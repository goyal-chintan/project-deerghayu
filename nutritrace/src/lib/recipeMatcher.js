/**
 * recipeMatcher.js - Core logic for local rule-based OCR parsing and recipe matching.
 * Runs completely on-device without external APIs.
 */

// Common nutriment properties list
const NUTRIMENTS_IDS = [
  'calories', 'proteins', 'carbohydrates', 'fat', 'fiber', 'saturated-fat',
  'sugars', 'sodium', 'salt', 'potassium', 'cholesterol', 'calcium', 'iron'
];

// ── FSSAI noise lines to strip ────────────────────────────────
const FSSAI_NOISE = [
  'contains permitted natural colour(s) and added flavour(s)',
  'contains permitted natural colour and added flavour',
  'multi-lingual declaration',
  'best before',
  'mrp',
];

// ── FSSAI nutrient mapping to internal keys ───────────────────
function _fssaiNutrientToKey(name, unit) {
  const n = name.toLowerCase().trim();
  if (n === 'energy') return unit === 'kcal' ? 'energy_kcal' : 'energy_kj';
  if (n === 'protein' || n === 'proteins') return 'protein_g';
  if (n === 'carbohydrate' || n === 'carbohydrates' || n === 'carbs') return 'carbohydrate_g';
  if (n === 'total fat' || n === 'fat') return 'fat_g';
  if (n === 'saturated fat' || n === 'saturated') return 'saturated_fat_g';
  if (n === 'trans fat') return 'trans_fat_g';
  if (n === 'fibre' || n === 'fiber' || n === 'dietary fibre' || n === 'dietary fiber') return 'fibre_g';
  if (n === 'sugar' || n === 'sugars' || n === 'total sugars') return 'sugar_g';
  if (n === 'sodium') return 'sodium_mg';
  return n.replace(/[^a-z0-9]/g, '_');
}

// ── Convert FSSAI nutrients to our internal format ────────────
function _fssaiToInternalNutrients(fssaiNutrition) {
  const mapping = {
    energy_kcal: 'calories',
    protein_g: 'proteins',
    carbohydrate_g: 'carbohydrates',
    fat_g: 'fat',
    saturated_fat_g: 'saturated-fat',
    trans_fat_g: 'trans-fat',
    fibre_g: 'fiber',
    sugar_g: 'sugars',
    sodium_mg: 'sodium',
  };
  const out = {};
  for (const [fssaiKey, internalKey] of Object.entries(mapping)) {
    if (fssaiNutrition[fssaiKey] != null) {
      out[internalKey] = fssaiNutrition[fssaiKey];
    }
  }
  return out;
}

/**
 * Parses an Indian FSSAI-style nutrition label text.
 * FSSAI labels typically have this structure:
 *   Serving size: 30g              (often first)
 *   Nutritional Information per 100g:
 *   Energy 420 kcal, Protein 28g, ...
 *   Per serving: ...               (optional)
 *   Servings per pack: 10
 *
 * Auto-detected when text contains "FSSAI"/"fssai"/"Lic. No."/"Best before"/"MRP".
 * Strips common FSSAI noise lines.
 */
export function parseFssaiLabel(text) {
  const result = {
    servingG: 100,
    servingsPerPack: null,
    per100g: {},
    perServing: {},
    ingredientsText: '',
    rawText: text,
  };

  if (!text) return result;

  let lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Strip FSSAI noise lines ──
  const strippedLines = [];
  for (const line of lines) {
    const lc = line.toLowerCase();
    let isNoise = false;
    for (const noise of FSSAI_NOISE) {
      if (lc.startsWith(noise)) { isNoise = true; break; }
    }
    if (!isNoise) strippedLines.push(line);
  }
  lines = strippedLines;
  if (lines.length === 0) return result;

  // ── Extract serving size ──
  for (const line of lines) {
    const m = line.match(/serving\s*size\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i);
    if (m) {
      result.servingG = parseFloat(m[1]);
      break;
    }
  }

  // ── Extract servings per pack ──
  for (const line of lines) {
    const m = line.match(/servings\s*per\s*pack\s*[:\-]?\s*(\d+)/i);
    if (m) {
      result.servingsPerPack = parseInt(m[1], 10);
      break;
    }
  }

  // ── Extract ingredients ──
  for (const line of lines) {
    const m = line.match(/ingredients\s*[:\-]\s*(.+)/i);
    if (m) {
      result.ingredientsText = m[1].trim();
      break;
    }
  }

  // ── Find "per 100g" section and parse ──
  // Values often come as a list on one line: "Energy 420 kcal, Protein 28g, ..."
  // Or as separate lines
  const per100gSection = _extractSection(lines, /per\s*100\s*g/i);
  if (per100gSection) {
    Object.assign(result.per100g, _parseFssaiNutritionLines(per100gSection));
  }

  // ── Find "per serving" section ──
  const perServingSection = _extractSection(lines, /per\s*serving/i);
  if (perServingSection) {
    Object.assign(result.perServing, _parseFssaiNutritionLines(perServingSection));
  }

  return result;
}

/**
 * Extracts lines belonging to a section starting at the heading matching `headingRe`.
 * Returns an array of lines (including the heading line).
 */
function _extractSection(lines, headingRe) {
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  const section = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Stop at next section heading (lowercase first letter, colon at end)
    if (i > startIdx && /^[A-Z][a-z]+ .*:/.test(line) && !headingRe.test(line)) {
      break;
    }
    section.push(line);
  }
  return section;
}

/**
 * Parses FSSAI nutrition lines like "Energy 420 kcal, Protein 28g, ..."
 * Also handles one-value-per-line format.
 */
function _parseFssaiNutritionLines(lines) {
  const result = {};
  const raw = lines.join(' ');

  // Split by comma, semicolon, or newline to get individual value statements.
  // Then further split by colon to strip section headings like "Nutritional Information per 100g: Energy 420 kcal".
  const parts = raw.split(/[,;]|\n/).map(s => s.trim()).filter(Boolean);

  // More flexible pattern: name can contain letters, spaces, slashes, colons, periods
  // Name is everything before the last number+unit group at end of string.
  const nutrientRe = /^(.+?)\s+(\d+(?:\.\d+)?)\s*(kcal|kj|g|mg)$/i;

  for (const part of parts) {
    // Strip common heading prefixes like "Nutritional Information per 100g:"
    // by finding the last colon-space separator
    const cleaned = part.replace(/^[A-Za-z\s/]+\d*\s*g\s*:\s*/i, '').trim();
    if (!cleaned) continue;

    const m = cleaned.match(nutrientRe);
    if (m) {
      const name = m[1].trim();
      const value = parseFloat(m[2]);
      const unit = m[3].toLowerCase();
      const key = _fssaiNutrientToKey(name, unit);
      result[key] = value;
    }
  }

  return result;
}

/**
 * Checks whether raw label text contains FSSAI markers.
 */
export function isFssaiLabelText(text) {
  if (!text) return false;
  const lc = text.toLowerCase();
  return /fssai|lic\.?\s*no\.?|best before|mrp/i.test(lc);
}

/**
 * Converts a parseFssaiLabel result to the same shape as parseNutritionTextLocally.
 */
function _fssaiResultToNutritionResult(fssai) {
  const result = {
    name: '',
    brand: '',
    portion: fssai.servingG || 100,
    unit: 'g',
    per_serving: fssai.servingG !== 100,
    nutrition: {},
    ingredientsText: fssai.ingredientsText || '',
    ingredients: [],
  };

  // Convert per100g FSSAI nutrients to our internal format and scale to serving
  const internal = _fssaiToInternalNutrients(fssai.per100g);
  const scale = (fssai.servingG || 100) / 100;
  for (const [key, val] of Object.entries(internal)) {
    result.nutrition[key] = Math.round(val * scale * 10) / 10;
  }

  // If perServing data is available, use that instead (more accurate)
  if (fssai.perServing && Object.keys(fssai.perServing).length > 0) {
    const perServingInternal = _fssaiToInternalNutrients(fssai.perServing);
    for (const [key, val] of Object.entries(perServingInternal)) {
      result.nutrition[key] = val;
    }
  }

  // Extract product name from first non-empty line (after stripping noise)
  if (fssai.rawText) {
    const lines = fssai.rawText.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const lc = line.toLowerCase();
      if (!lc.includes('ingredients') && !lc.includes('nutritional') && !lc.includes('fssai') && !lc.includes('serving') && !lc.includes('lic.') && !lc.includes('best before') && !lc.includes('mrp')) {
        result.name = line;
        break;
      }
    }
  }

  return result;
}

/**
 * Detects if text is an FSSAI-style label and parses accordingly.
 * Falls through to the default parser for non-FSSAI labels.
 */
export function parseNutritionTextLocally(lines) {
  // Auto-detect FSSAI labels
  if (lines && Array.isArray(lines) && lines.length > 0) {
    const combinedText = lines.map(l => l.text || l).join('\n');
    if (isFssaiLabelText(combinedText)) {
      const fssaiParsed = parseFssaiLabel(combinedText);
      return _fssaiResultToNutritionResult(fssaiParsed);
    }
  }
  // Fall through to the standard line-by-line parser
  return _parseNutritionTextLocallyStandard(lines);
}

/**
 * Original line-by-line parser — extracted so FSSAI auto-detect can route first.
 */
function _parseNutritionTextLocallyStandard(lines) {
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
 *
 * Accepts flexible arguments:
 *   - ingredientsText: string (comma-separated) OR array of ingredient names
 *   - totalPortionSize: number (grams) OR a parsed FSSAI object (extracts servingG)
 */
export async function matchAndCalculateRecipeLocally(ingredientsText, totalPortionSize = 100) {
  // Handle first arg being an array (pre-split ingredients)
  let ingredientNames;
  if (Array.isArray(ingredientsText)) {
    ingredientNames = ingredientsText.map(s => String(s).trim()).filter(Boolean);
  } else if (typeof ingredientsText === 'string') {
    if (!ingredientsText.trim()) return null;
    // Split ingredients by commas outside of parentheses
    ingredientNames = [];
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
  } else {
    return null;
  }

  // Handle second arg being a parsed FSSAI object
  let finalPortion;
  if (totalPortionSize && typeof totalPortionSize === 'object' && totalPortionSize.servingG != null) {
    finalPortion = totalPortionSize.servingG;
  } else {
    finalPortion = parseFloat(totalPortionSize) || 100;
  }

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
