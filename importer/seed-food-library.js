#!/usr/bin/env node
/**
 * Project Deerghayu — Bulk Food Library Seeder
 * =============================================
 * Adds all IFCT 2017 Indian vegetarian ingredients directly to the
 * NutriTrace FOOD LIBRARY (/api/foods) — not diary entries.
 * 
 * This means they appear in the search box when you log a meal,
 * and you can pick them from the list.
 *
 * Usage: node seed-food-library.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────
const SERVER     = process.env.NT_SERVER || 'http://localhost:3002';
const USERNAME   = process.env.NT_USERNAME || 'admin';
const PASSWORD   = process.env.NT_PASSWORD || '';

const IFCT_CSV     = path.join(__dirname, 'node_modules/@nodef/ifct2017/compositions/index.csv');
const RECIPES_JSON = path.join(__dirname, 'datasets/cooked-recipes.json');

// IFCT column indices (0-based)
const COL = {
  code: 0, name: 1, grup: 4, tags: 6,
  enerc: 7,       // energy kJ
  fatce: 15,      // fat g/100g
  fibtg: 19,      // fiber g/100g
  choavldf: 21,   // carbs g/100g
  protcnt: 23,    // protein g/100g
  vita: 53,       // Vitamin A (g/100g → µg ×1e6)
  vitc: 57,       // Vitamin C (g/100g → mg ×1000)
  vitd: 59,       // Vitamin D (g/100g → µg ×1e6)
  thia: 109,      // B1 (g/100g → mg ×1000)
  ribf: 111,      // B2
  nia: 113,       // B3
  vitb6c: 117,    // B6
  vitb12: 119,    // B12 (g/100g → µg ×1e6) — verify column index against IFCT header
  folsum: 121,    // Folate (g/100g → µg ×1e6)
  ca: 169,        // Calcium (g/100g → mg ×1000)
  fe: 177,        // Iron
  mg_col: 183,    // Magnesium
  p: 193,         // Phosphorus
  k: 195,         // Potassium
  na: 199,        // Sodium
  zn: 201,        // Zinc
};

function dietTypeFromTags(tags) {
  const t = (tags || '').toLowerCase();
  if (t.includes('vegan')) return 'vegan';
  if (t.includes('eggetarian')) return 'eggetarian';
  if (t.includes('vegetarian')) return 'vegetarian';
  return 'non-vegetarian';
}

function kJtoKcal(v)       { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n / 4.184 * 10) / 10; }
function scale(v, s)       { const n = parseFloat(v); return isNaN(n) || n === 0 ? undefined : Math.round(n * s * 1000) / 1000; }
function parseCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
function apiPost(path, body, cookies, csrf) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, SERVER);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Cookie': cookies,
        'X-CSRF-Token': csrf,
      }
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: raw, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Login ─────────────────────────────────────────────────────────────────
async function login() {
  const res = await apiPost('/api/auth/login', { username: USERNAME, password: PASSWORD }, '', '');
  const setCookies = res.headers['set-cookie'] || [];
  const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
  
  // Extract CSRF from JWT
  const tokenCookie = setCookies.find(c => c.startsWith('nt_token='));
  if (!tokenCookie) throw new Error('Login failed — no token cookie');
  const jwt = tokenCookie.split('=')[1].split(';')[0];
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  
  console.log(`✅ Logged in as: ${payload.username} (${payload.role})`);
  return { cookies: cookieStr, csrf: payload.csrf };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!PASSWORD && !process.env.NT_PASSWORD) {
    console.error('❌ Set NT_PASSWORD environment variable (or NT_USERNAME, NT_SERVER)');
    console.error('   Usage: NT_USERNAME=user NT_PASSWORD=pass node seed-food-library.js');
    process.exit(1);
  }

  console.log('🥗 Project Deerghayu — Food Library Seeder');
  console.log('─────────────────────────────────────────────');

  // Login
  let auth;
  try {
    auth = await login();
  } catch (e) {
    console.error('❌ Login failed:', e.message);
    console.error('   Is NutriTrace running? Start with: ./start-nutritrace.sh');
    process.exit(1);
  }

  const { cookies, csrf } = auth;
  let added = 0, skipped = 0, errors = 0;

  // ── Part 1: IFCT 2017 ingredients ─────────────────────────────────────
  console.log('\n📂 Loading IFCT 2017 ingredients into food library…\n');

  let isFirst = true;
  const rl = readline.createInterface({
    input: fs.createReadStream(IFCT_CSV, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (isFirst) { isFirst = false; continue; }
    const cols = parseCSVLine(line);
    if (cols.length < 10) continue;

    const tags = (cols[COL.tags] || '').toLowerCase();
    if (!tags.includes('vegetarian')) { skipped++; continue; }

    const name = cols[COL.name]?.trim();
    if (!name) continue;

    const kcal = kJtoKcal(cols[COL.enerc]);
    if (!kcal) continue;

    const grup = cols[COL.grup] || '';
    const code = cols[COL.code] || '';

    const nutrition = {
      calories:      kcal,
      proteins:      scale(cols[COL.protcnt], 1),
      carbohydrates: scale(cols[COL.choavldf], 1),
      fat:           scale(cols[COL.fatce], 1),
      fiber:         scale(cols[COL.fibtg], 1),
      sodium:        scale(cols[COL.na], 1000),
      potassium:     scale(cols[COL.k], 1000),
      calcium:       scale(cols[COL.ca], 1000),
      iron:          scale(cols[COL.fe], 1000),
      magnesium:     scale(cols[COL.mg_col], 1000),
      phosphorus:    scale(cols[COL.p], 1000),
      zinc:          scale(cols[COL.zn], 1000),
      'vitamin-a':   scale(cols[COL.vita], 1e6),
      'vitamin-c':   scale(cols[COL.vitc], 1000),
      'vitamin-d':   scale(cols[COL.vitd], 1e6),
      'b1':          scale(cols[COL.thia], 1000),
      'b2':          scale(cols[COL.ribf], 1000),
      'b3':          scale(cols[COL.nia], 1000),
      'b6':          scale(cols[COL.vitb6c], 1000),
      'b9':          scale(cols[COL.folsum], 1e6),
      'b12':         scale(cols[COL.vitb12], 1e6),  // B12 g/100g → mcg
    };
    // Remove undefined keys
    Object.keys(nutrition).forEach(k => nutrition[k] === undefined && delete nutrition[k]);

    const payload = {
      name,
      brand:    'IFCT 2017',
      portion:  100,
      unit:     'g',
      notes:    `${grup} | IFCT code: ${code}`,
      nutrition,
      diet_type: dietTypeFromTags(tags),
    };

    try {
      const res = await apiPost('/api/foods', payload, cookies, csrf);
      if (res.status === 200 || res.status === 201) {
        added++;
        if (added % 50 === 0) process.stdout.write(`  ✔ ${added} foods added…\r`);
      } else {
        errors++;
        if (errors < 5) console.error(`  ⚠ Error for "${name}": ${JSON.stringify(res.body)}`);
      }
    } catch (e) {
      errors++;
    }

    // Small delay to avoid overwhelming the server
    await new Promise(r => setTimeout(r, 10));
  }

  console.log(`\n✅ IFCT 2017: ${added} foods added | ${skipped} non-veg skipped | ${errors} errors`);

  // ── Part 2: Cooked recipes ────────────────────────────────────────────
  if (fs.existsSync(RECIPES_JSON)) {
    console.log('\n🍛 Adding cooked recipes to food library…');
    const recipes = JSON.parse(fs.readFileSync(RECIPES_JSON, 'utf8'));
    let rAdded = 0;

    for (const r of recipes) {
      const n = r.nutrition || {};
      const payload = {
        name:     r.name,
        brand:    r.brand || 'Homemade',
        portion:  r.portion || 100,
        unit:     r.unit || 'g',
        notes:    r.notes || '',
        diet_type: r.diet_type || 'vegetarian',
        nutrition: {
          calories:      n.calories,
          proteins:      n.proteins,
          carbohydrates: n.carbohydrates,
          fat:           n.fat,
          fiber:         n.fiber,
          sodium:        n.sodium,
          calcium:       n.calcium,
          iron:          n.iron,
          zinc:          n.zinc,
          'vitamin-a':   n['vitamin-a'],
          'vitamin-c':   n['vitamin-c'],
          'b1':          n.b1,
          'b2':          n.b2,
          'b3':          n.b3,
          'b9':          n.b9,
          'b12':         n.b12,
        }
      };
      // Remove undefined
      Object.keys(payload.nutrition).forEach(k => payload.nutrition[k] === undefined && delete payload.nutrition[k]);

      const res = await apiPost('/api/foods', payload, cookies, csrf);
      if (res.status === 200 || res.status === 201) {
        rAdded++;
        console.log(`  ✔ ${r.name}`);
      }
    }
    console.log(`✅ Recipes: ${rAdded} cooked dishes added`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`🎉 Food library seeded! Total: ${added} IFCT ingredients + cooked dishes`);
  console.log('');
  console.log('Now in NutriTrace:');
  console.log('  1. Go to Diary → tap "+" on any meal');
  console.log('  2. Search by ingredient name (e.g. "Bajra", "Ragi", "Dal")');
  console.log('  3. Select from the list → set quantity → Save');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('❌ Seeder failed:', err.message);
  process.exit(1);
});
