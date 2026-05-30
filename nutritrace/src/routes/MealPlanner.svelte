<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';

  let plans = [];
  let members = [];
  let loading = true;
  let currentDate = new Date().toISOString().slice(0,10);
  
  let showModal = false;
  let form = { date: currentDate, meal_type: 'Lunch', items: [] };

  onMount(async () => {
    await fetchAll();
  });

  async function fetchAll() {
    loading = true;
    try {
      const [mRes, pRes] = await Promise.all([
        NtApi.get('/api/family'),
        NtApi.get(`/api/meal_plans?date=${currentDate}`)
      ]);
      members = mRes;
      plans = pRes;
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  function changeDate(delta) {
    const d = new Date(currentDate);
    d.setUTCDate(d.getUTCDate() + delta);
    currentDate = d.toISOString().slice(0,10);
    fetchAll();
  }

  function formatAggregatedTargets() {
    let agg = {
      calories: 0, proteins: 0, carbohydrates: 0, fat: 0, calcium: 0, iron: 0, 'vitamin-c': 0
    };
    for (const m of members) {
      if (!m.targets) continue;
      agg.calories += m.targets.calories || 0;
      agg.proteins += m.targets.proteins || 0;
      agg.carbohydrates += m.targets.carbohydrates || 0;
      agg.fat += m.targets.fat || 0;
      agg.calcium += m.targets.calcium || 0;
      agg.iron += m.targets.iron || 0;
      agg['vitamin-c'] += m.targets['vitamin-c'] || 0;
    }
    return agg;
  }

  $: aggTargets = formatAggregatedTargets();

  // Very rough calculation of planned nutrition for the day
  $: plannedNutrition = plans.reduce((acc, plan) => {
      for (const item of plan.items) {
          if (item.nutrition) {
              acc.calories += (item.nutrition.calories || 0) * (item.quantity || 1);
              acc.proteins += (item.nutrition.proteins || 0) * (item.quantity || 1);
          }
      }
      return acc;
  }, { calories: 0, proteins: 0 });

  function openNew() {
    form = { date: currentDate, meal_type: 'Lunch', items: [] };
    // In a full implementation, we'd open a Food Search picker here
    // For now we mock it
    form.items.push({
        name: "Dal Tadka", quantity: 2, 
        nutrition: { calories: 300, proteins: 15 }
    });
    showModal = true;
  }

  async function save() {
    try {
      await NtApi.post('/api/meal_plans', form);
      showModal = false;
      await fetchAll();
    } catch (err) {
      alert('Error saving plan');
    }
  }

  async function remove(id) {
    if (!confirm('Remove this planned meal?')) return;
    try {
      await NtApi.del(`/api/meal_plans/${id}`);
      await fetchAll();
    } catch (err) {
      console.error(err);
    }
  }
</script>

<div class="page-shell">
  <header class="page-header">
    <div class="ph-left">
      <button class="icon-btn" on:click={() => push('/')}>
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <h1 class="page-title">Meal Planner</h1>
    </div>
  </header>

  <div class="diary-date-bar">
    <button class="icon-btn" on:click={() => changeDate(-1)}><span class="material-symbols-rounded">chevron_left</span></button>
    <div class="date-lbl"><strong>{new Date(currentDate).toLocaleDateString()}</strong></div>
    <button class="icon-btn" on:click={() => changeDate(1)}><span class="material-symbols-rounded">chevron_right</span></button>
  </div>

  <div class="page-content">
    {#if loading}
      <div class="empty-state">Loading...</div>
    {:else}
      <!-- Family Targets Summary -->
      <div class="card p-3 mb-3" style="background: var(--bg-surface-2);">
        <h3 class="text-1 mb-2" style="font-size:16px;">Family Daily Target Coverage</h3>
        <div class="progress-bar-wrap mb-1">
          <div class="pb-lbl text-2" style="font-size:12px; display:flex; justify-content:space-between;">
            <span>Calories</span>
            <span>{Math.round(plannedNutrition.calories)} / {aggTargets.calories} kcal</span>
          </div>
          <div class="pb-track" style="height:8px; background:var(--bg-3); border-radius:4px; overflow:hidden;">
            <div class="pb-fill" style="height:100%; background:var(--primary); width:{Math.min(100, (plannedNutrition.calories / (aggTargets.calories||1)) * 100)}%;"></div>
          </div>
        </div>
        <div class="progress-bar-wrap mb-1">
          <div class="pb-lbl text-2" style="font-size:12px; display:flex; justify-content:space-between;">
            <span>Protein</span>
            <span>{Math.round(plannedNutrition.proteins)} / {aggTargets.proteins} g</span>
          </div>
          <div class="pb-track" style="height:8px; background:var(--bg-3); border-radius:4px; overflow:hidden;">
            <div class="pb-fill" style="height:100%; background:var(--macro-protein); width:{Math.min(100, (plannedNutrition.proteins / (aggTargets.proteins||1)) * 100)}%;"></div>
          </div>
        </div>
      </div>

      <div class="meals-list">
        {#each ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as type}
          <div class="meal-group mb-4">
            <div class="mg-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <h3 style="margin:0; font-size:18px;">{type}</h3>
              <button class="icon-btn sm" on:click={openNew}><span class="material-symbols-rounded">add</span></button>
            </div>
            {#each plans.filter(p => p.meal_type === type) as plan (plan.id)}
              <div class="card p-3 mb-2" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  {#each plan.items as it}
                    <div style="font-weight:600;">{it.name} <span class="text-3 text-sm">x{it.quantity}</span></div>
                  {/each}
                </div>
                <button class="icon-btn sm danger" on:click={() => remove(plan.id)}><span class="material-symbols-rounded">close</span></button>
              </div>
            {:else}
              <div class="text-3" style="font-size:14px; padding:8px 0;">No plans</div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if showModal}
  <div class="modal-backdrop" transition:fade={{duration:200}} on:click={() => showModal=false} on:keydown={(e) => e.key === 'Escape' && (showModal=false)} role="button" tabindex="0">
    <div class="modal-surface" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" tabindex="-1">
      <header class="modal-header">
        <h3>Plan Meal</h3>
        <button class="icon-btn" on:click={() => showModal=false}><span class="material-symbols-rounded">close</span></button>
      </header>
      <div class="modal-body">
        <label class="input-group">
          <span>Meal Type</span>
          <select bind:value={form.meal_type}>
            <option>Breakfast</option>
            <option>Lunch</option>
            <option>Dinner</option>
            <option>Snacks</option>
          </select>
        </label>
        <p class="text-2" style="font-size:13px; margin-top:12px;">(Mocked items for demonstration: Dal Tadka x2)</p>
      </div>
      <footer class="modal-footer">
        <button class="btn" on:click={() => showModal=false}>Cancel</button>
        <button class="primary-btn" on:click={save}>Save Plan</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .diary-date-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; background: var(--bg-1);
    border-bottom: 1px solid var(--border-color);
  }
</style>
