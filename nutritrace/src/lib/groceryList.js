/**
 * Grocery List Generator
 * Aggregates ingredients from meal plan items and produces a shopping list.
 */

/**
 * Generate a grocery list from meal plan items
 * @param {Array} planItems - All items from meal plans (can span multiple days)
 * @param {Array} meals - Saved meals/recipes (for ingredient breakdown)
 * @returns {Array} - [{ name, totalAmount, unit, category, sources: [...] }]
 */
export function generateGroceryList(planItems, meals = []) {
  const ingredients = {};

  for (const item of planItems) {
    // If this item is a saved meal/recipe, expand its ingredients
    const mealMatch = meals.find(m => m.id === item.food_id || m.name === item.name);
    if (mealMatch && mealMatch.items) {
      const mealItems = typeof mealMatch.items === 'string' ? JSON.parse(mealMatch.items) : mealMatch.items;
      const servingScale = (item.servings || 1);
      for (const ingredient of mealItems) {
        addIngredient(ingredients, {
          name: ingredient.name || ingredient.food_name,
          portion: (ingredient.portion || 100) * servingScale,
          unit: ingredient.unit || 'g',
          category: ingredient.category || 'Other',
          meal_type: item.meal_type,
          date: item.date,
        });
      }
    } else {
      // Regular food item
      addIngredient(ingredients, {
        name: item.name,
        portion: (item.portion || 100) * (item.servings || 1),
        unit: item.unit || 'g',
        category: item.category || 'Other',
        meal_type: item.meal_type,
        date: item.date,
      });
    }
  }

  return Object.values(ingredients).sort((a, b) => a.name.localeCompare(b.name));
}

function addIngredient(map, { name, portion, unit, category, meal_type, date }) {
  const key = (name || '').toLowerCase().trim();
  if (!key) return;
  if (!map[key]) {
    map[key] = { name, totalAmount: 0, unit, category, sources: [] };
  }
  map[key].totalAmount += portion;
  map[key].sources.push({ meal_type, date, amount: portion });
}

/**
 * Group grocery items by category
 */
export function groupByCategory(items) {
  const groups = {};
  for (const item of items) {
    const cat = item.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }
  return groups;
}

/**
 * Format amount for display (convert g to kg if > 1000, ml to L, etc.)
 */
export function formatAmount(amount, unit) {
  if (unit === 'g' && amount >= 1000) return `${(amount / 1000).toFixed(1)} kg`;
  if (unit === 'ml' && amount >= 1000) return `${(amount / 1000).toFixed(1)} L`;
  return `${Math.round(amount)} ${unit}`;
}
