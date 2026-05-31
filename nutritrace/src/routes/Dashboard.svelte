<script>
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { fade } from 'svelte/transition';
  import { NtApi } from '../lib/api.js';
  import { localDateStr } from '../lib/db.js';
  import { summarizeFamilyNutrition } from '../lib/familyNutrition.js';
  import { goals } from '../stores/settings.js';
  import { currentUser } from '../stores/auth.js';

  let familyMembers = [];
  let entry = null;
  let loading = true;
  let today = localDateStr();
  let nutritionSummary = summarizeFamilyNutrition();
  let recommendations = [];
  let highImpactCount = 0;
  let needsAttentionCount = 0;

  $: nutritionSummary = summarizeFamilyNutrition({
    members: familyMembers,
    currentUser: $currentUser,
    goals: $goals,
    items: entry?.items || [],
    maxRecommendations: 3,
  });
  $: recommendations = (nutritionSummary.recommendations || []).slice(0, 3);
  $: highImpactCount = (nutritionSummary.analyticsRows || [])
    .filter(row => row.status?.key !== 'on_track').length;
  $: needsAttentionCount = (nutritionSummary.analyticsRows || [])
    .filter(row => row.status?.key === 'needs_attention').length;

  onMount(async () => {
    await loadDashboardData();
  });

  async function loadDashboardData() {
    loading = true;
    try {
      const [members, diaryEntry] = await Promise.all([
        NtApi.get('/api/family'),
        NtApi.getDiaryDate(today).catch(() => null)
      ]);
      familyMembers = Array.isArray(members) ? members : [];
      entry = diaryEntry;
    } catch (err) {
      console.error('[Dashboard] load error:', err);
    } finally {
      loading = false;
    }
  }

  function openNutrientAnalytics() {
    push('/nutrients');
  }

  function recommendationLabel(recommendation) {
    return `View nutrient analytics for ${recommendation.label}: ${recommendation.foodMove}`;
  }
</script>

<div class="dashboard" in:fade={{ duration: 180 }}>
  <header class="dash-header">
    <div class="dash-title-row">
      <span class="material-symbols-rounded dash-icon">family_restroom</span>
      <h1 class="dash-title">Family Dashboard</h1>
    </div>
    <span class="dash-date">{today}</span>
  </header>

  {#if loading}
    <div class="dash-loading" role="status" aria-live="polite">
      <span class="material-symbols-rounded spin">progress_activity</span>
      <p>Loading...</p>
    </div>
  {:else}
    <section class="family-summary-card" aria-labelledby="family-summary-title">
      <div class="summary-hero">
        <div class="summary-copy">
          <p class="summary-eyebrow">Family nutrition today</p>
          <h2 id="family-summary-title" class="summary-headline">{nutritionSummary.headline}</h2>
          <p class="summary-context">
            {nutritionSummary.mealsLogged} {nutritionSummary.mealsLogged === 1 ? 'meal' : 'meals'} logged ·
            {highImpactCount} high-impact {highImpactCount === 1 ? 'improvement' : 'improvements'}
          </p>
        </div>
        <div class="summary-actions" aria-label="Nutrition actions">
          <button
            type="button"
            class="primary-action"
            on:click={() => push('/planner')}
            aria-label="Plan the next meal"
          >
            <span class="material-symbols-rounded">calendar_month</span>
            <span>Plan next meal</span>
          </button>
          <button
            type="button"
            class="secondary-action"
            on:click={openNutrientAnalytics}
            aria-label="View nutrient analytics"
          >
            View nutrient analytics
          </button>
        </div>
      </div>

      <div class="summary-metrics" aria-label="Family nutrition summary metrics">
        <article class="metric-card coverage-card">
          <div>
            <p class="metric-label">Overall coverage</p>
            <p class="metric-value">{nutritionSummary.overallCoverage}%</p>
          </div>
          <div
            class="coverage-track"
            role="progressbar"
            aria-label="Overall family nutrition coverage"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={nutritionSummary.overallCoverage}
          >
            <span class="coverage-fill" style="--coverage: {nutritionSummary.overallCoverage}%"></span>
          </div>
        </article>

        <article class="metric-card">
          <p class="metric-label">Needs attention</p>
          <p class="metric-value">{needsAttentionCount}</p>
          <p class="metric-note">{needsAttentionCount === 1 ? 'priority area' : 'priority areas'}</p>
        </article>

        <article class="metric-card next-action-card">
          <p class="metric-label">Best next action</p>
          <p class="metric-action">{nutritionSummary.bestNextAction}</p>
        </article>
      </div>

      {#if nutritionSummary.dataState === 'no_meals'}
        <div class="empty-guidance" role="note" aria-label="No meals logged guidance">
          <span class="material-symbols-rounded guidance-icon">restaurant</span>
          <div class="guidance-copy">
            <h3>Start with one logged meal</h3>
            <p>Log what the family ate today, then Nutritrace can turn coverage into useful next-meal ideas.</p>
          </div>
          <button
            type="button"
            class="guidance-action"
            on:click={() => push('/')}
            aria-label="Log the first meal"
          >
            Log meal
          </button>
        </div>
      {:else if nutritionSummary.dataState === 'no_family'}
        <div class="empty-guidance" role="note" aria-label="Family setup guidance">
          <span class="material-symbols-rounded guidance-icon">group_add</span>
          <div class="guidance-copy">
            <h3>Add family members for shared coverage</h3>
            <p>Set up family profiles to compare today’s nutrition needs without crowding the dashboard.</p>
          </div>
          <button
            type="button"
            class="guidance-action"
            on:click={() => push('/family')}
            aria-label="Add family members"
          >
            Add members
          </button>
        </div>
      {:else if nutritionSummary.dataState === 'missing_targets'}
        <div class="empty-guidance" role="note" aria-label="Nutrition targets guidance">
          <span class="material-symbols-rounded guidance-icon">track_changes</span>
          <div class="guidance-copy">
            <h3>Set targets to unlock guidance</h3>
            <p>Nutrition targets help rank the most useful planning actions for each family member.</p>
          </div>
          <button
            type="button"
            class="guidance-action"
            on:click={() => push('/family')}
            aria-label="Set family nutrition targets"
          >
            Set targets
          </button>
        </div>
      {:else if recommendations.length > 0}
        <div class="recommendations-panel" aria-labelledby="recommendations-title">
          <div class="panel-heading">
            <h3 id="recommendations-title">Recommended improvements</h3>
            <p>Open analytics for details, affected members, and food sources.</p>
          </div>
          <div class="recommendation-list">
            {#each recommendations as recommendation (recommendation.id)}
              <button
                type="button"
                class="recommendation-row"
                on:click={openNutrientAnalytics}
                aria-label={recommendationLabel(recommendation)}
              >
                <span class="recommendation-icon material-symbols-rounded">trending_up</span>
                <span class="recommendation-body">
                  <span class="recommendation-title">{recommendation.label}</span>
                  <span class="recommendation-detail">{recommendation.foodMove}</span>
                </span>
                <span class="recommendation-meta">{recommendation.affectedLabel}</span>
                <span class="material-symbols-rounded recommendation-arrow" aria-hidden="true">chevron_right</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="steady-state" role="note" aria-label="Family nutrition on track">
          <span class="material-symbols-rounded steady-icon">check_circle</span>
          <div>
            <h3>No high-impact gaps right now</h3>
            <p>Keep logging meals or open analytics to review detailed coverage.</p>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .dashboard {
    padding: calc(var(--page-top, var(--safe-top)) + 16px) 16px calc(var(--nav-h, 64px) + var(--safe-bottom) + 24px);
    max-width: 900px;
    margin: 0 auto;
  }

  .dash-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    padding: 0 4px;
  }
  .dash-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .dash-icon {
    font-size: 28px;
    color: var(--accent);
  }
  .dash-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-1);
    margin: 0;
  }
  .dash-date {
    font-size: 13px;
    color: var(--text-3);
    font-weight: 500;
    white-space: nowrap;
  }

  .dash-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 80px 0;
    color: var(--text-3);
  }
  .spin {
    font-size: 32px;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .family-summary-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 16px);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.10);
  }

  .summary-hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }
  .summary-copy {
    min-width: 0;
  }
  .summary-eyebrow {
    margin: 0 0 8px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .summary-headline {
    margin: 0;
    color: var(--text-1);
    font-size: clamp(22px, 5vw, 34px);
    line-height: 1.08;
    letter-spacing: -0.03em;
  }
  .summary-context {
    margin: 10px 0 0;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.45;
  }
  .summary-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: stretch;
    min-width: 180px;
  }
  .primary-action,
  .secondary-action,
  .guidance-action,
  .recommendation-row {
    font: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  .primary-action,
  .secondary-action,
  .guidance-action {
    min-height: 44px;
    border-radius: var(--radius-md, 12px);
    border: 1px solid transparent;
    padding: 10px 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color var(--dur-fast, 0.15s), border-color var(--dur-fast, 0.15s), opacity var(--dur-fast, 0.15s), transform var(--dur-fast, 0.15s);
  }
  .primary-action {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--accent-text, #0A0B0F);
  }
  .primary-action .material-symbols-rounded {
    font-size: 20px;
  }
  .secondary-action,
  .guidance-action {
    background: var(--surface-2);
    border-color: var(--border);
    color: var(--text-1);
  }
  .primary-action:hover,
  .secondary-action:hover,
  .guidance-action:hover {
    opacity: 0.9;
  }
  .primary-action:active,
  .secondary-action:active,
  .guidance-action:active,
  .recommendation-row:active {
    transform: translateY(1px);
  }
  .primary-action:focus-visible,
  .secondary-action:focus-visible,
  .guidance-action:focus-visible,
  .recommendation-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .summary-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .metric-card {
    min-height: 112px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 12px);
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 10px;
  }
  .metric-label,
  .metric-note {
    margin: 0;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
  }
  .metric-value {
    margin: 4px 0 0;
    color: var(--text-1);
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.04em;
  }
  .metric-action {
    margin: 0;
    color: var(--text-1);
    font-size: 17px;
    font-weight: 750;
    line-height: 1.25;
  }
  .coverage-track {
    height: 8px;
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-3, var(--surface-2)));
    border-radius: var(--radius-full, 999px);
    overflow: hidden;
  }
  .coverage-fill {
    display: block;
    width: var(--coverage);
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
  }

  .empty-guidance,
  .steady-state {
    display: flex;
    align-items: center;
    gap: 14px;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 12px);
    padding: 16px;
  }
  .guidance-icon,
  .steady-icon {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md, 12px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    background: var(--accent-dim);
    color: var(--accent);
    font-size: 24px;
  }
  .guidance-copy,
  .steady-state > div {
    flex: 1;
    min-width: 0;
  }
  .guidance-copy h3,
  .steady-state h3 {
    margin: 0 0 4px;
    color: var(--text-1);
    font-size: 15px;
    font-weight: 750;
  }
  .guidance-copy p,
  .steady-state p {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.45;
  }

  .recommendations-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel-heading h3 {
    margin: 0 0 4px;
    color: var(--text-1);
    font-size: 16px;
    font-weight: 750;
  }
  .panel-heading p {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.45;
  }
  .recommendation-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .recommendation-row {
    min-height: 56px;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 12px);
    background: var(--surface-2);
    color: var(--text-1);
    padding: 12px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--dur-fast, 0.15s), border-color var(--dur-fast, 0.15s), transform var(--dur-fast, 0.15s);
  }
  .recommendation-row:hover {
    background: var(--surface-3, var(--surface-2));
    border-color: var(--border-strong, var(--border));
  }
  .recommendation-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md, 12px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-dim);
    color: var(--accent);
    font-size: 20px;
  }
  .recommendation-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .recommendation-title {
    color: var(--text-1);
    font-size: 14px;
    font-weight: 750;
  }
  .recommendation-detail,
  .recommendation-meta {
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.35;
  }
  .recommendation-meta {
    white-space: nowrap;
    font-weight: 650;
  }
  .recommendation-arrow {
    color: var(--text-3);
    font-size: 20px;
  }

  @media (max-width: 720px) {
    .summary-hero {
      flex-direction: column;
    }
    .summary-actions {
      width: 100%;
      min-width: 0;
    }
    .summary-metrics {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 520px) {
    .dashboard {
      padding-left: 12px;
      padding-right: 12px;
    }
    .dash-header {
      align-items: flex-start;
      flex-direction: column;
      gap: 6px;
    }
    .family-summary-card {
      padding: 16px;
    }
    .empty-guidance,
    .steady-state {
      align-items: flex-start;
      flex-direction: column;
    }
    .guidance-action {
      width: 100%;
    }
    .recommendation-row {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    .recommendation-meta {
      grid-column: 2 / 3;
    }
    .recommendation-arrow {
      grid-column: 3 / 4;
      grid-row: 1 / span 2;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
    .primary-action,
    .secondary-action,
    .guidance-action,
    .recommendation-row {
      transition: none;
    }
  }
</style>
