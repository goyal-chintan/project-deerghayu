# Nutrient Analytics UI Redesign

**Date:** 2026-05-31  
**Author:** Copilot  
**Status:** In Review  

## Summary

Replace the current nutrient chip wall with two clear surfaces: a calm main nutrition summary and a dedicated nutrient analytics dashboard. The main screen should tell the user what to do next; the analytics dashboard should carry detailed nutrient coverage, charts, filters, member comparisons, and planning handoff.

## Audience

This document is for engineers and designers working on the Nutritrace family nutrition UI. After reading it, they should know which information belongs on the main screen, which information belongs in analytics, and which UI components should replace the noisy nutrient chips.

## Context

The current UI displays many nutrient gaps as small chips or badge-like elements. This creates a noisy screen with repeated percentages and warnings that are hard to scan. In screenshots, the same family nutrition state appears across multiple surfaces, including:

- `src/routes/Dashboard.svelte` with `Family Dashboard` member cards and repeated `deficit-tag` nutrient percentages.
- `src/routes/Diary.svelte` with a `Family Nutrition Dashboard` card and wrapped lacking-nutrient tags.
- `src/routes/MealPlanner.svelte` with `Nutrient Gaps` pills and collapsed `Suggestions to fill gaps`.
- `src/routes/Family.svelte` with detailed scientific targets for each family member.

The problem is not that `0%` needs special treatment. The problem is that detailed nutrient coverage is being displayed with the wrong component. Chips are useful for filters, selections, and small categorical states. They are not appropriate for dozens of quantitative nutrient statuses.

## Options Considered

### Option A: Main summary with top actions

- **Pros:** Keeps the main screen calm, prioritizes the next best action, and avoids flooding users with low-value percentages.
- **Cons:** Requires a second surface for users who want detailed nutrient data.

### Option B: Dedicated nutrient analytics dashboard

- **Pros:** Gives dense nutrient data a proper home with charts, filters, trends, member comparison, and drill-down details.
- **Cons:** Requires clear entry points from the main dashboard and planner so users can find it.

### Option C: Same-screen progressive disclosure table

- **Pros:** Keeps detailed nutrient data on the current screen while replacing chips with rows.
- **Cons:** Still risks overloading the main screen and mixing “what should I do next?” with “analyze every nutrient.”

## Decision

Use a combined **main summary + dedicated analytics** model.

The main nutrition screen should show summaries and useful details, not a wall of nutrient chips. The analytics dashboard should show detailed nutrient data with charts, filters, tables, and planning actions.

This decision preserves first-glance clarity while still giving advanced users enough detail to plan meals scientifically.

## Information Architecture

### Main nutrition screen

The main screen answers one question: **What should I do next for today’s family nutrition?**

It should include:

- Overall family nutrition coverage.
- Meal logging context, such as meals logged today.
- A small number of high-impact improvement areas.
- A single primary action, such as `Plan next meal`.
- A secondary link to `View analytics`.
- Recommended improvements written as human-readable actions, not raw chip values.

It should not include:

- Dozens of nutrient status chips.
- Repeated `0%` labels or raw low-coverage percentages.
- A full micronutrient table.
- Multiple competing primary actions.

### Nutrient analytics dashboard

The analytics dashboard answers a different question: **What exactly is happening across nutrients, members, meals, and time?**

It should include:

- Time, member, meal, and severity filters.
- Coverage distribution charts for macro and micronutrient groups.
- Member impact comparison.
- Nutrient detail table with coverage, trend, affected members, and recommended food moves.
- Nutrient drill-down panel with explanation, food sources, and planning actions.
- A primary planning handoff, such as `Create meal plan`.

Detailed nutrient percentages belong here, not in chip walls on the main dashboard.

## Component Rules

| Information type | Use this component | Do not use |
|---|---|---|
| Selected filter criteria | Filter chips | Status chips for every nutrient |
| Overall family state | Summary card and progress indicator | Dozens of warning badges |
| Top nutrition opportunities | Ranked recommendation rows | Wrapped chip cloud |
| Full nutrient coverage | Chart and table | Inline pills |
| Member comparison | Horizontal bars or table rows | Repeated small cards with dense badges |
| Planning handoff | Primary button and contextual action rows | Ambiguous plus icons |

Chips may appear only as selected filters or small categorical controls. Nutrient status should appear in charts, rows, summary cards, and drill-down panels.

## Main Screen Design

The main screen should start with a quiet, high-confidence summary:

- **Title:** `Family nutrition today`
- **Status line:** a human sentence such as `Coverage is improving` or `Dinner can close the biggest gaps`.
- **Context:** `2 meals logged · 3 high-impact improvements available`.
- **Primary action:** `Plan next meal`.
- **Secondary action:** `View analytics`.

Below the header, show three compact summary cards:

1. **Overall coverage** — percentage and progress indicator.
2. **Needs attention** — count and top nutrient group names.
3. **Best next action** — meal or food move with the highest planning value.

Then show a ranked recommendation panel:

1. Highest-impact nutrient or nutrient group.
2. Why it matters in plain language.
3. Concrete food or meal action.

This panel should show at most three recommendations. If more details exist, the user should open analytics.

## Analytics Dashboard Design

The analytics dashboard should be a full-featured planning surface.

### Filters

Filters should support:

- Date range: today, week, custom.
- Family member: all members or one member.
- Meal: all meals, breakfast, lunch, dinner, snacks.
- Nutrient group: macros, minerals, vitamins, custom group.
- Severity: needs attention, watch, on track.

Selected filters may use chips because chips represent active criteria, not data points.

### Charts

The dashboard should include:

- **Coverage distribution chart** showing how nutrients spread across low, watch, and on-track ranges.
- **Member impact chart** showing which members are most affected.
- **Trend chart** for selected nutrient coverage over time.

Charts must not communicate state only through color. Each chart needs labels, legends, or text summaries.

### Detail table

The table should include:

| Column | Purpose |
|---|---|
| Nutrient | Names the nutrient or group. |
| Coverage | Shows current coverage as a value and visual indicator. |
| Trend | Shows whether coverage is improving, flat, or worsening. |
| Affected members | Shows who needs attention. |
| Food move | Gives a concrete planning action. |

Rows should be sortable and filter-aware.

### Drill-down panel

Selecting a nutrient should open a detail panel that explains:

- Why the nutrient matters.
- Which members and meals are driving the gap.
- Food sources that can improve coverage.
- Suggested meal additions.
- A direct path to add the suggestion to the meal plan.

## Data Display Rules

Raw percentages are useful only when they support a decision. The UI should interpret them before showing them on the main screen.

Use these rules:

- Show exact percentages in analytics.
- Show interpreted summary language on the main screen.
- Collapse long nutrient lists into ranked opportunities.
- Prefer “what action helps?” over “which numbers are low?”
- Do not show a nutrient as alarming if the underlying food log is too incomplete to support that conclusion.

## User Journey

1. The user opens the main nutrition screen.
2. They see overall family coverage, logged meal context, and the top recommended improvement.
3. They click `Plan next meal` if they want to act immediately.
4. They click `View analytics` if they want to understand the details.
5. In analytics, they filter by member, meal, date, or severity.
6. They inspect charts and the nutrient table.
7. They select a nutrient to see the drill-down panel.
8. They use a food move or `Create meal plan` to return to planning.

## Failure and Recovery States

The UI must distinguish these states:

| State | Main screen behavior | Analytics behavior |
|---|---|---|
| No family members | Explain that family members are needed and show `Add family member`. | Show disabled analytics with setup guidance. |
| No meals logged | Show meal logging CTA, not alarming nutrient deficits. | Show empty charts with “log meals to analyze coverage.” |
| Partial meal data | Show cautious summary language. | Show visible data completeness context. |
| Targets missing | Show setup CTA. | Exclude missing-target nutrients or mark them as unavailable. |
| Data load failure | Show retry and error message. | Preserve filters and show retry. |

## Accessibility Requirements

- Every interactive element needs a meaningful accessible name.
- Chart state must have non-color labels or summaries.
- Recommendation rows must be keyboard reachable.
- Filter chips must expose selected/unselected state.
- Hit targets must be at least 44 by 44 points or have equivalent padding and content shape.
- Expandable or drill-down rows must use full-row activation, not a tiny chevron-only target.
- Long nutrient names and explanations must wrap or reveal, not truncate without a path to read the full text.

## Visual Language Constraints

The implementation should follow the app’s design system rather than introduce a new visual language without approval.

Approved direction:

- Calm, spacious main dashboard.
- Dense but structured analytics dashboard.
- Summary cards, charts, rows, and detail panels.
- Chips only for filters.

Not approved in this spec:

- New brand palette.
- Decorative glass treatment changes.
- New icon style.
- New motion language.

Any non-functional visual-language change requires a separate approval-gated visual delta.

## Implementation Consequences

The later implementation plan should:

- Consolidate duplicate family nutrition surfaces so the dashboard, diary, planner, and family routes do not contradict each other.
- Replace nutrient chip clouds in `Dashboard.svelte`, `Diary.svelte`, and `MealPlanner.svelte`.
- Add or route to a canonical `Nutrition Analytics` surface.
- Reuse shared summary card, chart, filter, table, and recommendation components.
- Keep detailed target editing in `Family.svelte`.
- Add loading, empty, partial-data, and error states before claiming completion.

## Acceptance Criteria

- The main screen shows no wall of nutrient status chips.
- Nutrient chips are used only for filters or selected criteria.
- The main screen shows a clear primary action and at most three ranked recommendations.
- Detailed nutrient percentages appear on the analytics dashboard.
- Analytics includes filters, charts, member impact, nutrient detail table, and planning handoff.
- The UI distinguishes no data, partial data, missing targets, and true nutrition gaps.
- No status relies on color alone.
- Critical flows have live rendered evidence before final approval.

## Implementation Decisions For Planning

- Use the existing `/nutrients` route as the canonical analytics destination. Rename its page concept from `Explore Nutrients` to `Nutrition Analytics` and evolve `src/routes/NutrientExplorer.svelte` rather than adding a competing route.
- Use lightweight in-app chart primitives first, built from semantic HTML, SVG, or CSS. Do not add a charting dependency until the implementation proves a specific chart requirement cannot be met with existing primitives.
- Extract canonical family nutrient coverage calculation into a shared helper or derived store used by the main dashboard, diary card, planner, and analytics route. No route should compute its own contradictory version of nutrient status.
- Use one threshold model across all surfaces: `needs attention` below 60%, `watch` from 60% to 79%, and `on track` at 80% or above. If product or nutrition science later requires different thresholds per nutrient, implement that as explicit nutrient metadata rather than route-local conditionals.
