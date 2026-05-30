/**
 * Diet type constants and helpers for vegetarian mode filtering.
 */
export const DIET_TYPES = ['vegetarian', 'non-vegetarian', 'vegan', 'eggetarian'];

export const DIET_LABELS = {
  'vegetarian': 'Vegetarian',
  'non-vegetarian': 'Non-Vegetarian',
  'vegan': 'Vegan',
  'eggetarian': 'Eggetarian',
};

/** Returns true if the item should be visible when vegetarian mode is ON */
export function isAllowedInVegMode(item) {
  const dt = (item?.diet_type || 'vegetarian').toLowerCase();
  return dt !== 'non-vegetarian';
}

/** Determine overall diet type from a list of ingredient items */
export function combineDietTypes(items) {
  if (!items || !items.length) return 'vegetarian';
  const hasNonVeg = items.some(i => (i.diet_type || '').toLowerCase() === 'non-vegetarian');
  if (hasNonVeg) return 'non-vegetarian';
  const hasEgg = items.some(i => (i.diet_type || '').toLowerCase() === 'eggetarian');
  if (hasEgg) return 'eggetarian';
  const allVegan = items.every(i => (i.diet_type || '').toLowerCase() === 'vegan');
  if (allVegan) return 'vegan';
  return 'vegetarian';
}

/** Infer diet type from external food name/categories (OFF, USDA, Mealie) */
export function inferDietType(name, categories) {
  const text = `${name || ''} ${(categories || []).join(' ')}`.toLowerCase();
  const nonVegKeywords = ['chicken', 'mutton', 'lamb', 'fish', 'prawn', 'shrimp', 'pork', 'beef', 'meat', 'bacon', 'ham', 'sausage', 'salami', 'pepperoni', 'turkey', 'duck', 'crab', 'lobster', 'squid', 'anchov', 'sardine', 'tuna', 'salmon', 'mackerel', 'pomfret', 'hilsa', 'rohu', 'surmai', 'keema', 'gosht', 'murgh', 'jhinga'];
  const eggKeywords = ['egg', 'omelette', 'omelet', 'anda'];
  if (nonVegKeywords.some(k => text.includes(k))) return 'non-vegetarian';
  if (eggKeywords.some(k => text.includes(k))) return 'eggetarian';
  return 'vegetarian';
}
