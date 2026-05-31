# Nutrition Completeness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Normalize all IFCT ingredient and INDB recipe seed records to include every app-supported nutrient, enrich B12 defensibly, and validate provenance for every value.

**Architecture:** Add a seed-time normalization/provenance layer. Converters emit full numeric nutrition objects plus sidecar `nutrition_meta`; validation enforces completeness; seeder writes numeric nutrition only.

**Tech Stack:** Python converters/validation, Node seed tests, Svelte/JS app nutrient definitions, better-sqlite3 seeder.

---

## Task 1: Canonical nutrient IDs and normalization helpers

**Files:**
- Create: `nutritrace/server/seed/data/supported-nutrient-ids.json`
- Create: `nutritrace/scripts/nutrition_normalize.py`
- Create: `nutritrace/server/seed/supported-nutrients.test.js`
- Modify: none unless needed for import paths

**Steps:**
1. Extract the 34 ids from `nutritrace/src/lib/nutrition.js` into `supported-nutrient-ids.json` in exact order.
2. Add `nutrition_normalize.py` helpers:
   - `SUPPORTED_NUTRIENTS`
   - `make_meta(status, source, citation, confidence)`
   - `normalize_record(record, source_name, source_values, zero_rules, derived_rules)`
   - Fill every missing key with `0` only when a rule says explicit zero; otherwise use `0` with `status: "missing"` for now so validation can expose unresolved gaps.
   - Derive `kilojoules` and `salt` when inputs exist.
3. Add a Node test that imports `nutrition.js` and asserts ids exactly match `supported-nutrient-ids.json`.
4. Run `cd nutritrace/server && node --test seed/supported-nutrients.test.js`.
5. Commit: `feat(data): add canonical nutrient normalization helpers`.

## Task 2: B12 and zero-rule supplement framework

**Files:**
- Create: `nutritrace/server/seed/data/nutrient-supplements.json`
- Modify: `nutritrace/scripts/nutrition_normalize.py`
- Test: Python smoke/assertions, validation later

**Steps:**
1. Define supplement schema with `schema_version`, `rules`, and `item_overrides` keyed by `ifct:<code>` / `indb:<code>`.
2. Add safe explicit-zero rules for:
   - B12 in IFCT vegetarian plant groups excluding milk products/ghee/fortified unknowns.
   - cholesterol in plant-only foods.
   - caffeine except tea/coffee/cocoa/chocolate items.
   - alcohol for all seed foods/recipes unless name indicates alcoholic beverage.
   - added-sugars only where source sugar is absent and food is not sweet/dessert/processed; otherwise leave `missing` for validation/reporting.
3. Add B12 positive item overrides for main IFCT animal/dairy/egg/fish/meat groups using cited source values. Prioritize all 4 milk products, 15 eggs, organ meats, common meats, and common fish/shellfish.
4. Add B12 recipe overrides/estimates for obvious dairy/egg/fish/meat recipe names with citations/confidence; plant-only recipes get explicit zero only if names are confidently plant-only.
5. Stop if a positive value lacks a source/citation.
6. Commit: `feat(data): add nutrient supplement rules for B12 and safe zeros`.

## Task 3: Apply normalization in IFCT and INDB converters

**Files:**
- Modify: `nutritrace/scripts/convert_ifct.py`
- Modify: `nutritrace/scripts/convert_indb.py`
- Modify generated: `nutritrace/server/seed/data/ifct-foods.json`
- Modify generated: `nutritrace/server/seed/data/indb-recipes.json`

**Steps:**
1. Import normalization helpers.
2. Preserve existing mapped source nutrients as `status: "sourced"`.
3. Apply supplement rules and overrides after source mapping.
4. Emit `nutrition` with all 34 keys and `nutrition_meta` with all 34 keys.
5. Regenerate both datasets.
6. Spot-check: plant food B12=0 explicit_zero; milk/egg/fish/meat B12 nonzero with citation; recipe B12 zero/estimated as applicable.
7. Commit: `feat(data): normalize IFCT and INDB nutrients with provenance`.

## Task 4: Strengthen validation gate

**Files:**
- Modify: `nutritrace/scripts/validate_data.py`
- Modify generated: `nutritrace/server/seed/data/VALIDATION.md`

**Steps:**
1. Load `supported-nutrient-ids.json`.
2. Hard-fail if any row lacks a supported key in `nutrition`.
3. Hard-fail if any row lacks corresponding `nutrition_meta`.
4. Hard-fail if B12 positive has no citation/confidence/source.
5. Report per-nutrient status counts: sourced, derived, explicit_zero, estimated, missing.
6. Keep existing anchor/Atwater/quarantine checks.
7. Run converters + validation. Expected: PASS or clear unresolved missing statuses. If missing remains for scientifically uncertain nutrients, document explicitly and ask before weakening gate.
8. Commit: `feat(data): require complete nutrient provenance validation`.

## Task 5: Seeder safety for metadata and conflicts

**Files:**
- Modify: `nutritrace/server/seed/seed-core.js`
- Modify: `nutritrace/server/seed/seed-core.test.js`
- Modify: `nutritrace/server/index.js` if auto-seed error handling needs tightening

**Steps:**
1. Ensure seeder serializes only `record.nutrition`, not `nutrition_meta`.
2. Add validation that every record has all supported nutrition keys before insert/update.
3. Prevent overwriting non-seed user recipes with the same name: only update INDB rows if existing notes contain `INDB 2024.11, code`.
4. Auto-seed should log validation/seeding errors and continue startup without corrupt writes.
5. Add/update tests for complete nutrition requirement, metadata ignored, idempotency, and recipe conflict skip.
6. Run `cd nutritrace/server && node --test seed/classify.test.js seed/seed-core.test.js seed/supported-nutrients.test.js`.
7. Commit: `fix(seed): validate complete nutrition and protect user recipes`.

## Task 6: Full verification and PR update

**Files:**
- Possibly modify PR body/docs only.

**Steps:**
1. Run:
   - `python3 nutritrace/scripts/convert_ifct.py`
   - `python3 nutritrace/scripts/convert_indb.py`
   - `python3 nutritrace/scripts/validate_data.py`
   - `cd nutritrace/server && node --test seed/classify.test.js seed/seed-core.test.js seed/supported-nutrients.test.js`
   - `cd nutritrace && npm run build`
2. Seed an isolated DB and verify API returns foods/recipes with complete nutrition keys.
3. Run independent final review.
4. Push branch/update PR only after all reviews pass.

---

## Stop conditions

- No source/citation for positive B12 value.
- Source units unclear.
- Attempt to infer B12 from cobalt or fermentation.
- Blanket zero for a nutrient where food may plausibly contain it.
- Validation fails after regeneration.
- Seeder would overwrite user-created non-INDB recipes.
