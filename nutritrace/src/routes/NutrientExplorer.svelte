<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';
  import { NUTRIMENTS, Nutrition } from '../lib/nutrition.js';
  import { vegetarianMode } from '../stores/settings.js';
  import { isAllowedInVegMode } from '../lib/dietType.js';

  // Curated nutrient chips for quick selection
  const FEATURED_NUTRIENTS = [
    'iron', 'calcium', 'b12', 'zinc', 'vitamin-d', 'b9',
    'fiber', 'proteins', 'vitamin-a', 'vitamin-c', 'magnesium', 'potassium'
  ];

  let foods = [];
  let members = [];
  let loading = true;
  let selectedNutrientId = 'iron';

  $: selectedNutrient = NUTRIMENTS.find(n => n.id === selectedNutrientId) || NUTRIMENTS.find(n => n.id === 'iron');

  // Reactive filtering and sorting
  $: filteredFoods = (() => {
    let list = foods;
    if ($vegetarianMode) {
      list = list.filter(f => isAllowedInVegMode(f));
    }
    // Filter to foods that have the selected nutrient value > 0
    list = list.filter(f => {
      const val = getNutrientValue(f, selectedNutrientId);
      return val > 0;
    });
    // Sort descending by nutrient value per 100g
    list.sort((a, b) => getNutrientValue(b, selectedNutrientId) - getNutrientValue(a, selectedNutrientId));
    return list.slice(0, 20);
  })();

  // Aggregate daily need for the selected nutrient across all family members
  $: familyNeed = (() => {
    let total = 0;
    const breakdown = [];
    for (const m of members) {
      const need = m.targets?.[selectedNutrientId] || 0;
      total += need;
      if (need > 0) {
        breakdown.push({ name: m.name, need });
      }
    }
    return { total, breakdown };
  })();

  function getNutrientValue(food, nutrientId) {
    if (!food?.nutrition) return 0;
    const val = parseFloat(food.nutrition[nutrientId]);
    return isNaN(val) ? 0 : val;
  }

  function getPercentOfDaily(food) {
    if (!familyNeed.total || familyNeed.total <= 0) return 0;
    const val = getNutrientValue(food, selectedNutrientId);
    // Value is per 100g; assume a serving is the food's portion size
    const portion = parseFloat(food.portion) || 100;
    const perServing = val * (portion / 100);
    return Math.min(Math.round((perServing / familyNeed.total) * 100), 100);
  }

  function formatAmount(food) {
    const val = getNutrientValue(food, selectedNutrientId);
    return Nutrition.format(val) + ' ' + (selectedNutrient?.unit || '');
  }

  function getDietBadge(food) {
    const dt = (food.diet_type || 'vegetarian').toLowerCase();
    if (dt === 'vegan' || dt === 'vegetarian') return 'veg';
    if (dt === 'eggetarian') return 'egg';
    return 'nonveg';
  }

  async function addToPlan(food) {
    // Navigate to diary to add this food
    // Pass via sessionStorage for cross-route communication
    try {
      sessionStorage.setItem('nt:quickAdd', JSON.stringify({
        id: food.id,
        name: food.name,
        portion: food.portion,
        unit: food.unit,
        nutrition: food.nutrition
      }));
      push('/');
    } catch (e) {
      console.error('Failed to store quick add:', e);
    }
  }

  onMount(async () => {
    try {
      const [foodsRes, membersRes] = await Promise.all([
        NtApi.getFoods(),
        NtApi.get('/api/family').catch(() => [])
      ]);
      foods = Array.isArray(foodsRes) ? foodsRes : [];
      members = Array.isArray(membersRes) ? membersRes : [];
    } catch (err) {
      console.error('NutrientExplorer load error:', err);
    } finally {
      loading = false;
    }
  });
</script>

<div class="page-shell">
  <header class="page-header">
    <div class="ph-left">
      <button class="icon-btn" on:click={() => push('/')}>
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <h1 class="page-title">Explore Nutrients</h1>
    </div>
    <div class="ph-right">
      <label class="veg-toggle" title="Vegetarian filter">
        <input type="checkbox" bind:checked={$vegetarianMode}>
        <span class="veg-toggle-label">
          <span class="veg-dot"></span> Veg
        </span>
      </label>
    </div>
  </header>

  <div class="page-content">
    <!-- Nutrient Chips -->
    <div class="nutrient-chips">
      {#each FEATURED_NUTRIENTS as nid}
        {@const n = NUTRIMENTS.find(x => x.id === nid)}
        {#if n}
          <button
            class="chip"
            class:active={selectedNutrientId === nid}
            on:click={() => selectedNutrientId = nid}
          >
            {n.label}
          </button>
        {/if}
      {/each}
    </div>

    <!-- Family Need Summary -->
    {#if familyNeed.total > 0}
      <div class="family-card" transition:fade={{ duration: 150 }}>
        <div class="family-headline">
          <span class="material-symbols-rounded" style="font-size:20px; color:var(--accent)">family_restroom</span>
          <strong>{selectedNutrient?.label}: Family needs {Nutrition.format(familyNeed.total)}{selectedNutrient?.unit}/day</strong>
        </div>
        {#if familyNeed.breakdown.length > 0}
          <div class="family-breakdown">
            {#each familyNeed.breakdown as b}
              <span class="member-need">{b.name}: {Nutrition.format(b.need)}{selectedNutrient?.unit}</span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Results -->
    {#if loading}
      <div class="empty-state">
        <span class="material-symbols-rounded spin">progress_activity</span>
        <p>Loading foods...</p>
      </div>
    {:else if foods.length === 0}
      <div class="empty-state">
        <span class="material-symbols-rounded" style="font-size:48px; color:var(--text-3)">nutrition</span>
        <h2>No Foods in Library</h2>
        <p>Import the Indian food database from Settings, or add foods manually.</p>
        <button class="primary-btn mt-4" on:click={() => push('/settings')}>
          <span class="material-symbols-rounded">settings</span> Go to Settings
        </button>
      </div>
    {:else if filteredFoods.length === 0}
      <div class="empty-state">
        <span class="material-symbols-rounded" style="font-size:48px; color:var(--text-3)">search_off</span>
        <h2>No Results</h2>
        <p>No foods in your library have {selectedNutrient?.label || 'this nutrient'} data{$vegetarianMode ? ' (vegetarian filter active)' : ''}.</p>
      </div>
    {:else}
      <div class="results-list">
        {#each filteredFoods as food, i (food.id || i)}
          <div class="result-card" transition:fade={{ duration: 120, delay: i * 20 }}>
            <div class="rank-badge">#{i + 1}</div>
            <div class="result-body">
              <div class="result-top">
                <div class="result-name">
                  {food.name}
                  {#if getDietBadge(food) === 'veg'}
                    <span class="diet-badge veg" title="Vegetarian">&#127807;</span>
                  {:else if getDietBadge(food) === 'egg'}
                    <span class="diet-badge egg" title="Eggetarian">&#129370;</span>
                  {/if}
                </div>
                <div class="result-amount">{formatAmount(food)} per 100g</div>
              </div>
              {#if familyNeed.total > 0}
                <div class="progress-row">
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: {getPercentOfDaily(food)}%"></div>
                  </div>
                  <span class="progress-label">{getPercentOfDaily(food)}% of daily need/serving</span>
                </div>
              {/if}
            </div>
            <button class="add-btn" on:click={() => addToPlan(food)} title="Add to today's diary">
              <span class="material-symbols-rounded">add</span>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .nutrient-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }
  .chip {
    padding: 6px 14px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-secondary, var(--text-2));
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.active {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }

  /* Family card */
  .family-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 16px;
  }
  .family-headline {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text-primary, var(--text-1));
  }
  .family-breakdown {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .member-need {
    font-size: 12px;
    color: var(--text-secondary, var(--text-2));
  }

  /* Results list */
  .results-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .result-card {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    transition: box-shadow 0.15s;
  }
  .result-card:hover {
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  }

  .rank-badge {
    min-width: 32px;
    height: 32px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .result-body {
    flex: 1;
    min-width: 0;
  }
  .result-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .result-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary, var(--text-1));
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-amount {
    font-size: 12px;
    color: var(--text-secondary, var(--text-2));
    white-space: nowrap;
    font-weight: 500;
  }

  .diet-badge {
    font-size: 14px;
    flex-shrink: 0;
  }

  /* Progress */
  .progress-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .progress-bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-1));
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 0.3s ease;
  }
  .progress-label {
    font-size: 11px;
    color: var(--text-secondary, var(--text-3));
    white-space: nowrap;
    min-width: fit-content;
  }

  /* Add button */
  .add-btn {
    min-width: 44px;
    min-height: 44px;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .add-btn:hover {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .add-btn .material-symbols-rounded {
    font-size: 20px;
  }

  /* Veg toggle */
  .veg-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }
  .veg-toggle input {
    display: none;
  }
  .veg-toggle-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-secondary, var(--text-2));
    transition: all 0.15s ease;
  }
  .veg-toggle input:checked + .veg-toggle-label {
    background: var(--diet-veg-dim);
    border-color: var(--diet-veg);
    color: var(--diet-veg);
  }
  .veg-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--diet-veg);
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: 48px 16px;
    color: var(--text-secondary, var(--text-2));
  }
  .empty-state h2 {
    margin: 12px 0 4px;
    color: var(--text-primary, var(--text-1));
    font-size: 18px;
  }
  .empty-state p {
    font-size: 14px;
    max-width: 300px;
    margin: 0 auto;
  }

  /* Spinner */
  .spin {
    font-size: 32px;
    color: var(--accent);
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Responsive */
  @media (max-width: 480px) {
    .nutrient-chips {
      overflow-x: auto;
      flex-wrap: nowrap;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 4px;
    }
    .nutrient-chips::-webkit-scrollbar { display: none; }
    .result-top {
      flex-direction: column;
      gap: 2px;
    }
  }
</style>
