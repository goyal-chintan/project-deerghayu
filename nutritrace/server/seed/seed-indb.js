/**
 * seed-indb.js — CLI entrypoint for seeding IFCT foods + INDB recipes.
 *
 * Usage:
 *   node seed/seed-indb.js --owner <username|id> [--db <path>]
 *   npm run seed:indb -- --owner sunita
 *
 * - Resolves the owner by username or numeric id.
 * - Loads both JSON datasets and seeds them into the database.
 * - Prints a summary of inserted/updated counts.
 * - Idempotent: safe to run multiple times.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedFoods, seedRecipes } from './seed-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse minimal CLI args: --db <path> and --owner <username|id>.
 */
function parseArgs(argv) {
  const args = { db: null, owner: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) {
      args.db = argv[++i];
    } else if (argv[i] === '--owner' && argv[i + 1]) {
      args.owner = argv[++i];
    }
  }
  return args;
}

/**
 * Main entrypoint — only executes when this file is run directly.
 */
async function main() {
  const args = parseArgs(process.argv);

  if (!args.owner) {
    console.error('Error: --owner <username|id> is required.');
    console.error('Usage: node seed/seed-indb.js --owner <username|id> [--db <path>]');
    process.exit(1);
  }

  // Resolve DB path: CLI arg > env > default
  const dbPath = resolve(args.db || process.env.DB_PATH || './nutritrace.db');
  process.env.DB_PATH = dbPath;

  // Dynamic import of db.js ensures schema/migrations run first
  const { default: db } = await import('../db.js');

  // Resolve owner: numeric id or username lookup
  let ownerId;
  if (/^\d+$/.test(args.owner)) {
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(args.owner));
    if (!row) {
      const users = db.prepare('SELECT id, username FROM users').all();
      console.error(`Error: no user found with id=${args.owner}.`);
      if (users.length) {
        console.error('Available users:');
        for (const u of users) console.error(`  id=${u.id}  username=${u.username}`);
      } else {
        console.error('No users exist in the database. Create a user first.');
      }
      process.exit(1);
    }
    ownerId = row.id;
  } else {
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(args.owner);
    if (!row) {
      const users = db.prepare('SELECT id, username FROM users').all();
      console.error(`Error: no user found with username="${args.owner}".`);
      if (users.length) {
        console.error('Available users:');
        for (const u of users) console.error(`  id=${u.id}  username=${u.username}`);
      } else {
        console.error('No users exist in the database. Create a user first.');
      }
      process.exit(1);
    }
    ownerId = row.id;
  }

  // Load datasets (paths relative to this file)
  const foodsPath = resolve(__dirname, 'data', 'ifct-foods.json');
  const recipesPath = resolve(__dirname, 'data', 'indb-recipes.json');

  const foods = JSON.parse(readFileSync(foodsPath, 'utf-8'));
  const recipes = JSON.parse(readFileSync(recipesPath, 'utf-8'));

  console.log(`Seeding ${foods.length} IFCT foods + ${recipes.length} INDB recipes for user id=${ownerId}...`);

  // Seed foods
  const foodResult = seedFoods(db, ownerId, foods);
  console.log(`Foods: ${foodResult.inserted} inserted / ${foodResult.updated} updated / ${foodResult.skipped} skipped`);

  // Seed recipes
  const recipeResult = seedRecipes(db, ownerId, recipes);
  console.log(`Recipes: ${recipeResult.inserted} inserted / ${recipeResult.updated} updated / ${recipeResult.skipped} skipped`);

  // Report validation errors
  const allErrors = [...foodResult.errors, ...recipeResult.errors];
  if (allErrors.length) {
    console.error(`\nValidation errors (${allErrors.length}):`);
    for (const e of allErrors.slice(0, 10)) console.error(`  • ${e}`);
    if (allErrors.length > 10) console.error(`  ... and ${allErrors.length - 10} more`);
  }

  // Report recipe conflicts (user-owned same-name rows)
  if (recipeResult.conflicts.length) {
    console.warn(`\nRecipe conflicts (${recipeResult.conflicts.length} skipped — user recipes with same name):`);
    for (const c of recipeResult.conflicts.slice(0, 10)) {
      console.warn(`  • "${c.name}" (${c.code}): ${c.reason}`);
    }
    if (recipeResult.conflicts.length > 10) {
      console.warn(`  ... and ${recipeResult.conflicts.length - 10} more`);
    }
  }

  if (allErrors.length) {
    console.error('\nDone with validation errors. Fix seed data and re-run.');
    process.exit(2);
  }

  console.log('Done.');
}

// Only run main() when this file is the entrypoint (not when imported for tests)
const thisFile = fileURLToPath(import.meta.url);
const entryFile = resolve(process.argv[1] || '');
if (thisFile === entryFile) {
  main();
}

export { main, parseArgs };
