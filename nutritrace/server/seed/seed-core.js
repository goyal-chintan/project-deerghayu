/**
 * seed-core.js — Pure, testable seeding logic for IFCT foods and INDB recipes.
 *
 * Operates on a passed better-sqlite3 `db` handle — does NOT import db.js
 * itself. This keeps the module testable with isolated temp databases.
 *
 * Both functions are idempotent: they UPSERT based on stable identity keys
 * so re-running the seeder never creates duplicates.
 */

import { classifyDiet } from './classify.js';

// Canonical diet types from the app (routes/foods.js line 16).
const VALID_DIET_TYPES = ['vegetarian', 'non-vegetarian', 'vegan', 'eggetarian'];

/**
 * Seed IFCT ingredients into the `foods` table.
 *
 * Idempotency key: (user_id, barcode) — IFCT codes are globally unique
 * identifiers that map 1:1 to the `barcode` column. This allows us to
 * detect existing rows and UPDATE rather than INSERT duplicates.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} ownerId — user_id to own these foods
 * @param {Array} foods — array of IFCT food objects from ifct-foods.json
 * @returns {{inserted: number, updated: number}}
 */
export function seedFoods(db, ownerId, foods) {
  if (!ownerId && ownerId !== 0) {
    throw new Error('seedFoods: ownerId is required (got ' + ownerId + ')');
  }

  const findExisting = db.prepare(
    `SELECT id FROM foods WHERE user_id = ? AND barcode = ?`
  );

  const insertStmt = db.prepare(`
    INSERT INTO foods (user_id, name, brand, nutrition, portion, unit, category, barcode, diet_type, visibility, notes, updated_at, created_at)
    VALUES (?, ?, ?, ?, 100, 'g', ?, ?, ?, 'group', ?, datetime('now'), datetime('now'))
  `);

  const updateStmt = db.prepare(`
    UPDATE foods
    SET name = ?, brand = ?, nutrition = ?, portion = 100, unit = 'g',
        category = ?, diet_type = ?, visibility = 'group', notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;

  const run = db.transaction(() => {
    for (const food of foods) {
      const code = food.code;
      const name = food.name;
      const nutritionJson = JSON.stringify(food.nutrition || {});
      const category = food.group || null;
      const brand = 'IFCT 2017';

      // Validate diet_type: use provided value if canonical, else default
      let dietType = food.diet_type;
      if (!dietType || !VALID_DIET_TYPES.includes(dietType)) {
        dietType = 'vegetarian';
      }

      // Build human-readable citation note
      let notes = `IFCT 2017 (ICMR-NIN), code ${code}`;
      if (food.scientific) {
        notes += ` — ${food.scientific}`;
      }

      // visibility='group' makes these foods visible in the group catalogue
      // so all family members can search & use them without duplicating.

      const existing = findExisting.get(ownerId, code);
      if (existing) {
        updateStmt.run(name, brand, nutritionJson, category, dietType, notes, existing.id);
        updated++;
      } else {
        insertStmt.run(ownerId, name, brand, nutritionJson, category, code, dietType, notes);
        inserted++;
      }
    }
  });

  run();
  return { inserted, updated };
}

/**
 * Seed INDB recipes into the `meals` table with is_recipe=1.
 *
 * Idempotency key: (user_id, is_recipe=1, name) — INDB recipe names are
 * guaranteed unique within the dataset. We use name (not code) because
 * the meals table has no barcode column, and name is the stable identity.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} ownerId — user_id to own these recipes
 * @param {Array} recipes — array of INDB recipe objects from indb-recipes.json
 * @returns {{inserted: number, updated: number}}
 */
export function seedRecipes(db, ownerId, recipes) {
  if (!ownerId && ownerId !== 0) {
    throw new Error('seedRecipes: ownerId is required (got ' + ownerId + ')');
  }

  const findExisting = db.prepare(
    `SELECT id FROM meals WHERE user_id = ? AND is_recipe = 1 AND name = ?`
  );

  const insertStmt = db.prepare(`
    INSERT INTO meals (user_id, name, nutrition, is_recipe, servings, portion, unit, diet_type, visibility, notes, items, updated_at, created_at)
    VALUES (?, ?, ?, 1, 1, ?, 'g', ?, 'group', ?, '[]', datetime('now'), datetime('now'))
  `);

  const updateStmt = db.prepare(`
    UPDATE meals
    SET nutrition = ?, is_recipe = 1, servings = 1, portion = ?, unit = 'g',
        diet_type = ?, visibility = 'group', notes = ?, items = '[]', updated_at = datetime('now')
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;

  const run = db.transaction(() => {
    for (const recipe of recipes) {
      const name = recipe.name;
      const nutritionJson = JSON.stringify(recipe.nutrition || {});
      const portion = recipe.serving_grams ?? 100;
      const dietType = classifyDiet(name);

      // Build human-readable citation note
      let notes = `INDB 2024.11, code ${recipe.code}`;
      if (recipe.serving_unit && recipe.serving_grams != null) {
        notes += ` · 1 ${recipe.serving_unit} (~${recipe.serving_grams} g)`;
      }

      const existing = findExisting.get(ownerId, name);
      if (existing) {
        updateStmt.run(nutritionJson, portion, dietType, notes, existing.id);
        updated++;
      } else {
        insertStmt.run(ownerId, name, nutritionJson, portion, dietType, notes);
        inserted++;
      }
    }
  });

  run();
  return { inserted, updated };
}
