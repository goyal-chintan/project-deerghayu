/**
 * seed-native.js — Seeds IFCT ingredients and INDB recipes into the
 * on-device SQLite database on first install.
 *
 * Called from db-native.js after schema initialisation.
 * Idempotent: uses the IFCT code (barcode column) and recipe name
 * as identity keys, identical to the server-side seeder logic.
 *
 * Data source: static JSON files served from /seed-data/ in the web assets
 * bundle. No server required.
 */

const SEED_FLAG_KEY = 'nt:seed_indian_v1';
const SEED_DATA_BASE = '/seed-data/';

async function _fetchJson(filename) {
  const res = await fetch(SEED_DATA_BASE + filename);
  if (!res.ok) throw new Error(`Failed to load ${filename}: ${res.status}`);
  return res.json();
}

const INDB_PROVENANCE_RE = /INDB 2024\.11, code \S+/;

export async function seedNativeIfNeeded(db) {
  // Only seed once per install
  const flag = localStorage.getItem(SEED_FLAG_KEY);
  if (flag === 'done') return;

  console.log('[seed-native] First launch — seeding Indian food library...');
  try {
    const [foods, recipes] = await Promise.all([
      _fetchJson('ifct-foods.json'),
      _fetchJson('indb-recipes.json'),
    ]);

    // --- Seed IFCT ingredients ---
    let fInserted = 0, fUpdated = 0;
    for (const food of foods) {
      try {
        const exists = await db.query(
          `SELECT id FROM foods WHERE user_id = 1 AND barcode = ?`, [food.code]
        );
        const nutritionJson = JSON.stringify(food.nutrition || {});
        const notes = `IFCT 2017 (ICMR-NIN), code ${food.code}${food.scientific ? ' — ' + food.scientific : ''}`;
        const dietType = food.diet_type || 'vegetarian';
        const category = food.group || null;

        if (exists?.values?.length) {
          await db.run(
            `UPDATE foods SET name=?, brand='IFCT 2017', nutrition=?, portion=100, unit='g',
             category=?, diet_type=?, visibility='group', notes=?, updated_at=datetime('now')
             WHERE user_id=1 AND barcode=?`,
            [food.name, nutritionJson, category, dietType, notes, food.code]
          );
          fUpdated++;
        } else {
          await db.run(
            `INSERT INTO foods (user_id, name, brand, nutrition, portion, unit, category, barcode,
             diet_type, visibility, notes, sync_status, updated_at, created_at)
             VALUES (1, ?, 'IFCT 2017', ?, 100, 'g', ?, ?, ?, 'group', ?, 'synced', datetime('now'), datetime('now'))`,
            [food.name, nutritionJson, category, food.code, dietType, notes]
          );
          fInserted++;
        }
      } catch (e) {
        console.warn(`[seed-native] Food "${food.name}" skipped:`, e?.message);
      }
    }

    // --- Seed INDB recipes ---
    let rInserted = 0, rUpdated = 0;
    for (const recipe of recipes) {
      try {
        const exists = await db.query(
          `SELECT id, notes FROM meals WHERE user_id = 1 AND is_recipe = 1 AND name = ?`, [recipe.name]
        );
        const nutritionJson = JSON.stringify(recipe.nutrition || {});
        const portion = recipe.serving_grams ?? 100;
        const notes = `INDB 2024.11, code ${recipe.code}` +
          (recipe.serving_unit && recipe.serving_grams != null
            ? ` · 1 ${recipe.serving_unit} (~${recipe.serving_grams} g)` : '');
        // Simple diet classifier: non-veg keywords
        const name = recipe.name.toLowerCase();
        const isNonVeg = /chicken|mutton|fish|prawn|beef|pork|egg|lamb|crab|shrimp|keema|kheema|gosht|meat/.test(name);
        const dietType = isNonVeg ? 'non-vegetarian' : 'vegetarian';

        if (exists?.values?.length) {
          const existingNotes = exists.values[0]?.notes || '';
          if (!INDB_PROVENANCE_RE.test(existingNotes)) {
            // User-created recipe with same name — skip
            continue;
          }
          await db.run(
            `UPDATE meals SET nutrition=?, is_recipe=1, servings=1, portion=?, unit='g',
             diet_type=?, visibility='group', notes=?, items='[]', updated_at=datetime('now')
             WHERE user_id=1 AND is_recipe=1 AND name=?`,
            [nutritionJson, portion, dietType, notes, recipe.name]
          );
          rUpdated++;
        } else {
          await db.run(
            `INSERT INTO meals (user_id, name, nutrition, is_recipe, servings, portion, unit,
             diet_type, visibility, notes, items, sync_status, updated_at, created_at)
             VALUES (1, ?, ?, 1, 1, ?, 'g', ?, 'group', ?, '[]', 'synced', datetime('now'), datetime('now'))`,
            [recipe.name, nutritionJson, portion, dietType, notes]
          );
          rInserted++;
        }
      } catch (e) {
        console.warn(`[seed-native] Recipe "${recipe.name}" skipped:`, e?.message);
      }
    }

    console.log(`[seed-native] Done: ${fInserted} foods inserted, ${fUpdated} updated; ${rInserted} recipes inserted, ${rUpdated} updated`);
    localStorage.setItem(SEED_FLAG_KEY, 'done');
  } catch (e) {
    console.error('[seed-native] Seeding failed (app still works):', e);
    // Don't set the flag — allow retry on next launch
  }
}
