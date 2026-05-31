# Indian Nutrition Data — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Seed all common Indian ingredients + pan-Indian recipes (from the peer-reviewed INDB dataset, validated against IFCT 2017) into the app via a reproducible, idempotent, opt-in Node seeder.

**Architecture:** A Python offline dev script downloads the INDB workbook and converts it to faithful committed JSON (`indb-foods.json` / `indb-recipes.json`). A Python validation script cross-checks accuracy against IFCT 2017 and writes a report (the gate). A Node ESM seeder reads the JSON, applies a unit-tested `classify.js` (diet_type + category), and idempotently upserts ingredients → `foods` and recipes → `meals(is_recipe=1)`. No new runtime dependencies; classification + seeding logic is testable with `node:test`.

**Tech Stack:** Node 20 ESM, better-sqlite3, `node:test`/`node:assert`; Python 3 + pandas/openpyxl (offline dev tools only, not a runtime dep).

**Reference design:** `docs/plans/2026-05-30-indian-nutrition-data-design.md`. **Upstream issue:** charugupta-dev/project-deerghayu#3.

---

## Conventions
- Branch: `feature/indian-nutrition-data` (already created).
- Canonical `diet_type` strings: `vegetarian | non-vegetarian | vegan | eggetarian`.
- Canonical visibility for shared catalogue: `group`.
- Never commit `nutritrace/server/nutritrace.db`, `*.db-wal`, `*.db-shm`.
- Frequent commits; one logical change per commit.

---

### Task 0: Scaffold directories

**Files:**
- Create: `nutritrace/server/seed/data/.gitkeep`
- Create: `nutritrace/scripts/data/.gitkeep` (workbook download target; gitignored)

**Step 1:** Create dirs. Add `nutritrace/scripts/data/` to `.gitignore` (raw xlsx not committed; only derived JSON is).
**Step 2:** Commit: `chore: scaffold seed pipeline directories`.

---

### Task 1a: IFCT 2017 ingredient converter (CSV → JSON)

**Files:**
- Create: `nutritrace/scripts/convert_ifct.py`
- Output (committed): `nutritrace/server/seed/data/ifct-foods.json`

**Step 1:** Write `convert_ifct.py`:
- Fetch `https://raw.githubusercontent.com/nodef/ifct2017/master/compositions/index.csv` (cache in `scripts/data/`). Also fetch the column-descriptions resource from the repo to map IFCT codes → meaning.
- Map IFCT codes → `nutrition.js` keys: `enerc`→calories (convert kJ→kcal if needed, verify magnitude), `protcnt`→proteins, `fatce`→fat, `fibtg`→fiber, `choavldf`→carbohydrates, `cholc`→cholesterol, plus minerals (ca/fe/mg/p/k/na/zn) and vitamins (a/c/e/k/b1/b2/b3/b6, folate→b9, vitd). Ignore `_e` (standard-error) columns.
- Derive `diet_type` from the IFCT `tags` field (`vegetarian`/`eggetarian`/`fishetarian`→non-vegetarian/`non-veg`). Derive `category` from `grup`.
- Emit faithful records `{ name, scientific, source:"IFCT 2017", code, grup, tags, nutrition }`. Sort by name.

**Step 2:** Run `python3 nutritrace/scripts/convert_ifct.py`; expected ~542 rows.
**Step 3:** Sanity: `node -e "const f=require('./nutritrace/server/seed/data/ifct-foods.json'); console.log(f.length, f[0])"`.
**Step 4:** Commit: `feat: add IFCT-2017 ingredient converter + dataset`.

---

### Task 1b: INDB recipe converter (xlsx → JSON)

**Files:**
- Create: `nutritrace/scripts/convert_indb.py`
- Output (committed): `nutritrace/server/seed/data/indb-recipes.json`
- Input (gitignored): `nutritrace/scripts/data/Anuvaad_INDB_2024.11.xlsx` (already downloaded)

**Step 1:** Write `convert_indb.py` for the **single `Sheet1`, 1,014 recipe rows**:
- Map per-100g columns → `nutrition.js` keys. **Unit conversions:** `sfa_mg/mufa_mg/pufa_mg` ÷1000 → saturated/mono/poly-unsaturated-fat (g); `cholesterol_mg`→cholesterol (mg, no convert); `freesugar_g`→sugars; `folate_ug`→b9 (ignore identical `vitb9_ug`); vitamin-d = `vitd2_ug+vitd3_ug`; skip `vitb5/vitb7/carotenoids` (no app key). Drop ≤0.
- Capture `servings_unit` + `unit_serving_energy_kcal` for portion metadata.
- Emit faithful records `{ name, source:"INDB", food_code, nutrition, serving_unit, per_serving:{...} }`. Sort by name.

**Step 2:** Run `python3 nutritrace/scripts/convert_indb.py`; expected 1,014 rows.
**Step 3:** Sanity-check a known row (Mutton biryani) nutrient magnitudes.
**Step 4:** Commit: `feat: add INDB recipe converter + dataset`.

---

### Task 2: Accuracy validation gate

**Files:**
- Create: `nutritrace/scripts/validate_data.py`
- Output (committed): `nutritrace/server/seed/data/VALIDATION.md`

**Step 1:** Write `validate_data.py`:
- Ingredients ARE IFCT 2017 (gold standard) — assert structural integrity (no negative/NaN, unit ranges, no dup `name`).
- Recipes (INDB): plausibility checks — kcal in 0–900/100g, macros sum sane, no negatives; cross-check a sample of recipes whose main ingredient maps to an IFCT food for order-of-magnitude agreement.
- Report B12 coverage gap explicitly.
- Write `VALIDATION.md`: counts, sanity pass/fail, outliers, documented limitations.

**Step 2:** Run `python3 nutritrace/scripts/validate_data.py`
Expected GATE: 0 sanity failures on both datasets; recipe plausibility ≥95%. If fail, STOP and report.
**Step 3:** Commit: `test: add accuracy/sanity validation + report`.

---

### Task 3: Diet-type + category classifier (Node, TDD)

**Files:**
- Create: `nutritrace/server/seed/classify.js`
- Test: `nutritrace/server/seed/classify.test.js`

**Step 1 (failing test):** Write `classify.test.js` with `node:test`:
```js
import test from 'node:test';
import assert from 'node:assert';
import { classifyDietType, classifyCategory } from './classify.js';

test('non-veg keywords', () => {
  assert.equal(classifyDietType('Chicken Biryani', ''), 'non-vegetarian');
  assert.equal(classifyDietType('Mutton Curry', 'Meat'), 'non-vegetarian');
  assert.equal(classifyDietType('Fish Fry', ''), 'non-vegetarian');
});
test('egg keywords', () => {
  assert.equal(classifyDietType('Egg Bhurji', ''), 'eggetarian');
});
test('default veg', () => {
  assert.equal(classifyDietType('Palak Paneer', 'Milk and Milk Products'), 'vegetarian');
  assert.equal(classifyDietType('Toor Dal', 'Pulses'), 'vegetarian');
});
test('category from group', () => {
  assert.equal(classifyCategory('Paneer', 'Milk and Milk Products'), 'Dairy');
  assert.equal(classifyCategory('Toor Dal', 'Pulses'), 'Pulses & Legumes');
});
```
**Step 2:** Run: `node --test nutritrace/server/seed/` → FAIL (module missing).
**Step 3:** Implement `classify.js`: keyword sets for non-veg (chicken/mutton/fish/prawn/egg→egg first) and an INDB-food-group→category map; default `vegetarian` / `Other`.
**Step 4:** Run: `node --test nutritrace/server/seed/` → PASS.
**Step 5:** Commit: `feat: add diet-type + category classifier for seed data`.

---

### Task 4: Seeder core (idempotent upsert, TDD)

**Files:**
- Create: `nutritrace/server/seed/seed-indb.js` (exports `seedFoods`, `seedRecipes`, `run`)
- Test: `nutritrace/server/seed/seed-indb.test.js`

**Step 1 (failing test):** Use an in-memory/temp better-sqlite3 DB; create minimal `foods`/`meals` tables; seed a 2-row fixture; assert:
- ingredient inserted into `foods` with parsed `nutrition`, `diet_type`, `category`, `visibility='group'`, owner id.
- recipe inserted into `meals` with `is_recipe=1`.
- running `seedFoods` twice → row count unchanged (idempotent).
- malformed row (missing name) skipped, not thrown.
**Step 2:** Run: `node --test` → FAIL.
**Step 3:** Implement `seed-indb.js`: prepared INSERTs mirroring `routes/foods.js` columns; reads both `ifct-foods.json` (→ `foods`, diet_type already set from IFCT tags) and `indb-recipes.json` (→ `meals`, diet_type via `classify.js` keyword pass); dedupe by `name|brand` (foods) / `name` (meals); provenance into `notes`; accept `{ db, ownerId }` for testability.
**Step 4:** Run: `node --test` → PASS.
**Step 5:** Commit: `feat: add idempotent INDB seeder`.

---

### Task 5: CLI wiring

**Files:**
- Modify: `nutritrace/server/package.json` (add `"seed:indb": "node seed/seed-indb.js"`)
- Modify: `nutritrace/server/seed/seed-indb.js` (CLI entry: args `--db`, `--owner <username>`; resolves owner user id; defaults to admin/first user)

**Step 1:** Add script + CLI arg parsing + `import.meta.main`-style guard.
**Step 2:** Run (dry, against a copy): `cd nutritrace/server && node seed/seed-indb.js --db /tmp/opencode/seedtest.db --owner sunita`
Expected: prints added/skipped counts; exits 0.
**Step 3:** Commit: `feat: add seed:indb npm script + CLI`.

---

### Task 6: End-to-end run + manual UI verification

**Step 1:** Back up test DB, run seeder against `nutritrace/server/nutritrace.db` (owner `sunita`).
**Step 2:** Build/deploy loop; start server (PORT=3002 from `nutritrace/server`).
**Step 3:** Playwright: log in (`sunita`/`Deerghayu@2024`), open Foods → search "Dal"/"Dosa"/"Paneer", open one item, confirm micronutrients (iron/calcium/b12) populate + diet badge correct. Capture light+dark screenshots to `/tmp/opencode/ui-review/`.
**Step 4:** Spot-check a recipe (e.g., Palak Paneer) values against `VALIDATION.md`/IFCT.
**Step 5:** Commit any fixes. (DB and screenshots NOT committed.)

---

### Task 7: Independent review + PR

**Step 1:** Dispatch reviewer (spec-compliance) then reviewer (code-quality) — fresh agents, not implementer.
**Step 2:** Address blockers.
**Step 3:** `verification-before-completion`: re-run `node --test nutritrace/server/seed/` + validation gate; paste output.
**Step 4:** Merge `feature/indian-nutrition-data` → local `main`; push branch to `fork`; open PR to `charugupta-dev:main` from `goyal-chintan:feature/indian-nutrition-data`, linking issue #3. (Separate from the existing PR.)

---

## Verification gates (must all pass before PR)
1. `python3 nutritrace/scripts/validate_indb.py` → ≥80% within ±10%, 0 sanity failures.
2. `node --test nutritrace/server/seed/` → all pass.
3. Idempotency: seeder run twice → identical row counts.
4. Manual UI: Indian foods searchable with correct micronutrients + badges (screenshots captured).
