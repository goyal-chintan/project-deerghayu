import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./NutrientExplorer.svelte', import.meta.url), 'utf8');

test('nutrient route presents food-source exploration instead of analytics copy', () => {
  assert.match(source, /food-source|food source|food sources|source explorer/i);
  assert.doesNotMatch(source, /Family nutrition analytics|Plan from nutrient coverage|Nutrient Analytics/);
});

test('nutrient route keeps quick-add handoff to diary', () => {
  assert.match(source, /sessionStorage\.setItem\(['"]nt:quickAdd['"]/);
  assert.match(source, /push\(['"]\/['"]\)/);
});

test('nutrient route has accessible add buttons with 44px hit targets', () => {
  assert.match(source, /aria-label=\{`Add .* to today/);
  assert.match(source, /\.add-btn[\s\S]*?min-height:\s*44px/);
  assert.match(source, /\.add-btn[\s\S]*?min-width:\s*44px/);
});
