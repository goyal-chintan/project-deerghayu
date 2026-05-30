/**
 * classify.test.js — Tests for the diet-type classifier.
 *
 * Uses node:test + node:assert/strict (no external test runner needed).
 * Run: node --test seed/classify.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiet } from './classify.js';

describe('classifyDiet', () => {

  describe('Rule 1: Explicit vegetarian overrides (highest precedence)', () => {
    it('returns vegetarian for "Vegetarian egg kofta curry"', () => {
      assert.equal(classifyDiet('Vegetarian egg kofta curry'), 'vegetarian');
    });

    it('returns vegetarian for "Soya chunks sweet and sour"', () => {
      assert.equal(classifyDiet('Soya chunks sweet and sour'), 'vegetarian');
    });

    it('returns vegetarian for "Vegeterian scotch egg" (misspelling)', () => {
      assert.equal(classifyDiet('Vegeterian scotch egg'), 'vegetarian');
    });

    it('returns vegetarian for "Eggless chocolate cake"', () => {
      assert.equal(classifyDiet('Eggless chocolate cake'), 'vegetarian');
    });

    it('returns vegetarian for "Mock chicken"', () => {
      assert.equal(classifyDiet('Mock chicken'), 'vegetarian');
    });

    it('returns vegetarian for "Soybean curry"', () => {
      assert.equal(classifyDiet('Soybean curry'), 'vegetarian');
    });

    it('returns vegetarian for "Nutrela biryani"', () => {
      assert.equal(classifyDiet('Nutrela biryani'), 'vegetarian');
    });

    it('returns vegetarian for "Meatless burger patty"', () => {
      assert.equal(classifyDiet('Meatless burger patty'), 'vegetarian');
    });
  });

  describe('Rule 2: Non-vegetarian keywords', () => {
    it('returns non-vegetarian for "Chicken curry"', () => {
      assert.equal(classifyDiet('Chicken curry'), 'non-vegetarian');
    });

    it('returns non-vegetarian for "Mutton pulao"', () => {
      assert.equal(classifyDiet('Mutton pulao'), 'non-vegetarian');
    });

    it('returns non-vegetarian for "Fish finger"', () => {
      assert.equal(classifyDiet('Fish finger'), 'non-vegetarian');
    });

    it('returns non-vegetarian for "Prawn masala"', () => {
      assert.equal(classifyDiet('Prawn masala'), 'non-vegetarian');
    });

    it('returns non-vegetarian for "Keema matar"', () => {
      assert.equal(classifyDiet('Keema matar'), 'non-vegetarian');
    });

    it('returns non-vegetarian for "Gosht biryani"', () => {
      assert.equal(classifyDiet('Gosht biryani'), 'non-vegetarian');
    });

    it('returns non-vegetarian for "Bacon sandwich"', () => {
      assert.equal(classifyDiet('Bacon sandwich'), 'non-vegetarian');
    });

    it('returns non-vegetarian for "Tuna salad"', () => {
      assert.equal(classifyDiet('Tuna salad'), 'non-vegetarian');
    });
  });

  describe('Rule 3: Eggetarian keywords', () => {
    it('returns eggetarian for "Egg drop soup"', () => {
      assert.equal(classifyDiet('Egg drop soup'), 'eggetarian');
    });

    it('returns eggetarian for "Anda bhurji"', () => {
      assert.equal(classifyDiet('Anda bhurji'), 'eggetarian');
    });

    it('returns eggetarian for "Plain omelette"', () => {
      assert.equal(classifyDiet('Plain omelette'), 'eggetarian');
    });

    it('returns eggetarian for "Scrambled eggs"', () => {
      assert.equal(classifyDiet('Scrambled eggs'), 'eggetarian');
    });

    it('returns eggetarian for "Frittata with vegetables"', () => {
      assert.equal(classifyDiet('Frittata with vegetables'), 'eggetarian');
    });

    it('returns eggetarian for "Egg in a pepper"', () => {
      assert.equal(classifyDiet('Egg in a pepper'), 'eggetarian');
    });
  });

  describe('Default: vegetarian (no trigger words)', () => {
    it('returns vegetarian for "Palak paneer"', () => {
      assert.equal(classifyDiet('Palak paneer'), 'vegetarian');
    });

    it('returns vegetarian for "Aloo gobi"', () => {
      assert.equal(classifyDiet('Aloo gobi'), 'vegetarian');
    });

    it('returns vegetarian for "Dal makhani"', () => {
      assert.equal(classifyDiet('Dal makhani'), 'vegetarian');
    });
  });

  describe('False positive guards', () => {
    it('does NOT classify "Chickpea salad" as non-veg (no "chicken" match)', () => {
      assert.equal(classifyDiet('Chickpea salad'), 'vegetarian');
    });

    it('does NOT classify "Chick pea curry" as non-veg', () => {
      assert.equal(classifyDiet('Chick pea curry'), 'vegetarian');
    });

    it('does NOT classify "Eggplant curry" as eggetarian', () => {
      assert.equal(classifyDiet('Eggplant curry'), 'vegetarian');
    });

    it('does NOT classify "Baingan bharta" as eggetarian', () => {
      assert.equal(classifyDiet('Baingan bharta'), 'vegetarian');
    });

    it('does NOT classify "Graham cracker" as non-veg (no "ham" match)', () => {
      assert.equal(classifyDiet('Graham cracker'), 'vegetarian');
    });

    it('does NOT classify "Hamburger bun" as non-veg (no standalone "ham")', () => {
      // "hamburger" contains "ham" but not at a word boundary end
      assert.equal(classifyDiet('Hamburger bun'), 'vegetarian');
    });
  });

  describe('Precedence tests', () => {
    it('non-veg wins over eggetarian: "Chicken egg curry" → non-vegetarian', () => {
      assert.equal(classifyDiet('Chicken egg curry'), 'non-vegetarian');
    });

    it('explicit-veg wins over non-veg: "Vegetarian chicken nuggets" → vegetarian', () => {
      assert.equal(classifyDiet('Vegetarian chicken nuggets'), 'vegetarian');
    });

    it('explicit-veg wins over egg: "Eggless sponge cake" → vegetarian', () => {
      assert.equal(classifyDiet('Eggless sponge cake'), 'vegetarian');
    });
  });

  describe('Edge cases', () => {
    it('returns vegetarian for null/undefined/empty', () => {
      assert.equal(classifyDiet(null), 'vegetarian');
      assert.equal(classifyDiet(undefined), 'vegetarian');
      assert.equal(classifyDiet(''), 'vegetarian');
    });

    it('is case-insensitive', () => {
      assert.equal(classifyDiet('CHICKEN TIKKA'), 'non-vegetarian');
      assert.equal(classifyDiet('egg fried rice'), 'eggetarian');
    });
  });
});
