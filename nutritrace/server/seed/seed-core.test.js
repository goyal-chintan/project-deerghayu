/**
 * seed-core.test.js — Integration tests for seedFoods and seedRecipes.
 *
 * Uses node:test + node:assert/strict. Creates a temp database with full
 * schema (via dynamic import of db.js) and exercises the seeding logic.
 *
 * Run: node --test seed/seed-core.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Generate a unique temp db path to avoid collisions with parallel runs
const tempDbPath = join(tmpdir(), `nutritrace-test-${randomBytes(4).toString('hex')}.db`);

let db;
let ownerId;

// ── Helper: build a complete nutrition object with all 34 supported keys ──
function completeNutrition(overrides = {}) {
  return {
    calories: 0, kilojoules: 0, fat: 0, 'saturated-fat': 0, 'trans-fat': 0,
    'polyunsaturated-fat': 0, 'monounsaturated-fat': 0, cholesterol: 0,
    sodium: 0, salt: 0, carbohydrates: 0, fiber: 0, sugars: 0,
    'added-sugars': 0, proteins: 0, 'vitamin-d': 0, calcium: 0, iron: 0,
    potassium: 0, 'vitamin-a': 0, 'vitamin-c': 0, 'vitamin-e': 0,
    'vitamin-k': 0, b1: 0, b2: 0, b3: 0, b6: 0, b9: 0, b12: 0,
    magnesium: 0, zinc: 0, phosphorus: 0, caffeine: 0, alcohol: 0,
    ...overrides,
  };
}

// Sample IFCT-style food objects for testing (complete nutrition)
const sampleFoods = [
  {
    name: 'Test Spinach',
    scientific: 'Spinacia oleracea',
    source: 'IFCT 2017',
    code: 'T001',
    group: 'Green Leafy Vegetables',
    diet_type: 'vegetarian',
    nutrition: completeNutrition({ calories: 23, proteins: 2.9, fat: 0.4, fiber: 2.2 }),
  },
  {
    name: 'Test Chicken',
    scientific: 'Gallus gallus domesticus',
    source: 'IFCT 2017',
    code: 'T002',
    group: 'Poultry',
    diet_type: 'non-vegetarian',
    nutrition: completeNutrition({ calories: 239, proteins: 27.3, fat: 13.6 }),
  },
  {
    name: 'Test Almond',
    scientific: 'Prunus amygdalus',
    source: 'IFCT 2017',
    code: 'T003',
    group: 'Nuts and Oil Seeds',
    diet_type: 'vegetarian',
    nutrition: completeNutrition({ calories: 609, proteins: 18.4, fat: 58.5, fiber: 13.1 }),
  },
];

// Sample INDB-style recipe objects for testing (complete nutrition)
const sampleRecipes = [
  {
    name: 'Test Chicken Biryani',
    source: 'INDB 2024.11',
    code: 'TST001',
    primarysource: 'test_manual',
    serving_unit: 'plate',
    serving_grams: 250,
    basis: 'per_serving',
    nutrition: completeNutrition({ calories: 450, proteins: 25, fat: 18, carbohydrates: 52 }),
  },
  {
    name: 'Test Palak Paneer',
    source: 'INDB 2024.11',
    code: 'TST002',
    primarysource: 'test_manual',
    serving_unit: 'bowl',
    serving_grams: 200,
    basis: 'per_serving',
    nutrition: completeNutrition({ calories: 280, proteins: 12, fat: 20, carbohydrates: 10 }),
  },
  {
    name: 'Test Egg Curry',
    source: 'INDB 2024.11',
    code: 'TST003',
    primarysource: 'test_manual',
    serving_unit: null,
    serving_grams: null,
    basis: 'per_100g',
    nutrition: completeNutrition({ calories: 150, proteins: 10, fat: 8, carbohydrates: 5 }),
  },
];

describe('seed-core integration', () => {

  before(async () => {
    // Point db.js at our temp database
    process.env.DB_PATH = tempDbPath;

    // Dynamic import triggers schema creation + migrations
    const mod = await import('../db.js');
    db = mod.default;

    // Create a test user
    db.prepare(
      `INSERT INTO users (username, password_hash) VALUES (?, ?)`
    ).run('tester', 'hash_placeholder');

    const user = db.prepare(`SELECT id FROM users WHERE username = 'tester'`).get();
    ownerId = user.id;
  });

  after(() => {
    // Close db and remove temp files
    try { db.close(); } catch {}
    for (const suffix of ['', '-shm', '-wal']) {
      const p = tempDbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  // ── validateNutrition ───────────────────────────────────────────────────
  describe('validateNutrition', () => {
    let validateNutrition;

    before(async () => {
      const mod = await import('./seed-core.js');
      validateNutrition = mod.validateNutrition;
    });

    it('returns null for a complete valid nutrition object', () => {
      const result = validateNutrition(completeNutrition(), 'test');
      assert.equal(result, null);
    });

    it('rejects missing keys', () => {
      const partial = { calories: 100, proteins: 5 }; // missing most keys
      const result = validateNutrition(partial, 'test');
      assert.ok(result);
      assert.match(result, /missing:/);
      assert.match(result, /fat/);
    });

    it('rejects extra unsupported keys', () => {
      const withExtra = { ...completeNutrition(), 'omega-3': 1.5, 'copper': 0.2 };
      const result = validateNutrition(withExtra, 'test');
      assert.ok(result);
      assert.match(result, /extra:/);
      assert.match(result, /omega-3/);
    });

    it('rejects null/undefined nutrition', () => {
      assert.ok(validateNutrition(null, 'test'));
      assert.ok(validateNutrition(undefined, 'test'));
    });

    it('rejects non-object nutrition', () => {
      assert.ok(validateNutrition('string', 'test'));
      assert.ok(validateNutrition(42, 'test'));
    });
  });

  // ── seedFoods ───────────────────────────────────────────────────────────
  describe('seedFoods', () => {
    let seedFoods;

    before(async () => {
      const mod = await import('./seed-core.js');
      seedFoods = mod.seedFoods;
    });

    it('throws when ownerId is missing', () => {
      assert.throws(() => seedFoods(db, null, []), /ownerId is required/);
      assert.throws(() => seedFoods(db, undefined, []), /ownerId is required/);
    });

    it('inserts foods on first run', () => {
      const result = seedFoods(db, ownerId, sampleFoods);
      assert.equal(result.inserted, 3);
      assert.equal(result.updated, 0);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.errors, []);
    });

    it('creates rows with correct column values', () => {
      const rows = db.prepare(
        `SELECT * FROM foods WHERE user_id = ? AND barcode IN ('T001','T002','T003') ORDER BY barcode`
      ).all(ownerId);

      assert.equal(rows.length, 3);

      // Check spinach row
      const spinach = rows[0];
      assert.equal(spinach.name, 'Test Spinach');
      assert.equal(spinach.brand, 'IFCT 2017');
      assert.equal(spinach.portion, 100);
      assert.equal(spinach.unit, 'g');
      assert.equal(spinach.category, 'Green Leafy Vegetables');
      assert.equal(spinach.barcode, 'T001');
      assert.equal(spinach.diet_type, 'vegetarian');
      assert.equal(spinach.visibility, 'group');
      assert.match(spinach.notes, /IFCT 2017 \(ICMR-NIN\), code T001/);
      assert.match(spinach.notes, /Spinacia oleracea/);

      // Verify nutrition round-trips with all 34 keys
      const nutrition = JSON.parse(spinach.nutrition);
      assert.equal(nutrition.calories, 23);
      assert.equal(nutrition.proteins, 2.9);
      assert.equal(Object.keys(nutrition).length, 34);
    });

    it('does not store nutrition_meta in DB', () => {
      // Seed a food that has nutrition_meta in its source object
      const foodWithMeta = [{
        name: 'Test Meta Food',
        scientific: 'Testus metaicus',
        source: 'IFCT 2017',
        code: 'TMETA',
        group: 'Test',
        diet_type: 'vegetarian',
        nutrition: completeNutrition({ calories: 50 }),
        nutrition_meta: {
          calories: { status: 'sourced', source: 'IFCT 2017' },
          fat: { status: 'estimated', source: 'USDA' },
        },
      }];

      seedFoods(db, ownerId, foodWithMeta);
      const row = db.prepare(`SELECT nutrition FROM foods WHERE user_id = ? AND barcode = 'TMETA'`).get(ownerId);
      const parsed = JSON.parse(row.nutrition);

      // nutrition_meta must not appear as a key
      assert.equal('nutrition_meta' in parsed, false);
      // No nested objects — all values should be numbers
      for (const [key, val] of Object.entries(parsed)) {
        assert.equal(typeof val, 'number', `${key} should be a number, got ${typeof val}`);
      }
    });

    it('rejects foods with incomplete nutrition (missing keys)', () => {
      const incomplete = [{
        name: 'Incomplete Food',
        code: 'TINC',
        group: 'Test',
        diet_type: 'vegetarian',
        nutrition: { calories: 100, proteins: 5 }, // missing 32 keys
      }];

      const result = seedFoods(db, ownerId, incomplete);
      assert.equal(result.inserted, 0);
      assert.equal(result.skipped, 1);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /missing:/);

      // Verify nothing was written
      const row = db.prepare(`SELECT id FROM foods WHERE user_id = ? AND barcode = 'TINC'`).get(ownerId);
      assert.equal(row, undefined);
    });

    it('rejects foods with extra unsupported nutrition keys', () => {
      const extraKeys = [{
        name: 'Extra Keys Food',
        code: 'TEXTRA',
        group: 'Test',
        diet_type: 'vegetarian',
        nutrition: { ...completeNutrition({ calories: 200 }), 'omega-3': 1.5 },
      }];

      const result = seedFoods(db, ownerId, extraKeys);
      assert.equal(result.inserted, 0);
      assert.equal(result.skipped, 1);
      assert.match(result.errors[0], /extra:.*omega-3/);
    });

    it('is idempotent: re-run updates without inserting duplicates', () => {
      // Modify one nutrition value to prove update works
      const modified = sampleFoods.map(f => {
        if (f.code === 'T001') {
          return { ...f, nutrition: completeNutrition({ ...f.nutrition, calories: 25 }) };
        }
        return f;
      });

      const result = seedFoods(db, ownerId, modified);
      assert.equal(result.inserted, 0);
      assert.equal(result.updated, 3);

      // Total row count unchanged
      const count = db.prepare(
        `SELECT COUNT(*) as c FROM foods WHERE user_id = ? AND barcode IN ('T001','T002','T003')`
      ).get(ownerId);
      assert.equal(count.c, 3);

      // Value was updated
      const row = db.prepare(`SELECT nutrition FROM foods WHERE user_id = ? AND barcode = 'T001'`).get(ownerId);
      const n = JSON.parse(row.nutrition);
      assert.equal(n.calories, 25);
    });

    it('defaults invalid diet_type to vegetarian', () => {
      const badDiet = [{
        ...sampleFoods[0],
        code: 'T099',
        diet_type: 'pescatarian',
        nutrition: completeNutrition({ calories: 10 }),
      }];
      seedFoods(db, ownerId, badDiet);
      const row = db.prepare(`SELECT diet_type FROM foods WHERE user_id = ? AND barcode = 'T099'`).get(ownerId);
      assert.equal(row.diet_type, 'vegetarian');
    });
  });

  // ── seedRecipes ─────────────────────────────────────────────────────────
  describe('seedRecipes', () => {
    let seedRecipes;

    before(async () => {
      const mod = await import('./seed-core.js');
      seedRecipes = mod.seedRecipes;
    });

    it('throws when ownerId is missing', () => {
      assert.throws(() => seedRecipes(db, null, []), /ownerId is required/);
    });

    it('inserts recipes on first run', () => {
      const result = seedRecipes(db, ownerId, sampleRecipes);
      assert.equal(result.inserted, 3);
      assert.equal(result.updated, 0);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.errors, []);
    });

    it('creates rows with correct column values', () => {
      const rows = db.prepare(
        `SELECT * FROM meals WHERE user_id = ? AND is_recipe = 1 ORDER BY name`
      ).all(ownerId);

      assert.ok(rows.length >= 3);

      // Check chicken biryani
      const biryani = rows.find(r => r.name === 'Test Chicken Biryani');
      assert.ok(biryani);
      assert.equal(biryani.is_recipe, 1);
      assert.equal(biryani.servings, 1);
      assert.equal(biryani.portion, 250);
      assert.equal(biryani.unit, 'g');
      assert.equal(biryani.diet_type, 'non-vegetarian'); // from classifyDiet
      assert.equal(biryani.visibility, 'group');
      assert.match(biryani.notes, /INDB 2024\.11, code TST001/);
      assert.match(biryani.notes, /1 plate \(~250 g\)/);
      assert.equal(biryani.items, '[]');

      // Check paneer (vegetarian)
      const paneer = rows.find(r => r.name === 'Test Palak Paneer');
      assert.equal(paneer.diet_type, 'vegetarian');

      // Check egg curry (eggetarian, null serving → portion=100)
      const egg = rows.find(r => r.name === 'Test Egg Curry');
      assert.equal(egg.diet_type, 'eggetarian');
      assert.equal(egg.portion, 100);
    });

    it('does not store nutrition_meta in DB', () => {
      const recipeWithMeta = [{
        name: 'Test Meta Recipe',
        source: 'INDB 2024.11',
        code: 'TSTMETA',
        serving_unit: null,
        serving_grams: null,
        nutrition: completeNutrition({ calories: 300 }),
        nutrition_meta: {
          calories: { status: 'sourced', source: 'INDB 2024.11' },
        },
      }];

      seedRecipes(db, ownerId, recipeWithMeta);
      const row = db.prepare(
        `SELECT nutrition FROM meals WHERE user_id = ? AND name = 'Test Meta Recipe'`
      ).get(ownerId);
      const parsed = JSON.parse(row.nutrition);

      assert.equal('nutrition_meta' in parsed, false);
      for (const [key, val] of Object.entries(parsed)) {
        assert.equal(typeof val, 'number', `${key} should be a number, got ${typeof val}`);
      }
    });

    it('rejects recipes with incomplete nutrition', () => {
      const incomplete = [{
        name: 'Incomplete Recipe',
        code: 'TSTINC',
        serving_unit: null,
        serving_grams: null,
        nutrition: { calories: 100, fat: 5 }, // missing most keys
      }];

      const result = seedRecipes(db, ownerId, incomplete);
      assert.equal(result.inserted, 0);
      assert.equal(result.skipped, 1);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /missing:/);
    });

    it('is idempotent: re-run updates seed-owned recipes', () => {
      // Modify a nutrition value
      const modified = sampleRecipes.map(r => {
        if (r.name === 'Test Chicken Biryani') {
          return { ...r, nutrition: completeNutrition({ calories: 500, proteins: 25, fat: 18, carbohydrates: 52 }) };
        }
        return r;
      });

      const result = seedRecipes(db, ownerId, modified);
      assert.equal(result.inserted, 0);
      assert.equal(result.updated, 3);

      // Value was updated
      const row = db.prepare(
        `SELECT nutrition FROM meals WHERE user_id = ? AND name = 'Test Chicken Biryani'`
      ).get(ownerId);
      const n = JSON.parse(row.nutrition);
      assert.equal(n.calories, 500);
    });

    it('skips user-created recipes with same name (no INDB provenance)', () => {
      // Insert a user-created recipe (no INDB notes)
      db.prepare(`
        INSERT INTO meals (user_id, name, nutrition, is_recipe, servings, portion, unit, diet_type, visibility, notes, items, updated_at, created_at)
        VALUES (?, 'User Dosa Recipe', '{"calories":200}', 1, 1, 100, 'g', 'vegetarian', 'private', 'My family recipe', '[]', datetime('now'), datetime('now'))
      `).run(ownerId);

      // Now try to seed a recipe with the same name
      const conflicting = [{
        name: 'User Dosa Recipe',
        code: 'TSTCONF',
        serving_unit: null,
        serving_grams: null,
        nutrition: completeNutrition({ calories: 180 }),
      }];

      const result = seedRecipes(db, ownerId, conflicting);
      assert.equal(result.inserted, 0);
      assert.equal(result.updated, 0);
      assert.equal(result.skipped, 1);

      // Verify user's recipe was NOT modified
      const row = db.prepare(
        `SELECT nutrition, notes FROM meals WHERE user_id = ? AND name = 'User Dosa Recipe'`
      ).get(ownerId);
      assert.equal(row.notes, 'My family recipe');
      assert.equal(JSON.parse(row.nutrition).calories, 200);
    });

    it('updates seed-owned recipe even when name matches (has INDB provenance)', () => {
      // Insert a seed-owned recipe with INDB provenance in notes
      db.prepare(`
        INSERT INTO meals (user_id, name, nutrition, is_recipe, servings, portion, unit, diet_type, visibility, notes, items, updated_at, created_at)
        VALUES (?, 'Seeded Dal Fry', '{"calories":100}', 1, 1, 100, 'g', 'vegetarian', 'group', 'INDB 2024.11, code SEED01', '[]', datetime('now'), datetime('now'))
      `).run(ownerId);

      const updateRecipe = [{
        name: 'Seeded Dal Fry',
        code: 'SEED01',
        serving_unit: 'bowl',
        serving_grams: 200,
        nutrition: completeNutrition({ calories: 150, proteins: 8 }),
      }];

      const result = seedRecipes(db, ownerId, updateRecipe);
      assert.equal(result.updated, 1);
      assert.equal(result.skipped, 0);

      // Verify it was updated
      const row = db.prepare(
        `SELECT nutrition, portion FROM meals WHERE user_id = ? AND name = 'Seeded Dal Fry'`
      ).get(ownerId);
      const n = JSON.parse(row.nutrition);
      assert.equal(n.calories, 150);
      assert.equal(row.portion, 200);
    });

    it('skips recipe when existing row has empty/null notes (no provenance)', () => {
      // Insert a recipe with null notes
      db.prepare(`
        INSERT INTO meals (user_id, name, nutrition, is_recipe, servings, portion, unit, diet_type, visibility, notes, items, updated_at, created_at)
        VALUES (?, 'Null Notes Recipe', '{"calories":99}', 1, 1, 100, 'g', 'vegetarian', 'private', NULL, '[]', datetime('now'), datetime('now'))
      `).run(ownerId);

      const conflicting = [{
        name: 'Null Notes Recipe',
        code: 'TSTNULL',
        serving_unit: null,
        serving_grams: null,
        nutrition: completeNutrition({ calories: 200 }),
      }];

      const result = seedRecipes(db, ownerId, conflicting);
      assert.equal(result.skipped, 1);
      assert.equal(result.updated, 0);

      // Original unchanged
      const row = db.prepare(
        `SELECT nutrition FROM meals WHERE user_id = ? AND name = 'Null Notes Recipe'`
      ).get(ownerId);
      assert.equal(JSON.parse(row.nutrition).calories, 99);
    });
  });
});
