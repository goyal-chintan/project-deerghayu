<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';
  import { NUTRIMENTS, Nutrition } from '../lib/nutrition.js';
  import { vegetarianMode } from '../stores/settings.js';
  import { isAllowedInVegMode } from '../lib/dietType.js';

  const FEATURED_NUTRIENTS = [
    'iron', 'calcium', 'b12', 'zinc', 'vitamin-d', 'b9',
    'fiber', 'proteins', 'vitamin-a', 'vitamin-c', 'magnesium', 'potassium',
  ];

  const NUTRIENT_GROUPS = [
    { key: 'all', label: 'Featured' },
    { key: 'mineral', label: 'Minerals' },
    { key: 'vitamin', label: 'Vitamins' },
    { key: 'macro', label: 'Macros' },
  ];

  let foods = [];
  let members = [];
  let loading = true;
  let loadError = '';
  let selectedGroup = 'all';
  let selectedNutrientId = 'iron';

  $: featuredNutrients = FEATURED_NUTRIENTS
    .map(id => NUTRIMENTS.find(nutrient => nutrient.id === id))
    .filter(Boolean);
  $: visibleNutrients = selectedGroup === 'all'
    ? featuredNutrients
    : featuredNutrients.filter(nutrient => nutrient.category === selectedGroup);
  $: selectedNutrient = NUTRIMENTS.find(n => n.id === selectedNutrientId) || NUTRIMENTS.find(n => n.id === 'iron');
  $: rankedFoods = foods
    .filter(food => !$vegetarianMode || isAllowedInVegMode(food))
    .filter(food => getNutrientValue(food, selectedNutrientId) > 0)
    .sort((a, b) => getNutrientValue(b, selectedNutrientId) - getNutrientValue(a, selectedNutrientId))
    .slice(0, 20);
  $: familyNeed = getFamilyNeed();
  $: bestFood = rankedFoods[0] || null;

  function selectGroup(groupKey) {
    selectedGroup = groupKey;
    const nextNutrient = groupKey === 'all'
      ? featuredNutrients[0]
      : featuredNutrients.find(nutrient => nutrient.category === groupKey);
    if (nextNutrient) selectedNutrientId = nextNutrient.id;
  }

  function getFamilyNeed() {
    let total = 0;
    const breakdown = [];

    for (const member of members) {
      const need = Number.parseFloat(member.targets?.[selectedNutrientId]) || 0;
      total += need;
      if (need > 0) breakdown.push({ name: member.name || 'Family member', need });
    }

    return { total, breakdown };
  }

  function getNutrientValue(food, nutrientId) {
    const fromNutrition = Number.parseFloat(food?.nutrition?.[nutrientId]);
    if (Number.isFinite(fromNutrition)) return fromNutrition;

    const fromLegacyField = Number.parseFloat(food?.[nutrientId]);
    return Number.isFinite(fromLegacyField) ? fromLegacyField : 0;
  }

  function getServingSize(food) {
    const portion = Number.parseFloat(food?.portion);
    return Number.isFinite(portion) && portion > 0 ? portion : 100;
  }

  function getPerServingValue(food) {
    return getNutrientValue(food, selectedNutrientId) * (getServingSize(food) / 100);
  }

  function getPercentOfDaily(food) {
    if (!familyNeed.total || familyNeed.total <= 0) return 0;
    return Math.min(Math.round((getPerServingValue(food) / familyNeed.total) * 100), 100);
  }

  function formatAmount(value, nutrient = selectedNutrient) {
    const unit = nutrient?.unit ? ` ${nutrient.unit}` : '';
    return `${Nutrition.format(value)}${unit}`;
  }

  function formatFoodAmount(food) {
    return `${formatAmount(getNutrientValue(food, selectedNutrientId))} per 100g`;
  }

  function getDietBadge(food) {
    const dietType = (food.diet_type || 'vegetarian').toLowerCase();
    if (dietType === 'vegan' || dietType === 'vegetarian') return { icon: '🌿', label: 'Vegetarian' };
    if (dietType === 'eggetarian') return { icon: '🥚', label: 'Eggetarian' };
    return { icon: '🍗', label: 'Non-vegetarian' };
  }

  async function addToDiary(food) {
    try {
      sessionStorage.setItem('nt:quickAdd', JSON.stringify({
        id: food.id,
        name: food.name,
        portion: food.portion,
        unit: food.unit,
        nutrition: food.nutrition,
      }));
      push('/');
    } catch (err) {
      loadError = 'Could not prepare this food for the diary. Please try again.';
      console.error('[NutrientExplorer] quick add failed:', err);
    }
  }

  async function loadFoodSources() {
    loading = true;
    loadError = '';
    try {
      const [foodsRes, membersRes] = await Promise.all([
        NtApi.getFoods(),
        NtApi.get('/api/family').catch(() => []),
      ]);
      foods = Array.isArray(foodsRes) ? foodsRes : [];
      members = Array.isArray(membersRes) ? membersRes : [];
    } catch (err) {
      loadError = 'Food-source exploration could not load. Retry after checking your connection.';
      console.error('[NutrientExplorer] load error:', err);
    } finally {
      loading = false;
    }
  }

  onMount(loadFoodSources);
</script>

<div class="page-shell source-shell" in:fade={{ duration: 160 }}>
  <header class="page-header source-header">
    <div class="ph-left header-copy">
      <button class="icon-btn" aria-label="Back to diary" on:click={() => push('/')}>
        <span class="material-symbols-rounded" aria-hidden="true">arrow_back</span>
      </button>
      <div>
        <p class="eyebrow">Food-source explorer</p>
        <h1 class="page-title">Find foods rich in {selectedNutrient?.label || 'nutrients'}</h1>
        <p class="page-subtitle">Choose a nutrient, compare top foods per 100g, and add a serving to today’s diary.</p>
      </div>
    </div>
    <label class="veg-toggle" title="Vegetarian filter">
      <input type="checkbox" bind:checked={$vegetarianMode}>
      <span class="veg-toggle-label"><span class="veg-dot" aria-hidden="true"></span>Vegetarian</span>
    </label>
  </header>

  <div class="page-content source-content">
    <section class="hero-card" aria-label="Food source guidance">
      <div>
        <p class="eyebrow">Start with a nutrient</p>
        <h2>Explore practical food sources for the family table.</h2>
        <p>Ranked foods use nutrient density per 100g, while the serving note shows how much one usual portion contributes to your family’s daily need.</p>
      </div>
      {#if bestFood}
        <div class="hero-highlight">
          <span>Top source now</span>
          <strong>{bestFood.name}</strong>
          <small>{formatFoodAmount(bestFood)}</small>
        </div>
      {/if}
    </section>

    <section class="selector-card" aria-label="Nutrient filters">
      <div class="group-selector" role="group" aria-label="Nutrient group">
        {#each NUTRIENT_GROUPS as group}
          <button
            class:active={selectedGroup === group.key}
            aria-pressed={selectedGroup === group.key}
            on:click={() => selectGroup(group.key)}
          >
            {group.label}
          </button>
        {/each}
      </div>

      <div class="nutrient-chips" aria-label="Featured nutrient filters">
        {#each visibleNutrients as nutrient}
          <button
            class="chip"
            class:active={selectedNutrientId === nutrient.id}
            aria-pressed={selectedNutrientId === nutrient.id}
            on:click={() => selectedNutrientId = nutrient.id}
          >
            {nutrient.label}
          </button>
        {/each}
      </div>
    </section>

    {#if familyNeed.total > 0}
      <section class="summary-card" transition:fade={{ duration: 150 }} aria-label="Selected nutrient summary">
        <div>
          <p class="eyebrow">Selected nutrient</p>
          <h2>{selectedNutrient?.label}: {formatAmount(familyNeed.total)}/day for the family</h2>
          <p>{rankedFoods.length} food sources found{ $vegetarianMode ? ' with the vegetarian filter on' : '' }.</p>
        </div>
        <div class="member-needs">
          {#each familyNeed.breakdown as memberNeed}
            <span>{memberNeed.name}: {formatAmount(memberNeed.need)}</span>
          {/each}
        </div>
      </section>
    {:else}
      <section class="summary-card compact" aria-label="Selected nutrient summary">
        <div>
          <p class="eyebrow">Selected nutrient</p>
          <h2>{selectedNutrient?.label || 'Nutrient'} food sources</h2>
          <p>Add family profiles to see daily need per serving. Rankings still show food density per 100g.</p>
        </div>
      </section>
    {/if}

    {#if loading}
      <section class="state-card" aria-live="polite">
        <span class="material-symbols-rounded spin" aria-hidden="true">progress_activity</span>
        <h2>Loading food sources</h2>
        <p>Gathering foods and family needs for nutrient exploration.</p>
      </section>
    {:else if loadError}
      <section class="state-card error" aria-live="assertive">
        <span class="material-symbols-rounded" aria-hidden="true">error</span>
        <h2>Food sources unavailable</h2>
        <p>{loadError}</p>
        <button class="primary-btn" on:click={loadFoodSources}>Retry</button>
      </section>
    {:else if foods.length === 0}
      <section class="state-card">
        <span class="material-symbols-rounded" aria-hidden="true">nutrition</span>
        <h2>No foods in your library</h2>
        <p>Import the Indian food database from Settings, or add foods manually to begin source exploration.</p>
        <button class="primary-btn" on:click={() => push('/settings')}>
          <span class="material-symbols-rounded" aria-hidden="true">settings</span>
          Go to Settings
        </button>
      </section>
    {:else if rankedFoods.length === 0}
      <section class="state-card">
        <span class="material-symbols-rounded" aria-hidden="true">search_off</span>
        <h2>No matching food sources</h2>
        <p>No foods have {selectedNutrient?.label || 'this nutrient'} data{ $vegetarianMode ? ' with the vegetarian filter on' : '' }. Try another nutrient or filter.</p>
      </section>
    {:else}
      <section class="results-list" aria-label={`Top foods ranked by ${selectedNutrient?.label || 'nutrient'} per 100g`}>
        {#each rankedFoods as food, index (food.id || `${food.name}-${index}`)}
          {@const dietBadge = getDietBadge(food)}
          <article class="result-card" transition:fade={{ duration: 120, delay: Math.min(index * 16, 160) }}>
            <div class="rank-badge" aria-label={`Rank ${index + 1}`}>#{index + 1}</div>
            <div class="result-body">
              <div class="result-top">
                <h3>{food.name}</h3>
                <span class="diet-badge" title={dietBadge.label} aria-label={dietBadge.label}>{dietBadge.icon}</span>
              </div>
              <p class="result-amount">{formatFoodAmount(food)}</p>
              {#if familyNeed.total > 0}
                <div class="serving-row">
                  <div class="progress-bar" aria-hidden="true">
                    <div class="progress-fill" style={`transform: scaleX(${getPercentOfDaily(food) / 100})`}></div>
                  </div>
                  <span>{getPercentOfDaily(food)}% of family daily need per {getServingSize(food)}{food.unit || 'g'} serving</span>
                </div>
              {:else}
                <p class="serving-note">Typical serving: {getServingSize(food)}{food.unit || 'g'}</p>
              {/if}
            </div>
            <button class="add-btn" aria-label={`Add ${food.name} to today’s diary`} on:click={() => addToDiary(food)}>
              <span class="material-symbols-rounded" aria-hidden="true">add</span>
            </button>
          </article>
        {/each}
      </section>
    {/if}
  </div>
</div>

<style>
  .source-shell {
    --source-card-bg: var(--surface-1);
    --source-soft-bg: color-mix(in srgb, var(--accent) 8%, var(--surface-1));
  }

  .source-header {
    align-items: flex-start;
    gap: 16px;
  }

  .header-copy {
    align-items: flex-start;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--accent);
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .page-subtitle {
    max-width: 680px;
    margin: 6px 0 0;
    color: var(--text-secondary, var(--text-2));
    font-size: clamp(0.92rem, 0.88rem + 0.2vw, 1rem);
    line-height: 1.5;
  }

  .source-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .hero-card,
  .selector-card,
  .summary-card,
  .state-card,
  .result-card {
    background: var(--source-card-bg);
    border: 1px solid var(--border);
    border-radius: 16px;
  }

  .hero-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 280px);
    gap: 20px;
    padding: 20px;
    background: linear-gradient(135deg, var(--source-soft-bg), var(--surface-1) 62%);
  }

  .hero-card h2,
  .summary-card h2,
  .state-card h2,
  .result-top h3 {
    margin: 0;
    color: var(--text-primary, var(--text-1));
  }

  .hero-card h2 {
    font-size: clamp(1.35rem, 1.08rem + 1.2vw, 2rem);
    line-height: 1.1;
  }

  .hero-card p,
  .summary-card p,
  .state-card p,
  .serving-note {
    margin: 8px 0 0;
    color: var(--text-secondary, var(--text-2));
    line-height: 1.5;
  }

  .hero-highlight {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    border-radius: 12px;
    background: color-mix(in srgb, var(--surface-1) 88%, var(--accent));
  }

  .hero-highlight span,
  .hero-highlight small {
    color: var(--text-secondary, var(--text-2));
  }

  .hero-highlight strong {
    color: var(--text-primary, var(--text-1));
    font-size: 1.08rem;
  }

  .selector-card,
  .summary-card {
    padding: 16px;
  }

  .group-selector,
  .nutrient-chips,
  .member-needs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .group-selector {
    margin-bottom: 12px;
  }

  .group-selector button,
  .chip {
    min-height: 44px;
    border: 1px solid var(--border);
    color: var(--text-secondary, var(--text-2));
    background: var(--surface-1);
    cursor: pointer;
    font-weight: 700;
  }

  .group-selector button {
    padding: 0 14px;
    border-radius: 10px;
  }

  .chip {
    padding: 0 16px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .group-selector button:hover,
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .group-selector button:focus-visible,
  .chip:focus-visible,
  .add-btn:focus-visible,
  .veg-toggle input:focus-visible + .veg-toggle-label {
    outline: 3px solid color-mix(in srgb, var(--accent) 30%, transparent);
    outline-offset: 2px;
  }

  .group-selector button.active,
  .chip.active {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }

  .summary-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 320px);
    gap: 16px;
    align-items: center;
  }

  .summary-card.compact {
    display: block;
  }

  .member-needs span {
    color: var(--text-secondary, var(--text-2));
    font-size: 0.86rem;
  }

  .results-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .result-card {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    gap: 14px;
    align-items: center;
    padding: 14px;
  }

  .result-card:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  }

  .rank-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--source-soft-bg);
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: 800;
  }

  .result-body {
    min-width: 0;
  }

  .result-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .result-top h3 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
  }

  .diet-badge {
    flex: 0 0 auto;
    font-size: 1rem;
  }

  .result-amount {
    margin: 4px 0 0;
    color: var(--text-primary, var(--text-1));
    font-size: 0.92rem;
    font-weight: 700;
  }

  .serving-row {
    display: grid;
    grid-template-columns: minmax(80px, 1fr) auto;
    gap: 10px;
    align-items: center;
    margin-top: 8px;
  }

  .serving-row span {
    color: var(--text-secondary, var(--text-2));
    font-size: 0.82rem;
    white-space: nowrap;
  }

  .progress-bar {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-2, var(--surface-1)));
  }

  .progress-fill {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transform-origin: left center;
  }

  .add-btn {
    min-width: 44px;
    min-height: 44px;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    color: var(--accent);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-btn:hover {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }

  .veg-toggle {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
  }

  .veg-toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .veg-toggle-label {
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-1);
    color: var(--text-secondary, var(--text-2));
    font-size: 0.9rem;
    font-weight: 700;
  }

  .veg-toggle input:checked + .veg-toggle-label {
    border-color: var(--diet-veg, var(--accent));
    background: var(--diet-veg-dim, var(--source-soft-bg));
    color: var(--diet-veg, var(--accent));
  }

  .veg-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--diet-veg, var(--accent));
  }

  .state-card {
    text-align: center;
    padding: 48px 20px;
    color: var(--text-secondary, var(--text-2));
  }

  .state-card .material-symbols-rounded {
    color: var(--accent);
    font-size: 44px;
  }

  .state-card.error .material-symbols-rounded {
    color: var(--danger, #b42318);
  }

  .state-card .primary-btn {
    min-height: 44px;
    margin-top: 16px;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation-duration: 2.5s;
    }
  }

  @media (max-width: 720px) {
    .source-header,
    .hero-card,
    .summary-card {
      grid-template-columns: 1fr;
    }

    .source-header {
      align-items: stretch;
    }

    .hero-card,
    .selector-card,
    .summary-card {
      padding: 16px;
    }

    .serving-row {
      grid-template-columns: 1fr;
      gap: 6px;
    }

    .serving-row span {
      white-space: normal;
    }
  }

  @media (max-width: 480px) {
    .nutrient-chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .nutrient-chips::-webkit-scrollbar {
      display: none;
    }

    .result-card {
      grid-template-columns: 40px minmax(0, 1fr) 44px;
      gap: 10px;
      padding: 12px;
    }

    .rank-badge {
      width: 40px;
      height: 40px;
    }
  }
</style>
