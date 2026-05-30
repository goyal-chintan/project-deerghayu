<script>
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';

  let members = [];
  let loading = true;
  let showModal = false;

  let customTargetsActive = false;
  let custom_targets = { calories: '', proteins: '', carbohydrates: '', fat: '' };

  let form = {
    id: null,
    name: '',
    age: '',
    gender: 'female',
    weight_kg: '',
    height_cm: '',
    activity_level: 'sedentary',
    goal_type: 'maintain'
  };

  onMount(async () => {
    await fetchMembers();
  });

  async function fetchMembers() {
    try {
      members = await NtApi.get('/api/family');
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  function openNew() {
    form = { id: null, name: '', age: '', gender: 'female', weight_kg: '', height_cm: '', activity_level: 'sedentary', goal_type: 'maintain' };
    customTargetsActive = false;
    custom_targets = { calories: '', proteins: '', carbohydrates: '', fat: '' };
    showModal = true;
  }

  function editMember(m) {
    form = { goal_type: 'maintain', ...m };
    custom_targets = {
      calories: m.targets?.calories || '',
      proteins: m.targets?.proteins || '',
      carbohydrates: m.targets?.carbohydrates || '',
      fat: m.targets?.fat || ''
    };
    customTargetsActive = m.targets && (m.targets.calories != null);
    showModal = true;
  }

  async function save() {
    try {
      const payload = {
        ...form,
        custom_targets: customTargetsActive ? {
          calories: custom_targets.calories ? Number(custom_targets.calories) : undefined,
          proteins: custom_targets.proteins ? Number(custom_targets.proteins) : undefined,
          carbohydrates: custom_targets.carbohydrates ? Number(custom_targets.carbohydrates) : undefined,
          fat: custom_targets.fat ? Number(custom_targets.fat) : undefined
        } : null
      };
      if (form.id) {
        await NtApi.put(`/api/family/${form.id}`, payload);
      } else {
        await NtApi.post('/api/family', payload);
      }
      showModal = false;
      await fetchMembers();
    } catch (err) {
      alert('Error saving member');
    }
  }

  async function remove(id) {
    if (!confirm('Remove this family member?')) return;
    try {
      await NtApi.del(`/api/family/${id}`);
      await fetchMembers();
    } catch (err) {
      alert('Error removing member');
    }
  }

  $: if (form.gender === 'male' && (form.goal_type === 'pregnancy' || form.goal_type === 'lactation')) {
    form.goal_type = 'maintain';
  }

  $: previewTargets = (() => {
    const age = Number(form.age);
    const weight = Number(form.weight_kg);
    const height = Number(form.height_cm);
    if (!form.name || isNaN(age) || isNaN(weight) || isNaN(height) || age <= 0 || weight <= 0 || height <= 0) {
      return null;
    }
    
    let bmr = 0;
    if (age < 2) {
      bmr = weight * 90;
    } else {
      if (form.gender === 'male' || form.gender === 'm') {
        bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5;
      } else {
        bmr = (10 * weight) + (6.25 * height) - (5 * age) - 161;
      }
    }
    
    const multipliers = {
      'sedentary': 1.2,
      'light': 1.375,
      'moderate': 1.55,
      'active': 1.725,
      'very_active': 1.9
    };
    const multiplier = multipliers[form.activity_level] || 1.2;
    let calories = Math.round(bmr * multiplier);
    
    const goal = form.goal_type || 'maintain';
    if (goal === 'lose_weight') {
      calories = Math.max(form.gender === 'male' || form.gender === 'm' ? 1500 : 1200, calories - 500);
    } else if (goal === 'gain_muscle') {
      calories += 350;
    } else if (goal === 'pregnancy') {
      calories += 350;
    } else if (goal === 'lactation') {
      calories += 500;
    }

    let proteins = 0;
    if (goal === 'lose_weight') {
      proteins = Math.round(weight * 1.4);
    } else if (goal === 'gain_muscle') {
      proteins = Math.round(weight * 1.8);
    } else if (goal === 'pregnancy') {
      proteins = Math.round(weight * 1.1) + 25;
    } else if (goal === 'lactation') {
      proteins = Math.round(weight * 1.1) + 19;
    } else {
      proteins = Math.round(weight * (age < 2 ? 1.2 : 0.8));
    }

    let fatPercent = 0.25;
    if (goal === 'lose_weight') {
      fatPercent = 0.22;
    }
    let fat = Math.round((calories * fatPercent) / 9);
    let carbohydrates = Math.round((calories - (proteins * 4) - (fat * 9)) / 4);
    if (carbohydrates < 50) carbohydrates = 50;

    return { calories, proteins, carbohydrates, fat };
  })();

  function getGoalLabel(g) {
    switch (g) {
      case 'lose_weight': return 'Lose Weight';
      case 'gain_muscle': return 'Gain Muscle';
      case 'pregnancy': return 'Pregnancy';
      case 'lactation': return 'Lactation';
      default: return 'Maintain Weight';
    }
  }
</script>

<div class="page-shell">
  <header class="page-header">
    <div class="ph-left">
      <button class="icon-btn" aria-label="Back" on:click={() => push('/')}>
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <h1 class="page-title">Family Manager</h1>
    </div>
    <div class="ph-right">
      <button class="primary-btn" on:click={openNew}>
        <span class="material-symbols-rounded">add</span> Add Member
      </button>
    </div>
  </header>

  <div class="page-content">
    {#if loading}
      <div class="empty-state">Loading...</div>
    {:else if members.length === 0}
      <div class="empty-state">
        <span class="material-symbols-rounded" style="font-size:48px; color:var(--text-3)">family_restroom</span>
        <h2>No Family Members</h2>
        <p>Add your family members to start planning meals and tracking their nutrition scientifically.</p>
        <button class="primary-btn mt-4" on:click={openNew}>Add Member</button>
      </div>
    {:else}
      <div class="members-grid">
        {#each members as m (m.id)}
          <div class="member-card card" transition:slide>
            <div class="m-header">
              <h3>{m.name}</h3>
              <div class="m-actions">
                <button class="icon-btn sm" on:click={() => editMember(m)}><span class="material-symbols-rounded">edit</span></button>
                <button class="icon-btn sm danger" on:click={() => remove(m.id)}><span class="material-symbols-rounded">delete</span></button>
              </div>
            </div>
            <div class="m-demographics text-2">
              {m.age} yrs • {m.gender === 'male' || m.gender === 'm' ? 'M' : 'F'} • {m.weight_kg}kg • {m.height_cm}cm • {m.activity_level.replace('_',' ')}
            </div>
            <div class="m-goal text-2 mt-1" style="font-weight: 600; color: var(--accent); font-size: 13px;">
              Goal: {getGoalLabel(m.goal_type)}
            </div>
            
            <div class="m-targets mt-3">
              <h4 class="text-2 mb-2">Daily Scientific Targets</h4>
              <div class="target-section-label">Macros</div>
              <div class="target-grid">
                <div class="t-item">
                  <span class="t-icon material-symbols-rounded">local_fire_department</span>
                  <span class="t-val">{m.targets.calories}</span> <span class="t-lbl">kcal</span>
                </div>
                <div class="t-item">
                  <span class="t-icon material-symbols-rounded">fitness_center</span>
                  <span class="t-val">{m.targets.proteins}g</span> <span class="t-lbl">Protein</span>
                </div>
                <div class="t-item">
                  <span class="t-icon material-symbols-rounded">grain</span>
                  <span class="t-val">{m.targets.carbohydrates}g</span> <span class="t-lbl">Carbs</span>
                </div>
                <div class="t-item">
                  <span class="t-icon material-symbols-rounded">water_drop</span>
                  <span class="t-val">{m.targets.fat}g</span> <span class="t-lbl">Fat</span>
                </div>
                <div class="t-item">
                  <span class="t-icon material-symbols-rounded">grass</span>
                  <span class="t-val">{m.targets.fiber}g</span> <span class="t-lbl">Fiber</span>
                </div>
              </div>
              <div class="target-section-label">Minerals</div>
              <div class="target-grid">
                <div class="t-item"><span class="t-icon material-symbols-rounded">bone</span><span class="t-val">{m.targets.calcium}mg</span> <span class="t-lbl">Calcium</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">hub</span><span class="t-val">{m.targets.iron}mg</span> <span class="t-lbl">Iron</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">shield</span><span class="t-val">{m.targets.zinc}mg</span> <span class="t-lbl">Zinc</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">bolt</span><span class="t-val">{m.targets.magnesium}mg</span> <span class="t-lbl">Magnesium</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">electric_bolt</span><span class="t-val">{m.targets.potassium}mg</span> <span class="t-lbl">Potassium</span></div>
              </div>
              <div class="target-section-label">Vitamins</div>
              <div class="target-grid">
                <div class="t-item"><span class="t-icon material-symbols-rounded">visibility</span><span class="t-val">{m.targets['vitamin-a']}mcg</span> <span class="t-lbl">Vit A</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">immune</span><span class="t-val">{m.targets['vitamin-c']}mg</span> <span class="t-lbl">Vit C</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">sunny</span><span class="t-val">{m.targets['vitamin-d']}mcg</span> <span class="t-lbl">Vit D</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">genetics</span><span class="t-val">{m.targets.b9}mcg</span> <span class="t-lbl">Folate B9</span></div>
                <div class="t-item"><span class="t-icon material-symbols-rounded">neurology</span><span class="t-val">{m.targets.b12}mcg</span> <span class="t-lbl">Vit B12</span></div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if showModal}
  <div class="modal-backdrop" transition:fade={{duration:200}} on:click={() => showModal=false} on:keydown={(e) => e.key === 'Escape' && (showModal=false)} role="button" tabindex="0">
    <div class="modal-surface" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="member-modal-title" tabindex="-1">
      <header class="modal-header">
        <h3 id="member-modal-title">{form.id ? 'Edit Member' : 'New Member'}</h3>
        <button class="icon-btn" aria-label="Close" on:click={() => showModal=false}><span class="material-symbols-rounded">close</span></button>
      </header>
      <div class="modal-body">
        <label class="input-group">
          <span>Name</span>
          <input type="text" bind:value={form.name} placeholder="e.g. Rahul">
        </label>
        <div class="form-row">
          <label class="input-group">
            <span>Age (years)</span>
            <input type="number" bind:value={form.age}>
          </label>
          <label class="input-group">
            <span>Gender</span>
            <select bind:value={form.gender}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
        </div>
        <div class="form-row">
          <label class="input-group">
            <span>Weight (kg)</span>
            <input type="number" bind:value={form.weight_kg}>
          </label>
          <label class="input-group">
            <span>Height (cm)</span>
            <input type="number" bind:value={form.height_cm}>
          </label>
        </div>
        <label class="input-group">
          <span>Activity Level</span>
          <select bind:value={form.activity_level}>
            <option value="sedentary">Sedentary</option>
            <option value="light">Lightly Active</option>
            <option value="moderate">Moderately Active</option>
            <option value="active">Very Active</option>
            <option value="very_active">Extra Active</option>
          </select>
        </label>

        <label class="input-group" style="margin-top: 12px;">
          <span>Scientific Goal / Life Stage</span>
          <select bind:value={form.goal_type}>
            <option value="maintain">Maintain Weight (Science-based RDA)</option>
            <option value="lose_weight">Lose Weight (Caloric Deficit)</option>
            <option value="gain_muscle">Gain Muscle (Caloric Surplus)</option>
            {#if form.gender === 'female'}
              <option value="pregnancy">Pregnancy (Nutrient Boost)</option>
              <option value="lactation">Lactation / Breastfeeding</option>
            {/if}
          </select>
        </label>

        {#if previewTargets}
          <div class="preview-targets-box mt-3 p-3" style="background: var(--bg-2); border-radius: var(--radius-md); border: 1px solid var(--border);">
            <h4 class="text-xs uppercase tracking-wide text-3 mb-2" style="font-weight: 700; font-size: 11px;">Predicted Science Targets (Preview)</h4>
            <div style="display: flex; justify-content: space-between; text-align: center; font-size: 12px;">
              <div>
                <div style="font-weight: 700; color: var(--text-1); font-size: 14px;">{previewTargets.calories}</div>
                <div style="color: var(--text-3); font-size: 10px;">kcal</div>
              </div>
              <div>
                <div style="font-weight: 700; color: var(--text-1); font-size: 14px;">{previewTargets.proteins}g</div>
                <div style="color: var(--text-3); font-size: 10px;">Protein</div>
              </div>
              <div>
                <div style="font-weight: 700; color: var(--text-1); font-size: 14px;">{previewTargets.carbohydrates}g</div>
                <div style="color: var(--text-3); font-size: 10px;">Carbs</div>
              </div>
              <div>
                <div style="font-weight: 700; color: var(--text-1); font-size: 14px;">{previewTargets.fat}g</div>
                <div style="color: var(--text-3); font-size: 10px;">Fat</div>
              </div>
            </div>
          </div>
        {/if}
        
        <div class="form-divider" style="height: 1px; background: var(--border); margin: 16px 0;"></div>
        <label class="checkbox-row" style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-2); cursor: pointer; user-select: none; margin-bottom: 12px;">
          <input type="checkbox" bind:checked={customTargetsActive} style="cursor: pointer;">
          <span>Override scientific targets (set manual goals)</span>
        </label>
        
        {#if customTargetsActive}
          <div class="form-row" transition:slide>
            <label class="input-group">
              <span>Calories (kcal)</span>
              <input type="number" bind:value={custom_targets.calories} placeholder="e.g. 2000" min="0">
            </label>
            <label class="input-group">
              <span>Protein (g)</span>
              <input type="number" bind:value={custom_targets.proteins} placeholder="e.g. 65" min="0">
            </label>
          </div>
          <div class="form-row" transition:slide style="margin-top: 12px;">
            <label class="input-group">
              <span>Carbohydrates (g)</span>
              <input type="number" bind:value={custom_targets.carbohydrates} placeholder="e.g. 220" min="0">
            </label>
            <label class="input-group">
              <span>Fat (g)</span>
              <input type="number" bind:value={custom_targets.fat} placeholder="e.g. 60" min="0">
            </label>
          </div>
        {/if}
      </div>
      <footer class="modal-footer">
        <button class="btn" on:click={() => showModal=false}>Cancel</button>
        <button class="primary-btn" on:click={save} disabled={!form.name || !form.age}>Save & Calc Targets</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .members-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  }
  .member-card {
    padding: 16px;
  }
  .m-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .m-header h3 { margin: 0; font-size: 18px; }
  .m-actions { display: flex; gap: 4px; }
  
  .target-grid {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .target-section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-3);
    margin-top: 10px;
    margin-bottom: 4px;
  }
  .t-item {
    background: var(--bg-2);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-width: 60px;
    text-align: center;
  }
  .t-icon {
    font-size: 16px;
    color: var(--accent);
    margin-bottom: 2px;
  }
  .t-val { font-weight: 600; color: var(--text-1); }
  .t-lbl { font-size: 11px; color: var(--text-3); margin-top: 2px; }
  
  .form-row { display: flex; gap: 12px; }
  .form-row > * { flex: 1; }
</style>
