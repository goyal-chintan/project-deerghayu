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

// Sample IFCT-style food objects for testing
const sampleFoods = [
  {
    name: 'Test Spinach',
    scientific: 'Spinacia oleracea',
    source: 'IFCT 2017',
    code: 'T001',
    group: 'Green Leafy Vegetables',
    diet_type: 'vegetarian',
    nutrition: { calories: 23, proteins: 2.9, fat: 0.4, fiber: 2.2 },
  },
  {
    name: 'Test Chicken',
    scientific: 'Gallus gallus domesticus',
    source: 'IFCT 2017',
    code: 'T002',
    group: 'Poultry',
    diet_type: 'non-vegetarian',
    nutrition: { calories: 239, proteins: 27.3, fat: 13.6 },
  },
  {
    name: 'Test Almond',
    scientific: 'Prunus amygdalus',
    source: 'IFCT 2017',
    code: 'T003',
    group: 'Nuts and Oil Seeds',
    diet_type: 'vegetarian',
    nutrition: { calories: 609, proteins: 18.4, fat: 58.5, fiber: 13.1 },
  },
];

// Sample INDB-style recipe objects for testing
const sampleRecipes = [
  {
    name: 'Test Chicken Biryani',
    source: 'INDB 2024.11',
    code: 'TST001',
    primarysource: 'test_manual',
    serving_unit: 'plate',
    serving_grams: 250,
    basis: 'per_serving',
    nutrition: { calories: 450, proteins: 25, fat: 18, carbohydrates: 52 },
  },
  {
    name: 'Test Palak Paneer',
    source: 'INDB 2024.11',
    code: 'TST002',
    primarysource: 'test_manual',
    serving_unit: 'bowl',
    serving_grams: 200,
    basis: 'per_serving',
    nutrition: { calories: 280, proteins: 12, fat: 20, carbohydrates: 10 },
  },
  {
    name: 'Test Egg Curry',
    source: 'INDB 2024.11',
    code: 'TST003',
    primarysource: 'test_manual',
    serving_unit: null,
    serving_grams: null,
    basis: 'per_100g',
    nutrition: { calories: 150, proteins: 10, fat: 8, carbohydrates: 5 },
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

  describe('seedFoods', () => {
    // Lazy import to avoid circular issues with db.js initialization
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

      // Verify nutrition round-trips
      const nutrition = JSON.parse(spinach.nutrition);
      assert.equal(nutrition.calories, 23);
      assert.equal(nutrition.proteins, 2.9);
    });

    it('is idempotent: re-run updates without inserting duplicates', () => {
      // Modify one nutrition value to prove update works
      const modified = sampleFoods.map(f => {
        if (f.code === 'T001') {
          return { ...f, nutrition: { ...f.nutrition, calories: 25 } };
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
      const badDiet = [{ ...sampleFoods[0], code: 'T099', diet_type: 'pescatarian' }];
      seedFoods(db, ownerId, badDiet);
      const row = db.prepare(`SELECT diet_type FROM foods WHERE user_id = ? AND barcode = 'T099'`).get(ownerId);
      assert.equal(row.diet_type, 'vegetarian');
    });
  });

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
    });

    it('creates rows with correct column values', () => {
      const rows = db.prepare(
        `SELECT * FROM meals WHERE user_id = ? AND is_recipe = 1 ORDER BY name`
      ).all(ownerId);

      assert.equal(rows.length, 3);

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
      assert.equal(egg.portion, 100); // serving_grams is null → defaults to 100
    });

    it('is idempotent: re-run updates without inserting duplicates', () => {
      // Modify a nutrition value
      const modified = sampleRecipes.map(r => {
        if (r.name === 'Test Chicken Biryani') {
          return { ...r, nutrition: { ...r.nutrition, calories: 500 } };
        }
        return r;
      });

      const result = seedRecipes(db, ownerId, modified);
      assert.equal(result.inserted, 0);
      assert.equal(result.updated, 3);

      // Row count unchanged
      const count = db.prepare(
        `SELECT COUNT(*) as c FROM meals WHERE user_id = ? AND is_recipe = 1`
      ).get(ownerId);
      assert.equal(count.c, 3);

      // Value was updated
      const row = db.prepare(
        `SELECT nutrition FROM meals WHERE user_id = ? AND name = 'Test Chicken Biryani'`
      ).get(ownerId);
      const n = JSON.parse(row.nutrition);
      assert.equal(n.calories, 500);
    });
  });
});
