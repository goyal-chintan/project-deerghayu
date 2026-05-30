#!/usr/bin/env python3
import os
import re
import json
import sqlite3
import pandas as pd
import numpy as np

# Paths
db_path = "/Users/charu/work/project-deerghayu/data/db/nutritrace.db"
data_dir = "/Users/charu/work/project-deerghayu/nutritrace/scripts/data"
recipes_xlsx_path = os.path.join(data_dir, "ANUVAAD_INDB_2024.xlsx")
recipes_csv_path = os.path.join(data_dir, "Cleaned_Indian_Food_Dataset.csv")

# Nutrient mappings from INDB column names to NutriTrace JSON keys
NUTRIMENT_MAPPING = {
    'energy_kcal': 'calories',
    'protein_g': 'proteins',
    'carb_g': 'carbohydrates',
    'fat_g': 'fat',
    'fibre_g': 'fiber',
    'sodium_mg': 'sodium',
    'potassium_mg': 'potassium',
    'calcium_mg': 'calcium',
    'iron_mg': 'iron',
    'magnesium_mg': 'magnesium',
    'phosphorus_mg': 'phosphorus',
    'zinc_mg': 'zinc',
    'vita_ug': 'vitamin-a',
    'vitc_mg': 'vitamin-c',
    'vitb1_mg': 'b1',
    'vitb2_mg': 'b2',
    'vitb3_mg': 'b3',
    'vitb6_mg': 'b6',
    'folate_ug': 'b9',
}

def clean_name(name):
    if not isinstance(name, str):
        return []
    # Remove parentheses contents or keep them separate
    parts = re.split(r'[\(\)]', name)
    cleaned_parts = []
    for p in parts:
        p = p.lower().strip()
        p = re.sub(r'[^a-z0-9\s]', '', p)
        # remove fillers
        p = re.sub(r'\b(recipe|style|garam|hot|cold|homemade|cooked|raw|dry|fresh|with|and|in|of|for|at|is)\b', '', p)
        p = " ".join(p.split())
        if p:
            cleaned_parts.append(p)
    return cleaned_parts

def get_tokens(text):
    if not isinstance(text, str):
        return set()
    text = text.lower()
    words = re.findall(r'[a-z0-9]+', text)
    stop_words = {'recipe', 'style', 'cooked', 'raw', 'dry', 'fresh', 'with', 'and', 'in', 'of', 'for', 'at', 'is'}
    return {w for w in words if w not in stop_words}

def find_best_match_opt(indb_name, csv_prepared):
    indb_cleaned_parts = clean_name(indb_name)
    if not indb_cleaned_parts:
        return None, 0.0
        
    indb_parts_tokens = [(ip, get_tokens(ip)) for ip in indb_cleaned_parts]
    
    best_match_row = None
    best_score = 0.0
    
    for idx, csv_cleaned_parts, csv_parts_tokens, row in csv_prepared:
        for ip, t1 in indb_parts_tokens:
            for cp, t2 in csv_parts_tokens:
                if not t1 or not t2:
                    continue
                intersection = t1.intersection(t2)
                if not intersection:
                    continue
                jaccard = len(intersection) / len(t1.union(t2))
                overlap = len(intersection) / min(len(t1), len(t2))
                score = 0.5 * jaccard + 0.5 * overlap
                if score > best_score:
                    best_score = score
                    best_match_row = row
                    
    if best_score >= 0.65: # threshold
        return best_match_row, best_score
    return None, 0.0

def seed():
    print("🌱 Loading datasets...")
    indb_df = pd.read_excel(recipes_xlsx_path, sheet_name="INDB")
    csv_df = pd.read_csv(recipes_csv_path)
    
    print(f"Loaded {len(indb_df)} rows from INDB and {len(csv_df)} recipes from Archana's Kitchen.")
    
    # Pre-compute cleaned parts and tokens for all CSV recipes to optimize matching
    print("⚙️ Pre-computing CSV text tokens for fast matching...")
    csv_prepared = []
    for idx, row in csv_df.iterrows():
        csv_name = row['TranslatedRecipeName']
        csv_cleaned_parts = clean_name(csv_name)
        csv_parts_tokens = []
        for cp in csv_cleaned_parts:
            csv_parts_tokens.append((cp, get_tokens(cp)))
        csv_prepared.append((idx, csv_cleaned_parts, csv_parts_tokens, row))
        
    # Separate INDB into raw ingredients and recipes
    recipe_sources = ['asc_manual', 'bfp_manual', 'open_source_recipes']
    indb_recipes = indb_df[indb_df['primarysource'].isin(recipe_sources)]
    indb_raw = indb_df[~indb_df['primarysource'].isin(recipe_sources)]
    
    print(f"INDB breakdown: {len(indb_raw)} raw food items, {len(indb_recipes)} recipes.")
    
    # Connect to SQLite
    if not os.path.exists(db_path):
        print(f"❌ Database not found at {db_path}!")
        return
        
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Find user ID for 'charu'
    cursor.execute("SELECT id FROM users WHERE username = 'charu'")
    user_row = cursor.fetchone()
    user_id = user_row[0] if user_row else 1
    print(f"Using user_id = {user_id} for imported records.")
    
    # ── PART 1: Seed Raw Ingredients to foods Table ─────────────────────────
    print("\n🌾 Seeding raw ingredients into 'foods' table...")
    foods_added = 0
    foods_skipped = 0
    
    # Keep track of existing food names to avoid duplicates
    cursor.execute("SELECT LOWER(name), brand FROM foods WHERE deleted_at IS NULL")
    existing_foods = {f"{row[0].strip()}|{row[1].strip().lower() if row[1] else ''}" for row in cursor.fetchall()}
    
    for _, row in indb_raw.iterrows():
        name = row['food_name'].strip()
        brand_map = {
            'ifct2017': 'IFCT 2017',
            'ifct2004': 'IFCT 2004',
            'ukfct': 'UK CoFID',
            'usda': 'USDA FDC'
        }
        brand = brand_map.get(row['primarysource'], 'INDB Raw')
        
        # Check if already exists
        food_key = f"{name.lower()}|{brand.lower()}"
        if food_key in existing_foods:
            foods_skipped += 1
            continue
            
        # Parse nutrition
        nutrition = {}
        for col_name, json_key in NUTRIMENT_MAPPING.items():
            val = row.get(col_name)
            if pd.notna(val) and val is not None:
                nutrition[json_key] = round(float(val), 3)
                
        # Parse Vitamin D specifically (vitd2_ug + vitd3_ug)
        vitd = 0.0
        has_vitd = False
        if pd.notna(row.get('vitd2_ug')):
            vitd += float(row['vitd2_ug'])
            has_vitd = True
        if pd.notna(row.get('vitd3_ug')):
            vitd += float(row['vitd3_ug'])
            has_vitd = True
        if has_vitd:
            nutrition['vitamin-d'] = round(vitd, 3)
            
        # Remove values <= 0
        nutrition = {k: v for k, v in nutrition.items() if v > 0}
        
        category = row.get('food_group_nin')
        category = category.strip() if pd.notna(category) else 'Ingredient'
        
        notes = f"INDB Group: {category}"
        
        try:
            cursor.execute(
                """INSERT INTO foods (user_id, name, brand, nutrition, portion, unit, img_url, notes, category, barcode, visibility, source_id, updated_at)
                   VALUES (?, ?, ?, ?, 100, 'g', NULL, ?, ?, NULL, 'private', NULL, datetime('now'))""",
                (user_id, name, brand, json.dumps(nutrition), notes, category)
            )
            foods_added += 1
        except Exception as e:
            print(f"Error adding food {name}: {e}")
            
    conn.commit()
    print(f"✅ Seeded foods: {foods_added} added, {foods_skipped} skipped (already exist).")
    
    # ── PART 2: Seed Recipes to meals Table ──────────────────────────────────
    print("\n🍛 Seeding cooked recipes into 'meals' table...")
    recipes_added = 0
    recipes_skipped = 0
    recipes_matched = 0
    
    # Existing recipes
    cursor.execute("SELECT LOWER(name) FROM meals WHERE is_recipe = 1 AND deleted_at IS NULL")
    existing_recipes = {row[0].strip() for row in cursor.fetchall()}
    
    for _, row in indb_recipes.iterrows():
        indb_name = row['food_name'].strip()
        
        # Check if already exists
        if indb_name.lower() in existing_recipes:
            recipes_skipped += 1
            continue
            
        # Look for matching recipe in Archana's Kitchen dataset (using pre-computed list)
        match_row, match_score = find_best_match_opt(indb_name, csv_prepared)
        
        name = indb_name
        img_url = None
        servings = 1
        instructions = ""
        ingredients_str = ""
        cuisine = "Indian"
        
        if match_row is not None:
            recipes_matched += 1
            name = match_row['TranslatedRecipeName']
            img_url = match_row['image-url']
            cuisine = match_row['Cuisine']
            
            try:
                servings = int(match_row['Servings'])
            except:
                servings = 1
                
            instructions = match_row['TranslatedInstructions']
            ingredients_str = match_row['TranslatedIngredients']
            
        # Parse nutrition (INDB columns are per 100g)
        nutrition = {}
        for col_name, json_key in NUTRIMENT_MAPPING.items():
            val = row.get(col_name)
            if pd.notna(val) and val is not None:
                nutrition[json_key] = round(float(val), 3)
                
        # Parse Vitamin D
        vitd = 0.0
        has_vitd = False
        if pd.notna(row.get('vitd2_ug')):
            vitd += float(row['vitd2_ug'])
            has_vitd = True
        if pd.notna(row.get('vitd3_ug')):
            vitd += float(row['vitd3_ug'])
            has_vitd = True
        if has_vitd:
            nutrition['vitamin-d'] = round(vitd, 3)
            
        # Filter zero/empty values
        nutrition = {k: v for k, v in nutrition.items() if v > 0}
        
        # Build notes
        source = f"Source: Indian Nutrient Databank (INDB | Code: {row['food_code']})"
        notes_parts = [source]
        if cuisine:
            notes_parts.append(f"Cuisine: {cuisine}")
        if ingredients_str:
            notes_parts.append(f"\nIngredients:\n{ingredients_str}")
        if instructions:
            notes_parts.append(f"\nInstructions:\n{instructions}")
            
        notes = "\n".join(notes_parts)
        
        # Insert into meals table (is_recipe = 1)
        try:
            cursor.execute(
                """INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, servings, visibility, source_id, updated_at)
                   VALUES (?, ?, ?, '[]', ?, ?, 1, 100, 'g', ?, 'private', NULL, datetime('now'))""",
                (user_id, name, json.dumps(nutrition), img_url, notes, servings)
            )
            recipes_added += 1
        except Exception as e:
            print(f"Error adding recipe {name}: {e}")
            
    conn.commit()
    conn.close()
    
    print(f"✅ Seeded recipes: {recipes_added} added ({recipes_matched} matched with full details & images), {recipes_skipped} skipped.")
    print("\n🎉 Seeding operations complete!")

if __name__ == "__main__":
    seed()
