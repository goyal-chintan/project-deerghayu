/**
 * supported-nutrients.test.js — Verify the canonical JSON list matches
 * the NUTRIMENTS array exported from src/lib/nutrition.js.
 *
 * Run: cd nutritrace/server && node --test seed/supported-nutrients.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the canonical source-of-truth from the app
import { NUTRIMENTS } from '../../src/lib/nutrition.js';

// Load the committed JSON id list
const idsPath = join(__dirname, 'data', 'supported-nutrient-ids.json');
const jsonIds = JSON.parse(readFileSync(idsPath, 'utf-8'));

describe('supported-nutrient-ids.json', () => {
  it('has exactly 34 nutrients', () => {
    assert.equal(jsonIds.length, 34);
  });

  it('matches NUTRIMENTS ids in exact order', () => {
    const jsIds = NUTRIMENTS.map(n => n.id);
    assert.deepEqual(jsonIds, jsIds);
  });

  it('contains no duplicates', () => {
    const unique = new Set(jsonIds);
    assert.equal(unique.size, jsonIds.length);
  });

  it('every entry is a non-empty string', () => {
    for (const id of jsonIds) {
      assert.equal(typeof id, 'string');
      assert.ok(id.length > 0, `empty id found`);
    }
  });
});
