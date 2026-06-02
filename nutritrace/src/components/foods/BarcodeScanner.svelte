<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { fly } from 'svelte/transition';
  import { isNative, getNativeMode } from '../../lib/platform.js';

  // Portal to document.body — prevents position:fixed being trapped by
  // ancestor transforms or opacity transitions (common iOS issue)
  function modalPortal(node) {
    document.body.appendChild(node);
    document.body.style.overflow = 'hidden';
    return {
      destroy() {
        node.remove();
        document.body.style.overflow = '';
      }
    };
  }
  import { barcodeBeep, barcodeFlashlight, aiEffectivelyEnabled, envLocks, aiProvider, aiApiKey, aiModel, aiBaseUrl } from '../../stores/settings.js';
  import { callAI, callAIProxy } from '../../lib/aiChat.js';
  import { NUTRIMENTS } from '../../lib/nutrition.js';
  import { parseNutritionTextLocally, matchAndCalculateRecipeLocally } from '../../lib/recipeMatcher.js';
  import Dialog from '../ui/Dialog.svelte';

  export let open = false;

  const dispatch = createEventDispatcher();

  let readerId = 'scanner-' + Math.random().toString(36).slice(2);
  let scannerDiv;
  let engine = null;
  let detected = false;
  let selectedEngine = localStorage.getItem('wl_scanEngine') || 'zxing';
  let selectedCamId  = localStorage.getItem('wl_scanCamId')  || '';
  let cameras = [];
  let status = 'Requesting camera…';
  let torchVisible = false;
  let torchOn = false;
  let manualCode = '';
  let scanlineVisible = false;
  let scanning = false;
  $: _isNativeLocal = isNative && getNativeMode() === 'local';
  $: _canUseAiLabelScan = $aiEffectivelyEnabled && !_isNativeLocal;

  /** AI OCR privacy opt-in state */
  let showAiOcrConfirm = false;
  let _pendingAiOcrScan = null; // holds the closure to resume scan after opt-in
  $: _aiOcrOptedIn = typeof localStorage !== 'undefined' && localStorage.getItem('nt:aiOcrOptedIn') === 'true';

  // CSS injected for quagga/html5qr video fill
  let styleEl = null;

  // Lazy-load the barcode scanner libraries (~870 KB total) only when the
  // scanner actually opens. Cached promise so subsequent opens reuse loaded scripts.
  let _libsPromise = null;
  function _loadBarcodeLibs() {
    if (_libsPromise) return _libsPromise;
    const inject = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
    _libsPromise = Promise.all([
      inject('/vendor/zxing.min.js'),
      inject('/vendor/html5-qrcode.min.js'),
      inject('/vendor/quagga2.min.js'),
    ]).catch(e => {
      _libsPromise = null;          // allow retry
      throw e;
    });
    return _libsPromise;
  }

  const _hideEl = el => {
    el.style.setProperty('display','none','important');
    el.style.setProperty('visibility','hidden','important');
  };

  let h5Observer = null;

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 1046;
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
    } catch(e) {}
  }

  async function stopEngine() {
    if (!engine) return;
    try {
      if (engine._type === 'zxing') {
        engine.reader.reset();
        if (engine.videoEl && engine.videoEl.srcObject) {
          engine.videoEl.srcObject.getTracks().forEach(t => t.stop());
          engine.videoEl.srcObject = null;
        }
      } else if (engine._type === 'html5qr' && engine.running) {
        await engine.reader.stop().catch(() => {});
      } else if (engine._type === 'quagga2') {
        try { window.Quagga && Quagga.stop(); } catch(e) {}
      }
    } catch(e) {}
    engine = null;
  }

  async function close() {
    detected = true;
    scanning = false;
    await stopEngine();
    if (h5Observer) { h5Observer.disconnect(); h5Observer = null; }
    if (styleEl) { styleEl.remove(); styleEl = null; }
    dispatch('close');
  }

  async function onCode(code) {
    if (detected) return;
    detected = true;
    if ($barcodeBeep) playBeep();
    scanlineVisible = true;
    setTimeout(() => scanlineVisible = false, 500);
    await close();
    dispatch('scan', { code });
  }

  async function startCamera(deviceId) {
    if (detected || !deviceId || !scannerDiv) return;
    status = 'Starting camera…';
    torchVisible = false;
    torchOn = false;

    if (selectedEngine === 'zxing') {
      if (!window.ZXing || !ZXing.BrowserMultiFormatReader) { status = 'ZXing not loaded.'; return; }
      scannerDiv.innerHTML = '';
      const videoEl = document.createElement('video');
      videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;position:absolute;top:0;left:0';
      videoEl.setAttribute('playsinline', ''); videoEl.setAttribute('muted', '');
      scannerDiv.appendChild(videoEl);
      const reader = new ZXing.BrowserMultiFormatReader();
      engine = { _type: 'zxing', reader, videoEl, torchOn: false };
      navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
        .then(stream => {
          videoEl.srcObject = stream;
          return videoEl.play().then(() => reader.decodeFromStream(stream, videoEl, async r => { if (r) await onCode(r.getText()); }));
        }).then(() => {
          if (!detected) status = 'Align Barcode';
          try {
            const t = videoEl.srcObject && videoEl.srcObject.getVideoTracks()[0];
            if (t) {
              const caps = t.getCapabilities ? t.getCapabilities() : {};
              if ('torch' in caps) {
                torchVisible = true;
                if ($barcodeFlashlight) {
                  torchOn = true; engine.torchOn = true;
                  t.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
                }
              }
            }
          } catch(e) {}
        }).catch(err => { console.error('[ZXing]', err); status = 'Camera error — try another engine.'; });

    } else if (selectedEngine === 'html5qr') {
      if (!window.Html5Qrcode) { status = 'html5-qrcode not loaded.'; return; }
      scannerDiv.innerHTML = '';
      const hId = readerId + 'h';
      const inner = document.createElement('div');
      inner.id = hId; inner.style.cssText = 'width:100%;height:100%;position:relative';
      scannerDiv.appendChild(inner);

      if (h5Observer) h5Observer.disconnect();
      h5Observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
          m.addedNodes && m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            const id = node.id || '';
            if (id === 'qr-shaded-region' || id.includes('__scan_region__') || id.includes('__dashboard') || id.includes('__header')) {
              _hideEl(node);
            } else if (id.includes('__scan_region')) {
              node.style.setProperty('position','absolute','important');
              node.style.setProperty('inset','0','important');
              node.style.setProperty('width','100%','important');
              node.style.setProperty('height','100%','important');
              node.style.setProperty('border','none','important');
              node.style.setProperty('box-shadow','none','important');
            } else if (node.tagName === 'VIDEO') {
              node.style.cssText = 'width:100%!important;height:100%!important;object-fit:cover!important;position:absolute!important;top:0!important;left:0!important;display:block!important';
            } else if (node.tagName !== 'CANVAS' && id && id.startsWith(hId)) {
              _hideEl(node);
            }
          });
          if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
            const id = m.target.id || '';
            if (id === 'qr-shaded-region' || id.includes('__scan_region__') || id.includes('__dashboard') || id.includes('__header')) {
              _hideEl(m.target);
            }
          }
        });
      });
      h5Observer.observe(inner, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

      const reader = new Html5Qrcode(inner.id);
      engine = { _type: 'html5qr', reader, running: false, torchOn: false };
      reader.start(deviceId, { fps: 10 }, async t => await onCode(t), () => {})
        .then(() => {
          engine.running = true;
          if (!detected) status = 'Align Barcode';
          try {
            inner.querySelectorAll('div,img,button,span').forEach(el => _hideEl(el));
            const shaded = document.getElementById('qr-shaded-region');
            if (shaded) _hideEl(shaded);
            const vid = inner.querySelector('video');
            if (vid) {
              vid.style.setProperty('display','block','important');
              vid.style.setProperty('visibility','visible','important');
              vid.style.setProperty('width','100%','important');
              vid.style.setProperty('height','100%','important');
              vid.style.setProperty('object-fit','cover','important');
              vid.style.setProperty('position','absolute','important');
              vid.style.setProperty('top','0','important');
              vid.style.setProperty('left','0','important');
            }
          } catch(e) {}
          try {
            const caps = reader.getRunningTrackCameraCapabilities();
            const tf = caps.torchFeature();
            if (tf.isSupported()) {
              torchVisible = true;
              if ($barcodeFlashlight) {
                torchOn = true; engine.torchOn = true;
                tf.apply(true).catch(() => {});
              }
            }
          } catch(e) {}
        }).catch(err => { console.error('[html5qr]', err); status = 'Camera error — try another engine.'; });

    } else if (selectedEngine === 'quagga2') {
      if (!window.Quagga) { status = 'Quagga2 not loaded.'; return; }
      scannerDiv.innerHTML = '';
      engine = { _type: 'quagga2', torchOn: false };
      Quagga.init({
        inputStream: { type: 'LiveStream', target: scannerDiv, constraints: { deviceId: { exact: deviceId } } },
        decoder: { readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader','code_39_reader'] },
        locate: true
      }, err => {
        if (err) { console.error('[Quagga2]', err); status = 'Quagga2 error — try another engine.'; return; }
        Quagga.start();
        if (!detected) status = 'Align Barcode';
        setTimeout(() => {
          try {
            const t = window.Quagga && Quagga.CameraAccess && Quagga.CameraAccess.getActiveTrack && Quagga.CameraAccess.getActiveTrack();
            if (t) {
              const caps = t.getCapabilities ? t.getCapabilities() : {};
              if ('torch' in caps) {
                torchVisible = true;
                if ($barcodeFlashlight) {
                  torchOn = true; engine.torchOn = true;
                  t.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
                }
              }
            }
          } catch(e) {}
        }, 800);
      });
      Quagga.offDetected();
      Quagga.onDetected(async result => { if (result && result.codeResult) await onCode(result.codeResult.code); });
    }
  }

  async function toggleTorch() {
    if (!engine) return;
    torchOn = !torchOn;
    engine.torchOn = torchOn;
    try {
      if (engine._type === 'zxing' && engine.videoEl && engine.videoEl.srcObject) {
        const t = engine.videoEl.srcObject.getVideoTracks()[0];
        if (t) await t.applyConstraints({ advanced: [{ torch: torchOn }] });
      } else if (engine._type === 'html5qr') {
        await engine.reader.getRunningTrackCameraCapabilities().torchFeature().apply(torchOn).catch(() => {});
      } else if (engine._type === 'quagga2') {
        const t = window.Quagga && Quagga.CameraAccess && Quagga.CameraAccess.getActiveTrack && Quagga.CameraAccess.getActiveTrack();
        if (t) await t.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
      }
    } catch(e) {}
  }

  async function onEngineChange(e) {
    selectedEngine = e.target.value;
    localStorage.setItem('wl_scanEngine', selectedEngine);
    await stopEngine();
    if (scannerDiv) scannerDiv.innerHTML = '';
    torchVisible = false;
    if (selectedCamId) setTimeout(() => startCamera(selectedCamId), 300);
  }

  async function onCamChange(e) {
    selectedCamId = e.target.value;
    localStorage.setItem('wl_scanCamId', selectedCamId);
    await stopEngine();
    if (scannerDiv) scannerDiv.innerHTML = '';
    torchVisible = false;
    setTimeout(() => startCamera(selectedCamId), 300);
  }

  async function refresh() {
    if (!selectedCamId) return;
    await stopEngine();
    if (scannerDiv) scannerDiv.innerHTML = '';
    torchVisible = false;
    setTimeout(() => startCamera(selectedCamId), 300);
  }

  async function doManual() {
    if (detected) return;
    const code = manualCode.trim();
    if (!code) return;
    detected = true;
    await close();
    dispatch('scan', { code });
  }

  async function startScanner() {
    detected = false;
    scanning = true;
    status = 'Loading scanner…';
    try {
      await _loadBarcodeLibs();
    } catch (e) {
      status = 'Failed to load scanner libraries.';
      scanning = false;
      return;
    }

    // Inject video fill CSS
    styleEl = document.createElement('style');
    styleEl.textContent =
      '#' + readerId + ' video{width:100%!important;height:100%!important;object-fit:cover!important;position:absolute!important;top:0!important;left:0!important;display:block!important}' +
      '#' + readerId + ' canvas{width:100%!important;height:100%!important;position:absolute!important;top:0!important;left:0!important;pointer-events:none!important}';
    document.head.appendChild(styleEl);

    navigator.mediaDevices.getUserMedia({ video: true })
      .then(ps => { ps.getTracks().forEach(t => t.stop()); return navigator.mediaDevices.enumerateDevices(); })
      .then(devices => {
        if (detected) return;
        cameras = devices.filter(d => d.kind === 'videoinput').map((d, i) => ({
          deviceId: d.deviceId, label: d.label || ('Camera ' + (i + 1))
        }));
        if (!cameras.length) { status = 'No camera found.'; return; }
        const preferred = (selectedCamId && cameras.find(d => d.deviceId === selectedCamId))
                       || cameras.find(d => /back|rear|environment/i.test(d.label))
                       || cameras[0];
        selectedCamId = preferred.deviceId;
        localStorage.setItem('wl_scanCamId', selectedCamId);
        startCamera(selectedCamId);
      })
      .catch(() => { status = 'Camera access denied.'; });
  }

  // Native mode: use ML Kit bundled scanner. Runs camera BEHIND the
  // WebView (`startScan` API); we render our own overlay UI on top.
  // Critically, this path does NOT call the Google Code Scanner module
  // — no Google Play Services runtime dependency. Works on degoogled
  // ROMs (GrapheneOS, /e/, CalyxOS, etc.). Fixes #31.
  let _nativeListener = null;
  let _nativeBarcodeScannerRef = null;
  let nativeScannerActive = false;
  let nativeStatus = 'Starting camera…';
  let nativeTorchOn = false;

  async function startNativeScanner() {
    detected = false;  // reset detected guard so re-opening after a prior scan works
    scanning = true;
    nativeStatus = 'Requesting camera…';
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
      _nativeBarcodeScannerRef = BarcodeScanner;

      const perms = await BarcodeScanner.requestPermissions();
      if (perms.camera !== 'granted') {
        const { showError } = await import('../../stores/toast.js');
        showError('Camera permission denied');
        open = false; scanning = false;
        return;
      }

      // Make the WebView and everything else transparent so the camera
      // (behind the WebView) is visible. Class hooks into CSS at the
      // bottom of this file. App-wide global CSS opt-in is in main.js.
      document.body.classList.add('barcode-scanner-active');
      nativeScannerActive = true;
      nativeStatus = 'Align Barcode';

      _nativeListener = await BarcodeScanner.addListener('barcodeScanned', (event) => {
        const code = event?.barcode?.rawValue;
        if (!code) return;
        if (detected) return;
        detected = true;
        if ($barcodeBeep) playBeep();
        scanlineVisible = true;
        setTimeout(() => scanlineVisible = false, 500);
        // Set open=false FIRST. Don't call stopNativeScanner directly here.
        // If we did, scanning=false would fire BEFORE open=false, and the
        // reactive `$: if (open && !scanning) startNativeScanner()` would
        // re-fire during the await window inside stopNativeScanner —
        // because at that moment open is still true and scanning is now
        // false. That re-opens the scanner in a loop until CameraX hits
        // its surface-combination limit ("No supported surface combination
        // is found ... May be attempting to bind too many use cases").
        // The reactive `$: if (!open && scanning) stopNativeScanner()`
        // handles cleanup correctly once open=false propagates.
        open = false;
        dispatch('scan', { code });
      });

      await BarcodeScanner.startScan();

      // Auto-enable torch if the setting requests it
      if ($barcodeFlashlight) {
        try { await BarcodeScanner.enableTorch(); nativeTorchOn = true; } catch {}
      }
    } catch (e) {
      console.error('[BarcodeScanner] Native scan failed:', e);
      const { showError } = await import('../../stores/toast.js');
      showError('Barcode scan failed: ' + (e?.message || 'Unknown error'));
      await stopNativeScanner();
      open = false;
    }
  }

  async function stopNativeScanner() {
    scanning = false;
    nativeScannerActive = false;
    document.body.classList.remove('barcode-scanner-active');
    if (_nativeListener) {
      try { await _nativeListener.remove(); } catch {}
      _nativeListener = null;
    }
    if (_nativeBarcodeScannerRef) {
      try { await _nativeBarcodeScannerRef.stopScan(); } catch {}
    }
  }

  async function toggleNativeTorch() {
    if (!_nativeBarcodeScannerRef) return;
    try {
      if (nativeTorchOn) {
        await _nativeBarcodeScannerRef.disableTorch();
        nativeTorchOn = false;
      } else {
        await _nativeBarcodeScannerRef.enableTorch();
        nativeTorchOn = true;
      }
    } catch {}
  }

  function closeNative() {
    // Same ordering rule as the scan listener: open=false first so the
    // reactive cleans up. Avoids the re-open loop.
    open = false;
    dispatch('close');
  }

  function doManualNative() {
    if (detected) return;
    const code = manualCode.trim();
    if (!code) return;
    detected = true;
    open = false;
    dispatch('scan', { code });
  }

  let ocrLoading = false;
  let scanLabelFileInput;

  async function _captureLabelPhoto() {
    if (isNative) {
      try {
        const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
        const photo = await Camera.getPhoto({
          quality: 80,
          resultType: CameraResultType.Base64,
          source: CameraSource.Camera,
          width: 1600,
        });
        return { base64: photo.base64String, mimeType: `image/${photo.format || 'jpeg'}` };
      } catch (err) {
        console.warn('[BarcodeScanner] Camera capture failed:', err);
        return null;
      }
    }
    return new Promise((resolve) => {
      const handler = (e) => {
        scanLabelFileInput.removeEventListener('change', handler);
        const file = e.target.files?.[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
          if (!m) { resolve(null); return; }
          resolve({ mimeType: m[1], base64: m[2] });
        };
        reader.readAsDataURL(file);
      };
      scanLabelFileInput.addEventListener('change', handler);
      scanLabelFileInput.value = '';
      scanLabelFileInput.click();
    });
  }

  function _buildLabelMessages(provider, image) {
    const prompt = [
      'Extract nutrition facts from this label image.',
      'Return ONLY a JSON object with these keys (omit keys you cannot read):',
      '  name (string, product name), brand (string), portion (number), unit (string, one of g/ml/oz/fl oz/cup/tsp/tbsp/lb/kg/l/each),',
      '  per_serving (boolean, true if the listed values are per serving, false if per 100g),',
      '  ingredients (string, raw ingredients list text on the label),',
      '  calories (kcal), kilojoules (kJ),',
      '  fat (g), saturated-fat (g), trans-fat (g), polyunsaturated-fat (g), monounsaturated-fat (g),',
      '  carbohydrates (g), sugars (g), added-sugars (g), fiber (g),',
      '  proteins (g),',
      '  sodium (mg), salt (g), potassium (mg), cholesterol (mg),',
      '  calcium (mg), iron (mg), magnesium (mg), zinc (mg), phosphorus (mg),',
      '  vitamin-d (µg), vitamin-a (µg), vitamin-c (mg), vitamin-e (mg), vitamin-k (µg),',
      '  b1 (mg), b2 (mg), b3 (mg), b6 (mg), b9 (µg), b12 (µg),',
      '  caffeine (mg), alcohol (g)',
      'Use numbers, not strings. Use the units specified, not the label\'s.',
      'No commentary, no markdown — JSON only.',
    ].join('\n');
    if (provider === 'claude') {
      return [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType || image.mimeType, data: image.base64 } },
        { type: 'text', text: prompt },
      ]}];
    }
    if (provider === 'openai' || provider === 'oai-compat') {
      return [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
        { type: 'text', text: prompt },
      ]}];
    }
    if (provider === 'gemini') {
      return [{ role: 'user', content: prompt, _image: image }];
    }
    return [{ role: 'user', content: prompt }];
  }

  function _parseJsonFromReply(text) {
    if (!text) return null;
    const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }

  async function scanLabelOcrAI() {
    if (ocrLoading) return;

    // Privacy gate: confirm before sending photo to cloud AI
    const optedIn = typeof localStorage !== 'undefined' && localStorage.getItem('nt:aiOcrOptedIn') === 'true';
    if (!optedIn) {
      // Store a closure that will resume the scan after opt-in confirmation
      _pendingAiOcrScan = async () => {
        _pendingAiOcrScan = null;
        await _doScanLabelOcrAI();
      };
      showAiOcrConfirm = true;
      return;
    }

    await _doScanLabelOcrAI();
  }

  function _onAiOcrConfirm() {
    showAiOcrConfirm = false;
    try { localStorage.setItem('nt:aiOcrOptedIn', 'true'); } catch {}
    // Resume the pending scan if one was queued
    if (_pendingAiOcrScan) {
      _pendingAiOcrScan();
    }
  }

  function _onAiOcrCancel() {
    showAiOcrConfirm = false;
    _pendingAiOcrScan = null;
    // Re-enable barcode scanning if it was disabled
    detected = false;
  }

  /** Internal — performs the actual AI OCR scan (called after privacy opt-in gate) */
  async function _doScanLabelOcrAI() {
    if (ocrLoading) return;
    detected = true; // disable barcode scanning in background
    const image = await _captureLabelPhoto();
    if (!image || !image.base64) {
      detected = false;
      return;
    }
    ocrLoading = true;
    try {
      const provider = $aiProvider || 'claude';
      const messages = _buildLabelMessages(provider, image);
      const systemPrompt = 'You are a nutrition label parser. Return JSON only.';
      const reply = $envLocks.ai
        ? await callAIProxy({ messages, systemPrompt })
        : await callAI({
            provider, apiKey: $aiApiKey, model: $aiModel, baseUrl: $aiBaseUrl,
            messages, systemPrompt,
          });
      const parsed = _parseJsonFromReply(reply);
      if (!parsed || typeof parsed !== 'object') {
        const { showError } = await import('../../stores/toast.js');
        showError('Could not read the label. Try a clearer photo.');
        detected = false;
        return;
      }
      
      const portion = parsed.portion != null ? Number(parsed.portion) : 100;
      // If listed values are per 100g (per_serving false) but portion is not 100, we scale nutrients to match portion
      const factor = (parsed.per_serving === false && portion !== 100) ? (portion / 100) : 1;

      const foodItem = {
        name: parsed.name || '',
        brand: parsed.brand || '',
        portion: portion,
        unit: parsed.unit || 'g',
        ingredientsText: parsed.ingredients || '',
        nutrition: {},
      };

      for (const n of NUTRIMENTS) {
        const v = parsed[n.id];
        if (v != null && !isNaN(parseFloat(v))) {
          foodItem.nutrition[n.id] = parseFloat(v) * factor;
        }
      }

      // Match ingredients locally from extracted list
      if (parsed.ingredients) {
        try {
          const matched = await matchAndCalculateRecipeLocally(parsed.ingredients, portion);
          if (matched && matched.ingredients && matched.ingredients.length > 0) {
            foodItem.ingredients = matched.ingredients;
            // Merge matching nutrients if not parsed from label
            for (const n of NUTRIMENTS) {
              if (foodItem.nutrition[n.id] == null && matched.nutrition[n.id] != null) {
                foodItem.nutrition[n.id] = matched.nutrition[n.id];
              }
            }
          }
        } catch (matchErr) {
          console.warn('[BarcodeScanner] Local ingredients matching failed on AI path:', matchErr);
        }
      }

      open = false;
      dispatch('scan-label-success', { parsed: foodItem });
    } catch (e) {
      console.error('[BarcodeScanner] Label OCR failed:', e);
      const { showError } = await import('../../stores/toast.js');
      showError('Scan failed: ' + (e?.message || 'unknown error'));
      detected = false;
    } finally {
      ocrLoading = false;
    }
  }

  async function scanLabelOcrLocal() {
    if (ocrLoading) return;
    detected = true; // disable barcode scanning in background
    const image = await _captureLabelPhoto();
    if (!image || !image.base64) {
      detected = false;
      return;
    }
    ocrLoading = true;
    try {
      let textDetections = [];
      if (isNative) {
        const { Ocr } = await import('@jcesarmobile/capacitor-ocr');
        const res = await Ocr.process({ image: `data:${image.mimeType};base64,${image.base64}` });
        textDetections = res.results || [];
      } else {
        const { showError } = await import('../../stores/toast.js');
        showError('Local OCR requires running on a native device. Please use AI Scan on web.');
        detected = false;
        return;
      }

      if (textDetections.length === 0) {
        const { showError } = await import('../../stores/toast.js');
        showError('No text detected on the label. Try a clearer photo.');
        detected = false;
        return;
      }

      const parsed = parseNutritionTextLocally(textDetections);
      const portion = parsed.portion != null ? Number(parsed.portion) : 100;
      const factor = (parsed.per_serving === false && portion !== 100) ? (portion / 100) : 1;

      const foodItem = {
        name: parsed.name || '',
        brand: parsed.brand || '',
        portion: portion,
        unit: parsed.unit || 'g',
        ingredientsText: parsed.ingredientsText || '',
        nutrition: {},
      };

      for (const n of NUTRIMENTS) {
        const v = parsed.nutrition[n.id];
        if (v != null && !isNaN(parseFloat(v))) {
          foodItem.nutrition[n.id] = parseFloat(v) * factor;
        }
      }

      if (parsed.ingredientsText) {
        try {
          const matched = await matchAndCalculateRecipeLocally(parsed.ingredientsText, portion);
          if (matched && matched.ingredients && matched.ingredients.length > 0) {
            foodItem.ingredients = matched.ingredients;
            for (const n of NUTRIMENTS) {
              if (foodItem.nutrition[n.id] == null && matched.nutrition[n.id] != null) {
                foodItem.nutrition[n.id] = matched.nutrition[n.id];
              }
            }
          }
        } catch (matchErr) {
          console.warn('[BarcodeScanner] Local ingredients matching failed on Local path:', matchErr);
        }
      }

      open = false;
      dispatch('scan-label-success', { parsed: foodItem });
    } catch (e) {
      console.error('[BarcodeScanner] Local label OCR failed:', e);
      const { showError } = await import('../../stores/toast.js');
      showError('Scan failed: ' + (e?.message || 'unknown error'));
      detected = false;
    } finally {
      ocrLoading = false;
    }
  }

  $: if (open && !scanning) {
    if (isNative) startNativeScanner();
    else startScanner();
  }
  $: if (!open && scanning) {
    if (isNative) stopNativeScanner();
    else close();
  }

  onDestroy(() => {
    detected = true;
    if (isNative) stopNativeScanner();
    else {
      stopEngine();
      if (h5Observer) h5Observer.disconnect();
      if (styleEl) styleEl.remove();
    }
  });
</script>

{#if open && isNative && nativeScannerActive}
  <!-- Native scanner overlay. The actual camera renders BEHIND the
       WebView (ML Kit handles it); we just draw the UI on top, with
       body+root made transparent via .barcode-scanner-active. Portal
       to <body> so the visibility-hide CSS rule (which hides every
       body child except this overlay) doesn't sweep us up with #app. -->
  <div class="native-scanner-overlay" use:modalPortal>
    <div class="ns-top">
      <button class="btn-icon ns-close" on:click={closeNative} aria-label="Close scanner" title="Close scanner">
        <span class="material-symbols-rounded">close</span>
      </button>
      <div class="ns-status">{nativeStatus}</div>
      <button class="btn-icon ns-torch" class:active={nativeTorchOn} on:click={toggleNativeTorch} aria-label="Toggle flashlight" title="Toggle flashlight">
        <span class="material-symbols-rounded">{nativeTorchOn ? 'flash_on' : 'flash_off'}</span>
      </button>
    </div>

    <div class="ns-aim">
      <div class="ns-aim-box">
        <div class="aim-corner tl"></div>
        <div class="aim-corner tr"></div>
        <div class="aim-corner bl"></div>
        <div class="aim-corner br"></div>
        {#if scanlineVisible}
          <div class="aim-scanline"></div>
        {/if}
      </div>
    </div>

    <div class="ns-bottom">
      {#if _canUseAiLabelScan}
        <button class="sc-btn" style="margin-bottom:8px" on:click={scanLabelOcrAI} disabled={ocrLoading}>
          <span class="material-symbols-rounded" class:spin={ocrLoading}>{ocrLoading ? 'progress_activity' : 'photo_camera'}</span>
          <span>{ocrLoading ? 'Scanning label…' : 'Scan Nutrition Label (AI)'}</span>
        </button>
        {#if _aiOcrOptedIn}
          <div class="ns-ai-indicator">
            <span class="material-symbols-rounded" style="font-size:14px">cloud_upload</span>
            <span>AI sends photos to cloud</span>
          </div>
        {/if}
      {/if}
      <button class="sc-btn" style="margin-bottom:8px" on:click={scanLabelOcrLocal} disabled={ocrLoading}>
        <span class="material-symbols-rounded" class:spin={ocrLoading}>{ocrLoading ? 'progress_activity' : 'photo_camera'}</span>
        <span>{ocrLoading ? 'Scanning label…' : 'Scan Label (Local OCR)'}</span>
      </button>
      <div class="ns-manual">
        <input
          class="input"
          type="text"
          placeholder="Or type barcode manually…"
          bind:value={manualCode}
          on:keydown={e => e.key === 'Enter' && doManualNative()}
        />
        <button class="btn btn-primary" on:click={doManualNative}>Look Up</button>
      </div>
    </div>
  </div>
{/if}

{#if open && !isNative}
  <div class="scanner-backdrop" use:modalPortal on:click={close} transition:fly={{ y: 20, duration: 220 }}>
    <div class="scanner-panel" on:click|stopPropagation>
      <!-- Header -->
      <div class="scanner-header">
        <span class="scanner-title">Scan Barcode</span>
        <button class="btn-icon" on:click={close} aria-label="Close" title="Close scanner">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>

      <!-- Engine + Camera selects -->
      <div class="scanner-controls">
        <div class="sc-field">
          <label class="sc-label">Library</label>
          <select class="sc-select" bind:value={selectedEngine} on:change={onEngineChange}>
            <option value="zxing">@zxing/library</option>
            <option value="html5qr">html5-qrcode</option>
            <option value="quagga2">quagga2</option>
          </select>
        </div>
        <div class="sc-field">
          <label class="sc-label">Camera</label>
          <select class="sc-select" bind:value={selectedCamId} on:change={onCamChange}>
            {#if cameras.length === 0}
              <option>Loading…</option>
            {:else}
              {#each cameras as cam}
                <option value={cam.deviceId}>{cam.label}</option>
              {/each}
            {/if}
          </select>
        </div>
      </div>

      <!-- Viewport -->
      <div class="scanner-viewport">
        <div id={readerId} bind:this={scannerDiv} class="scanner-feed"></div>
        <!-- Aim guide -->
        <div class="scanner-aim" aria-hidden="true">
          <div class="aim-box">
            <div class="aim-corner tl"></div>
            <div class="aim-corner tr"></div>
            <div class="aim-corner bl"></div>
            <div class="aim-corner br"></div>
            {#if scanlineVisible}
              <div class="aim-scanline"></div>
            {/if}
          </div>
        </div>
        <!-- Status pill -->
        <div class="scanner-status-pill">{status}</div>
      </div>

      <!-- Action buttons -->
      <div class="scanner-actions">
        <button class="sc-btn" on:click={refresh}>
          <span class="material-symbols-rounded">refresh</span>
          Refresh
        </button>
        {#if torchVisible}
          <button class="sc-btn" class:sc-btn-torch={torchOn} on:click={toggleTorch}>
            <span class="material-symbols-rounded">{torchOn ? 'flash_on' : 'flash_off'}</span>
            {torchOn ? 'Flash On' : 'Flash Off'}
          </button>
        {/if}
        {#if _canUseAiLabelScan}
          <button class="sc-btn" on:click={scanLabelOcrAI} disabled={ocrLoading}>
            <span class="material-symbols-rounded" class:spin={ocrLoading}>{ocrLoading ? 'progress_activity' : 'photo_camera'}</span>
            <span>{ocrLoading ? 'Scanning label…' : 'Scan Label (AI)'}</span>
          </button>
          {#if _aiOcrOptedIn}
            <span class="ai-indicator">
              <span class="material-symbols-rounded" style="font-size:14px">cloud_upload</span>
              AI sends photos to cloud
            </span>
          {/if}
        {/if}
        <button class="sc-btn" on:click={scanLabelOcrLocal} disabled={ocrLoading}>
          <span class="material-symbols-rounded" class:spin={ocrLoading}>{ocrLoading ? 'progress_activity' : 'photo_camera'}</span>
          <span>{ocrLoading ? 'Scanning label…' : 'Scan Label (Local)'}</span>
        </button>
      </div>

      <!-- Manual entry -->
      <div class="scanner-manual">
        <input
          class="input"
          type="text"
          placeholder="Or type barcode manually…"
          bind:value={manualCode}
          on:keydown={e => e.key === 'Enter' && doManual()}
        />
        <button class="btn btn-primary" on:click={doManual}>Look Up</button>
      </div>
      <input bind:this={scanLabelFileInput} type="file" accept="image/*" capture="environment" style="display:none" />
    </div>
  </div>
{/if}

<!-- AI OCR privacy confirmation dialog -->
<Dialog
  open={showAiOcrConfirm}
  title="AI Photo Upload"
  message="Send photo to AI for parsing? Your photo will be uploaded to {$aiProvider || 'the AI provider'} for processing. You can change this later in settings."
  confirmText="Allow"
  cancelText="Cancel"
  on:confirm={_onAiOcrConfirm}
  on:cancel={_onAiOcrCancel}
/>

<style>
  .scanner-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0,0,0,0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    padding: 16px;
  }

  .scanner-panel {
    width: 100%;
    max-width: 440px;
    max-height: calc(100dvh - 32px);
    background: var(--surface-1);
    border-radius: var(--radius-xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
  }

  .scanner-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .scanner-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-1);
  }

  .scanner-controls {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .sc-field { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 3px; }
  .sc-label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: .5px; }
  .sc-select {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text-1);
    font-size: 13px;
  }

  .scanner-viewport {
    position: relative;
    width: 100%;
    height: 260px;
    background: #000;
    flex-shrink: 0;
    overflow: hidden;
  }
  .scanner-feed {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .scanner-aim {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
  }
  .aim-box {
    position: relative;
    width: 68%;
    max-width: 260px;
    aspect-ratio: 2.2/1;
    border: 2px dashed rgba(255,255,255,0.4);
    border-radius: 4px;
    overflow: hidden;
  }
  .aim-scanline {
    position: absolute;
    left: 0; right: 0; height: 3px;
    background: var(--accent);
    top: 45%;
    box-shadow: 0 0 8px var(--accent);
  }
  .aim-corner {
    position: absolute;
    width: 16px; height: 16px;
  }
  .aim-corner.tl { top: -3px; left: -3px; border-top: 3px solid var(--accent); border-left: 3px solid var(--accent); }
  .aim-corner.tr { top: -3px; right: -3px; border-top: 3px solid var(--accent); border-right: 3px solid var(--accent); }
  .aim-corner.bl { bottom: -3px; left: -3px; border-bottom: 3px solid var(--accent); border-left: 3px solid var(--accent); }
  .aim-corner.br { bottom: -3px; right: -3px; border-bottom: 3px solid var(--accent); border-right: 3px solid var(--accent); }

  .scanner-status-pill {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    pointer-events: none;
    font-size: 11px;
    color: #fff;
    background: rgba(0,0,0,0.65);
    padding: 3px 10px;
    border-radius: 10px;
    white-space: nowrap;
  }

  .scanner-actions {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .sc-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 22px;
    padding: 8px 16px;
    min-height: 44px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: var(--surface-1);
    color: var(--text-2);
    white-space: nowrap;
    transition: background var(--dur-fast), color var(--dur-fast);
  }
  .sc-btn .material-symbols-rounded { font-size: 18px; }
  .sc-btn.sc-btn-active { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); border-color: var(--accent); }
  .sc-btn.sc-btn-torch  { background: color-mix(in srgb, #fbbf24 20%, transparent); color: #fbbf24; border-color: #fbbf24; }
  .ai-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
  }

  .scanner-manual {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    align-items: center;
  }
  .scanner-manual .input { flex: 1; }
  .scanner-manual .btn { flex-shrink: 0; white-space: nowrap; }

  /* Native ML Kit scanner overlay (bundled, no Play Services) — camera
     renders BEHIND the WebView. We just draw chrome on top. */
  .native-scanner-overlay {
    position: fixed;
    inset: 0;
    z-index: 250;
    display: flex;
    flex-direction: column;
    pointer-events: none;
  }
  .native-scanner-overlay > * { pointer-events: auto; }

  .ns-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(var(--safe-top) + 12px) 16px 12px;
    gap: 8px;
    background: linear-gradient(to bottom, rgba(0,0,0,0.55), transparent);
  }
  .ns-close, .ns-torch {
    background: rgba(0,0,0,0.5);
    color: #fff;
    border-radius: 50%;
    width: 44px;
    height: 44px;
  }
  .ns-torch.active { background: rgba(251,191,36,0.85); color: #000; }
  .ns-status {
    flex: 1;
    text-align: center;
    color: #fff;
    background: rgba(0,0,0,0.55);
    border-radius: 14px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    margin: 0 8px;
    max-width: 220px;
    justify-self: center;
  }

  .ns-aim {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .ns-aim-box {
    position: relative;
    width: 78%;
    max-width: 320px;
    aspect-ratio: 2.2/1;
    border: 2px dashed rgba(255,255,255,0.5);
    border-radius: 6px;
  }
  .ns-aim-box .aim-corner.tl { top: -3px; left: -3px; border-top: 3px solid var(--accent); border-left: 3px solid var(--accent); }
  .ns-aim-box .aim-corner.tr { top: -3px; right: -3px; border-top: 3px solid var(--accent); border-right: 3px solid var(--accent); }
  .ns-aim-box .aim-corner.bl { bottom: -3px; left: -3px; border-bottom: 3px solid var(--accent); border-left: 3px solid var(--accent); }
  .ns-aim-box .aim-corner.br { bottom: -3px; right: -3px; border-bottom: 3px solid var(--accent); border-right: 3px solid var(--accent); }

  .ns-bottom {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 16px calc(var(--safe-bottom) + 20px);
    background: linear-gradient(to top, rgba(0,0,0,0.65), transparent);
  }
  .ns-bottom .sc-btn {
    align-self: center;
    background: rgba(0,0,0,0.65);
    color: #fff;
    border-color: rgba(255,255,255,0.25);
    min-height: 44px;
    padding: 10px 20px;
    border-radius: 22px;
    font-size: 13px;
    font-weight: 600;
    width: 90%;
    max-width: 320px;
    justify-content: center;
  }
  .ns-ai-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    color: rgba(255,255,255,0.7);
    margin-top: -4px;
    margin-bottom: 4px;
  }
  .ns-bottom .sc-btn.sc-btn-active {
    background: color-mix(in srgb, var(--accent) 80%, transparent);
    color: #fff;
    border-color: var(--accent);
  }
  .ns-manual {
    display: flex;
    gap: 8px;
    background: rgba(0,0,0,0.55);
    border-radius: var(--radius-md);
    padding: 8px;
    align-items: center;
  }
  .ns-manual .input { flex: 1; background: rgba(255,255,255,0.92); color: #000; }
  .ns-manual .btn { flex-shrink: 0; white-space: nowrap; }
</style>
