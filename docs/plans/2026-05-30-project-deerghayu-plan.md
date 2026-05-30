# Project Deerghayu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local-first family nutrition tracking and meal planning system using NutriTrace inside Docker, pre-seeded with IFCT 2017 raw foods and common North Indian cooked vegetarian recipes, with daily RDA goals matching ICMR-NIN 2024 standards.

**Architecture:** A local Docker container running the NutriTrace SvelteKit PWA on SQLite. A Node.js compiler script pulls data from `@nodef/ifct2017` and parses cooked recipes, outputs a Portable JSON payload, which is imported via the UI.

**Tech Stack:** Docker, Docker Compose, SQLite, Node.js, `@nodef/ifct2017`.

---

### Task 1: Project Scaffolding & Git Configurations

**Files:**
- Create: `/Users/charu/work/project-deerghayu/docker-compose.yml`
- Create: `/Users/charu/work/project-deerghayu/.env.example`
- Create: `/Users/charu/work/project-deerghayu/.gitignore`

- [ ] **Step 1: Create the gitignore file**
  Create `/Users/charu/work/project-deerghayu/.gitignore` with the following contents:
  ```
  .DS_Store
  .env
  node_modules/
  data/
  importer/nutritrace-indian-foods.json
  ```

- [ ] **Step 2: Create the .env.example file**
  Create `/Users/charu/work/project-deerghayu/.env.example` with the following contents:
  ```ini
  # Path on the host machine to store SQLite database
  DATA_DB_PATH=./data/db
  # Path on the host machine to store uploaded images and backups
  DATA_UPLOADS_PATH=./data/uploads
  # A long random string for authentication
  JWT_SECRET=super-secret-random-jwt-key-replace-this
  ```

- [ ] **Step 3: Create the docker-compose.yml file**
  Create `/Users/charu/work/project-deerghayu/docker-compose.yml` with the following contents:
  ```yaml
  services:
    nutritrace:
      image: ghcr.io/traceapps/nutritrace:latest
      container_name: nutritrace
      ports:
        - "3000:3001"
      volumes:
        - ${DATA_DB_PATH}:/data/db
        - ${DATA_UPLOADS_PATH}:/data/uploads
      environment:
        - DB_PATH=/data/db/nutritrace.db
        - UPLOADS_PATH=/data/uploads
        - JWT_SECRET=${JWT_SECRET}
      restart: unless-stopped
  ```

- [ ] **Step 4: Create local data directories**
  Run: `mkdir -p /Users/charu/work/project-deerghayu/data/db /Users/charu/work/project-deerghayu/data/uploads`

- [ ] **Step 5: Copy .env.example to .env**
  Run: `cp /Users/charu/work/project-deerghayu/.env.example /Users/charu/work/project-deerghayu/.env`
  Replace `JWT_SECRET` in `.env` with a secure randomly generated string.

- [ ] **Step 6: Commit**
  Run:
  ```bash
  git add .gitignore .env.example docker-compose.yml
  git commit -m "chore: setup Docker Compose and project scaffolding"
  ```

---

### Task 2: Family RDA Target Mappings (ICMR-NIN 2024)

**Files:**
- Create: `/Users/charu/work/project-deerghayu/docs/targets/family-targets.md`

- [ ] **Step 1: Write target profile documentation**
  Create `/Users/charu/work/project-deerghayu/docs/targets/family-targets.md` documenting the daily targets for the family members:
  ```markdown
  # ICMR-NIN 2024 Family Nutritional Targets

  Input these values into NutriTrace Profile Settings for daily goals.

  ## 1. Adult Male (65kg, Sedentary)
  *   Energy: 2,110 kcal
  *   Protein: 54g
  *   Carbohydrates: 250g (approx 55% energy)
  *   Fat: 20-30% of energy
  *   Dietary Fiber: 30g
  *   Calcium: 1,000mg
  *   Iron: 17mg
  *   Zinc: 17mg
  *   Vitamin C: 80mg
  *   Vitamin B12: 2.2 mcg
  *   Folate: 220 mcg

  ## 2. Adult Female (55kg, Sedentary, Premenopausal)
  *   Energy: 1,662 kcal
  *   Protein: 46g
  *   Carbohydrates: 200g
  *   Dietary Fiber: 25g
  *   Calcium: 1,000mg
  *   Iron: 21mg (high focus)
  *   Zinc: 13.2mg
  *   Vitamin C: 80mg
  *   Vitamin B12: 2.2 mcg
  *   Folate: 220 mcg

  ## 3. 9-Month-Old Infant
  *   Energy: 670 kcal (breast milk + solids)
  *   Protein: 10g
  *   Calcium: 270mg (critical)
  *   Iron: 11mg (critical - breast milk is deficient)
  *   Zinc: 3mg
  *   Vitamin C: 50mg (enhances iron)
  *   Vitamin B12: 0.5 mcg
  *   Vitamin D: 400 IU (supplement suggested)
  ```

- [ ] **Step 2: Commit**
  Run:
  ```bash
  git add docs/targets/family-targets.md
  git commit -m "docs: add family RDA targets documentation"
  ```

---

### Task 3: Seed Cooked Recipes Database

**Files:**
- Create: `/Users/charu/work/project-deerghayu/importer/datasets/cooked-recipes.json`

- [ ] **Step 1: Write seed recipe dataset**
  Create the `/Users/charu/work/project-deerghayu/importer/datasets/cooked-recipes.json` file containing pre-computed nutrition profiles (per 100g cooked dish) for common North Indian vegetarian/vegan foods:
  ```json
  [
    {
      "name": "Moong Dal Khichdi (Cooked)",
      "brand": "Homemade",
      "category": "Dishes",
      "notes": "Traditional cooked rice and moong dal khichdi. Comfort food, easy to digest.",
      "portion": 100,
      "unit": "g",
      "nutrition": {
        "calories": 115,
        "proteins": 4.2,
        "carbohydrates": 19.8,
        "fat": 2.1,
        "fiber": 2.5,
        "calcium": 22,
        "iron": 1.2,
        "zinc": 0.8,
        "sodium": 240,
        "vitamin-c": 1.5,
        "b1": 0.08,
        "b2": 0.04,
        "b3": 0.6,
        "b9": 35
      }
    },
    {
      "name": "Ragi Porridge (Cooked)",
      "brand": "Homemade",
      "category": "Dishes",
      "notes": "Finger millet porridge. High calcium champion, excellent for infant solid foods.",
      "portion": 100,
      "unit": "g",
      "nutrition": {
        "calories": 95,
        "proteins": 1.8,
        "carbohydrates": 18.2,
        "fat": 1.1,
        "fiber": 2.1,
        "calcium": 86,
        "iron": 1.0,
        "zinc": 0.5,
        "sodium": 15
      }
    },
    {
      "name": "Whole Wheat Roti (Cooked)",
      "brand": "Homemade",
      "category": "Bread",
      "notes": "Standard Indian flatbread cooked on tawa without ghee/oil.",
      "portion": 100,
      "unit": "g",
      "nutrition": {
        "calories": 264,
        "proteins": 8.5,
        "carbohydrates": 54.0,
        "fat": 1.5,
        "fiber": 8.2,
        "calcium": 35,
        "iron": 3.2,
        "zinc": 2.1,
        "sodium": 3,
        "b1": 0.35,
        "b2": 0.12,
        "b3": 3.8,
        "b9": 28
      }
    },
    {
      "name": "Palak Paneer (Cooked)",
      "brand": "Homemade",
      "category": "Dishes",
      "notes": "Spinach curry with paneer. Rich in calcium, Vitamin A, and protein.",
      "portion": 100,
      "unit": "g",
      "nutrition": {
        "calories": 142,
        "proteins": 7.2,
        "carbohydrates": 3.8,
        "fat": 11.2,
        "fiber": 2.2,
        "calcium": 210,
        "iron": 1.8,
        "zinc": 1.1,
        "sodium": 310,
        "vitamin-c": 12.0,
        "vitamin-a": 340,
        "b9": 65,
        "b12": 0.35
      }
    },
    {
      "name": "Sprouted Moong Salad (Raw/Steamed)",
      "brand": "Homemade",
      "category": "Salad",
      "notes": "Sprouted whole green gram. Highly bioavailable vitamins and minerals due to germination.",
      "portion": 100,
      "unit": "g",
      "nutrition": {
        "calories": 128,
        "proteins": 8.8,
        "carbohydrates": 21.0,
        "fat": 0.6,
        "fiber": 4.5,
        "calcium": 38,
        "iron": 2.4,
        "zinc": 1.2,
        "sodium": 12,
        "vitamin-c": 16.0,
        "vitamin-a": 12,
        "b1": 0.18,
        "b2": 0.15,
        "b3": 1.2,
        "b9": 85
      }
    }
  ]
  ```

- [ ] **Step 2: Commit**
  Run:
  ```bash
  git add importer/datasets/cooked-recipes.json
  git commit -m "feat: add Indian cooked recipes dataset seed"
  ```

---

### Task 4: Node.js Data Importer Utility

**Files:**
- Create: `/Users/charu/work/project-deerghayu/importer/package.json`
- Create: `/Users/charu/work/project-deerghayu/importer/index.js`

- [ ] **Step 1: Create package.json**
  Create the `/Users/charu/work/project-deerghayu/importer/package.json` with the following configuration:
  ```json
  {
    "name": "project-deerghayu-importer",
    "version": "1.0.0",
    "type": "module",
    "description": "Imports IFCT 2017 & INDB 2024 cooked dishes into NutriTrace Portable JSON format",
    "main": "index.js",
    "dependencies": {
      "@nodef/ifct2017": "^1.0.12"
    }
  }
  ```

- [ ] **Step 2: Write index.js script**
  Create `/Users/charu/work/project-deerghayu/importer/index.js` which:
  1. Loads `@nodef/ifct2017` composition database.
  2. Map-reduces raw composition columns to NutriTrace flat nutrient keys.
  3. Appends the pre-computed cooked recipes.
  4. Generates a Portable JSON backup file matching the SvelteKit endpoint requirements.
  ```javascript
  import fs from 'fs';
  import path from 'path';
  import * as ifct2017 from '@nodef/ifct2017';

  async function generateImportFile() {
    console.log('Loading IFCT 2017 database...');
    await ifct2017.loadCompositions();
    
    // We fetch the complete corpus of IFCT composition items.
    // The compositions library exposes a lookup list or full corpus database.
    // Let's pull the raw database records.
    const rawComps = ifct2017.compositions.corpus;
    console.log(`Loaded ${rawComps.size} raw IFCT food items.`);

    const foodList = [];

    // Map raw IFCT 2017 foods
    for (const [code, item] of rawComps.entries()) {
      const name = item.name;
      // Get composition details
      const detail = ifct2017.compositions(code);
      if (!detail) continue;

      const nutrition = {
        calories: Number(detail.enerc) || 0,
        proteins: Number(detail.prot) || 0,
        carbohydrates: Number(detail.cho) || Number(detail.chocdf) || 0,
        fat: Number(detail.fat) || 0,
        fiber: Number(detail.fibtg) || Number(detail.fibts) || 0,
        calcium: Number(detail.ca) || 0,
        iron: Number(detail.fe) || 0,
        zinc: Number(detail.zn) || 0,
        magnesium: Number(detail.mg) || 0,
        potassium: Number(detail.k) || 0,
        sodium: Number(detail.na) || 0,
        'vitamin-c': Number(detail.vitc) || 0,
        'vitamin-a': Number(detail.vita) || 0,
        'vitamin-d': Number(detail.vitd) || 0,
        'vitamin-e': Number(detail.vite) || 0,
        'vitamin-k': Number(detail.vitk1) || 0,
        b1: Number(detail.thia) || 0,
        b2: Number(detail.ribf) || 0,
        b3: Number(detail.nia) || 0,
        b6: Number(detail.vitb6) || 0,
        b9: Number(detail.folsum) || Number(detail.foldfe) || 0,
        b12: Number(detail.vitb12) || 0
      };

      // Strip zero-values to keep database size compact
      for (const k of Object.keys(nutrition)) {
        if (nutrition[k] === 0) delete nutrition[k];
      }

      foodList.push({
        name: name,
        brand: "IFCT 2017",
        category: item.group || "Ingredients",
        portion: 100,
        unit: "g",
        nutrition
      });
    }

    // Load cooked seed recipes
    console.log('Loading cooked seed recipes...');
    const recipeDataPath = path.resolve('datasets/cooked-recipes.json');
    const cookedDishes = JSON.parse(fs.readFileSync(recipeDataPath, 'utf8'));

    // Merge cooked dishes into the food list
    for (const dish of cookedDishes) {
      foodList.push(dish);
    }

    // Wrap in Portable JSON backup container format for NutriTrace bulk-import
    const importPayload = {
      foodList: foodList
    };

    const outputPath = path.resolve('nutritrace-indian-foods.json');
    fs.writeFileSync(outputPath, JSON.stringify(importPayload, null, 2));
    console.log(`Success! Wrote ${foodList.length} items to ${outputPath}`);
  }

  generateImportFile().catch(console.error);
  ```

- [ ] **Step 3: Install dependencies & run generator**
  Run:
  ```bash
  cd /Users/charu/work/project-deerghayu/importer
  npm install
  node index.js
  ```
  Expected: Successful compilation message showing output file written with 540+ items.

- [ ] **Step 4: Commit**
  Run:
  ```bash
  cd /Users/charu/work/project-deerghayu
  git add importer/package.json importer/index.js
  git commit -m "feat: implement Node.js importer script"
  ```

---

### Task 5: Launch Container & Seed Data

**Files:**
- Modify: `/Users/charu/work/project-deerghayu/README.md` (Create the file if not exists)

- [ ] **Step 1: Write setup guide to README.md**
  Create `/Users/charu/work/project-deerghayu/README.md` with execution and launch guidelines:
  ```markdown
  # Project Deerghayu

  Privacy-focused, local-first Indian diet and baby nutrition tracking system.

  ## Quick Start

  1.  **Generate Food Database JSON**:
      ```bash
      cd importer
      npm install
      node index.js
      ```
  2.  **Start NutriTrace**:
      ```bash
      cd ..
      docker compose up -d
      ```
  3.  **Setup Account**:
      *   Open `http://localhost:3000` in your web browser.
      *   Follow the startup wizard to create an admin account.
  4.  **Import Database**:
      *   Navigate to **Settings → Import & Export** (under Backup & Restore).
      *   Choose **Bulk Food Import** / **Upload JSON**.
      *   Select the compiled `importer/nutritrace-indian-foods.json` file.
  5.  **Set Family Profile Goals**:
      *   Use target metrics defined in `docs/targets/family-targets.md` to configure goals for family members under profiles.
  ```

- [ ] **Step 2: Spin up the docker containers**
  Run: `docker compose up -d` in `/Users/charu/work/project-deerghayu`
  Expected: Download and launch of NutriTrace.

- [ ] **Step 3: Commit**
  Run:
  ```bash
  git add README.md
  git commit -m "docs: add project README quick start instructions"
  ```
