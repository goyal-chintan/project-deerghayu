/**
 * Nutrient Gap Recommendation Engine
 * Given current intake, targets, and a food library, suggests foods to fill nutrient gaps.
 */
import { isAllowedInVegMode } from './dietType.js';

/**
 * Find nutrient gaps (nutrients below threshold % of target)
 * @param {Object} intake - current nutrient intake { calories: 1200, iron: 8, ... }
 * @param {Object} targets - nutrient targets { calories: 2000, iron: 18, ... }
 * @param {number} threshold - percentage below which a nutrient is considered lacking (default 0.8 = 80%)
 * @returns {Array} - [{ key, label, current, target, percent, gap }]
 */
export function findNutrientGaps(intake, targets, threshold = 0.8) {
  const gaps = [];
  for (const [key, target] of Object.entries(targets)) {
    if (!target || target <= 0) continue;
    const current = intake[key] || 0;
    const percent = current / target;
    if (percent < threshold) {
      gaps.push({
        key,
        current: Math.round(current * 10) / 10,
        target: Math.round(target * 10) / 10,
        percent: Math.round(percent * 100),
        gap: Math.round((target - current) * 10) / 10,
      });
    }
  }
  // Sort by worst gaps first
  return gaps.sort((a, b) => a.percent - b.percent);
}

/**
 * Suggest top foods to fill a specific nutrient gap
 * @param {string} nutrientKey - e.g., 'iron', 'calcium', 'b12'
 * @param {number} gapAmount - how much more of this nutrient is needed
 * @param {Array} foods - food library array with nutrition objects
 * @param {boolean} vegMode - whether to filter to vegetarian only
 * @param {number} limit - max suggestions to return
 * @returns {Array} - [{ food, name, amountPer100g, servingToFill, percentFillPer100g }]
 */
export function suggestFoodsForNutrient(nutrientKey, gapAmount, foods, vegMode = false, limit = 5) {
  const candidates = foods
    .filter(f => {
      if (vegMode && !isAllowedInVegMode(f)) return false;
      const nutrition = (() => {
        try {
          return typeof f.nutrition === 'string' ? JSON.parse(f.nutrition) : (f.nutrition || {});
        } catch { return {}; }
      })();
      const value = nutrition[nutrientKey];
      return value && value > 0;
    })
    .map(f => {
      const nutrition = (() => {
        try {
          return typeof f.nutrition === 'string' ? JSON.parse(f.nutrition) : (f.nutrition || {});
        } catch { return {}; }
      })();
      const amountPer100g = nutrition[nutrientKey] || 0;
      const servingToFill = gapAmount > 0 ? Math.round((gapAmount / amountPer100g) * 100) : 0; // grams needed
      return {
        food: f,
        name: f.name,
        amountPer100g: Math.round(amountPer100g * 100) / 100,
        servingToFill, // grams needed to fill the gap completely
        percentFillPer100g: gapAmount > 0 ? Math.round((amountPer100g / gapAmount) * 100) : 100,
      };
    })
    .sort((a, b) => b.amountPer100g - a.amountPer100g);

  return candidates.slice(0, limit);
}

/**
 * Generate comprehensive suggestions for all nutrient gaps
 * @param {Object} intake - current intake
 * @param {Object} targets - targets
 * @param {Array} foods - food library
 * @param {boolean} vegMode - vegetarian filter
 * @returns {Array} - [{ nutrient: { key, gap, percent }, suggestions: [{ name, amountPer100g, servingToFill }] }]
 */
export function generateGapSuggestions(intake, targets, foods, vegMode = false) {
  const gaps = findNutrientGaps(intake, targets, 0.8);
  return gaps.slice(0, 5).map(gap => ({
    nutrient: gap,
    suggestions: suggestFoodsForNutrient(gap.key, gap.gap, foods, vegMode, 3),
  }));
}
