# Nutrient Analytics UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace noisy nutrient status chip walls with a calm main nutrition summary and a dedicated `/nutrients` analytics dashboard with filters, charts, details, and planning handoff.

**Architecture:** Extract family nutrient coverage into one tested helper so Dashboard, Diary, Planner, and Analytics cannot disagree. Evolve the existing `/nutrients` route into the canonical Nutrition Analytics surface, then update existing dashboard/planner cards to show summaries, top actions, and links into analytics instead of dozens of chips.

**Tech Stack:** Svelte 5, Svelte SPA Router, Vite, plain ES modules, Node built-in test runner, existing Nutritrace design tokens.

---

## File Structure

- Create `src/lib/familyNutrition.js` — canonical coverage calculations, thresholds, grouping, recommendation summaries, and planning labels.
- Create `src/lib/familyNutrition.test.js` — Node unit tests for coverage status, missing-data handling, ranking, and analytics rows.
- Modify `src/routes/NutrientExplorer.svelte` — rename from Explore Nutrients to Nutrition Analytics and replace simple nutrient-food explorer with filters, charts, table, and drill-down.
- Modify `src/routes/Dashboard.svelte` — replace member deficit tags with summary cards and top recommendations.
- Modify `src/routes/Diary.svelte` — replace `Family Nutrition Dashboard` chip cloud with the same summary/action model.
- Modify `src/routes/MealPlanner.svelte` — keep useful coverage rows but remove `Nutrient Gaps` chip wall; show top planning actions and analytics link.
Do not modify `src/routes/Family.svelte` except to preserve target editing behavior. Detailed target editing belongs there; analytics belongs at `/nutrients`.

## Validation Commands

- Unit tests: `node --test src/lib/familyNutrition.test.js`
- Build: `npm run build`
- Runtime review: `npm run dev -- --host 127.0.0.1`, then use Playwright CLI to capture `/dashboard`, `/`, `/planner`, and `/nutrients`.

---

### Task 1: Shared family nutrition coverage engine

**Files:**
- Create: `src/lib/familyNutrition.js`
- Create: `src/lib/familyNutrition.test.js`
- Read: `src/lib/nutrition.js`
- Read: `src/lib/nutrientRecommendations.js`

- [ ] **Step 1: Write failing tests for the canonical calculation**

Create `src/lib/familyNutrition.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYTICS_NUTRIENT_IDS,
  getCoverageStatus,
  getGoalTarget,
  summarizeFamilyNutrition,
  buildAnalyticsRows,
  buildCoverageDistribution,
} from './familyNutrition.js';

const goals = {
  calories: { min: 2000, max: 2000 },
  proteins: { min: 20, max: 20, isPercent: true },
  carbohydrates: { min: 50, max: 50, isPercent: true },
  fat: { min: 30, max: 30, isPercent: true },
  iron: { min: 18, max: 18 },
  calcium: { min: 1000, max: 1000 },
  fiber: { min: 30, max: 30 },
};

const members = [
  {
    id: 'child-1',
    name: 'Aarav',
    targets: { calories: 1200, iron: 10, calcium: 700, fiber: 18, proteins: 40 },
  },
  {
    id: 'adult-1',
    name: 'Mira',
    targets: { calories: 1800, iron: 18, calcium: 1000, fiber: 28, proteins: 65 },
  },
];

const items = [
  {
    name: 'Breakfast dal',
    meal: 'Breakfast',
    member_id: 'child-1',
    quantity: 1,
    nutrition: { calories: 350, iron: 5, calcium: 120, fiber: 9, proteins: 18 },
  },
  {
    name: 'Lunch thali',
    meal: 'Lunch',
    member_id: 'adult-1',
    quantity: 1,
    nutrition: { calories: 700, iron: 8, calcium: 250, fiber: 12, proteins: 30 },
  },
];

test('getCoverageStatus uses one threshold model', () => {
  assert.deepEqual(getCoverageStatus(40), { key: 'needs_attention', label: 'Needs attention' });
  assert.deepEqual(getCoverageStatus(60), { key: 'watch', label: 'Watch' });
  assert.deepEqual(getCoverageStatus(79), { key: 'watch', label: 'Watch' });
  assert.deepEqual(getCoverageStatus(80), { key: 'on_track', label: 'On track' });
});

test('getGoalTarget converts percent macro goals into grams', () => {
  assert.equal(getGoalTarget('proteins', { id: 'me', isMe: true }, goals), 100);
  assert.equal(getGoalTarget('fat', { id: 'me', isMe: true }, goals), 67);
  assert.equal(getGoalTarget('iron', { id: 'me', isMe: true }, goals), 18);
  assert.equal(getGoalTarget('calcium', members[0], goals), 700);
});

test('summarizeFamilyNutrition returns calm main-screen summary and top recommendations', () => {
  const summary = summarizeFamilyNutrition({
    members,
    currentUser: { full_name: 'Chintan' },
    goals,
    items,
    maxRecommendations: 3,
  });

  assert.equal(summary.members.length, 3);
  assert.equal(summary.mealsLogged, 2);
  assert.equal(summary.recommendations.length, 3);
  assert.equal(summary.recommendations[0].status.key, 'needs_attention');
  assert.ok(summary.headline.length > 0);
  assert.ok(summary.bestNextAction.length > 0);
});

test('summarizeFamilyNutrition distinguishes no meals from alarming deficits', () => {
  const summary = summarizeFamilyNutrition({
    members,
    currentUser: { full_name: 'Chintan' },
    goals,
    items: [],
  });

  assert.equal(summary.dataState, 'no_meals');
  assert.equal(summary.recommendations.length, 0);
  assert.equal(summary.headline, 'Log a meal to analyze nutrition');
});

test('buildAnalyticsRows includes exact percentages, trend labels, affected members, and food moves', () => {
  const summary = summarizeFamilyNutrition({
    members,
    currentUser: { full_name: 'Chintan' },
    goals,
    items,
  });
  const rows = buildAnalyticsRows(summary);

  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => ANALYTICS_NUTRIENT_IDS.includes(row.id)));
  assert.ok(rows.every(row => Number.isInteger(row.coveragePct)));
  assert.ok(rows.every(row => typeof row.foodMove === 'string'));
});

test('buildCoverageDistribution counts low, watch, and on-track nutrient states', () => {
  const summary = summarizeFamilyNutrition({
    members,
    currentUser: { full_name: 'Chintan' },
    goals,
    items,
  });
  const distribution = buildCoverageDistribution(summary.analyticsRows);

  assert.equal(
    distribution.needs_attention + distribution.watch + distribution.on_track,
    summary.analyticsRows.length,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test src/lib/familyNutrition.test.js
```

Expected: failure with an import error for `./familyNutrition.js`.

- [ ] **Step 3: Implement the shared calculation module**

Create `src/lib/familyNutrition.js`:

```js
import { NUTRIMENTS, Nutrition } from './nutrition.js';

export const ANALYTICS_NUTRIENT_IDS = [
  'calories',
  'proteins',
  'carbohydrates',
  'fat',
  'fiber',
  'iron',
  'calcium',
  'zinc',
  'vitamin-a',
  'vitamin-c',
  'vitamin-d',
  'b12',
  'b9',
];

export const STATUS_THRESHOLDS = {
  needs_attention: 60,
  watch: 80,
};

const MACRO_DENSITY = {
  fat: 9,
  'saturated-fat': 9,
  carbohydrates: 4,
  sugars: 4,
  proteins: 4,
};

const FOOD_MOVES = {
  iron: 'Add lentils or beans',
  calcium: 'Add curd or fortified milk',
  fiber: 'Add fruit or whole grains',
  proteins: 'Add dal, paneer, eggs, or tofu',
  carbohydrates: 'Add rice, roti, or potatoes',
  fat: 'Add nuts, seeds, or oil',
  'vitamin-a': 'Add carrots or leafy greens',
  'vitamin-c': 'Add citrus or amla',
  'vitamin-d': 'Add fortified dairy or eggs',
  b12: 'Add dairy, eggs, or fortified foods',
  b9: 'Add leafy greens or legumes',
  zinc: 'Add seeds, legumes, or dairy',
  calories: 'Increase meal portions',
};

function nutrientInfo(id) {
  return NUTRIMENTS.find(n => n.id === id) || { id, label: id, unit: '' };
}

function safeNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMemberName(member, currentUser) {
  if (member.isMe) return currentUser?.full_name || currentUser?.name || 'Myself';
  return member.name || 'Family member';
}

function allMembers(members = [], currentUser = null) {
  return [
    { id: 'me', isMe: true, name: formatMemberName({ isMe: true }, currentUser), targets: null },
    ...members,
  ];
}

export function getGoalTarget(nutrientId, member, goals = {}) {
  if (!member?.isMe) return safeNumber(member?.targets?.[nutrientId]);

  const goal = goals?.[nutrientId];
  if (!goal) return 0;

  const raw = goal.sharedGoal === false
    ? safeNumber(goal.days?.[new Date().getDay()] ?? goal.max ?? goal.min)
    : safeNumber(goal.max ?? goal.min);

  if (!raw) return 0;
  if (!goal.isPercent) return raw;

  const density = MACRO_DENSITY[nutrientId];
  if (!density) return raw;

  const calorieGoal = safeNumber(goals.calories?.max ?? goals.calories?.min) || 2000;
  return Math.round((calorieGoal * raw) / 100 / density);
}

export function getCoverageStatus(coveragePct) {
  if (coveragePct < STATUS_THRESHOLDS.needs_attention) {
    return { key: 'needs_attention', label: 'Needs attention' };
  }
  if (coveragePct < STATUS_THRESHOLDS.watch) {
    return { key: 'watch', label: 'Watch' };
  }
  return { key: 'on_track', label: 'On track' };
}

export function getMealName(item) {
  return item?.meal || item?.meal_type || 'Meal';
}

export function calculateMemberTotals({ members = [], currentUser = null, items = [] }) {
  const people = allMembers(members, currentUser);
  const totals = Object.fromEntries(
    people.map(member => [
      member.id,
      Object.fromEntries(ANALYTICS_NUTRIENT_IDS.map(id => [id, 0])),
    ]),
  );

  for (const item of items || []) {
    const memberId = item.member_id || 'me';
    if (!totals[memberId]) continue;
    const calculated = Nutrition.calculate(item);
    for (const id of ANALYTICS_NUTRIENT_IDS) {
      totals[memberId][id] += safeNumber(calculated[id]);
    }
  }

  return { people, totals };
}

export function summarizeFamilyNutrition({
  members = [],
  currentUser = null,
  goals = {},
  items = [],
  maxRecommendations = 3,
} = {}) {
  const { people, totals } = calculateMemberTotals({ members, currentUser, items });
  const mealsLogged = new Set((items || []).map(getMealName).filter(Boolean)).size;
  const analyticsRows = [];
  const memberSummaries = [];

  for (const member of people) {
    const memberRows = [];
    for (const id of ANALYTICS_NUTRIENT_IDS) {
      const target = getGoalTarget(id, member, goals);
      if (target <= 0) continue;
      const current = totals[member.id]?.[id] || 0;
      const coveragePct = Math.min(100, Math.round((current / target) * 100));
      const info = nutrientInfo(id);
      const status = getCoverageStatus(coveragePct);
      memberRows.push({ id, label: info.label, unit: info.unit, current, target, coveragePct, status });
    }
    memberSummaries.push({
      id: member.id,
      name: formatMemberName(member, currentUser),
      rows: memberRows,
      needsAttentionCount: memberRows.filter(row => row.status.key === 'needs_attention').length,
    });
  }

  for (const id of ANALYTICS_NUTRIENT_IDS) {
    const info = nutrientInfo(id);
    const affected = [];
    let currentTotal = 0;
    let targetTotal = 0;

    for (const member of memberSummaries) {
      const row = member.rows.find(r => r.id === id);
      if (!row) continue;
      currentTotal += row.current;
      targetTotal += row.target;
      if (row.status.key !== 'on_track') affected.push({ name: member.name, coveragePct: row.coveragePct });
    }

    if (targetTotal <= 0) continue;
    const coveragePct = Math.min(100, Math.round((currentTotal / targetTotal) * 100));
    const status = getCoverageStatus(coveragePct);
    analyticsRows.push({
      id,
      label: info.label,
      unit: info.unit,
      current: currentTotal,
      target: targetTotal,
      coveragePct,
      status,
      affected,
      affectedLabel: affected.length ? `${affected.length} member${affected.length === 1 ? '' : 's'}` : 'None',
      trend: 'Today',
      foodMove: FOOD_MOVES[id] || 'Open analytics for food ideas',
    });
  }

  analyticsRows.sort((a, b) => {
    if (a.status.key !== b.status.key) {
      const rank = { needs_attention: 0, watch: 1, on_track: 2 };
      return rank[a.status.key] - rank[b.status.key];
    }
    return a.coveragePct - b.coveragePct;
  });

  const recommendations = mealsLogged === 0
    ? []
    : analyticsRows.filter(row => row.status.key !== 'on_track').slice(0, maxRecommendations);

  const overallCoverage = analyticsRows.length
    ? Math.round(analyticsRows.reduce((sum, row) => sum + row.coveragePct, 0) / analyticsRows.length)
    : 0;

  const dataState = people.length <= 1 && members.length === 0
    ? 'no_family'
    : mealsLogged === 0
      ? 'no_meals'
      : analyticsRows.length === 0
        ? 'missing_targets'
        : 'ready';

  const headline = dataState === 'no_meals'
    ? 'Log a meal to analyze nutrition'
    : dataState === 'missing_targets'
      ? 'Set nutrition targets to analyze coverage'
      : recommendations.length > 0
        ? `${recommendations.length} high-impact improvement${recommendations.length === 1 ? '' : 's'} available`
        : 'Family nutrition is on track';

  return {
    dataState,
    headline,
    mealsLogged,
    overallCoverage,
    bestNextAction: recommendations[0]?.foodMove || (mealsLogged === 0 ? 'Log first meal' : 'Review analytics'),
    members: memberSummaries,
    analyticsRows,
    recommendations,
  };
}

export function buildAnalyticsRows(summary) {
  return [...(summary?.analyticsRows || [])];
}

export function buildCoverageDistribution(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc[row.status.key] += 1;
      return acc;
    },
    { needs_attention: 0, watch: 0, on_track: 0 },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node --test src/lib/familyNutrition.test.js
```

Expected: all six tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/familyNutrition.js src/lib/familyNutrition.test.js
git commit -m "Add shared family nutrition coverage engine" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds with only the two new files.

---

### Task 2: Nutrition Analytics route

**Files:**
- Modify: `src/routes/NutrientExplorer.svelte`
- Use: `src/lib/familyNutrition.js`
- Use: `src/lib/nutrientRecommendations.js`

- [ ] **Step 1: Add a route-level smoke test script to the plan runner**

Run this one-off check before editing so the worker knows the current route builds:

```bash
npm run build
```

Expected: build succeeds before the route rewrite.

- [ ] **Step 2: Replace the NutrientExplorer script with analytics state**

In `src/routes/NutrientExplorer.svelte`, replace the `<script>` block with:

```svelte
<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';
  import { NUTRIMENTS, Nutrition } from '../lib/nutrition.js';
  import { vegetarianMode, goals } from '../stores/settings.js';
  import { currentUser } from '../stores/auth.js';
  import { suggestFoodsForNutrient } from '../lib/nutrientRecommendations.js';
  import {
    ANALYTICS_NUTRIENT_IDS,
    buildCoverageDistribution,
    summarizeFamilyNutrition,
  } from '../lib/familyNutrition.js';
  import { isAllowedInVegMode } from '../lib/dietType.js';

  const MEAL_FILTERS = ['All meals', 'Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const SEVERITY_FILTERS = [
    { key: 'all', label: 'All status' },
    { key: 'needs_attention', label: 'Needs attention' },
    { key: 'watch', label: 'Watch' },
    { key: 'on_track', label: 'On track' },
  ];
  const GROUP_FILTERS = [
    { key: 'all', label: 'All nutrients' },
    { key: 'macro', label: 'Macros' },
    { key: 'mineral', label: 'Minerals' },
    { key: 'vitamin', label: 'Vitamins' },
  ];

  let foods = [];
  let members = [];
  let diaryEntry = null;
  let loading = true;
  let error = '';

  let selectedMeal = 'All meals';
  let selectedSeverity = 'all';
  let selectedGroup = 'all';
  let selectedMemberId = 'all';
  let selectedNutrientId = 'iron';

  $: allItems = diaryEntry?.items || [];
  $: filteredItems = allItems.filter(item => {
    const mealMatch = selectedMeal === 'All meals' || (item.meal || item.meal_type) === selectedMeal;
    const memberMatch = selectedMemberId === 'all' || (item.member_id || 'me') === selectedMemberId;
    return mealMatch && memberMatch;
  });

  $: summary = summarizeFamilyNutrition({
    members,
    currentUser: $currentUser,
    goals: $goals,
    items: filteredItems,
    maxRecommendations: 3,
  });

  $: distribution = buildCoverageDistribution(summary.analyticsRows);
  $: memberOptions = [
    { id: 'all', name: 'All members' },
    { id: 'me', name: $currentUser?.full_name || 'Myself' },
    ...members.map(member => ({ id: member.id, name: member.name })),
  ];

  $: analyticsRows = summary.analyticsRows.filter(row => {
    const nutrient = NUTRIMENTS.find(n => n.id === row.id);
    const severityMatch = selectedSeverity === 'all' || row.status.key === selectedSeverity;
    const groupMatch = selectedGroup === 'all' || nutrient?.category === selectedGroup;
    return severityMatch && groupMatch;
  });

  $: selectedRow = analyticsRows.find(row => row.id === selectedNutrientId)
    || analyticsRows[0]
    || summary.analyticsRows[0]
    || null;

  $: selectedSuggestions = selectedRow
    ? suggestFoodsForNutrient(selectedRow.id, Math.max(selectedRow.target - selectedRow.current, 0), foods, $vegetarianMode, 4)
    : [];

  function formatAmount(value, unit) {
    return `${Nutrition.format(value)}${unit || ''}`;
  }

  function barWidth(value, max) {
    if (!max) return 0;
    return Math.max(4, Math.round((value / max) * 100));
  }

  function goToPlannerWithNutrient(row = selectedRow) {
    if (row) {
      sessionStorage.setItem('nt:analyticsPlanningFocus', JSON.stringify({
        nutrientId: row.id,
        label: row.label,
        foodMove: row.foodMove,
      }));
    }
    push('/planner');
  }

  async function addFoodSuggestion(suggestion) {
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
      error = 'Could not prepare this food suggestion. Try opening the planner instead.';
      console.error('[NutritionAnalytics] suggestion handoff failed:', err);
    }
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const [foodsRes, membersRes, diaryRes] = await Promise.all([
        NtApi.getFoods(),
        NtApi.get('/api/family').catch(() => []),
        NtApi.getDiaryDate(new Date().toISOString().slice(0, 10)).catch(() => null),
      ]);
      foods = Array.isArray(foodsRes) ? foodsRes.filter(food => !$vegetarianMode || isAllowedInVegMode(food)) : [];
      members = Array.isArray(membersRes) ? membersRes : [];
      diaryEntry = diaryRes;
    } catch (err) {
      error = 'Nutrition analytics could not load. Retry after checking your connection.';
      console.error('[NutritionAnalytics] load error:', err);
    } finally {
      loading = false;
    }
  });
</script>
```

- [ ] **Step 3: Replace the route markup with the analytics dashboard**

In `src/routes/NutrientExplorer.svelte`, replace the markup between `</script>` and `<style>` with:

```svelte
<div class="page-shell analytics-shell">
  <header class="page-header analytics-header">
    <div class="ph-left">
      <button class="icon-btn" aria-label="Back to diary" on:click={() => push('/')}>
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <div>
        <p class="eyebrow">Family nutrition analytics</p>
        <h1 class="page-title">Plan from nutrient coverage</h1>
        <p class="page-subtitle">Use filters, charts, and nutrient details to decide what to plan next.</p>
      </div>
    </div>
    <div class="ph-right">
      <button class="primary-btn" on:click={() => goToPlannerWithNutrient()} disabled={!selectedRow}>
        <span class="material-symbols-rounded">restaurant_menu</span>
        Create meal plan
      </button>
    </div>
  </header>

  <div class="page-content analytics-content">
    {#if loading}
      <section class="analytics-empty" aria-live="polite">
        <span class="material-symbols-rounded spin">progress_activity</span>
        <h2>Loading nutrition analytics</h2>
        <p>Building family coverage, member impact, and food suggestions.</p>
      </section>
    {:else if error}
      <section class="analytics-empty error" aria-live="assertive">
        <span class="material-symbols-rounded">error</span>
        <h2>Analytics unavailable</h2>
        <p>{error}</p>
        <button class="primary-btn" on:click={() => location.reload()}>Retry</button>
      </section>
    {:else if summary.dataState === 'no_meals'}
      <section class="analytics-empty">
        <span class="material-symbols-rounded">restaurant</span>
        <h2>Log meals to analyze coverage</h2>
        <p>Nutrition analytics needs meal data before it can classify nutrient coverage.</p>
        <button class="primary-btn" on:click={() => push('/')}>Log first meal</button>
      </section>
    {:else}
      <section class="filter-panel" aria-label="Analytics filters">
        <label>
          <span>Date range</span>
          <select aria-label="Date range">
            <option>Today</option>
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
            {#each MEAL_FILTERS as meal}
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

      <section class="analytics-grid">
        <article class="analytics-card distribution-card">
          <div class="card-heading">
            <div>
              <p class="eyebrow">Coverage distribution</p>
              <h2>{summary.overallCoverage}% average coverage</h2>
            </div>
            <span class="status-label">{summary.headline}</span>
          </div>
          <div class="distribution-bars" aria-label="Coverage distribution by status">
            {#each [
              { key: 'needs_attention', label: 'Needs attention', count: distribution.needs_attention },
              { key: 'watch', label: 'Watch', count: distribution.watch },
              { key: 'on_track', label: 'On track', count: distribution.on_track },
            ] as segment}
              <div class="distribution-row">
                <span>{segment.label}</span>
                <div class="bar-track">
                  <div class:needs={segment.key === 'needs_attention'} class:watch={segment.key === 'watch'} class:track={segment.key === 'on_track'} style="width:{barWidth(segment.count, summary.analyticsRows.length)}%"></div>
                </div>
                <strong>{segment.count}</strong>
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
          </div>
          <div class="member-impact-list">
            {#each summary.members as member}
              <div class="member-impact-row">
                <span>{member.name}</span>
                <div class="bar-track">
                  <div class="needs" style="width:{barWidth(member.needsAttentionCount, ANALYTICS_NUTRIENT_IDS.length)}%"></div>
                </div>
                <strong>{member.needsAttentionCount} low</strong>
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
          <div class="nutrient-table" role="table" aria-label="Nutrient coverage details">
            <div class="nutrient-row header" role="row">
              <span role="columnheader">Nutrient</span>
              <span role="columnheader">Coverage</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Affected</span>
              <span role="columnheader">Food move</span>
            </div>
            {#each analyticsRows as row}
              <button
                class="nutrient-row"
                class:selected={selectedRow?.id === row.id}
                role="row"
                aria-label={`Inspect ${row.label}, ${row.coveragePct}% coverage, ${row.status.label}`}
                on:click={() => selectedNutrientId = row.id}
              >
                <span role="cell"><strong>{row.label}</strong></span>
                <span role="cell">{row.coveragePct}%</span>
                <span role="cell">{row.status.label}</span>
                <span role="cell">{row.affectedLabel}</span>
                <span role="cell">{row.foodMove}</span>
              </button>
            {/each}
          </div>
        </article>

        <aside class="analytics-card drilldown-card" aria-label="Selected nutrient details">
          {#if selectedRow}
            <p class="eyebrow">Nutrient detail</p>
            <h2>{selectedRow.label}</h2>
            <p class="drilldown-summary">
              {formatAmount(selectedRow.current, selectedRow.unit)} of {formatAmount(selectedRow.target, selectedRow.unit)}
              logged today. {selectedRow.status.label}.
            </p>
            <div class="drilldown-progress" aria-label={`${selectedRow.coveragePct}% coverage`}>
              <div style="width:{selectedRow.coveragePct}%"></div>
            </div>
            <h3>Planning moves</h3>
            <div class="suggestion-list">
              {#each selectedSuggestions as suggestion}
                <button class="suggestion-row" on:click={() => addFoodSuggestion(suggestion)}>
                  <span>
                    <strong>{suggestion.name}</strong>
                    <small>{suggestion.amountPer100g}{selectedRow.unit} per 100g</small>
                  </span>
                  <span>Add</span>
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
  </div>
</div>
```

- [ ] **Step 4: Replace route styles with dashboard styles**

In `src/routes/NutrientExplorer.svelte`, replace the `<style>` block with:

```svelte
<style>
  .analytics-shell { max-width: 1200px; margin: 0 auto; }
  .analytics-header { align-items: flex-start; gap: 16px; }
  .eyebrow {
    margin: 0 0 4px;
    color: var(--text-3);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .page-subtitle { margin: 6px 0 0; color: var(--text-2); }
  .analytics-content { display: grid; gap: 16px; }
  .filter-panel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .filter-panel label { display: grid; gap: 6px; color: var(--text-2); font-size: 12px; font-weight: 700; }
  .filter-panel select {
    min-height: 44px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-1);
    padding: 0 12px;
  }
  .analytics-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; }
  .analytics-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    padding: 16px;
    box-shadow: var(--shadow-sm);
  }
  .card-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
  .card-heading h2 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
  .status-label {
    border-radius: 999px;
    padding: 6px 10px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 700;
  }
  .distribution-bars,
  .member-impact-list { display: grid; gap: 12px; }
  .distribution-row,
  .member-impact-row {
    display: grid;
    grid-template-columns: minmax(110px, 0.8fr) 1.5fr auto;
    gap: 12px;
    align-items: center;
    min-height: 44px;
  }
  .bar-track { height: 10px; border-radius: 999px; background: var(--surface-3, var(--surface-2)); overflow: hidden; }
  .bar-track > div { height: 100%; border-radius: inherit; background: var(--accent); }
  .bar-track .needs,
  .needs { background: var(--danger, #ef4444); }
  .bar-track .watch,
  .watch { background: var(--warning, #f59e0b); }
  .bar-track .track,
  .track { background: var(--success, var(--accent)); }
  .analytics-detail-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.7fr); gap: 16px; align-items: start; }
  .nutrient-table { display: grid; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
  .nutrient-row {
    display: grid;
    grid-template-columns: 1.1fr 0.6fr 0.8fr 0.8fr 1fr;
    gap: 10px;
    align-items: center;
    min-height: 48px;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text-1);
    text-align: left;
    cursor: pointer;
  }
  .nutrient-row.header {
    min-height: 40px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 700;
    cursor: default;
  }
  .nutrient-row.selected,
  .nutrient-row:hover { background: var(--accent-dim); }
  .drilldown-summary { color: var(--text-2); line-height: 1.5; }
  .drilldown-progress { height: 10px; border-radius: 999px; background: var(--surface-2); overflow: hidden; margin: 14px 0; }
  .drilldown-progress > div { height: 100%; border-radius: inherit; background: var(--accent); }
  .suggestion-list { display: grid; gap: 8px; margin: 12px 0; }
  .suggestion-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    min-height: 52px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-1);
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
  }
  .suggestion-row small { display: block; color: var(--text-3); margin-top: 2px; }
  .secondary-action {
    width: 100%;
    min-height: 44px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-1);
    font-weight: 700;
    cursor: pointer;
  }
  .analytics-empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 48px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    text-align: center;
  }
  .analytics-empty .material-symbols-rounded { font-size: 44px; color: var(--text-3); }
  .analytics-empty.error .material-symbols-rounded { color: var(--danger, #ef4444); }
  .muted { color: var(--text-3); }
  @media (max-width: 860px) {
    .analytics-grid,
    .analytics-detail-layout { grid-template-columns: 1fr; }
    .nutrient-row { grid-template-columns: 1fr; gap: 4px; }
    .nutrient-row.header { display: none; }
  }
</style>
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: Vite build succeeds. If Svelte reports an unused import or invalid role, remove the unused import or adjust the role before continuing.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/routes/NutrientExplorer.svelte
git commit -m "Redesign nutrients route as analytics dashboard" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds with only `src/routes/NutrientExplorer.svelte`.

---

### Task 3: Calm family summary on Dashboard

**Files:**
- Modify: `src/routes/Dashboard.svelte`
- Use: `src/lib/familyNutrition.js`

- [ ] **Step 1: Replace route-local card calculations with shared summary**

In `src/routes/Dashboard.svelte`, add this import:

```js
import { summarizeFamilyNutrition } from '../lib/familyNutrition.js';
```

Keep `Nutrition` only if other code in the file still uses it. Replace `memberCards`, `topDeficit`, `computeMemberCards`, `computeSummary`, `getTarget`, and `getProgressColor` with this reactive summary:

```js
let nutritionSummary = null;

$: nutritionSummary = summarizeFamilyNutrition({
  members: familyMembers,
  currentUser: $currentUser,
  goals: $goals,
  items: entry?.items || [],
  maxRecommendations: 3,
});
```

- [ ] **Step 2: Replace member deficit tag markup with summary/action markup**

In `src/routes/Dashboard.svelte`, replace the `<!-- Member Cards Grid -->` section with:

```svelte
<section class="family-summary-card">
  <div class="summary-hero">
    <div>
      <p class="eyebrow">Family nutrition today</p>
      <h2>{nutritionSummary.headline}</h2>
      <p class="summary-context">
        {nutritionSummary.mealsLogged} meal{nutritionSummary.mealsLogged === 1 ? '' : 's'} logged ·
        {nutritionSummary.recommendations.length} high-impact improvement{nutritionSummary.recommendations.length === 1 ? '' : 's'}
      </p>
    </div>
    <button class="primary-btn" on:click={() => push('/planner')}>
      <span class="material-symbols-rounded">restaurant_menu</span>
      Plan next meal
    </button>
  </div>

  <div class="summary-metrics">
    <div class="metric-card">
      <span>Overall coverage</span>
      <strong>{nutritionSummary.overallCoverage}%</strong>
      <div class="metric-bar" aria-label={`${nutritionSummary.overallCoverage}% family nutrition coverage`}>
        <div style="width:{nutritionSummary.overallCoverage}%"></div>
      </div>
    </div>
    <div class="metric-card">
      <span>Needs attention</span>
      <strong>{nutritionSummary.recommendations.length} areas</strong>
      <small>{nutritionSummary.recommendations.map(r => r.label).join(' · ') || 'No urgent gaps'}</small>
    </div>
    <div class="metric-card">
      <span>Best next action</span>
      <strong>{nutritionSummary.bestNextAction}</strong>
      <small>Based on today’s logged meals</small>
    </div>
  </div>

  {#if nutritionSummary.dataState === 'no_meals'}
    <div class="summary-empty">
      <span class="material-symbols-rounded">restaurant</span>
      <div>
        <strong>Log a meal first</strong>
        <p>Nutritrace will show nutrient recommendations after there is enough meal data.</p>
      </div>
    </div>
  {:else}
    <div class="recommendation-list">
      {#each nutritionSummary.recommendations as row}
        <button
          class="recommendation-row"
          aria-label={`Open analytics for ${row.label}, ${row.coveragePct}% coverage`}
          on:click={() => push('/nutrients')}
        >
          <span>
            <strong>{row.label}</strong>
            <small>{row.status.label} · {row.affectedLabel}</small>
          </span>
          <span>{row.foodMove}</span>
        </button>
      {/each}
    </div>
  {/if}

  <button class="analytics-link" on:click={() => push('/nutrients')}>
    View nutrient analytics
    <span class="material-symbols-rounded">arrow_forward</span>
  </button>
</section>
```

- [ ] **Step 3: Add dashboard summary styles**

Add these styles near the existing dashboard styles:

```css
.family-summary-card {
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  box-shadow: var(--shadow-sm);
}
.summary-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.summary-hero h2 { margin: 0; font-size: 24px; letter-spacing: -0.03em; }
.summary-context { margin: 6px 0 0; color: var(--text-2); }
.summary-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.metric-card {
  display: grid;
  gap: 8px;
  min-height: 112px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.metric-card span,
.metric-card small { color: var(--text-3); }
.metric-card strong { color: var(--text-1); font-size: 20px; }
.metric-bar { height: 8px; border-radius: 999px; background: var(--surface-3, var(--border)); overflow: hidden; }
.metric-bar > div { height: 100%; border-radius: inherit; background: var(--accent); }
.summary-empty,
.recommendation-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  min-height: 56px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.recommendation-list { display: grid; gap: 10px; }
.recommendation-row {
  width: 100%;
  color: var(--text-1);
  text-align: left;
  cursor: pointer;
}
.recommendation-row small { display: block; color: var(--text-3); margin-top: 3px; }
.analytics-link {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-weight: 700;
  cursor: pointer;
}
@media (max-width: 720px) {
  .summary-hero,
  .summary-metrics { grid-template-columns: 1fr; display: grid; }
}
```

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds and no unresolved `memberCards`, `topDeficit`, `computeMemberCards`, or `computeSummary` references remain.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/routes/Dashboard.svelte
git commit -m "Replace dashboard nutrient chips with summary actions" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds with only `src/routes/Dashboard.svelte`.

---

### Task 4: Diary family nutrition card cleanup

**Files:**
- Modify: `src/routes/Diary.svelte`
- Use: `src/lib/familyNutrition.js`

- [ ] **Step 1: Add shared summary import and reactive state**

In `src/routes/Diary.svelte`, add:

```js
import { summarizeFamilyNutrition } from '../lib/familyNutrition.js';
```

Add this reactive statement near the existing family member state:

```js
$: familyNutritionSummary = summarizeFamilyNutrition({
  members: familyMembers,
  currentUser: $currentUser,
  goals: $goals,
  items: entry?.items || [],
  maxRecommendations: 3,
});
```

- [ ] **Step 2: Replace the Family Nutrition Dashboard chip card**

Replace lines around the existing `<!-- Family Nutrition Dashboard Card -->` block with:

```svelte
<div class="family-dashboard-card card mb-4">
  <div class="fd-header">
    <div class="fd-title-wrap">
      <span class="material-symbols-rounded fd-icon">family_restroom</span>
      <span class="fd-title">Family Nutrition Today</span>
    </div>
    <button class="fd-manage-btn" on:click={() => push('/nutrients')} title="View nutrient analytics">
      <span class="material-symbols-rounded">analytics</span> Analytics
    </button>
  </div>

  {#if familyMembers.length === 0}
    <div class="fd-empty">
      <p class="text-3 text-sm mb-3">Add family members to plan and track nutrition coverage together.</p>
      <button class="primary-btn sm" on:click={() => push('/family')}>
        <span class="material-symbols-rounded">person_add</span> Add Family Member
      </button>
    </div>
  {:else}
    <div class="fd-summary-grid">
      <div class="fd-metric">
        <span>Coverage</span>
        <strong>{familyNutritionSummary.overallCoverage}%</strong>
      </div>
      <div class="fd-metric">
        <span>Meals logged</span>
        <strong>{familyNutritionSummary.mealsLogged}</strong>
      </div>
      <div class="fd-metric">
        <span>Next action</span>
        <strong>{familyNutritionSummary.bestNextAction}</strong>
      </div>
    </div>

    {#if familyNutritionSummary.recommendations.length > 0}
      <div class="fd-recommendations">
        {#each familyNutritionSummary.recommendations as row}
          <button class="fd-recommendation-row" on:click={() => push('/nutrients')} aria-label={`Open analytics for ${row.label}`}>
            <span>
              <strong>{row.label}</strong>
              <small>{row.status.label} · {row.affectedLabel}</small>
            </span>
            <span>{row.foodMove}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="fd-empty compact">
        <p>{familyNutritionSummary.headline}</p>
      </div>
    {/if}

    <div class="fd-actions">
      <button class="primary-btn sm" on:click={() => push('/planner')}>
        <span class="material-symbols-rounded">restaurant_menu</span> Plan next meal
      </button>
      <button class="meal-add-row" on:click={() => push('/family')} style="background: transparent;">
        <span class="material-symbols-rounded">person_add</span>
        <span>Manage family</span>
      </button>
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Add diary card styles**

Add these styles to `src/routes/Diary.svelte`:

```css
.fd-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 12px 0;
}
.fd-metric {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.fd-metric span {
  color: var(--text-3);
  font-size: 12px;
  font-weight: 700;
}
.fd-metric strong {
  color: var(--text-1);
  font-size: 16px;
  line-height: 1.25;
}
.fd-recommendations {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.fd-recommendation-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 52px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  color: var(--text-1);
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.fd-recommendation-row small {
  display: block;
  color: var(--text-3);
  margin-top: 3px;
}
.fd-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 12px;
}
.fd-empty.compact {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
@media (max-width: 640px) {
  .fd-summary-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Remove obsolete member lacking chip computation if unused**

After replacing the card, search for `memberLackingNutrients` in `src/routes/Diary.svelte`.

Run:

```bash
rg "memberLackingNutrients|fd-lacking-list" src/routes/Diary.svelte
```

Expected: if matches only point to the old computation or old styles, delete the obsolete reactive block and old `.fd-lacking-list` styles. Keep code if another current surface still uses it.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/routes/Diary.svelte
git commit -m "Simplify diary family nutrition summary" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds with only `src/routes/Diary.svelte`.

---

### Task 5: Planner gap section replacement

**Files:**
- Modify: `src/routes/MealPlanner.svelte`
- Use: `src/lib/familyNutrition.js`

- [ ] **Step 1: Import the shared summary helpers**

Add to `src/routes/MealPlanner.svelte`:

```js
import {
  buildCoverageDistribution,
  summarizeFamilyNutrition,
} from '../lib/familyNutrition.js';
```

Add this reactive summary after `plannedNutrition` and `memberNutrition`:

```js
$: plannerSummary = summarizeFamilyNutrition({
  members,
  currentUser: null,
  goals: {},
  items: plans.flatMap(plan => (plan.items || []).map(item => ({ ...item, meal: plan.meal_type || item.meal }))),
  maxRecommendations: 3,
});
$: plannerDistribution = buildCoverageDistribution(plannerSummary.analyticsRows);
```

- [ ] **Step 2: Replace the `Nutrient Gaps` chip card**

Replace the block labeled `<!-- ─── Nutrient Gap Alerts ─────────────────────────────────── -->` with:

```svelte
{#if plannerSummary.analyticsRows.length > 0}
  <div class="card planning-insights-card mb-3" transition:slide={{ duration: 200 }}>
    <div class="planning-insights-header">
      <div>
        <span class="eyebrow">Planning insights</span>
        <h3>{plannerSummary.headline}</h3>
      </div>
      <button class="analytics-mini-link" on:click={() => push('/nutrients')}>
        View analytics
        <span class="material-symbols-rounded">arrow_forward</span>
      </button>
    </div>

    <div class="planning-distribution" aria-label="Planned nutrient coverage distribution">
      <div><strong>{plannerDistribution.needs_attention}</strong><span>Needs attention</span></div>
      <div><strong>{plannerDistribution.watch}</strong><span>Watch</span></div>
      <div><strong>{plannerDistribution.on_track}</strong><span>On track</span></div>
    </div>

    {#if plannerSummary.recommendations.length > 0}
      <div class="planning-recommendations">
        {#each plannerSummary.recommendations as row}
          <div class="planning-recommendation-row">
            <span>
              <strong>{row.label}</strong>
              <small>{row.coveragePct}% coverage · {row.affectedLabel}</small>
            </span>
            <button class="si-add-btn" on:click={() => push('/nutrients')} aria-label={`Open analytics for ${row.label}`}>
              Details
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 3: Keep suggestions but make them secondary and non-noisy**

Keep the `Suggestions to fill gaps` accordion, but change its header copy to:

```svelte
<span>Food ideas for top planning gaps</span>
```

Limit rendered suggestion groups to the top three:

```svelte
{#each gapSuggestions.slice(0, 3) as { nutrient, suggestions }}
```

This preserves the existing add-food behavior without reintroducing the chip wall.

- [ ] **Step 4: Add planner insight styles**

Add these styles to `src/routes/MealPlanner.svelte`:

```css
.planning-insights-card {
  display: grid;
  gap: 14px;
}
.planning-insights-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.planning-insights-header h3 {
  margin: 4px 0 0;
  font-size: 18px;
}
.eyebrow {
  color: var(--text-3);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.analytics-mini-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-weight: 700;
  cursor: pointer;
}
.planning-distribution {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.planning-distribution > div {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.planning-distribution strong {
  font-size: 22px;
  color: var(--text-1);
}
.planning-distribution span {
  color: var(--text-3);
  font-size: 12px;
}
.planning-recommendations {
  display: grid;
  gap: 8px;
}
.planning-recommendation-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  min-height: 52px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.planning-recommendation-row small {
  display: block;
  color: var(--text-3);
  margin-top: 3px;
}
@media (max-width: 640px) {
  .planning-insights-header,
  .planning-distribution { grid-template-columns: 1fr; display: grid; }
}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds and no `.gap-pills` UI is rendered from `MealPlanner.svelte`.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/routes/MealPlanner.svelte
git commit -m "Replace planner nutrient chips with planning insights" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds with only `src/routes/MealPlanner.svelte`.

---

### Task 6: Final Apple-grade validation and cleanup

**Files:**
- Read/verify: `src/lib/familyNutrition.js`
- Read/verify: `src/lib/familyNutrition.test.js`
- Read/verify: `src/routes/NutrientExplorer.svelte`
- Read/verify: `src/routes/Dashboard.svelte`
- Read/verify: `src/routes/Diary.svelte`
- Read/verify: `src/routes/MealPlanner.svelte`

- [ ] **Step 1: Run unit tests**

Run:

```bash
node --test src/lib/familyNutrition.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: Vite build succeeds.

- [ ] **Step 3: Run live UI**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite reports a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 4: Capture rendered evidence**

Use the Playwright CLI wrapper:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open http://127.0.0.1:5173/dashboard --headed
"$PWCLI" screenshot
"$PWCLI" open http://127.0.0.1:5173/
"$PWCLI" screenshot
"$PWCLI" open http://127.0.0.1:5173/planner
"$PWCLI" screenshot
"$PWCLI" open http://127.0.0.1:5173/nutrients
"$PWCLI" screenshot
```

Expected: screenshots show no nutrient status chip wall on Dashboard, Diary, Planner, or Analytics. The `/nutrients` screen shows filters, charts, table rows, detail panel, and planning actions.

- [ ] **Step 5: Run interaction/accessibility spot checks**

Use Playwright snapshots:

```bash
"$PWCLI" open http://127.0.0.1:5173/nutrients
"$PWCLI" snapshot
```

Expected:

- Main analytics controls appear in the accessibility snapshot.
- Filter selects have meaningful names.
- Nutrient table rows have meaningful labels.
- Primary planning button is visible.
- No state is communicated only by color; labels such as `Needs attention`, `Watch`, and `On track` are visible.

- [ ] **Step 6: Search for remaining chip-wall offenders**

Run:

```bash
rg "gap-pill|deficit-tag|fd-lacking-list|Nutrient Gaps|\\({.*pct.*}%\\)" src/routes/Dashboard.svelte src/routes/Diary.svelte src/routes/MealPlanner.svelte src/routes/NutrientExplorer.svelte
```

Expected: no matches for removed chip-wall classes or `Nutrient Gaps`. Percentage matches may remain inside analytics rows, progress labels, or compact coverage rows only.

---

## Spec Coverage Checklist

- Main screen has summaries and useful details: Tasks 3 and 4.
- Dedicated analytics dashboard has filters, charts, details, and planning handoff: Task 2.
- Chips are reserved for filters and not used as quantitative status walls: Tasks 2, 3, 4, 5, and 6.
- Shared threshold model prevents contradictory status: Task 1.
- Failure states distinguish no meals, missing targets, and load failure: Tasks 1 and 2.
- Accessibility requires labels, keyboard-sized targets, and non-color status labels: Tasks 2, 3, 4, 5, and 6.
- Live rendered evidence is captured before approval: Task 6.
