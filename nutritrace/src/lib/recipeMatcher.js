/**
 * recipeMatcher.js - Core logic for local rule-based OCR parsing and recipe matching.
 * Runs completely on-device without external APIs.
 */

// Common nutriment properties list
const NUTRIMENTS_IDS = [
  'calories', 'proteins', 'carbohydrates', 'fat', 'fiber', 'saturated-fat',
  'sugars', 'sodium', 'salt', 'potassium', 'cholesterol', 'calcium', 'iron'
];

/**
 * Parses raw text lines from local on-device OCR into a structured food object.
 * Handles portion sizes, units, and parses the per_serving configuration.
 */
export function parseNutritionTextLocally(lines) {
  const result = {
    name: '',
    brand: '',
    portion: 100,
    unit: 'g',
    per_serving: false,
    nutrition: {}
  };

  if (!lines || !Array.isArray(lines)) return result;

  // Clean lines list
  const textLines = lines.map(l => l.text.trim());

  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i].toLowerCase().trim();

    // Check for Brand / Name from the first few lines if they are not common words
    if (i < 3 && !result.name && line.length > 2) {
      if (!line.includes('nutrition') && !line.includes('facts') && !line.includes('serving') && !line.includes('amount')) {
        result.name = textLines[i];
      }
    }

    // Portion Size / Serving Size
    if (line.includes('serving size') || line.includes('portion')) {
      const match = line.match(/(?:serving size|portion)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(g|ml|oz)/i);
      if (match) {
        result.portion = parseFloat(match[1]);
        result.unit = match[2].toLowerCase();
        result.per_serving = true;
      }
    } else if (line.includes('per 100') || line.includes('100g') || line.includes('100 g') || line.includes('100ml')) {
      result.portion = 100;
      result.unit = line.includes('ml') ? 'ml' : 'g';
      result.per_serving = false;
    }

    // Calories / Energy
    if (line.includes('calories') || line.includes('energy') || line.includes('kcal')) {
      const match = line.match(/(?:calories|energy|kcal)\s*(?:from fat)?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
      if (match) {
        result.nutrition['calories'] = parseFloat(match[1]);
      }
    }

    // Protein
    if (line.includes('protein') || line.includes('proteins')) {
      const match = line.match(/(?:protein|proteins)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i);
      if (match) result.nutrition['proteins'] = parseFloat(match[1]);
    }

    // Carbohydrates
    if (line.includes('carbohydrate') || line.includes('carbohydrates') || line.includes('carbs')) {
      const match = line.match(/(?:carbohydrate|carbohydrates|carbs)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i);
      if (match) result.nutrition['carbohydrates'] = parseFloat(match[1]);
    }

    // Fat
    if (line.includes('total fat') || (line.includes('fat') && !line.includes('saturated') && !line.includes('trans') && !line.includes('poly') && !line.includes('mono'))) {
      const match = line.match(/(?:total fat|fat)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i);
      if (match) result.nutrition['fat'] = parseFloat(match[1]);
    }

    // Saturated Fat
    if (line.includes('saturated fat') || line.includes('saturated')) {
      const match = line.match(/(?:saturated fat|saturated)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i);
      if (match) result.nutrition['saturated-fat'] = parseFloat(match[1]);
    }

    // Dietary Fiber
    if (line.includes('fiber') || line.includes('dietary fiber')) {
      const match = line.match(/(?:dietary fiber|fiber)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i);
      if (match) result.nutrition['fiber'] = parseFloat(match[1]);
    }

    // Sugars
    if (line.includes('sugar') || line.includes('sugars') || line.includes('total sugars')) {
      const match = line.match(/(?:total sugars|sugars|sugar)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i);
      if (match) result.nutrition['sugars'] = parseFloat(match[1]);
    }

    // Sodium
    if (line.includes('sodium')) {
      const match = line.match(/sodium\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mg|g)/i);
      if (match) {
        let val = parseFloat(match[1]);
        if (match[2].toLowerCase() === 'g') val *= 1000;
        result.nutrition['sodium'] = val;
      }
    }

    // Salt
    if (line.includes('salt')) {
      const match = line.match(/salt\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(g|mg)/i);
      if (match) {
        let val = parseFloat(match[1]);
        if (match[2].toLowerCase() === 'mg') val /= 1000;
        result.nutrition['salt'] = val;
      }
    }
  }

  // Attempt to parse ingredients list block from text if visible
  let combined = textLines.join('\n');
  const ingMatch = combined.match(/ingredients\s*[:\-]\s*([\s\S]+)$/i);
  if (ingMatch) {
    result.ingredientsText = ingMatch[1].trim();
  }

  return result;
}

/**
 * Splits, cleans, and matches ingredients against SQLite database foods,
 * then calculates estimated nutrients based on a linear descending weight allocation.
 */
export async function matchAndCalculateRecipeLocally(ingredientsText, totalPortionSize = 100) {
  if (!ingredientsText) return null;

  // Split ingredients by commas outside of parentheses
  const ingredientNames = [];
  let current = "";
  let parenDepth = 0;
  for (let i = 0; i < ingredientsText.length; i++) {
    const char = ingredientsText[i];
    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth--;

    if (char === ',' && parenDepth === 0) {
      ingredientNames.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) ingredientNames.push(current.trim());

  // Clean ingredient names
  const cleanedIngredients = ingredientNames.map(name => {
    let clean = name.toLowerCase();
    clean = clean.replace(/^(?:ingredients|ingredient|contains|contains less than 2% of)\s*[:\-]?\s*/i, '');
    clean = clean.replace(/\s*\(\s*\d+(?:\.\d+)?\s*%\s*\)/g, '');
    clean = clean.replace(/\d+(?:\.\d+)?\s*%/g, '');
    clean = clean.replace(/\s*\([\s\S]*?\)/g, '');
    clean = clean.replace(/[.\-*:\d]/g, '');
    return clean.trim();
  }).filter(name => name.length > 2);

  if (cleanedIngredients.length === 0) return null;

  const { getDb } = await import('./db-native.js');
  const db = await getDb();
  const matchedItems = [];

  for (let i = 0; i < cleanedIngredients.length; i++) {
    const name = cleanedIngredients[i];
    const cleanQuery = `%${name}%`;
    const r = await db.query(
      `SELECT * FROM foods WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1`,
      [cleanQuery]
    );
    const row = r?.values?.[0];
    if (row) {
      matchedItems.push({
        name: row.name,
        originalName: name,
        id: row.id,
        portion: row.portion || 100,
        unit: row.unit || 'g',
        nutrition: typeof row.nutrition === 'string' ? JSON.parse(row.nutrition) : (row.nutrition || {})
      });
    } else {
      const firstWord = name.split(/\s+/)[0];
      if (firstWord.length > 2) {
        const r2 = await db.query(
          `SELECT * FROM foods WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1`,
          [`%${firstWord}%`]
        );
        const row2 = r2?.values?.[0];
        if (row2) {
          matchedItems.push({
            name: row2.name,
            originalName: name,
            id: row2.id,
            portion: row2.portion || 100,
            unit: row2.unit || 'g',
            nutrition: typeof row2.nutrition === 'string' ? JSON.parse(row2.nutrition) : (row2.nutrition || {})
          });
          continue;
        }
      }
      // Placeholder with zero nutrients if not matched
      matchedItems.push({
        name: name,
        originalName: name,
        id: null,
        portion: 100,
        unit: 'g',
        nutrition: {}
      });
    }
  }

  // Linear descending portion distribution (descending weight rule)
  const n = matchedItems.length;
  const sumWeights = (n * (n + 1)) / 2;
  const calculatedNutrition = {};

  NUTRIMENTS_IDS.forEach(id => { calculatedNutrition[id] = 0; });
  const finalPortion = parseFloat(totalPortionSize) || 100;

  const itemsWithPortions = matchedItems.map((item, idx) => {
    const weightFraction = (n - idx) / sumWeights;
    const estPortion = weightFraction * finalPortion;
    const portionFactor = estPortion / (item.portion || 100);

    NUTRIMENTS_IDS.forEach(id => {
      const val = parseFloat(item.nutrition[id]);
      if (!isNaN(val)) {
        calculatedNutrition[id] += val * portionFactor;
      }
    });

    return {
      ...item,
      estPortion: Math.round(estPortion * 10) / 10
    };
  });

  NUTRIMENTS_IDS.forEach(id => {
    calculatedNutrition[id] = Math.round(calculatedNutrition[id] * 10) / 10;
  });

  return {
    ingredients: itemsWithPortions,
    nutrition: calculatedNutrition,
    portion: finalPortion
  };
}
