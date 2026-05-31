<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../../lib/api.js';
  import { localDateStr } from '../../lib/db.js';
  import { NUTRIMENTS, Nutrition } from '../../lib/nutrition.js';
  import { isAllowedInVegMode } from '../../lib/dietType.js';
  import { suggestFoodsForNutrient } from '../../lib/nutrientRecommendations.js';
  import { vegetarianMode, goals, mealNames } from '../../stores/settings.js';
  import { currentUser } from '../../stores/auth.js';
  import {
    ANALYTICS_NUTRIENT_IDS,
    buildCoverageDistribution,
    summarizeFamilyNutrition,
  } from '../../lib/familyNutrition.js';

  const DATE_RANGE_FILTERS = [
    { key: 'today', label: 'Today', days: 1 },
    { key: 'last3', label: 'Last 3 days', days: 3 },
    { key: 'last7', label: 'Last 7 days', days: 7 },
  ];
  const DEFAULT_MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const GROUP_FILTERS = [
    { key: 'all', label: 'All nutrients' },
    { key: 'energy', label: 'Energy' },
    { key: 'macro', label: 'Macros' },
    { key: 'mineral', label: 'Minerals' },
    { key: 'vitamin', label: 'Vitamins' },
  ];
  const SEVERITY_FILTERS = [
    { key: 'all', label: 'All status' },
    { key: 'needs_attention', label: 'Needs attention' },
    { key: 'watch', label: 'Watch' },
    { key: 'on_track', label: 'On track' },
  ];

  let foods = [];
  let members = [];
  let diaryEntry = null;
  let diaryEntries = [];
  let loading = true;
  let rangeLoading = false;
  let loadError = '';
  let handoffError = '';
  let today = localDateStr();

  let selectedDateRange = 'today';
  let selectedMemberId = 'all';
  let selectedMeal = 'All meals';
  let selectedGroup = 'all';
  let selectedSeverity = 'all';
  let selectedNutrientId = '';

  $: allItems = diaryEntries.flatMap(entry =>
    (Array.isArray(entry?.items) ? entry.items : []).map(item => ({ ...item, __date: entry.date })),
  );
  $: filteredItems = allItems.filter(item => {
    const mealMatch = selectedMeal === 'All meals' || normalizeMeal(item) === selectedMeal;
    const memberMatch = selectedMemberId === 'all' || (item.member_id || 'me') === selectedMemberId;
    return mealMatch && memberMatch;
  });
  $: selectedRangeDates = datesForRange(selectedDateRange);
  $: selectedRangeDays = selectedRangeDates.length;
  $: summary = summarizeFamilyNutrition({
    members: scaleMembersForRange(members, selectedRangeDays),
    currentUser: $currentUser,
    goals: scaleGoalsForRange($goals, selectedRangeDates),
    items: filteredItems,
    maxRecommendations: 3,
  });
  $: mealFilters = ['All meals', ...($mealNames || DEFAULT_MEAL_NAMES)];
  $: memberOptions = [
    { id: 'all', name: 'All members' },
    { id: 'me', name: $currentUser?.full_name || $currentUser?.name || 'Myself' },
    ...members.map(member => ({ id: member.id, name: member.name || 'Family member' })),
  ];
  $: selectedMemberSummary = summary.members.find(member => member.id === selectedMemberId) || null;
  $: sourceRows = selectedMemberId === 'all'
    ? summary.analyticsRows
    : (selectedMemberSummary?.rows || []).map(row => withMemberContext(row, selectedMemberSummary.name));
  $: analyticsRows = sourceRows.filter(row => {
    const nutrient = NUTRIMENTS.find(n => n.id === row.id);
    const severityMatch = selectedSeverity === 'all' || row.status.key === selectedSeverity;
    const groupMatch = selectedGroup === 'all' || nutrient?.category === selectedGroup;
    return severityMatch && groupMatch;
  });
  $: distribution = buildCoverageDistribution(analyticsRows);
  $: overallCoverage = analyticsRows.length
    ? Math.round(analyticsRows.reduce((sum, row) => sum + row.coveragePct, 0) / analyticsRows.length)
    : 0;
  $: selectedRow = analyticsRows.find(row => row.id === selectedNutrientId)
    || analyticsRows[0]
    || sourceRows[0]
    || null;
  $: candidateFoods = foods.filter(food => !$vegetarianMode || isAllowedInVegMode(food));
  $: selectedSuggestions = selectedRow
    ? suggestFoodsForNutrient(
        selectedRow.id,
        Math.max(selectedRow.target - selectedRow.current, 0),
        candidateFoods,
        $vegetarianMode,
        4,
      )
    : [];
  $: memberImpactRows = selectedMemberId === 'all'
    ? summary.members
    : selectedMemberSummary ? [selectedMemberSummary] : [];
  $: noMatchingMeals = allItems.length > 0 && filteredItems.length === 0;

  function normalizeMeal(item) {
    const configuredMeals = $mealNames || DEFAULT_MEAL_NAMES;
    const rawMeal = item?.meal ?? item?.meal_type ?? 0;
    if (typeof rawMeal === 'number') return configuredMeals[rawMeal] || `Meal ${rawMeal + 1}`;
    if (typeof rawMeal === 'string' && /^\d+$/.test(rawMeal)) {
      const index = Number.parseInt(rawMeal, 10);
      return configuredMeals[index] || `Meal ${index + 1}`;
    }

    const meal = String(rawMeal || 'Meal');
    const configuredMatch = configuredMeals.find(name => String(name).toLowerCase() === meal.toLowerCase());
    if (configuredMatch) return configuredMatch;
    const snackMatch = configuredMeals.find(name => String(name).toLowerCase().includes('snack'));
    return meal.toLowerCase().includes('snack') && snackMatch ? snackMatch : meal;
  }

  function withMemberContext(row, memberName) {
    const aggregateRow = summary.analyticsRows.find(item => item.id === row.id);
    const affected = row.status.key === 'on_track' ? [] : [{ name: memberName, coveragePct: row.coveragePct }];
    return {
      ...row,
      affected,
      affectedLabel: affected.length ? memberName : 'None',
      trend: 'Today',
      foodMove: aggregateRow?.foodMove || 'Open planner for food ideas',
    };
  }

  function formatAmount(value, unit) {
    const suffix = unit ? ` ${unit}` : '';
    return `${Nutrition.format(value)}${suffix}`;
  }

  function barWidth(value, max) {
    if (!max || value <= 0) return 0;
    return Math.max(8, Math.round((value / max) * 100));
  }

  function statusTone(key) {
    if (key === 'needs_attention') return 'Needs attention';
    if (key === 'watch') return 'Watch';
    return 'On track';
  }

  function scaleNumber(value, multiplier) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed * multiplier : value;
  }

  function scaleGoalsForRange(goalMap, rangeDates) {
    const days = rangeDates.length;
    if (days <= 1) return goalMap;
    const todayWeekday = new Date(`${today}T00:00:00`).getDay();
    return Object.fromEntries(Object.entries(goalMap || {}).map(([id, goal]) => {
      if (!goal || typeof goal !== 'object') return [id, goal];
      if (goal.isPercent) return [id, goal];

      if (goal.sharedGoal === false && goal.days) {
        const rangeTarget = rangeDates.reduce((sum, date) => {
          const weekday = new Date(`${date}T00:00:00`).getDay();
          const value = Number.parseFloat(goal.days?.[weekday] ?? goal.max ?? goal.min);
          return Number.isFinite(value) ? sum + value : sum;
        }, 0);
        return [id, {
          ...goal,
          min: rangeTarget,
          max: rangeTarget,
          days: { ...goal.days, [todayWeekday]: rangeTarget },
        }];
      }

      return [id, {
        ...goal,
        min: scaleNumber(goal.min, days),
        max: scaleNumber(goal.max, days),
      }];
    }));
  }

  function scaleMembersForRange(memberList, days) {
    if (days <= 1) return memberList;
    return memberList.map(member => ({
      ...member,
      targets: member.targets
        ? Object.fromEntries(Object.entries(member.targets).map(([id, value]) => [id, scaleNumber(value, days)]))
        : member.targets,
    }));
  }

  function datesForRange(rangeKey) {
    const range = DATE_RANGE_FILTERS.find(item => item.key === rangeKey) || DATE_RANGE_FILTERS[0];
    return Array.from({ length: range.days }, (_, index) => {
      const date = new Date(`${today}T00:00:00`);
      date.setDate(date.getDate() - index);
      return localDateStr(date);
    });
  }

  function normalizeDiaryEntry(entry, date) {
    return { ...(entry || {}), date, items: Array.isArray(entry?.items) ? entry.items : [] };
  }

  async function loadDiaryRange(rangeKey) {
    rangeLoading = true;
    handoffError = '';
    try {
      const dates = datesForRange(rangeKey);
      const entries = await Promise.all(dates.map(date =>
        date === today && diaryEntry
          ? Promise.resolve(diaryEntry)
          : NtApi.getDiaryDate(date).catch(() => null),
      ));
      diaryEntries = entries.map((entry, index) => normalizeDiaryEntry(entry, dates[index]));
    } catch (err) {
      loadError = 'Nutrition analytics could not load this date range. Retry after checking your connection.';
      console.error('[NutritionAnalytics] date range load error:', err);
    } finally {
      rangeLoading = false;
    }
  }

  async function handleDateRangeChange(event) {
    selectedDateRange = event.target.value;
    await loadDiaryRange(selectedDateRange);
  }

  async function loadAnalytics() {
    loading = true;
    loadError = '';
    handoffError = '';
    try {
      const [foodsRes, membersRes, diaryRes] = await Promise.all([
        NtApi.getFoods(),
        NtApi.get('/api/family').catch(() => []),
        NtApi.getDiaryDate(today).catch(() => null),
      ]);
      foods = Array.isArray(foodsRes) ? foodsRes : [];
      members = Array.isArray(membersRes) ? membersRes : [];
      diaryEntry = normalizeDiaryEntry(diaryRes, today);
      diaryEntries = [diaryEntry];
      if (selectedDateRange !== 'today') await loadDiaryRange(selectedDateRange);
    } catch (err) {
      loadError = 'Nutrition analytics could not load. Retry after checking your connection.';
      console.error('[NutritionAnalytics] load error:', err);
    } finally {
      loading = false;
    }
  }

  function goToPlannerWithNutrient(row = selectedRow) {
    handoffError = '';
    try {
      if (row) {
        sessionStorage.setItem('nt:analyticsPlanningFocus', JSON.stringify({
          nutrientId: row.id,
          label: row.label,
          coveragePct: row.coveragePct,
          status: row.status.label,
          foodMove: row.foodMove,
        }));
      }
    } catch (err) {
      console.warn('[NutritionAnalytics] planning focus handoff failed:', err);
    }
    push('/planner');
  }

  async function addFoodSuggestion(suggestion) {
    handoffError = '';
    try {
      sessionStorage.setItem('nt:quickAdd', JSON.stringify({
        id: suggestion.food.id,
        name: suggestion.food.name,
        portion: suggestion.servingToFill || suggestion.food.portion || 100,
        unit: suggestion.food.unit || 'g',
        nutrition: suggestion.food.nutrition,
      }));
      push('/');
    } catch (err) {
      handoffError = 'Could not prepare this food suggestion. Try opening the planner instead.';
      console.error('[NutritionAnalytics] suggestion handoff failed:', err);
    }
  }

  onMount(loadAnalytics);
</script>

<section class="nutrition-analytics-panel" aria-labelledby="nutrition-coverage-title" in:fade={{ duration: 160 }}>
  <div class="analytics-panel-header">
    <div>
      <p class="eyebrow">Family nutrition</p>
      <h2 id="nutrition-coverage-title">Nutrition coverage</h2>
      <p class="panel-subtitle">Family targets, meal coverage, and nutrient gaps.</p>
    </div>
    <button class="primary-btn" on:click={() => goToPlannerWithNutrient()} disabled={!selectedRow}>
      <span class="material-symbols-rounded" aria-hidden="true">restaurant_menu</span>
      Create meal plan
    </button>
  </div>

  <div class="analytics-content">
    {#if loading}
      <section class="analytics-empty" aria-live="polite">
        <span class="material-symbols-rounded spin" aria-hidden="true">progress_activity</span>
        <h2>Loading nutrition analytics</h2>
        <p>Building family coverage, member impact, and food suggestions from today’s diary.</p>
      </section>
    {:else if loadError}
      <section class="analytics-empty error" aria-live="assertive">
        <span class="material-symbols-rounded" aria-hidden="true">error</span>
        <h2>Analytics unavailable</h2>
        <p>{loadError}</p>
        <button class="primary-btn" on:click={loadAnalytics}>Retry</button>
      </section>
    {:else}
      {#if handoffError}
        <p class="handoff-error" role="alert">{handoffError}</p>
      {/if}

      <section class="filter-panel" aria-label="Analytics filters">
        <label>
          <span>Date range</span>
          <select value={selectedDateRange} aria-label="Date range" on:change={handleDateRangeChange} disabled={rangeLoading}>
            {#each DATE_RANGE_FILTERS as range}
              <option value={range.key}>{range.label}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Member</span>
          <select bind:value={selectedMemberId} aria-label="Family member">
            {#each memberOptions as member}
              <option value={member.id}>{member.name}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Meal</span>
          <select bind:value={selectedMeal} aria-label="Meal">
            {#each mealFilters as meal}
              <option value={meal}>{meal}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Nutrient group</span>
          <select bind:value={selectedGroup} aria-label="Nutrient group">
            {#each GROUP_FILTERS as group}
              <option value={group.key}>{group.label}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select bind:value={selectedSeverity} aria-label="Coverage severity">
            {#each SEVERITY_FILTERS as severity}
              <option value={severity.key}>{severity.label}</option>
            {/each}
          </select>
        </label>
      </section>

      {#if allItems.length === 0 || noMatchingMeals}
      <section class="analytics-empty">
        <span class="material-symbols-rounded" aria-hidden="true">restaurant</span>
        <h2>{noMatchingMeals ? 'No meals match these filters' : 'Log meals to analyze coverage'}</h2>
        <p>
          {noMatchingMeals
            ? 'Adjust the date range, member, or meal filter to bring logged foods back into view.'
            : 'Nutrition analytics needs meal data before it can classify nutrient coverage.'}
        </p>
        <button class="primary-btn" on:click={() => push('/')}>{noMatchingMeals ? 'Review diary' : 'Log first meal'}</button>
      </section>
      {:else if analyticsRows.length === 0}
        <section class="analytics-empty compact">
          <span class="material-symbols-rounded" aria-hidden="true">filter_alt_off</span>
          <h2>No nutrients match these filters</h2>
          <p>Try a different nutrient group or severity level.</p>
        </section>
      {:else}
        {#if rangeLoading}
          <p class="range-loading" aria-live="polite">Updating nutrition analytics for this date range…</p>
        {/if}

        <section class="analytics-grid">
          <article class="analytics-card distribution-card">
            <div class="card-heading">
              <div>
                <p class="eyebrow">Coverage distribution</p>
                <h2>{overallCoverage}% average coverage</h2>
              </div>
              <span class="status-label">{summary.headline}</span>
            </div>
            <div class="distribution-bars" aria-label="Coverage distribution by status">
              {#each [
                { key: 'needs_attention', label: 'Needs attention', count: distribution.needs_attention },
                { key: 'watch', label: 'Watch', count: distribution.watch },
                { key: 'on_track', label: 'On track', count: distribution.on_track },
              ] as segment}
                <div class="distribution-row status-{segment.key}">
                  <span>{segment.label}</span>
                  <div class="bar-track" aria-hidden="true">
                    <div style="width: {barWidth(segment.count, analyticsRows.length)}%"></div>
                  </div>
                  <strong>{segment.count} nutrients</strong>
                </div>
              {/each}
            </div>
          </article>

          <article class="analytics-card member-impact-card">
            <div class="card-heading">
              <div>
                <p class="eyebrow">Member impact</p>
                <h2>Who needs attention</h2>
              </div>
              <span class="status-label">{filteredItems.length} items selected</span>
            </div>
            <div class="member-impact-list">
              {#each memberImpactRows as member}
                <div class="member-impact-row">
                  <span>{member.name}</span>
                  <div class="bar-track" aria-hidden="true">
                    <div style="width: {barWidth(member.needsAttentionCount, ANALYTICS_NUTRIENT_IDS.length)}%"></div>
                  </div>
                  <strong>{member.needsAttentionCount} low nutrients</strong>
                </div>
              {/each}
            </div>
          </article>
        </section>

        <section class="analytics-detail-layout">
          <article class="analytics-card nutrient-table-card">
            <div class="card-heading">
              <div>
                <p class="eyebrow">Nutrient details</p>
                <h2>{analyticsRows.length} nutrients shown</h2>
              </div>
            </div>
            <div class="nutrient-table" aria-label="Nutrient coverage details">
              <div class="nutrient-row header" aria-hidden="true">
                <span>Nutrient</span>
                <span>Coverage</span>
                <span>Status</span>
                <span>Affected</span>
                <span>Food move</span>
              </div>
              {#each analyticsRows as row}
                <button
                  class="nutrient-row"
                  class:selected={selectedRow?.id === row.id}
                  aria-label={`Inspect ${row.label}, ${row.coveragePct}% coverage, ${row.status.label}, ${row.foodMove}`}
                  aria-pressed={selectedRow?.id === row.id}
                  on:click={() => selectedNutrientId = row.id}
                >
                  <span><strong>{row.label}</strong></span>
                  <span>{row.coveragePct}%</span>
                  <span><span class="status-pill status-{row.status.key}">{statusTone(row.status.key)}</span></span>
                  <span>{row.affectedLabel}</span>
                  <span>{row.foodMove}</span>
                </button>
              {/each}
            </div>
          </article>

          <aside class="analytics-card drilldown-card" aria-label="Selected nutrient details">
            {#if selectedRow}
              <p class="eyebrow">Nutrient detail</p>
              <h2>{selectedRow.label}</h2>
              <p class="drilldown-summary">
                {formatAmount(selectedRow.current, selectedRow.unit)} of {formatAmount(selectedRow.target, selectedRow.unit)} logged today.
                Status: {selectedRow.status.label}.
              </p>
              <div class="drilldown-progress" aria-label={`${selectedRow.coveragePct}% coverage`}>
                <div style="width: {selectedRow.coveragePct}%"></div>
              </div>
              <div class="drilldown-meta">
                <span>Current {formatAmount(selectedRow.current, selectedRow.unit)}</span>
                <span>Target {formatAmount(selectedRow.target, selectedRow.unit)}</span>
              </div>

              <h3>Food suggestions</h3>
              <div class="suggestion-list">
                {#each selectedSuggestions as suggestion}
                  <button
                    class="suggestion-row"
                    aria-label={`Quick add ${suggestion.name} for ${selectedRow.label}`}
                    on:click={() => addFoodSuggestion(suggestion)}
                  >
                    <span>
                      <strong>{suggestion.name}</strong>
                      <small>{formatAmount(suggestion.amountPer100g, selectedRow.unit)} per 100g · about {suggestion.servingToFill || 100}g to close gap</small>
                    </span>
                    <span class="suggestion-action">Add</span>
                  </button>
                {/each}
                {#if selectedSuggestions.length === 0}
                  <p class="muted">No food suggestions found for this nutrient with current filters.</p>
                {/if}
              </div>

              <button class="secondary-action" on:click={() => goToPlannerWithNutrient(selectedRow)}>
                Plan around {selectedRow.label}
              </button>
            {/if}
          </aside>
        </section>
      {/if}
    {/if}
  </div>
</section>

<style>
  .nutrition-analytics-panel {
    display: grid;
    gap: var(--space-4);
  }

  .analytics-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
  }

  .analytics-panel-header h2 {
    margin: 0;
    color: var(--text-1);
    font-size: clamp(24px, 4vw, 34px);
    letter-spacing: -0.04em;
  }

  .eyebrow {
    margin: 0 0 var(--space-1);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .panel-subtitle {
    margin: var(--space-2) 0 0;
    color: var(--text-2);
    line-height: 1.5;
  }

  .analytics-content {
    display: grid;
    gap: var(--space-4);
  }

  .primary-btn,
  .secondary-action,
  .suggestion-row,
  .nutrient-row,
  .filter-panel select {
    min-height: 44px;
  }

  .range-loading,
  .handoff-error {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    color: var(--text-1);
    font-weight: 700;
  }

  .range-loading {
    border: 1px solid var(--border);
    background: var(--surface-2);
  }

  .handoff-error {
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
    background: color-mix(in srgb, var(--danger) 12%, var(--surface-1));
  }

  .filter-panel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(152px, 1fr));
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    box-shadow: var(--shadow-sm);
  }

  .filter-panel label {
    display: grid;
    gap: var(--space-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 700;
  }

  .filter-panel select {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-1);
    padding: 0 var(--space-3);
    font: inherit;
  }

  .analytics-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
    gap: var(--space-4);
  }

  .analytics-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
  }

  .card-heading {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    align-items: flex-start;
    margin-bottom: var(--space-4);
  }

  .card-heading h2,
  .drilldown-card h2,
  .analytics-empty h2 {
    margin: 0;
    color: var(--text-1);
    font-size: clamp(18px, 2.2vw, 22px);
    letter-spacing: -0.02em;
  }

  .status-label,
  .status-pill {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
  }

  .distribution-bars,
  .member-impact-list {
    display: grid;
    gap: var(--space-3);
  }

  .distribution-row,
  .member-impact-row {
    display: grid;
    grid-template-columns: minmax(120px, 0.85fr) minmax(90px, 1.4fr) auto;
    gap: var(--space-3);
    align-items: center;
    min-height: 44px;
    color: var(--text-2);
  }

  .distribution-row strong,
  .member-impact-row strong {
    color: var(--text-1);
    font-size: 13px;
    text-align: right;
  }

  .bar-track {
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    overflow: hidden;
  }

  .bar-track > div {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .status-needs_attention .bar-track > div,
  .status-needs_attention {
    background: color-mix(in srgb, var(--danger) 18%, var(--surface-2));
  }

  .status-watch .bar-track > div,
  .status-watch {
    background: color-mix(in srgb, var(--warning) 24%, var(--surface-2));
  }

  .status-on_track .bar-track > div,
  .status-on_track {
    background: color-mix(in srgb, var(--success) 20%, var(--surface-2));
  }

  .distribution-row.status-needs_attention .bar-track > div {
    background: var(--danger);
  }

  .distribution-row.status-watch .bar-track > div {
    background: var(--warning);
  }

  .distribution-row.status-on_track .bar-track > div,
  .member-impact-row .bar-track > div {
    background: var(--success);
  }

  .analytics-detail-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(300px, 0.75fr);
    gap: var(--space-4);
    align-items: start;
  }

  .nutrient-table {
    display: grid;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .nutrient-row {
    display: grid;
    grid-template-columns: 1.1fr 0.6fr 0.85fr 0.8fr 1.2fr;
    gap: var(--space-3);
    align-items: center;
    width: 100%;
    min-height: 56px;
    padding: var(--space-3);
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text-1);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }

  .nutrient-row:last-child {
    border-bottom: 0;
  }

  .nutrient-row.header {
    min-height: 40px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 800;
    cursor: default;
  }

  .nutrient-row:not(.header):hover,
  .nutrient-row.selected {
    background: var(--accent-dim);
  }

  .nutrient-row:focus-visible,
  .suggestion-row:focus-visible,
  .secondary-action:focus-visible,
  .primary-btn:focus-visible,
  .filter-panel select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .drilldown-card {
    position: sticky;
    top: calc(var(--page-top) + var(--space-4));
  }

  .drilldown-summary {
    color: var(--text-2);
    line-height: 1.5;
  }

  .drilldown-progress {
    height: 12px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    overflow: hidden;
    margin: var(--space-4) 0 var(--space-2);
  }

  .drilldown-progress > div {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .drilldown-meta {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--text-2);
    font-size: 13px;
    margin-bottom: var(--space-4);
  }

  .drilldown-card h3 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--text-1);
    font-size: 15px;
  }

  .suggestion-list {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-4);
  }

  .suggestion-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    align-items: center;
    width: 100%;
    min-height: 56px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-1);
    padding: var(--space-3);
    text-align: left;
    cursor: pointer;
  }

  .suggestion-row small {
    display: block;
    color: var(--text-3);
    margin-top: var(--space-1);
    line-height: 1.4;
  }

  .suggestion-action {
    color: var(--accent);
    font-weight: 800;
  }

  .secondary-action {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-1);
    font-weight: 800;
    cursor: pointer;
  }

  .analytics-empty {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: 48px var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    text-align: center;
  }

  .analytics-empty.compact {
    padding: var(--space-8) var(--space-5);
  }

  .analytics-empty .material-symbols-rounded {
    font-size: 44px;
    color: var(--text-3);
  }

  .analytics-empty.error .material-symbols-rounded {
    color: var(--danger);
  }

  .analytics-empty p,
  .muted {
    margin: 0;
    color: var(--text-2);
    line-height: 1.5;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }

    .nutrient-row {
      transition: none;
    }
  }

  @media (max-width: 860px) {
    .analytics-panel-header,
    .card-heading {
      flex-direction: column;
    }

    .analytics-grid,
    .analytics-detail-layout {
      grid-template-columns: 1fr;
    }

    .drilldown-card {
      position: static;
    }
  }

  @media (max-width: 620px) {
    .nutrient-row {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }

    .nutrient-row.header {
      display: none;
    }

    .distribution-row,
    .member-impact-row {
      grid-template-columns: 1fr;
      gap: var(--space-2);
    }

    .distribution-row strong,
    .member-impact-row strong {
      text-align: left;
    }
  }
</style>
