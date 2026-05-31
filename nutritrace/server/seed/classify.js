/**
 * classify.js — Diet-type classifier for recipe names.
 *
 * Pure function: given a recipe/food name string, returns one of:
 *   'non-vegetarian' | 'eggetarian' | 'vegetarian'
 *
 * Never returns 'vegan' — veganness cannot be reliably inferred from a name.
 *
 * Precedence order (first match wins):
 *   1. Explicit-veg overrides (e.g. "vegetarian", "soya", "eggless")
 *   2. Non-vegetarian keywords (meat/fish/poultry, word-boundary matched)
 *   3. Eggetarian keywords (egg-related, excluding "eggplant")
 *   4. Default: vegetarian
 */

// ── Rule 1: Explicit vegetarian overrides ──────────────────────────────────
// These phrases, when present ANYWHERE in the name, force vegetarian
// classification regardless of other keywords. Covers cases like:
//   "Vegetarian egg kofta curry" — has "egg" but is explicitly vegetarian
//   "Soya chunks sweet and sour" — "soya" is a plant protein indicator
//   "Vegeterian scotch egg" — alternate spelling + egg word
const VEG_OVERRIDE_PATTERNS = [
  /vegetarian/i,
  /vegeterian/i,   // common misspelling in Indian recipe databases
  /\bmock\b/i,
  /\bsoya\b/i,
  /\bsoy chunk/i,
  /\bsoybean/i,
  /\bnustrela\b/i,
  /\bnutrela\b/i,
  /\bnutri nugget/i,
  /\bnutrinugget/i,
  /\bmeatless\b/i,
  /\beggless\b/i,
];

// ── Rule 2: Non-vegetarian keywords ────────────────────────────────────────
// Each word is \b-anchored on both sides, which prevents substring false
// positives without explicit exclusion lists:
//   "chickpea"  — "chicken" never appears as a whole word.
//   "hamburger" — \bham\b fails because "ham" is followed by \w ("b").
//   "graham"    — \bham\b fails because "ham" is preceded by \w ("a").
const NON_VEG_WORDS = [
  'chicken', 'mutton', 'lamb', 'goat', 'beef', 'pork',
  'fish', 'prawn', 'prawns', 'shrimp', 'crab', 'lobster',
  'squid', 'oyster', 'clam',
  'keema', 'kheema', 'qeema', 'gosht', 'murgh', 'murg',
  'machli', 'machhli',
  'bacon', 'ham', 'sausage', 'salami',
  'meat', 'seafood',
  'tuna', 'anchovy', 'sardine',
];

// Build a single regex: \b(word1|word2|...)\b with case-insensitive flag.
const NON_VEG_RE = new RegExp(
  '\\b(' + NON_VEG_WORDS.join('|') + ')\\b', 'i'
);

// ── Rule 3: Eggetarian keywords ────────────────────────────────────────────
// Must NOT match "eggplant" or "eggless" (eggless is already caught by rule 1
// but we guard here too for correctness). Strategy:
//   - Match \begg(s)?\b but reject if followed by "plant" or "less"
//   - Match other egg words with simple word boundaries.
const EGG_WORDS_SIMPLE = [
  'anda', 'ande', 'ander', 'omelet', 'omelette', 'frittata',
];

const EGG_SIMPLE_RE = new RegExp(
  '\\b(' + EGG_WORDS_SIMPLE.join('|') + ')\\b', 'i'
);

// For "egg"/"eggs" we need a negative lookahead to skip "eggplant"/"eggless"
const EGG_RE = /\beggs?\b(?!plant|less)/i;

/**
 * Classify a recipe/food name into a diet type.
 * @param {string} name — recipe or food name
 * @returns {'non-vegetarian'|'eggetarian'|'vegetarian'}
 */
export function classifyDiet(name) {
  if (!name || typeof name !== 'string') return 'vegetarian';

  // Rule 1: Explicit vegetarian override — highest precedence
  for (const pat of VEG_OVERRIDE_PATTERNS) {
    if (pat.test(name)) return 'vegetarian';
  }

  // Rule 2: Non-vegetarian keywords
  if (NON_VEG_RE.test(name)) return 'non-vegetarian';

  // Rule 3: Eggetarian keywords (egg, eggs — excluding eggplant/eggless)
  if (EGG_RE.test(name) || EGG_SIMPLE_RE.test(name)) return 'eggetarian';

  // Default: vegetarian (no trigger words found)
  return 'vegetarian';
}
