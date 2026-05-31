# Indian Ingredient & Recipe Nutrition Data — Design

**Date:** 2026-05-30
**Status:** Approved (design phase)
**Branch:** `feature/indian-nutrition-data`
**Target PR:** upstream `charugupta-dev/project-deerghayu` (separate from the existing dashboard/grocery PR)

## Goal

Replace the broken, non-reproducible Python seeder (`nutritrace/scripts/seed_indian_data.py`,
which reads proprietary Excel/CSV files from hardcoded paths on the original author's machine)
with a scientifically accurate, fully-referenced, reproducible pipeline that seeds **all**
common Indian ingredients and recipes (pan-Indian: North, South, and other regional cuisines)
into the app.

## Data sources & provenance

> **Refinement (post-inspection of real files, 2026-05-30):** The canonical Anuvaad INDB
> download (`Anuvaad_INDB_2024.11.xlsx`) is **recipes-only** (1,014 rows). It contains no raw
> ingredients. Therefore ingredients are sourced **directly from IFCT 2017** (the authority
> itself, lab-measured) and recipes from INDB. This is strictly more accurate than the
> originally-planned "INDB primary" approach.

| Role | Source | Backing | Coverage |
|------|--------|---------|----------|
| **Ingredients** | IFCT 2017 — Indian Food Composition Tables, ICMR–NIN (`nodef/ifct2017` extract, Zenodo 7088653) | Lab-measured by the National Institute of Nutrition across 6 regions. Includes per-food diet **tags** (veg/eggetarian/fishetarian/non-veg) and food **groups**. | 542 ingredients |
| **Recipes** | INDB — Indian Nutrient Databank (`Anuvaad_INDB_2024.11.xlsx`) | Peer-reviewed: Vijayakumar A, Dubasi HB, Awasthi A, Jaacks LM. *Development of an Indian Food Composition Database.* Current Developments in Nutrition, 2024 (Gold Open Access, ASN). Gates-funded. | 1,014 pan-Indian recipes (per 100 g & per serving) |

INDB recipe values are themselves referenced from: (1) IFCT 2017 (NIN/ICMR), (2) Nutritive
Value of Indian Foods 2004 (NIN/ICMR), (3) UK CoFID (Public Health England), (4) USDA
FoodData Central. Provenance therefore traces to government/lab authorities.

### Known data facts / limitations (documented, not hidden)
- **No vitamin B12** in either source's columns. B12 is the key vegetarian-deficiency nutrient;
  seeded items will simply lack a `b12` value rather than carry a fabricated one. Documented in
  `VALIDATION.md` and the PR.
- Unit conversions required: INDB `sfa_mg/mufa_mg/pufa_mg` (mg) → app grams (÷1000); IFCT
  energy codes → kcal as needed. `folate_ug` == `vitb9_ug` → use one (`b9`).
- IFCT ingredient diet_type/category come from IFCT tags/groups; INDB recipes have no diet flag,
  so recipe diet_type is keyword-classified.

### Licensing posture (accuracy-first, license-flexible — user-approved)

- Upstream repo has **no license** (`licenseInfo: null`).
- INDB has no explicit license but is published open-access; the `nodef/ifct2017` extract is AGPL-3.0.
- Mitigation: ingest **numeric nutrition values** (factual, not copyrightable) **+ per-row source
  citations**. Verbatim copyrighted recipe instructions are **omitted or summarized**, never copied.

## Architecture (3 stages)

```
Anuvaad_INDB_2024.11.xlsx ──[offline convert + classify]──> data/indb-foods.json
                                                            data/indb-recipes.json
                                   │                              │
                          [validate vs IFCT 2017]        [Node ESM seeder]
                                   │                              │
                              report (GATE)            foods (ingredients)
                                                       meals  (recipes, is_recipe=1)
```

### Stage 1 — Offline conversion (run once)
- Reads the INDB xlsx, maps columns → app `nutrition.js` keys. Proven mapping:
  `energy_kcal→calories`, `protein_g→proteins`, `carb_g→carbohydrates`, `fat_g→fat`,
  `fibre_g→fiber`, `sodium_mg→sodium`, `potassium_mg→potassium`, `calcium_mg→calcium`,
  `iron_mg→iron`, `magnesium_mg→magnesium`, `phosphorus_mg→phosphorus`, `zinc_mg→zinc`,
  `vita_ug→vitamin-a`, `vitc_mg→vitamin-c`, `vitb1_mg→b1`, `vitb2_mg→b2`, `vitb3_mg→b3`,
  `vitb6_mg→b6`, `folate_ug→b9`; Vitamin D = `vitd2_ug + vitd3_ug → vitamin-d`.
- Classifies `diet_type ∈ {vegetarian, non-vegetarian, vegan, eggetarian}` (exact canonical
  strings validated in `server/routes/foods.js`).
- Classifies `category` from the INDB food group.
- Drops values ≤ 0.
- Emits committed, diff-reviewable `indb-foods.json` and `indb-recipes.json` with provenance per row.

### Stage 2 — Validation gate (blocks on failure)
- Sample INDB ingredients with IFCT 2017 counterparts; assert energy/protein/iron/calcium
  within **±10%**; report match-rate.
- Unit sanity (µg vs mg per `nutrition.js`); reject negatives/NaN; plausibility caps.
- Dedup/collision report.
- Output a human-readable validation summary committed with the data.

### Stage 3 — Node ESM seeder (`server/seed/seed-indb.js`)
- Reads the committed JSON; idempotent upsert.
- Dedupe key: `name|brand` for foods, `name` for recipes (matches prior script).
- Ingredients → `foods`; recipes → `meals` with `is_recipe = 1`.
- **Owner:** the primary/admin account that owns the family (configurable arg).
- **Visibility:** `'group'` — the technically-correct shared-catalogue value (`canRead` only
  honors `group`/`specific`; `'public'` would be invisible to others). Note: family members
  (Aarav, Rahul, Mataji) are `family_members` profile rows under the single `sunita` account,
  not separate logins, so seeded foods are usable across the account's profiles regardless;
  `'group'` additionally exposes them to any separate user accounts when sharing is enabled.
- Stores `notes`/`source_id` provenance.
- **Opt-in only** (`npm run seed:indb`); never auto-runs on server boot.

## Error handling & idempotency
- Re-running never duplicates (skip-if-exists on dedupe key).
- Malformed rows logged and skipped, not fatal.

## Testing / verification
- Unit test: column-mapping + diet-type classifier (fixtures → expected JSON).
- Integration test (temp SQLite): counts, idempotency (run twice → same count), spot-check a
  known dish (e.g., Palak Paneer) nutrient values.
- Manual: run seeder on the test DB, log in as `sunita`, confirm items searchable in
  Foods/Diary with correct micronutrients + diet badges; capture light+dark screenshots
  (per the non-waivable UI-evidence rule).

## Independent review (subagent-driven-development)
Two-stage review after build: (a) spec-compliance, then (b) code-quality — fresh reviewer
agents, never the implementer.

## Out of scope
- New UI screens (uses existing Foods/Diary/Nutrients views).
- Schema changes (existing `foods`/`meals` columns suffice).
- Auto-seeding on boot.
