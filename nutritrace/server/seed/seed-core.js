/**
 * seed-core.js — Pure, testable seeding logic for IFCT foods and INDB recipes.
 *
 * Operates on a passed better-sqlite3 `db` handle — does NOT import db.js
 * itself. This keeps the module testable with isolated temp databases.
 *
 * Both functions are idempotent: they UPSERT based on stable identity keys
 * so re-running the seeder never creates duplicates.
 *
 * Safety invariants:
 * - Only `record.nutrition` (numeric values) is serialized to DB; `nutrition_meta` is never stored.
 * - Every record must contain ALL supported nutrient keys (no missing, no extra).
 * - Recipes only update existing rows that have INDB provenance in their notes;
 *   user-created recipes with the same name are never overwritten.
 */

import { classifyDiet } from './classify.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Canonical set of nutrient IDs — source of truth for validation.
const SUPPORTED_NUTRIENT_IDS = JSON.parse(
  readFileSync(join(__dirname, 'data', 'supported-nutrient-ids.json'), 'utf-8')
);
const SUPPORTED_SET = new Set(SUPPORTED_NUTRIENT_IDS);

// Canonical diet types from the app (routes/foods.js line 16).
const VALID_DIET_TYPES = ['vegetarian', 'non-vegetarian', 'vegan', 'eggetarian'];

// Pattern identifying seed-owned recipe rows (INDB provenance in notes).
const INDB_PROVENANCE_RE = /INDB 2024\.11, code \S+/;

/**
 * Validate that a nutrition object contains exactly the supported nutrient keys,
 * and that every value is a finite non-negative number (rejects null, undefined,
 * NaN, Infinity, booleans, strings, objects, and negative numbers).
 *
 * Returns null if valid, or an error string describing the problem.
 *
 * @param {object} nutrition — nutrition object from seed record
 * @param {string} label — human-readable identifier for error messages
 * @returns {string|null}
 */
export function validateNutrition(nutrition, label) {
  if (!nutrition || typeof nutrition !== 'object' || Array.isArray(nutrition)) {
    return `${label}: nutrition is missing or not an object`;
  }
  const keys = Object.keys(nutrition);
  const missing = SUPPORTED_NUTRIENT_IDS.filter(id => !(id in nutrition));
  const extra = keys.filter(k => !SUPPORTED_SET.has(k));
  const invalid = SUPPORTED_NUTRIENT_IDS.filter(id =>
    id in nutrition && (typeof nutrition[id] !== 'number' || !Number.isFinite(nutrition[id]) || nutrition[id] < 0)
  );

  if (missing.length || extra.length || invalid.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (extra.length) parts.push(`extra: ${extra.join(', ')}`);
    if (invalid.length) parts.push(`invalid values: ${invalid.join(', ')}`);
    return `${label}: ${parts.join('; ')}`;
  }
  return null;
}

/**
 * Extract only the supported nutrient keys from a validated record.
 * Must be called AFTER validateNutrition() passes — copies values directly
 * without coercion. Excludes `nutrition_meta` and any unsupported keys.
 *
 * @param {object} record — seed data record with .nutrition (already validated)
 * @returns {object} — clean nutrition object for DB storage
 */
function extractNutrition(record) {
  const source = record.nutrition;
  const clean = {};
  for (const id of SUPPORTED_NUTRIENT_IDS) {
    clean[id] = source[id];
  }
  return clean;
}

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
 * @returns {{inserted: number, updated: number, skipped: number, errors: string[]}}
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
  let skipped = 0;
  const errors = [];

  const run = db.transaction(() => {
    for (const food of foods) {
      const code = food.code;
      const name = food.name;

      // Validate nutrition completeness
      const validationError = validateNutrition(food.nutrition, `food "${name}" (${code})`);
      if (validationError) {
        errors.push(validationError);
        skipped++;
        continue;
      }

      // Extract only supported numeric nutrition keys (never nutrition_meta)
      const nutritionJson = JSON.stringify(extractNutrition(food));
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
  return { inserted, updated, skipped, errors };
}

/**
 * Seed INDB recipes into the `meals` table with is_recipe=1.
 *
 * Idempotency key: (user_id, is_recipe=1, name) — INDB recipe names are
 * guaranteed unique within the dataset. We use name (not code) because
 * the meals table has no barcode column, and name is the stable identity.
 *
 * Conflict protection: if an existing recipe with the same name exists but
 * its notes do NOT contain INDB provenance (`INDB 2024.11, code <code>`),
 * it is treated as a user-created recipe and is never overwritten. The row
 * is skipped and counted as a conflict.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} ownerId — user_id to own these recipes
 * @param {Array} recipes — array of INDB recipe objects from indb-recipes.json
 * @returns {{inserted: number, updated: number, skipped: number, errors: string[], conflicts: Array<{name: string, code: string, reason: string}>}}
 */
export function seedRecipes(db, ownerId, recipes) {
  if (!ownerId && ownerId !== 0) {
    throw new Error('seedRecipes: ownerId is required (got ' + ownerId + ')');
  }

  const findExisting = db.prepare(
    `SELECT id, notes FROM meals WHERE user_id = ? AND is_recipe = 1 AND name = ?`
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
  let skipped = 0;
  const errors = [];
  const conflicts = [];

  const run = db.transaction(() => {
    for (const recipe of recipes) {
      const name = recipe.name;

      // Validate nutrition completeness
      const validationError = validateNutrition(recipe.nutrition, `recipe "${name}" (${recipe.code})`);
      if (validationError) {
        errors.push(validationError);
        skipped++;
        continue;
      }

      // Extract only supported numeric nutrition keys (never nutrition_meta)
      const nutritionJson = JSON.stringify(extractNutrition(recipe));
      const portion = recipe.serving_grams ?? 100;
      const dietType = classifyDiet(name);

      // Build human-readable citation note
      let notes = `INDB 2024.11, code ${recipe.code}`;
      if (recipe.serving_unit && recipe.serving_grams != null) {
        notes += ` · 1 ${recipe.serving_unit} (~${recipe.serving_grams} g)`;
      }

      const existing = findExisting.get(ownerId, name);
      if (existing) {
        // Conflict protection: only update if existing row has INDB provenance
        if (!existing.notes || !INDB_PROVENANCE_RE.test(existing.notes)) {
          // User-created recipe with same name — do not overwrite
          conflicts.push({ name, code: recipe.code, reason: 'existing recipe lacks INDB provenance' });
          skipped++;
          continue;
        }
        updateStmt.run(nutritionJson, portion, dietType, notes, existing.id);
        updated++;
      } else {
        insertStmt.run(ownerId, name, nutritionJson, portion, dietType, notes);
        inserted++;
      }
    }
  });

  run();
  return { inserted, updated, skipped, errors, conflicts };
}
