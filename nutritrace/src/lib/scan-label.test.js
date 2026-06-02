import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseNutritionTextLocally } from './recipeMatcher.js';
import { Nutrition } from './nutrition.js';

describe('local scan-label parsing', () => {
  it('parses protein-bar label text and keeps per-serving nutrition stable', () => {
    const parsed = parseNutritionTextLocally([
      { text: 'Protein Bar' },
      { text: 'Nutrition Facts' },
      { text: 'Serving Size 60g' },
      { text: 'Calories 220' },
      { text: 'Protein 20g' },
      { text: 'Carbohydrates 23g' },
      { text: 'Total Fat 7g' },
      { text: 'Fiber 8g' },
      { text: 'Sugars 2g' },
      { text: 'Sodium 180mg' },
      { text: 'Ingredients: dates, whey protein, almonds, cocoa' },
    ]);

    assert.equal(parsed.name, 'Protein Bar');
    assert.equal(parsed.portion, 60);
    assert.equal(parsed.unit, 'g');
    assert.equal(parsed.per_serving, true);
    assert.deepEqual(parsed.nutrition, {
      calories: 220,
      proteins: 20,
      carbohydrates: 23,
      fat: 7,
      fiber: 8,
      sugars: 2,
      sodium: 180,
    });
    assert.equal(parsed.ingredientsText, 'dates, whey protein, almonds, cocoa');

    const oneBar = Nutrition.calculate({ nutrition: parsed.nutrition, quantity: 1 });
    assert.equal(oneBar.calories, 220);
    assert.equal(oneBar.proteins, 20);
    assert.equal(oneBar.salt, 0.45);

    const twoBars = Nutrition.calculate({ nutrition: parsed.nutrition, quantity: 2 });
    assert.equal(twoBars.calories, 440);
    assert.equal(twoBars.proteins, 40);
    assert.equal(twoBars.sodium, 360);
    assert.equal(twoBars.salt, 0.9);
  });

  it('detects per-100g labels so FoodEditor can scale to the serving size', () => {
    const parsed = parseNutritionTextLocally([
      { text: 'Energy Bar' },
      { text: 'per 100g' },
      { text: 'Calories 400' },
      { text: 'Protein 30g' },
      { text: 'Carbohydrates 35g' },
      { text: 'Fat 10g' },
    ]);

    assert.equal(parsed.portion, 100);
    assert.equal(parsed.unit, 'g');
    assert.equal(parsed.per_serving, false);
    assert.equal(parsed.nutrition.calories, 400);
    assert.equal(parsed.nutrition.proteins, 30);

    const sixtyGramServing = Object.fromEntries(
      Object.entries(parsed.nutrition).map(([key, value]) => [key, value * 0.6])
    );
    assert.deepEqual(sixtyGramServing, {
      calories: 240,
      proteins: 18,
      carbohydrates: 21,
      fat: 6,
    });
  });
});
