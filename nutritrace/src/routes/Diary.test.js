import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./Diary.svelte', import.meta.url), 'utf8');

test('diary consumes nutrient quick-add handoff from session storage', () => {
  assert.match(source, /sessionStorage\.getItem\(['"]nt:quickAdd['"]\)/);
  assert.match(source, /sessionStorage\.removeItem\(['"]nt:quickAdd['"]\)/);
  assert.match(source, /addDiaryItem\(/);
  assert.match(source, /Food added to today/);
});
