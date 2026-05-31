import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./Statistics.svelte', import.meta.url), 'utf8');

test('statistics route offers charts and nutrition segmented views', () => {
  assert.match(source, /import NutritionAnalyticsPanel from ['"]\.\.\/components\/nutrition\/NutritionAnalyticsPanel\.svelte['"]/);
  assert.match(source, /let activeStatsView\s*=\s*['"]charts['"]/);
  assert.match(source, /role=['"]tablist['"][\s\S]*aria-label=['"]Statistics view['"]/);
  assert.match(source, />\s*Charts\s*</);
  assert.match(source, />\s*Nutrition\s*</);
  assert.match(source, /on:keydown=\{handleStatsTabKeydown\}/);
  assert.match(source, /tabindex=\{activeStatsView === ['"]charts['"] \? 0 : -1\}/);
  assert.match(source, /tabindex=\{activeStatsView === ['"]nutrition['"] \? 0 : -1\}/);
});

test('statistics route renders charts and nutrition panel in separate views', () => {
  assert.match(source, /\{#if activeStatsView === ['"]charts['"]\}[\s\S]*<canvas bind:this=\{canvasEl\}>[\s\S]*\{:else if activeStatsView === ['"]nutrition['"]\}[\s\S]*<NutritionAnalyticsPanel \/>/);
});

test('statistics chart lifecycle is guarded to the charts view', () => {
  assert.match(source, /function renderChart\(\) \{\s*if \(activeStatsView !== ['"]charts['"] \|\| !canvasEl\) return;/);
  assert.match(source, /if \(activeStatsView === ['"]charts['"] && canvasEl\) loadData\(\);/);
});
