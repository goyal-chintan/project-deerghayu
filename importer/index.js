#!/usr/bin/env node
/**
 * Project Deerghayu – IFCT 2017 → NutriTrace Importer
 * =====================================================
 * Reads the IFCT 2017 compositions CSV bundled in node_modules and converts
 * it into a NutriTrace-compatible spreadsheet CSV that can be imported via
 * Settings → Import (source: "spreadsheet").
 *
 * Also merges cooked-recipe entries from datasets/cooked-recipes.json.
 *
 * Output: output/deerghayu-food-database.csv
 *
 * Usage:  node index.js [--filter vegetarian] [--max 500]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const filterVeg = !args.includes('--all');          // default: veg only
const maxRows   = parseInt(args.find(a => /^--max=/.test(a))?.split('=')[1]) || Infinity;

// ── Paths ─────────────────────────────────────────────────────────────────
const IFCT_CSV    = path.join(__dirname, 'node_modules/@nodef/ifct2017/compositions/index.csv');
const RECIPES_JSON = path.join(__dirname, 'datasets/cooked-recipes.json');
const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_CSV  = path.join(OUTPUT_DIR, 'deerghayu-food-database.csv');

// ── IFCT column indices (0-based, from compositions/index.csv header) ─────
// Confirmed by running: head -1 compositions/index.csv | tr ',' '\n' | nl
const COL = {
  code:     0,
  name:     1,
  grup:     4,   // food group
  tags:     6,   // contains "vegetarian", "eggetarian", etc.
  enerc:    7,   // energy kJ — we'll convert to kcal (/4.184)
  fatce:    15,  // total fat (g)
  fibtg:    19,  // dietary fibre (g)
  choavldf: 21,  // carbohydrates (g)
  protcnt:  23,  // protein (g)
  vita:     53,  // Vitamin A (retinol equivalent, µg) — col 54 in 1-based
  vitc:     57,  // Vitamin C (mg)
  vitd:     59,  // Vitamin D (µg)
  thia:     109, // Thiamine / B1 (mg)
  ribf:     111, // Riboflavin / B2 (mg)
  nia:      113, // Niacin / B3 (mg)
  vitb6c:   117, // Vitamin B6 (mg)
  vitb12:   119, // Vitamin B12 (µg) — verify column index against IFCT header
  folsum:   121, // Folate total / B9 (µg)
  ca:       169, // Calcium (mg)
  fe:       177, // Iron (mg)
  mg:       183, // Magnesium (mg)
  p:        193, // Phosphorus (mg)
  k:        195, // Potassium (mg)
  na:       199, // Sodium (mg)
  zn:       201, // Zinc (mg)
};

// ── Helpers ───────────────────────────────────────────────────────────────
function dietTypeFromTags(tags) {
  const t = (tags || '').toLowerCase();
  if (t.includes('vegan')) return 'vegan';
  if (t.includes('eggetarian')) return 'eggetarian';
  if (t.includes('vegetarian')) return 'vegetarian';
  return 'non-vegetarian';
}

function kJtoKcal(kj) {
  if (!kj || isNaN(kj)) return '';
  const kcal = parseFloat(kj) / 4.184;
  return kcal.toFixed(1);
}

function safeNum(v, scale = 1) {
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  return (n * scale).toFixed(3).replace(/\.?0+$/, '');
}

// Rudimentary CSV row parser: handles quoted fields with commas inside
function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQ  = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// Wrap a value for CSV output (quote if contains comma, newline, or quote)
function csvField(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

// ── NutriTrace spreadsheet CSV header ────────────────────────────────────
// Columns accepted by server/lib/nutrition-import/spreadsheet.js
const HEADER = [
  'Date', 'Name', 'Brand', 'Meal', 'Quantity', 'Unit',
  'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)',
  'Sodium (mg)', 'Potassium (mg)', 'Calcium (mg)', 'Iron (mg)',
  'Magnesium (mg)', 'Phosphorus (mg)', 'Zinc (mg)',
  'Vitamin A (µg)', 'Vitamin C (mg)', 'Vitamin D (µg)',
  'B1 Thiamine (mg)', 'B2 Riboflavin (mg)', 'B3 Niacin (mg)',
  'B6 (mg)', 'B9 Folate (µg)', 'B12 (µg)',
  'Notes', 'Diet Type',
];

// A fixed import date — NutriTrace needs a date; we pick today.
// The user can then copy items from diary to their food library.
const TODAY = new Date().toISOString().slice(0, 10);

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const out = fs.createWriteStream(OUTPUT_CSV, { encoding: 'utf8' });
  out.write(csvRow(HEADER) + '\n');

  let count = 0;
  let skipped = 0;
  let isFirstLine = true;

  // ── Part 1: IFCT 2017 raw ingredients ───────────────────────────────
  console.log('📂 Reading IFCT 2017 compositions CSV…');

  const rl = readline.createInterface({
    input: fs.createReadStream(IFCT_CSV, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; } // skip header
    if (count >= maxRows) break;

    const cols = parseCSVLine(line);
    if (cols.length < 10) continue;

    const tags = (cols[COL.tags] || '').toLowerCase();
    if (filterVeg && !tags.includes('vegetarian')) {
      skipped++;
      continue;
    }

    const name  = cols[COL.name] || '';
    const grup  = cols[COL.grup] || '';
    const kcal  = kJtoKcal(cols[COL.enerc]);
    if (!name || !kcal) continue;

    const row = [
      TODAY,                          // Date
      name,                           // Name
      'IFCT 2017',                    // Brand
      'Breakfast',                    // Meal (default; user adjusts)
      '100',                          // Quantity (per 100g)
      'g',                            // Unit
      kcal,                           // Calories (kcal)
      safeNum(cols[COL.protcnt]),     // Protein
      safeNum(cols[COL.choavldf]),    // Carbs
      safeNum(cols[COL.fatce]),       // Fat
      safeNum(cols[COL.fibtg]),       // Fiber
      safeNum(cols[COL.na],   1000), // Sodium (mg) — IFCT stores in g/100g
      safeNum(cols[COL.k],    1000), // Potassium (mg)
      safeNum(cols[COL.ca],   1000), // Calcium (mg)
      safeNum(cols[COL.fe],   1000), // Iron (mg)
      safeNum(cols[COL.mg],   1000), // Magnesium (mg)
      safeNum(cols[COL.p],    1000), // Phosphorus (mg)
      safeNum(cols[COL.zn],   1000), // Zinc (mg)
      safeNum(cols[COL.vita], 1e6),  // Vitamin A µg (IFCT in g/100g → ×1,000,000)
      safeNum(cols[COL.vitc], 1000), // Vitamin C mg (IFCT in g/100g → ×1000)
      safeNum(cols[COL.vitd], 1e6),  // Vitamin D µg (IFCT in g/100g → ×1,000,000)
      safeNum(cols[COL.thia], 1000), // B1 mg (IFCT in g/100g → ×1000)
      safeNum(cols[COL.ribf], 1000), // B2 mg
      safeNum(cols[COL.nia],  1000), // B3 mg
      safeNum(cols[COL.vitb6c], 1000),// B6 mg
      safeNum(cols[COL.folsum], 1e6), // B9 µg (IFCT in g/100g → ×1,000,000)
      safeNum(cols[COL.vitb12], 1e6), // B12 µg (IFCT in g/100g → ×1,000,000)
      `IFCT2017:${cols[COL.code]} | Group: ${grup}`, // Notes
      dietTypeFromTags(tags),         // Diet Type
    ];

    out.write(csvRow(row) + '\n');
    count++;
  }

  console.log(`✅ IFCT 2017: ${count} vegetarian ingredients written (${skipped} non-veg skipped)`);

  // ── Part 2: Cooked recipes ───────────────────────────────────────────
  console.log('🍛 Processing cooked recipes…');
  let recipeCount = 0;

  if (fs.existsSync(RECIPES_JSON)) {
    const recipes = JSON.parse(fs.readFileSync(RECIPES_JSON, 'utf8'));
    for (const r of recipes) {
      const n = r.nutrition || {};
      // Convert cooked-recipes.json format to spreadsheet row
      // nutrition values in cooked-recipes.json are already per-100g
      const row = [
        TODAY,
        r.name,
        r.brand || 'Homemade',
        'Breakfast',
        String(r.portion || 100),
        r.unit || 'g',
        n.calories != null ? String(n.calories) : '',
        n.proteins  != null ? String(n.proteins)  : '',
        n.carbohydrates != null ? String(n.carbohydrates) : '',
        n.fat       != null ? String(n.fat)       : '',
        n.fiber     != null ? String(n.fiber)     : '',
        n.sodium    != null ? String(n.sodium)    : '',
        '',                                                   // potassium
        n.calcium   != null ? String(n.calcium)   : '',
        n.iron      != null ? String(n.iron)      : '',
        '',                                                   // magnesium
        '',                                                   // phosphorus
        n.zinc      != null ? String(n.zinc)      : '',
        n['vitamin-a'] != null ? String(n['vitamin-a']) : '',
        n['vitamin-c'] != null ? String(n['vitamin-c']) : '',
        '',                                                   // vitamin-d
        n.b1 != null ? String(n.b1) : '',
        n.b2 != null ? String(n.b2) : '',
        n.b3 != null ? String(n.b3) : '',
        '',                                                   // b6
        n.b9 != null ? String(n.b9) : '',
        n.b12 != null ? String(n.b12) : '',
        r.notes || '',
        r.diet_type || 'vegetarian',                          // Diet Type
      ];
      out.write(csvRow(row) + '\n');
      recipeCount++;
    }
    console.log(`✅ Cooked recipes: ${recipeCount} dishes written`);
  } else {
    console.log('⚠️  No cooked-recipes.json found, skipping.');
  }

  out.end();

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📊 TOTAL: ${count + recipeCount} food entries exported`);
  console.log(`📁 Output: ${OUTPUT_CSV}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Start NutriTrace:  docker compose up -d');
  console.log('  2. Open http://localhost:3000 → Settings → Import Data');
  console.log('  3. Choose source: "Spreadsheet (CSV)"');
  console.log('  4. Upload: output/deerghayu-food-database.csv');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('❌ Importer failed:', err.message);
  process.exit(1);
});
