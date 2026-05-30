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

### Task 1: Conversion script (xlsx → faithful JSON)

**Files:**
- Create: `nutritrace/scripts/convert_indb.py`
- Output (committed): `nutritrace/server/seed/data/indb-foods.json`, `nutritrace/server/seed/data/indb-recipes.json`

**Step 1:** Write `convert_indb.py`:
- Download `https://www.anuvaad.org.in/wp-content/uploads/2020/07/Anuvaad_INDB_2024.11.xlsx` to `scripts/data/` if absent.
- Read the INDB sheet. Split rows by `primarysource`: recipe sources `['asc_manual','bfp_manual','open_source_recipes']` → recipes; the rest → raw ingredients.
- Map columns → `nutrition.js` keys (mapping table in the design doc). Vitamin D = `vitd2_ug + vitd3_ug`. Drop values ≤ 0, round to 3 dp.
- Emit **faithful** records: `{ name, source (brand), food_code, food_group, nutrition, servings?, per_serving? }`. Do NOT classify diet/category here (done in Node).
- Deterministic ordering (sort by name) so JSON diffs are stable.

**Step 2:** Run: `python3 nutritrace/scripts/convert_indb.py`
Expected: prints counts (~1,095 foods, ~1,014 recipes); writes both JSON files.

**Step 3:** Sanity-check output:
Run: `node -e "const f=require('./nutritrace/server/seed/data/indb-foods.json'); console.log(f.length, Object.keys(f[0]))"`
Expected: count > 500; keys include `name`, `nutrition`.

**Step 4:** Commit: `feat: add INDB→JSON conversion script and derived datasets`.

---

### Task 2: Accuracy validation gate (vs IFCT 2017)

**Files:**
- Create: `nutritrace/scripts/validate_indb.py`
- Output (committed): `nutritrace/server/seed/data/VALIDATION.md`

**Step 1:** Write `validate_indb.py`:
- Fetch IFCT 2017 compositions JSON from `nodef/ifct2017` raw GitHub (ground truth) → cache in `scripts/data/`.
- Match a sample of INDB ingredients to IFCT entries by normalized name.
- For matched pairs, compare `calories/proteins/iron/calcium`; flag deviation > ±10%.
- Run unit/sanity checks on ALL rows: no negative/NaN, µg vs mg ranges plausible, no duplicate `name|source`.
- Write `VALIDATION.md`: match count, %-within-tolerance, list of outliers, sanity-check pass/fail.

**Step 2:** Run: `python3 nutritrace/scripts/validate_indb.py`
Expected: GATE — ≥80% of matched ingredients within ±10%, 0 sanity-check failures. If gate fails, STOP and report (do not seed).

**Step 3:** Commit: `test: add IFCT-2017 accuracy validation + report for INDB data`.

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
**Step 3:** Implement `seed-indb.js`: prepared INSERTs mirroring `routes/foods.js` columns; dedupe by `name|brand` (foods) / `name` (meals); apply `classify.js`; provenance into `notes`; accept `{ db, ownerId }` for testability.
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
