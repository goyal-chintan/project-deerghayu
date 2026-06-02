<svelte:options runes />

<script>
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';

  import { portal } from '../lib/portal.js';
  import { pop, push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';
  import { NUTRIMENTS } from '../lib/nutrition.js';
  import { showSuccess, showError } from '../stores/toast.js';
  import { editorState, clearFoodEditorState } from '../stores/editorState.js';
  import Toggle from '../components/settings/Toggle.svelte';
  import UnitPicker from '../components/ui/UnitPicker.svelte';
  import { takePhoto } from '../lib/camera.js';
  import { isNative, getNativeMode } from '../lib/platform.js';
  import BarcodeScanner from '../components/foods/BarcodeScanner.svelte';
  import { foodsShowCategories, foodsShowLabels, foodsShowNotes, foodCategories, visibleNutriments, nutrimentsOrder, customNutriments, cropPhotos, offUsername, offPassword, offUploadCountry, energyUnit, catName as _catName, catDisplay as _catDisplay } from '../stores/settings.js';
  import { DIET_TYPES, DIET_LABELS } from '../lib/dietType.js';
  import { fitImageDataUrl } from '../lib/image-fit.js';

  // ── Photo capture / upload ─────────────────────────────────
  let fileInput;
  let showCamera = $state(false);
  let showUrlInput = $state(false);
  let photoUrl = $state('');
  function applyPhotoUrl() {
    const url = photoUrl.trim();
    if (url) { food.imgUrl = url; }
    showUrlInput = false;
    photoUrl = '';
  }
  let cameraVideo = null;
  let cameraStream = null;
  let showCrop = $state(false);
  let cropSrc = $state('');
  let cropImg = null;
  let cropBox = null;
  let cropDragging = false, cropStartX, cropStartY, cropOrigL, cropOrigT;

  function openGallery() { fileInput && fileInput.click(); }

  function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      if ($cropPhotos) {
        cropSrc = ev.target.result;
        showCrop = true;
      } else {
        // Downscale to keep payload under the server's 1MB JSON limit.
        // Preserves aspect ratio — no cropping.
        food.imgUrl = await fitImageDataUrl(ev.target.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function openCamera() {
    if (isNative) {
      try {
        const file = await takePhoto();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
          if ($cropPhotos) { cropSrc = ev.target.result; showCrop = true; }
          else { food.imgUrl = await fitImageDataUrl(ev.target.result); }
        };
        reader.readAsDataURL(file);
      } catch { /* user cancelled */ }
      return;
    }
    showCamera = true;
    await new Promise(r => setTimeout(r, 80));
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
      if (cameraVideo) { cameraVideo.srcObject = cameraStream; cameraVideo.play(); }
    } catch(err) {
      showCamera = false;
      showError('Camera access denied or unavailable.');
    }
  }

  function stopCamera() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    showCamera = false;
  }

  async function capturePhoto() {
    if (!cameraVideo) return;
    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    if ($cropPhotos) {
      cropSrc = dataUrl;
      showCrop = true;
    } else {
      food.imgUrl = await fitImageDataUrl(dataUrl);
    }
  }

  function removePhoto() { food.imgUrl = ''; }

  // Crop UI helpers
  function onCropImgLoad() {
    if (!cropImg || !cropBox) return;
    const w = cropImg.offsetWidth, h = cropImg.offsetHeight;
    cropBox.style.left   = Math.round(w * 0.1) + 'px';
    cropBox.style.top    = Math.round(h * 0.1) + 'px';
    cropBox.style.width  = Math.round(w * 0.8) + 'px';
    cropBox.style.height = Math.round(h * 0.8) + 'px';
  }

  function cropStartDrag(e) {
    cropDragging = true;
    const pt = e.touches ? e.touches[0] : e;
    cropStartX = pt.clientX; cropStartY = pt.clientY;
    cropOrigL = parseInt(cropBox.style.left); cropOrigT = parseInt(cropBox.style.top);
    e.preventDefault();
  }

  function cropMoveDrag(e) {
    if (!cropDragging || !cropImg || !cropBox) return;
    const pt = e.touches ? e.touches[0] : e;
    const w = cropImg.offsetWidth, h = cropImg.offsetHeight;
    cropBox.style.left = Math.max(0, Math.min(w - parseInt(cropBox.style.width),  cropOrigL + pt.clientX - cropStartX)) + 'px';
    cropBox.style.top  = Math.max(0, Math.min(h - parseInt(cropBox.style.height), cropOrigT + pt.clientY - cropStartY)) + 'px';
  }

  function cropEndDrag() { cropDragging = false; }

  function confirmCrop() {
    if (!cropImg || !cropBox) return;
    const scaleX = cropImg.naturalWidth  / cropImg.offsetWidth;
    const scaleY = cropImg.naturalHeight / cropImg.offsetHeight;
    const cx = parseInt(cropBox.style.left) * scaleX;
    const cy = parseInt(cropBox.style.top)  * scaleY;
    const cw = parseInt(cropBox.style.width)  * scaleX;
    const ch = parseInt(cropBox.style.height) * scaleY;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(cropImg, cx, cy, cw, ch, 0, 0, cw, ch);
    food.imgUrl = canvas.toDataURL('image/jpeg', 0.9);
    showCrop = false; cropSrc = '';
  }

  let { params } = $props();
  if (!params) params = {};

  let food = $state({
    name:'', brand:'', barcode:'', imgUrl:'',
    portion: 100, unit: 'g', categories: [], notes: '', diet_type: 'vegetarian',
    calories: '', kilojoules: '', fat: '', 'saturated-fat': '', 'trans-fat': '', 'polyunsaturated-fat': '', 'monounsaturated-fat': '', carbohydrates: '',
    sugars: '', 'added-sugars': '', proteins: '', salt: '', fiber: '',
    sodium: '', cholesterol: '', potassium: '', caffeine: '', alcohol: '',
    calcium: '', iron: '', magnesium: '', zinc: '', phosphorus: '',
    'vitamin-c': '', 'vitamin-a': '', 'vitamin-d': '', 'vitamin-e': '', 'vitamin-k': '',
    b1: '', b2: '', b3: '', b6: '', b9: '', b12: '',
    // _derived: { sodium?: true, salt?: true } — set when sodium/salt was
    // auto-calculated from the other field via the regulatory factor (× 2.5
    // / × 0.4). Cleared when the user manually edits the field. Persisted
    // in nutrition._derived on the saved food so the calculator icon
    // survives reloads.
    _derived: {},
  });
  let store = 'foodList';
  let saving = $state(false);
  let showAllNutrients = $state(false);
  let contributing = $state(false);
  let offSuccess = $state(false);
  // Off by default — proportional scaling can surprise users editing a single
  // value (e.g. correcting a typo'd protein gram). User opts in via the link
  // toggle next to the unit selector.
  let linked = $state(false);
  // Snapshot of values used as the baseline for proportional scaling.
  // Captured the moment the user flips `linked` on, NOT at mount: at
  // mount the food may be empty (new food), and even for edit-food the
  // user may have started typing before flipping linked on. Re-taking
  // it on toggle means the snapshot reflects the user's "lock these
  // proportions in" intent, not whatever was loaded.
  let _snapshot = null;
  let downloading = $state(false);
  let downloadSuccess = $state(false);
  let editorScannerOpen = $state(false);
  // Cached list of the user's foods, used for client-side duplicate-barcode
  // detection. Populated once on mount; refreshed only when the editor saves
  // (so a save+stay-open flow can re-check). Whitespace + leading-zero
  // normalisation matches the picker-page lookup behaviour.
  let _myFoods = [];
  let duplicateOf = $state(null);
  let matchedIngredients = $state([]);
  let ingredientsText = $state('');
  let isNewFood = $derived(!(params && params.id));
  let hasBarcode = $derived(!!(food.barcode && food.barcode.trim()));
  let isNativeLocal = $derived(isNative && getNativeMode() === 'local');

  function _normBarcode(b) {
    return String(b || '').trim().replace(/^0+/, '');
  }
  // Reactively check for a duplicate barcode in the user's library whenever
  // the field changes. Excludes the food currently being edited so editing
  // an existing food doesn't flag itself.
  $effect(() => {
    const bc = food.barcode;
    if (!bc || !bc.trim()) {
      duplicateOf = null;
    } else if (_myFoods && _myFoods.length) {
      const codeN = _normBarcode(bc);
      duplicateOf = _myFoods.find(f =>
        f.id !== food.id && f.barcode && _normBarcode(f.barcode) === codeN
      ) || null;
    }
  });

  // Inline scan handler — populate the barcode field, then auto-prefill the
  // form from OFF if the user hasn't typed anything substantive yet. Skips
  // the auto-prefill when the user has already filled name + nutrition so
  // we don't clobber curated data.
  async function onEditorScan({ detail }) {
    const code = detail?.code;
    if (!code) return;
    food.barcode = code;
    const looksEmpty = !food.name?.trim() && !food.brand?.trim() &&
      (food.nutrition == null || Object.keys(food.nutrition || {}).length === 0) &&
      !NUTRIMENTS.some(n => food[n.id] != null && food[n.id] !== '');
    if (looksEmpty && !isNativeLocal) {
      // Re-use the existing smart-fill that only writes empty fields.
      await downloadFromOFF();
    } else {
      showSuccess('Barcode set');
    }
  }


  let offVerified    = null;  // null = unchecked, true = confirmed, false = not found yet
  // OFF presence check for the barcode, drives the Share vs View button
  // label. null = not yet checked. true = product is in OFF (button is
  // "View on OFF"). false = not in OFF (button is "Share to OFF").
  let offProductExists = null;
  let _lastCheckedBarcode = null;

  async function _refreshOffPresence() {
    if (isNativeLocal) { offProductExists = null; return; }
    if (!food.barcode) { offProductExists = null; return; }
    if (_lastCheckedBarcode === food.barcode) return; // no-op refresh
    _lastCheckedBarcode = food.barcode;
    try {
      const { API } = await import('../lib/api.js');
      const existing = await API.lookupBarcode(food.barcode);
      offProductExists = !!existing;
    } catch {
      // Network failure shouldn't lock the button — treat as "unknown,
      // assume not in OFF" so the Share path stays reachable.
      offProductExists = false;
    }
  }
  $effect(() => {
    if (food.barcode && food.barcode !== _lastCheckedBarcode) _refreshOffPresence();
  });

  async function _openOffPage() {
    const url = 'https://world.openfoodfacts.org/product/' + encodeURIComponent(food.barcode);
    try {
      const { isNative } = await import('../lib/platform.js');
      if (isNative) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  async function shareOrViewOnOFF() {
    if (isNativeLocal) return;
    if (offProductExists) {
      await _openOffPage();
      return;
    }
    contributing = true; offSuccess = false; offVerified = null;
    try {
      const { API } = await import('../lib/api.js');
      // Final pre-flight lookup in case the local cached state is stale
      // (e.g. someone else contributed the product after we last checked).
      const existing = await API.lookupBarcode(food.barcode);
      if (existing) {
        offProductExists = true;
        contributing = false;
        await _openOffPage();
        return;
      }
      await _doUploadToOFF(API);
      offProductExists = true; // we just contributed it, mark as present
    } catch(e) {
      showError('Could not upload to Open Food Facts: ' + e.message);
      contributing = false;
    }
  }

  async function _doUploadToOFF(API) {
    const { NUTRIMENTS: NUT } = await import('../lib/nutrition.js');
    const nutrition = {};
    for (const n of NUT) {
      const v = food[n.id];
      if (v !== undefined && v !== '' && v !== null && !isNaN(parseFloat(v)))
        nutrition[n.id] = parseFloat(v);
    }
    await API.contributeToOFF(
      { name: food.name, barcode: food.barcode, brand: food.brand,
        portion: food.portion, unit: food.unit, nutrition },
      { offUsername: $offUsername, offPassword: $offPassword,
        offUploadCountry: $offUploadCountry }
    );
    offSuccess = true;
    contributing = false;
    // Give OFF a few seconds to index, then verify the product is live
    setTimeout(async () => {
      try {
        const found = await API.lookupBarcode(food.barcode);
        offVerified = !!found;
      } catch { offVerified = false; }
    }, 3000);
  }

  function takeSnapshot() {
    const allNuts = [...NUTRIMENTS, ...($customNutriments || [])];
    _snapshot = { portion: parseFloat(food.portion) || 0 };
    for (const n of allNuts) _snapshot[n.id] = parseFloat(food[n.id]) || 0;
  }

  let _scaleTimer = null;

  function applyProportional(changedId, newVal) {
    if (!linked || !_snapshot) return;
    const origVal = changedId === '__portion__' ? _snapshot.portion : _snapshot[changedId];
    if (!origVal || origVal <= 0 || newVal <= 0) return;
    const ratio = newVal / origVal;
    const allNuts = [...NUTRIMENTS, ...($customNutriments || [])];
    for (const n of allNuts) {
      if (n.id === changedId) continue;
      const v = _snapshot[n.id];
      if (v > 0) food[n.id] = Math.round(v * ratio * 10000) / 10000;
    }
    if (changedId !== '__portion__') {
      if (_snapshot.portion > 0) food.portion = Math.round(_snapshot.portion * ratio * 100) / 100;
    }
    food = { ...food };
  }

  function scheduleScale(changedId, getVal) {
    clearTimeout(_scaleTimer);
    _scaleTimer = setTimeout(() => { applyProportional(changedId, getVal()); }, 400);
  }

  function onPortionInput() { scheduleScale('__portion__', () => parseFloat(food.portion) || 0); }
  function onNutInput(id)   {
    // Per-nutrient typing does NOT trigger proportional scaling. The
    // link toggle is for "scale all nutrients to a new serving size",
    // not "rescale everything when I correct a single value." Keeping
    // scale on nutrient edits would surprise users fixing a typo'd
    // protein gram with a cascade across every other field.
    if (id === 'sodium' || id === 'salt') _handleSaltSodiumDerivation(id);
  }

  // Sodium ↔ salt derivation in the editor. When the user types in one and
  // the other is empty, auto-fill via the regulatory factor (sodium_mg =
  // salt_g × 400; salt_g = sodium_mg / 400) and flag the auto-filled field
  // as derived. When the user manually types in a field, clear its derived
  // flag (now user-entered, not derived).
  function _handleSaltSodiumDerivation(changedId) {
    if (!food._derived) food._derived = {};
    // The user just typed in `changedId` — it's no longer derived.
    if (food._derived[changedId]) food._derived = { ...food._derived, [changedId]: false };

    const otherId = changedId === 'sodium' ? 'salt' : 'sodium';
    const changedVal = parseFloat(food[changedId]);

    // Last-edited-wins. Sodium and salt are the same datum in different
    // units, so any edit to either side should recompute the other —
    // including over a value the user previously typed or that was
    // imported from a source with internally-inconsistent label data
    // (OFF / USDA sometimes reports both with values that don't agree).
    // Other nutrients keep the standard "preserve user input" rule;
    // only this pair gets last-edited-wins.
    if (Number.isFinite(changedVal) && changedVal > 0) {
      if (changedId === 'sodium') {
        food.salt   = Math.round((changedVal / 400) * 1000) / 1000;
        food._derived = { ...food._derived, salt: true };
      } else {
        food.sodium = Math.round((changedVal * 400) * 10) / 10;
        food._derived = { ...food._derived, sodium: true };
      }
    }
  }

  async function downloadFromOFF() {
    if (isNativeLocal) return;
    if (!food.barcode) return;
    downloading = true; downloadSuccess = false;
    try {
      const { API } = await import('../lib/api.js');
      const result = await API.lookupBarcode(food.barcode);
      if (!result) { showError('Not found in Open Food Facts'); return; }
      // Only fill empty fields (smart mode)
      if (!food.name && result.name)   food.name  = result.name;
      if (!food.brand && result.brand) food.brand = result.brand;
      if (result.nutrition) {
        for (const n of NUTRIMENTS) {
          const v = result.nutrition[n.id];
          if ((food[n.id] === '' || food[n.id] == null) && v != null) food[n.id] = v;
        }
      }
      if (!food.imgUrl && result.imgUrl) food.imgUrl = result.imgUrl;
      food = { ...food };
      downloadSuccess = true;
      setTimeout(() => downloadSuccess = false, 2500);
      showSuccess('Data refreshed from Open Food Facts');
    } catch(e) {
      showError('Refresh failed: ' + e.message);
    } finally { downloading = false; }
  }

  // Scan Label operations are fully delegated to the shared BarcodeScanner component.

  function handleOcrSuccess({ detail }) {
    const parsed = detail.parsed;
    if (!parsed) return;
    if (parsed.name) food.name = parsed.name;
    if (parsed.brand) food.brand = parsed.brand;
    if (parsed.portion) food.portion = parsed.portion;
    if (parsed.unit) food.unit = parsed.unit;
    if (parsed.nutrition) {
      for (const n of NUTRIMENTS) {
        const v = parsed.nutrition[n.id];
        if (v != null && !isNaN(parseFloat(v))) food[n.id] = parseFloat(v);
      }
    }
    matchedIngredients = parsed.ingredients || [];
    ingredientsText = parsed.ingredientsText || '';
    food = { ...food };
    showSuccess('Nutrition extracted from label');
  }

  async function runLocalIngredientMatching() {
    if (!ingredientsText.trim()) return;
    try {
      const { matchAndCalculateRecipeLocally } = await import('../lib/recipeMatcher.js');
      const res = await matchAndCalculateRecipeLocally(ingredientsText, food.portion || 100);
      if (res && res.ingredients) {
        matchedIngredients = res.ingredients;
        // The $effect above will auto-compute nutrition from the matched estimates
        const { showSuccess: toastSuccess } = await import('../stores/toast.js');
        toastSuccess('Ingredients matched and nutrition calculated!');
      } else {
        const { showError } = await import('../stores/toast.js');
        showError('Could not match any ingredients.');
      }
    } catch (e) {
      const { showError } = await import('../stores/toast.js');
      showError('Matching failed: ' + e.message);
    }
  }

  // Auto-recompute nutrition whenever matchedIngredients or their estPortion changes.
  // Uses $effect so it automatically tracks deep changes in the $state array.
  $effect(() => {
    const items = matchedIngredients;
    if (!items || items.length === 0) return;
    const computed = {};
    NUTRIMENTS.forEach(id => { computed[id] = 0; });
    items.forEach(item => {
      const portion = parseFloat(item.estPortion) || 0;
      const portionFactor = portion / (item.portion || 100);
      for (const n of NUTRIMENTS) {
        const val = parseFloat(item.nutrition[n.id]);
        if (!isNaN(val)) {
          computed[n.id] = (computed[n.id] || 0) + val * portionFactor;
        }
      }
    });
    for (const n of NUTRIMENTS) {
      food[n.id] = Math.round((computed[n.id] || 0) * 10) / 10;
    }
  });


  onMount(async () => {
    store = editorState.foodStore || 'foodList';
    // Cache the user's library for duplicate-barcode detection. Best-effort —
    // if the call fails the duplicate warning just stays inactive.
    NtApi.getFoods().then(list => { _myFoods = list || []; }).catch(() => {});
    if (editorState.foodPrefill) {
      const prefill = editorState.foodPrefill;
      // Flatten nested nutrition into top-level fields for editing
      const flatNutrition = (prefill.nutrition && typeof prefill.nutrition === 'object') ? { ...prefill.nutrition } : {};
      food = { ...food, ...prefill, ...flatNutrition };
      matchedIngredients = prefill.ingredients || [];
      ingredientsText = prefill.ingredientsText || '';
    } else if (params && params.id) {
      const existing = await NtApi.getFood(params.id).catch(() => null);
      if (existing) {
        const flatNutrition = (existing.nutrition && typeof existing.nutrition === 'object') ? { ...existing.nutrition } : {};
        food = { ...food, ...existing, ...flatNutrition };
        matchedIngredients = existing.ingredients || [];
        ingredientsText = existing.ingredientsText || '';
      }
    }
    // Default `linked` to ON when editing an existing food (the user is
    // almost always rescaling, and they expect serving size to preserve
    // density). For NEW food entry where the form starts empty, leave it
    // OFF so typing nutrient values from a label doesn't silently
    // cross-scale neighbouring fields. Fixes #28.
    const _hasNutrition = food.nutrition && Object.keys(food.nutrition || {}).length > 0;
    const _hasFlatNutrient = NUTRIMENTS.some(n => food[n.id] != null && food[n.id] !== '');
    if (_hasNutrition || _hasFlatNutrient) {
      linked = true;
      takeSnapshot();
    }
    // Snapshot otherwise is taken when the user flips `linked` on —
    // see the link-btn click handler.

  });

  // Read-only when viewing someone else's shared food. Server returns 403 on
  // PUT regardless, but locking the UI prevents the user from typing into a
  // form that won't save and gives them a single clear action: Save a Copy.
  let _readOnly = $derived(!!food._shared_by);

  async function saveAsCopy() {
    saving = true;
    try {
      // Strip the upstream id so it inserts as a new row owned by the current user.
      const copy = { ...food };
      const sourceId = food.id;
      delete copy.id;
      delete copy._shared_by;
      delete copy.user_id;
      delete copy.visibility;
      delete copy.favorite;
      const created = sourceId
        ? await NtApi.copyFood(sourceId)
        : await NtApi.createFood(copy);
      showSuccess('Saved a copy to your catalog');
      clearFoodEditorState();
      pop();
    } catch (e) { showError('Could not save copy: ' + e.message); }
    saving = false;
  }

  async function save() {
    if (!food.name.trim()) {
      showError($_('food_editor.errors.name_required'));
      return;
    }
    saving = true;
    try {
      // Build nested nutrition object from flat fields for Nutrition.calculate() compatibility
      const _nutrition = {};
      for (const _n of NUTRIMENTS) {
        const _v = food[_n.id];
        if (_v !== undefined && _v !== '' && _v !== null && !isNaN(parseFloat(_v))) {
          _nutrition[_n.id] = parseFloat(_v) || 0;
        }
      }
      // Persist the derived-flag map so the calculator icon survives reloads.
      // Strip falsy entries so empty maps don't bloat the JSON payload.
      if (food._derived) {
        const flags = {};
        for (const k of Object.keys(food._derived)) {
          if (food._derived[k]) flags[k] = true;
        }
        if (Object.keys(flags).length) _nutrition._derived = flags;
      }
      const item = { ...food, nutrition: _nutrition };
      const saved = food.id
        ? await NtApi.updateFood(food.id, item)
        : await NtApi.createFood(item);
      item.id = saved.id;
      // If called from diary pick mode, also add to diary
      const ctx = editorState.foodDiaryCtx;
      if (ctx) {
        const { addDiaryItem } = await import('../stores/diary.js');
        await addDiaryItem(
          { ...item, portion: item.portion || 100, unit: item.unit || 'g' },
          Number(ctx.meal) || 0,
          ctx.date
        );
      }
      clearFoodEditorState();
      showSuccess(ctx ? $_('food_editor.added_to_diary') : $_('food_editor.saved'));
      if (ctx) {
        // Go back twice to return to diary
        history.go(-2);
      } else {
        pop();
      }
    } catch(e) {
      showError('Save failed: ' + (e.message || e));
    } finally {
      saving = false;
    }
  }

  function toggleCategory(cat) {
    const name = _catName(cat);
    food.categories = food.categories || [];
    if (food.categories.includes(name)) {
      food.categories = food.categories.filter(c => c !== name);
    } else {
      food.categories = [...food.categories, name];
    }
  }

  // Apply the user's custom nutriment order (set via drag-to-reorder in
  // Settings → Nutrients). Without this the editor stayed on the static
  // NUTRIMENTS array order even after the user reorganized.
  function _applyOrder(list) {
    const ord = $nutrimentsOrder || [];
    if (!ord.length) return list;
    return list.slice().sort((a, b) => {
      const ai = ord.indexOf(a.id);
      const bi = ord.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  let visibleFields = $derived.by(() => {
    const vis = $visibleNutriments;
    const base = vis ? NUTRIMENTS.filter(n => vis.includes(n.id)) : NUTRIMENTS.filter(n => n.default);
    return _applyOrder(base);
  });

  let allFields = $derived(_applyOrder(NUTRIMENTS));
  let displayFields = $derived(showAllNutrients ? allFields : visibleFields);
</script>

<div class="page-shell editor-page">
  <!-- Header -->
  <header class="editor-header">
    <button class="btn-icon" on:click={pop} aria-label={$_('common.back')} title={$_('common.back')}>
      <span class="material-symbols-rounded">arrow_back</span>
    </button>
    <h2 class="editor-title">{_readOnly ? `Shared by ${food._shared_by}` : (food.id ? 'Edit Food' : 'Add Food')}</h2>
    {#if food.id && !_readOnly}
      <button class="btn-icon fav-btn" class:on={!!food.favorite}
        on:click={() => { food.favorite = food.favorite ? 0 : 1; food = food; }}
        aria-label={food.favorite ? 'Unfavorite' : 'Favorite'}
        title={food.favorite ? 'Unfavorite' : 'Add to favorites'}>
        <span class="material-symbols-rounded">{food.favorite ? 'favorite' : 'favorite_border'}</span>
      </button>
    {/if}
    {#if _readOnly}
      <button class="btn btn-primary" style="height:36px;padding:0 14px;font-size:13px;white-space:nowrap"
        on:click={saveAsCopy} disabled={saving}>
        {saving ? 'Copying…' : 'Save to My Catalog'}
      </button>
    {:else}
      <button class="btn btn-primary" style="height:36px;padding:0 16px;font-size:13px"
        on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    {/if}
  </header>

  {#if _readOnly}
    <div class="readonly-banner">
      <span class="material-symbols-rounded">lock</span>
      <div>
        <div class="readonly-title">Shared by {food._shared_by} — read only</div>
        <div class="readonly-sub">Tap <strong>Save to My Catalog</strong> to bring this into your catalog and edit it.</div>
      </div>
    </div>
  {/if}

  <div class="page-content editor-content" class:readonly-content={_readOnly} inert={_readOnly || null}>
    <!-- Photo -->
    <div class="card editor-card photo-card">
      <div class="editor-card-title">Photo</div>
      <div class="photo-preview-wrap">
        {#if food.imgUrl}
          <img class="photo-preview-img" src={food.imgUrl} alt="Food" />
          <button class="photo-remove-btn btn-icon" on:click={removePhoto} aria-label="Remove photo" title="Remove photo">
            <span class="material-symbols-rounded" style="font-size:18px">close</span>
          </button>
        {:else}
          <div class="photo-placeholder">
            <span class="material-symbols-rounded" style="font-size:48px;opacity:0.25">photo_camera</span>
          </div>
        {/if}
      </div>
      <div class="photo-btn-row">
        <button class="btn btn-ghost photo-action-btn" on:click={openCamera}>
          <span class="material-symbols-rounded">camera_alt</span>
          Camera
        </button>
        <button class="btn btn-ghost photo-action-btn" on:click={openGallery}>
          <span class="material-symbols-rounded">photo_library</span>
          Upload
        </button>
        <button class="btn btn-ghost photo-action-btn" on:click={() => { showUrlInput = !showUrlInput; photoUrl = ''; }}>
          <span class="material-symbols-rounded">link</span>
          URL
        </button>
      </div>
      {#if showUrlInput}
        <div class="photo-url-row">
          <input class="input photo-url-input" placeholder="https://..." bind:value={photoUrl}
            on:keydown={e => e.key === 'Enter' && applyPhotoUrl()} />
          <button class="btn btn-primary" on:click={applyPhotoUrl}>Get</button>
        </div>
      {/if}
      <input bind:this={fileInput} type="file" accept="image/*" style="display:none" on:change={onFileChange} />
    </div>

    <!-- Camera popup -->
    {#if showCamera}
      <div class="cam-overlay" role="dialog" aria-modal="true" use:portal>
        <div class="cam-popup">
          <div class="cam-header">
            <span class="cam-title">Take Photo</span>
            <button class="btn-icon" on:click={stopCamera} aria-label="Cancel" title="Close camera">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
          <!-- svelte-ignore a11y-media-has-caption -->
          <video bind:this={cameraVideo} autoplay playsinline muted class="cam-video"></video>
          <div class="cam-footer">
            <button class="btn btn-primary cam-capture-btn" on:click={capturePhoto}>
              <span class="material-symbols-rounded">camera_alt</span>
              Capture
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Crop popup -->
    {#if showCrop}
      <div class="cam-overlay" role="dialog" aria-modal="true" use:portal>
        <div class="cam-popup">
          <div class="cam-header">
            <span class="cam-title">Crop Photo</span>
            <button class="btn-icon" on:click={() => { showCrop = false; cropSrc = ''; }} aria-label="Cancel" title="Cancel">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
          <p class="crop-hint">Drag the box to reposition</p>
          <div class="crop-container"
            on:mousemove={cropMoveDrag}
            on:touchmove={cropMoveDrag}
            on:mouseup={cropEndDrag}
            on:touchend={cropEndDrag}
          >
            <img bind:this={cropImg} src={cropSrc} class="crop-img" alt="Crop" on:load={onCropImgLoad} />
            <div bind:this={cropBox} class="crop-box"
              on:mousedown={cropStartDrag}
              on:touchstart={cropStartDrag}
            ></div>
          </div>
          <div class="cam-footer">
            <button class="btn btn-primary" on:click={confirmCrop}>Crop &amp; Use</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Basic info -->
    <div class="card editor-card">
      <div class="editor-card-title">Basic Info</div>
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="input" placeholder={$_('food_editor.name_placeholder')} bind:value={food.name} />
      </div>
      <div class="form-group">
        <label class="form-label">Brand</label>
        <input class="input" placeholder={$_('food_editor.brand_placeholder')} bind:value={food.brand} />
      </div>
      <div class="form-row" style="align-items:flex-end">
        <div class="form-group" style="flex:1">
          <label class="form-label">Serving Size</label>
          <input class="input" type="number" min="0" bind:value={food.portion}
            on:input={onPortionInput} />
        </div>
        <div class="form-group" style="width:100px">
          <label class="form-label">Unit</label>
          <UnitPicker bind:value={food.unit} />
        </div>
        <button class="btn-icon link-btn" class:linked title={linked ? 'All fields scale proportionally' : 'Fields are independent'}
          on:click={() => { linked = !linked; if (linked) takeSnapshot(); }}>
          <span class="material-symbols-rounded" style="font-size:20px">{linked ? 'link' : 'link_off'}</span>
        </button>
      </div>
      <div class="form-group">
        <label class="form-label">Barcode</label>
        <div class="barcode-input-wrap">
          <input class="input barcode-input" type="text" inputmode="numeric" placeholder="Optional" bind:value={food.barcode} />
          <button type="button" class="barcode-scan-inline" title="Scan barcode" aria-label="Scan barcode"
            on:click={() => editorScannerOpen = true}>
            <span class="material-symbols-rounded">barcode_scanner</span>
          </button>
        </div>
        {#if duplicateOf}
          <div class="barcode-dup-warn">
            <span class="material-symbols-rounded" style="font-size:16px;color:var(--warning,#f59e0b)">warning</span>
            <span>You already have a food with this barcode: <strong>{duplicateOf.name}</strong></span>
            <button type="button" class="btn-link" on:click={() => {
              clearFoodEditorState();
              editorState.foodStore = store;
              if (editorState.foodDiaryCtx) { /* preserve pick-mode context */ }
              push(`/foods/edit/${duplicateOf.id}`);
            }}>Open existing →</button>
          </div>
        {/if}
        {#if hasBarcode && !isNativeLocal}
          <div class="form-row" style="gap:8px;margin-top:8px">
            <button class="btn btn-secondary" style="flex:1"
              on:click={shareOrViewOnOFF} disabled={contributing}>
              <span class="material-symbols-rounded" style="font-size:15px;vertical-align:middle;margin-right:4px">
                {offProductExists ? 'open_in_new' : 'upload'}
              </span>
              {contributing ? 'Uploading…' : offSuccess ? 'Submitted!' : offProductExists ? 'View on OFF' : 'Share to OFF'}
            </button>
            <button class="btn btn-secondary" style="flex:1"
              on:click={downloadFromOFF} disabled={downloading}>
              <span class="material-symbols-rounded" style="font-size:15px;vertical-align:middle;margin-right:4px">download</span>
              {downloading ? 'Loading…' : downloadSuccess ? 'Updated!' : 'Refresh from OFF'}
            </button>
          </div>
          {#if offSuccess}
            <div class="off-verify-row">
              {#if offVerified === null}
                <span class="off-verify-checking">
                  <span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle">hourglass_top</span>
                  Verifying on Open Food Facts…
                </span>
              {:else if offVerified}
                <span class="off-verify-ok">
                  <span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle">check_circle</span>
                  Confirmed live on Open Food Facts
                </span>
              {:else}
                <span class="off-verify-pending">
                  <span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle">schedule</span>
                  Submitted — may take a few minutes to appear
                </span>
              {/if}
              <a class="off-verify-link" href="https://world.openfoodfacts.org/product/{food.barcode}" target="_blank" rel="noopener">
                View on Open Food Facts <span class="material-symbols-rounded" style="font-size:12px;vertical-align:middle">open_in_new</span>
              </a>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <!-- Categories -->
    {#if $foodsShowCategories && ($foodCategories || []).length > 0}
      <div class="card editor-card">
        <div class="editor-card-title">Categories</div>
        <div class="cat-chips">
          {#each $foodCategories as cat}
            <button class="chip" class:accent={(food.categories||[]).includes(_catName(cat))}
              on:click={() => toggleCategory(cat)}>
              {#if (food.categories||[]).includes(_catName(cat))}
                <span class="material-symbols-rounded" style="font-size:14px">check</span>
              {/if}
              {$foodsShowLabels ? _catDisplay(cat) : _catName(cat)}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Diet Type -->
    <div class="card editor-card">
      <div class="editor-card-title">Diet Type</div>
      <select class="input" bind:value={food.diet_type}>
        {#each DIET_TYPES as dt}
          <option value={dt}>{DIET_LABELS[dt]}</option>
        {/each}
      </select>
    </div>

    <!-- Notes -->
    {#if $foodsShowNotes}
      <div class="card editor-card">
        <div class="editor-card-title">Notes</div>
        <textarea class="input textarea" placeholder="Optional notes" bind:value={food.notes}></textarea>
      </div>
    {/if}

    <!-- Ingredients & Matching Card -->
    <div class="card editor-card">
      <div class="editor-card-title">
        <span>Ingredients (Local DB Matching)</span>
      </div>
      <div class="form-group">
        <label class="form-label">Raw Ingredients List</label>
        <textarea class="input textarea" style="min-height: 80px" placeholder="Wheat flour, sugar, palm oil..." bind:value={ingredientsText}></textarea>
        {#if ingredientsText.trim()}
          <button type="button" class="btn btn-secondary" style="width: 100%; min-height: 44px; margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 8px" on:click={runLocalIngredientMatching}>
            <span class="material-symbols-rounded" style="font-size: 20px">hdr_strong</span>
            <span>Match & Estimate</span>
          </button>
        {/if}
      </div>

      {#if matchedIngredients.length > 0}
        <div class="matched-ingredients-list" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--text-2)">
            Matched Foods & Estimated Weight (Portion: {food.portion}{food.unit}):
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            {#each matchedIngredients as item}
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:4px 0">
                <span style="color:var(--text-1)">
                  {item.name} 
                  {#if item.id == null}
                    <span style="color:var(--warning,#f59e0b);font-size:11px;margin-left:4px">(No direct database match)</span>
                  {:else}
                    <span style="color:var(--accent);font-size:11px;margin-left:4px">(IFCT Seeded)</span>
                  {/if}
                </span>
                <div style="display:flex;align-items:center;gap:6px">
                  <input class="input" type="number" min="0" max="1000" step="1" style="width:75px;padding:6px 8px;text-align:right;height:40px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm,#8px)"
                    bind:value={item.estPortion} />
                  <span style="color:var(--text-2);font-weight:500">{item.unit}</span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Nutrition -->
    <div class="card editor-card">
      <div class="editor-card-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span>Nutrition</span>
        <button type="button" class="scan-label-btn" on:click={() => { editorScannerOpen = true; }}
          title="Take a photo of the nutrition label to fill these fields"
          aria-label="Scan nutrition label">
          <span class="material-symbols-rounded scan-icon">photo_camera</span>
          <span>Scan Label</span>
        </button>
      </div>
      {#each displayFields as n}
        {@const _kjMode = n.id === 'calories' && $energyUnit === 'kJ'}
        <div class="form-group" class:nutrient-sub={n.subOf}>
          <label class="form-label">
            {_kjMode ? 'Energy' : n.label} ({_kjMode ? 'kJ' : n.unit})
            {#if (n.id === 'sodium' || n.id === 'salt') && food._derived && food._derived[n.id]}
              <span class="material-symbols-rounded" style="font-size:14px;color:var(--text-3);vertical-align:middle;margin-left:2px"
                title={n.id === 'sodium' ? 'Auto-calculated from salt (× 400 mg/g)' : 'Auto-calculated from sodium (÷ 400)'}>calculate</span>
            {/if}
          </label>
          {#if _kjMode}
            <input class="input" type="number" min="0" step="1" placeholder="0"
              value={food.calories ? Math.round(food.calories * 4.184) : ''}
              on:input={(e) => { const v = parseFloat(e.target.value); food.calories = isNaN(v) ? '' : v / 4.184; onNutInput('calories'); }} />
          {:else}
            <input class="input" type="number" min="0" step="0.1" placeholder="0"
              bind:value={food[n.id]}
              on:input={() => onNutInput(n.id)} />
          {/if}
        </div>
      {/each}
      <button class="btn btn-ghost w-full" style="margin-top:8px"
        on:click={() => showAllNutrients = !showAllNutrients}>
        {showAllNutrients ? 'Show less' : 'Show all nutrients'}
      </button>
    </div>

    <div style="height:16px"></div>
  </div>
</div>

<!-- Inline barcode scanner — fired by the scan button next to the Barcode field -->
<BarcodeScanner bind:open={editorScannerOpen} on:scan={onEditorScan} on:scan-label-success={handleOcrSuccess} on:close={() => editorScannerOpen = false} />

<style>
  /* Indented sub-nutrient rows — Saturated Fat under Total Fat, Sugars
     under Carbs, etc. Mirrors the FDA Nutrition Facts label hierarchy
     and matches CookTrace's PantryEditor for cross-app consistency. */
  .nutrient-sub { padding-left: 12px; }
  .nutrient-sub .form-label { color: var(--text-3); font-weight: 500; }

  /* Barcode field — scan button absolutely positioned inside the input
     wrapper, mirroring the search-bar pattern in Foods.svelte. */
  .barcode-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .barcode-input {
    flex: 1;
    width: 100%;
    padding-right: 38px; /* leave room for the scan icon */
  }
  .barcode-scan-inline {
    position: absolute;
    right: 6px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-3);
    padding: 4px;
    display: flex;
    align-items: center;
  }
  .barcode-scan-inline:hover { color: var(--text-1); }
  .barcode-scan-inline .material-symbols-rounded { font-size: 20px; }

  .barcode-dup-warn {
    display: flex; align-items: center; gap: 8px;
    margin-top: 8px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--warning, #f59e0b) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning, #f59e0b) 30%, transparent);
    border-radius: var(--radius-md);
    font-size: 13px;
    color: var(--text-1);
    flex-wrap: wrap;
  }
  .barcode-dup-warn .btn-link {
    background: none; border: none; cursor: pointer;
    color: var(--accent); font-weight: 600; font-size: 13px;
    padding: 0; margin-left: auto;
    font-family: inherit;
  }
  .barcode-dup-warn .btn-link:hover { text-decoration: underline; }

  .link-btn { color: var(--text-3); margin-bottom: 2px; }
  .link-btn.linked { color: var(--accent); }
  .editor-page {
    padding-top: 0;
    position: fixed;
    inset: 0;
    overflow-y: auto;
    z-index: 30;
    background: var(--bg);
  }
  .editor-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: calc(var(--safe-top) + 12px) 16px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-1);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .editor-title { font-size: 17px; font-weight: 600; flex: 1; }
  .fav-btn { color: var(--text-3); }
  .fav-btn.on { color: var(--macro-protein, #ec4899); }
  .editor-content { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; padding-bottom: 32px; }
  .readonly-content { opacity: 0.78; pointer-events: none; }
  .readonly-banner {
    display: flex; align-items: center; gap: 12px;
    padding: 12px var(--page-px);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .readonly-banner .material-symbols-rounded { color: var(--accent); font-size: 20px; flex-shrink: 0; }
  .readonly-title { font-weight: 600; }
  .readonly-sub   { color: var(--text-3); font-size: 12px; margin-top: 2px; line-height: 1.4; }
  .editor-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .editor-card-title { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); margin-bottom: 4px; }
  .form-row { display: flex; gap: 12px; align-items: flex-end; }
  .off-verify-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; font-size: 12px; padding: 6px 2px 0;
  }
  .off-verify-checking { color: var(--text-3); }
  .off-verify-ok { color: var(--success, #4caf50); }
  .off-verify-pending { color: var(--text-3); }
  .off-verify-link {
    color: var(--accent); text-decoration: none; font-size: 12px;
    white-space: nowrap; flex-shrink: 0;
  }
  .off-verify-link:hover { text-decoration: underline; }
  .cat-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  /* Photo section */
  .photo-card { gap: 10px; }
  .photo-preview-wrap {
    position: relative;
    width: min(360px, 100%);
    aspect-ratio: 1 / 1;
    margin: 0 auto;
    background: var(--surface-2);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed var(--border-strong);
  }
  .photo-preview-wrap:has(.photo-preview-img) {
    border-style: solid;
    border-color: transparent;
  }
  .photo-preview-img {
    width: 100%;
    height: 100%;
    /* cover = scale to fill, center-cropped on overflow edges. Looks
       better than letterboxing for food photos where the subject is
       typically centered in the frame. */
    object-fit: cover;
    background: var(--surface-2);
  }
  .photo-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
  .photo-remove-btn {
    position: absolute;
    top: 8px; right: 8px;
    background: rgba(0,0,0,0.55);
    color: #fff;
    border-radius: 50%;
    width: 32px; height: 32px;
  }
  .photo-btn-row { display: flex; gap: 8px; }
  .photo-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 13px;
  }
  .photo-action-btn .material-symbols-rounded { font-size: 18px; }
  .photo-url-row { display: flex; gap: 8px; margin-top: 8px; }
  .photo-url-input { flex: 1; }

  /* Camera / crop overlay — shared with MealEditor via :global */
  :global(.cam-overlay) {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.9);
    display: flex; align-items: center; justify-content: center;
  }
  :global(.cam-popup) {
    background: var(--surface-1);
    border-radius: var(--radius-xl);
    width: min(480px, 96vw);
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  :global(.cam-header) {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px; border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  :global(.cam-title) { font-size: 17px; font-weight: 600; }
  :global(.cam-video) { width: 100%; max-height: 50vh; background: #000; display: block; }
  :global(.cam-footer) {
    padding: 16px;
    border-top: 1px solid var(--border);
    display: flex; justify-content: center;
    flex-shrink: 0;
  }
  :global(.cam-capture-btn) { gap: 6px; min-width: 140px; }
  :global(.crop-hint) { padding: 8px 16px 0; font-size: 12px; color: var(--text-3); }
  :global(.crop-container) { position: relative; overflow: hidden; user-select: none; touch-action: none; }
  :global(.crop-img) { display: block; max-width: 100%; max-height: 55vh; user-select: none; }
  :global(.crop-box) {
    position: absolute;
    border: 2px solid #fff;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);
    cursor: move;
    box-sizing: border-box;
    touch-action: none;
  }

  /* Scan Label button — sits in the Nutrition card title row. Icon + text
     so the action is obvious (camera alone could be confused with food
     photo / profile picture). Compact enough to fit the title row on
     mobile. */
  .scan-label-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-1);
    border: 1px solid var(--border);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }
  .scan-label-btn:hover { background: var(--surface-3); }
  .scan-label-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .scan-label-btn .material-symbols-rounded { font-size: 18px; }

  @keyframes spin { to { transform: rotate(360deg); } }

</style>
