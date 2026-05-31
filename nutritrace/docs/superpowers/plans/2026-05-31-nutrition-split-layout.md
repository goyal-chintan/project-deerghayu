# Nutrition Split Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `/#/nutrients` as a food-source explorer and move family nutrition coverage analytics into `/#/statistics` so users are not confused by two analytics-like nutrient screens.

**Architecture:** Extract the current `NutrientExplorer.svelte` analytics experience into a reusable Statistics panel, then rebuild `NutrientExplorer.svelte` around the original "select nutrient → top foods" workflow with premium organic layout. Existing Dashboard, Diary, and Planner CTAs route analytics intent to Statistics and food-source discovery intent to Nutrients.

**Tech Stack:** Svelte 5 compatibility mode, svelte-spa-router hash routes, Chart.js, app design tokens, `NtApi`, `familyNutrition.js`, `nutrientRecommendations.js`.

---

### Task 1: Extract Nutrition Analytics Panel

**Files:**
- Create: `src/components/nutrition/NutritionAnalyticsPanel.svelte`
- Source: copy the analytics logic and markup from current `src/routes/NutrientExplorer.svelte`

- [ ] Create `NutritionAnalyticsPanel.svelte` with the current family nutrition analytics logic.
- [ ] Remove the outer page shell/header so it can render inside Statistics.
- [ ] Keep loading, error, filters, distribution, nutrient details, member impact, suggestions, and planner handoff.
- [ ] Change the primary heading copy to "Nutrition coverage" and subtitle to "Family targets, meal coverage, and nutrient gaps."
- [ ] Ensure no code in this component navigates to `/nutrients` for analytics.
- [ ] Run `npm run build` after integration tasks, not in this task alone.
- [ ] Commit with message: `Extract nutrition analytics panel`.

### Task 2: Restore Organic Nutrient Sources Explorer

**Files:**
- Modify: `src/routes/NutrientExplorer.svelte`
- Source reference: `git show origin/main:nutritrace/src/routes/NutrientExplorer.svelte`

- [ ] Replace the analytics dashboard route with a food-source explorer.
- [ ] Preserve original functionality: nutrient selector, vegetarian filter, family daily need, top foods ranked by selected nutrient, % daily need per serving, diet badges, add-to-diary handoff via `nt:quickAdd`.
- [ ] Improve layout organically: hero guidance, nutrient group selector, selected nutrient summary, ranked food cards, clear empty/loading/error states.
- [ ] Use chips only as nutrient filters, never as quantitative status chips.
- [ ] Ensure add buttons have `aria-label` and visible 44px minimum hit target.
- [ ] Commit with message: `Restore nutrient food sources explorer`.

### Task 3: Add Nutrition Tab To Statistics

**Files:**
- Modify: `src/routes/Statistics.svelte`
- Import: `src/components/nutrition/NutritionAnalyticsPanel.svelte`

- [ ] Add `activeStatsView = 'charts'`.
- [ ] Add an accessible segmented control near the Statistics header: `Charts` and `Nutrition`.
- [ ] Render the existing charts UI only when `activeStatsView === 'charts'`.
- [ ] Render `<NutritionAnalyticsPanel />` when `activeStatsView === 'nutrition'`.
- [ ] Ensure chart lifecycle remains safe: chart rendering only occurs when `canvasEl` exists.
- [ ] Preserve current Statistics chart behavior exactly in the Charts tab.
- [ ] Commit with message: `Move nutrition analytics into statistics`.

### Task 4: Retarget Navigation And CTAs

**Files:**
- Modify: `src/routes/Dashboard.svelte`
- Modify: `src/routes/Diary.svelte`
- Modify: `src/routes/MealPlanner.svelte`
- Optional modify: `src/components/layout/Sidebar.svelte`

- [ ] Update analytics CTAs to route to `/statistics`, with copy like "View nutrition statistics".
- [ ] Update food-source CTAs/recommendation actions to route to `/nutrients`, with copy like "Find foods".
- [ ] Keep Sidebar label `Nutrients` for the food-source explorer; do not rename it to Analytics.
- [ ] Ensure no visible copy says "Nutrient Analytics" on `/nutrients`.
- [ ] Commit with message: `Clarify nutrient and statistics navigation`.

### Task 5: Validate, Review, And Update PR

**Files:**
- Modify as needed based on validation findings.

- [ ] Run `node --test src/lib/familyNutrition.test.js src/lib/routeResolver.test.js`.
- [ ] Run `npm run build`.
- [ ] Search for confusing remnants: `rg -n "Family nutrition analytics|Plan from nutrient coverage|View nutrient analytics|Nutrient Analytics" src`.
- [ ] Verify dev server renders `/#/nutrients` and `/#/statistics`.
- [ ] Request code review.
- [ ] Fix Critical and Important findings.
- [ ] Push branch and update PR #5 with the layout split details.

---

## Product Integration Notes

- **Nutrients screen intent:** "I need more of a nutrient; what foods can I add?"
- **Statistics Nutrition tab intent:** "How is my family doing against nutrient targets?"
- **Dashboard/Diary/Planner intent:** "What should I do next?" These screens stay calm and route users to the correct deep surface.
- **Canonical placement:** food discovery stays in Nutrients; analytics moves to Statistics.
- **Discoverability:** Sidebar `Nutrients` opens food sources; summary cards link to Statistics for analytics and Nutrients for food discovery.

## Apple-Grade UI Guardrails

- No duplicate analytics screens.
- No quantitative chip walls.
- Clear primary action per surface.
- Every async state has loading/error/retry or useful empty state.
- Interactive controls have meaningful labels and 44px target size.
- Status must not be communicated by color alone.
- No visual-language changes beyond the approved organic split.
