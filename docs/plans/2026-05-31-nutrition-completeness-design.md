# Nutrition Completeness + B12 Enrichment Design

## Goal

Ensure every seeded IFCT ingredient and INDB recipe has a complete nutrition object for every nutrient supported by the app, while keeping values scientifically defensible. Missing data must not silently become fabricated data: explicit zero is allowed only when the food truly lacks the nutrient or a documented rule proves absence.

## Current evidence

- App nutrient model: `nutritrace/src/lib/nutrition.js` defines 34 supported nutrient ids and units.
- IFCT and INDB seed JSON currently omit many keys. `b12` is absent from both sources: 0/542 IFCT foods and 0/984 INDB recipes.
- IFCT source extract has B1/B2/B3/B5/B6/B7/B9 but no B12/cobalamin column. INDB has no B12 column.
- Legacy importer B12 mapping is stale: its `vitb12` index points at a B6 error-margin column, not cobalamin.

## Scientific rules

1. Do not infer B12 from cobalt, fermentation, or vegetarian status alone.
2. B12 is explicit zero for unfortified plant foods, oils, sugars, spices, grains, pulses, fruits, and vegetables.
3. B12 must be sourced or conservatively estimated for dairy, egg, fish, shellfish, meat, poultry, and organ meats.
4. Recipes without ingredient lists cannot be computed exactly. They need direct source/proxy estimates with low/medium/high confidence, or explicit zero only when the name/classification is confidently plant-only.
5. Derived values are acceptable where the app already derives them: `kilojoules = calories * 4.184`, `salt = sodium / 400`.

## Architecture

Use a seed-data normalization and provenance layer, not schema changes.

- Runtime `nutrition` remains a numeric object containing all supported keys.
- Seed JSON also carries `nutrition_meta`, keyed by nutrient id, to document provenance (`sourced`, `derived`, `explicit_zero`, `estimated`).
- Validation enforces complete key coverage and provenance for every key.
- Seeder writes only `nutrition` to the DB and ignores `nutrition_meta`; citations are summarized in `notes`.

## Data sources and confidence

- Existing IFCT/INDB values remain primary where present.
- Derived values use deterministic app formulas.
- B12 positive values use a curated supplement file with source/citation/confidence. Use USDA FoodData Central/SR Legacy/FNDDS and NIN/ICMR/peer-reviewed literature where available.
- Category zero rules are cited and limited to scientifically safe categories.

## Non-goals

- No DB schema migration for nutrient provenance.
- No UI display of per-nutrient citations in this iteration.
- No invented recipe ingredient decomposition when INDB lacks ingredient lists.
- No blanket zero-filling for uncertain nutrients such as added sugars in sweets, caffeine in tea/coffee/chocolate, or B12 in animal-derived foods.

## Acceptance criteria

- Every IFCT food and INDB recipe has all 34 supported nutrient keys in `nutrition`.
- Every nutrient value has `nutrition_meta` explaining provenance.
- B12 has explicit zero for defensible plant foods/recipes and nonzero sourced/estimated values for main dairy/egg/fish/meat foods and recipes.
- Validation hard-fails on missing keys, missing metadata, unsupported nutrient ids, or uncited B12 positive values.
- Seeder remains idempotent and does not write metadata into runtime `nutrition`.
- Build/tests/validation pass; PR is updated after review.
