# 🥗 Project Deerghayu
### Family Nutrition Tracking System — Indian Vegetarian / Vegan

> **Deerghayu** (दीर्घायु) — Sanskrit for "long life". A local-first nutrition
> planning system tailored for North Indian vegetarian and vegan families,
> including tracking for infants as young as 9 months.

---

## 🏗 Architecture

```
project-deerghayu/
├── importer/                  ← Data pipeline
│   ├── index.js               ← IFCT 2017 → NutriTrace CSV converter
│   ├── datasets/
│   │   └── cooked-recipes.json  ← North Indian cooked dish database
│   └── output/
│       └── deerghayu-food-database.csv  ← Generated import file
├── data/
│   ├── db/                    ← NutriTrace SQLite database (persistent)
│   └── uploads/               ← Uploaded images
├── docs/                      ← Specs, RDA targets, roadmap
├── start-nutritrace.sh        ← One-click server startup
└── docker-compose.yml         ← Docker deployment (optional)
```

**Data Sources:**
- 🇮🇳 **IFCT 2017** (`@nodef/ifct2017`) — 328 Indian raw ingredients with full micronutrient profiles
- 🍛 **Homemade recipes** (`datasets/cooked-recipes.json`) — North Indian cooked dishes
- 📱 **NutriTrace** — Free, open-source nutrition diary (self-hosted)

---

## 🚀 Quick Start

### Start NutriTrace

```bash
./start-nutritrace.sh
```

Then open **http://localhost:3002** in your browser.

**First time only:** Create your admin account when prompted.

### Regenerate the Food Database

```bash
cd importer
node index.js          # Generates output/deerghayu-food-database.csv
```

---

## 📥 Importing Food Data into NutriTrace

1. Start NutriTrace (`./start-nutritrace.sh`)
2. Log in and go to **Settings → Import Data**
3. Choose source: **Spreadsheet (CSV)**
4. Upload: `importer/output/deerghayu-food-database.csv`
5. Review preview → click **Import**

The database includes:
- ✅ 328 Indian vegetarian/vegan raw ingredients (IFCT 2017)
- ✅ 5 cooked North Indian dishes (khichdi, ragi porridge, roti, palak paneer, sprouted moong)

---

## 👨‍👩‍👧‍👦 Family Setup

Each family member needs their own NutriTrace account:

| Profile | Notes |
|---------|-------|
| Charu (you) | Set your weight, height, activity level → auto-calculates RDA |
| Spouse | Separate account, separate goals |
| Baby (9 months) | Use Indian Pediatric RDA targets — see `docs/` |

### Key Nutrient Targets (ICMR-NIN 2024)

| Nutrient | Adult Woman | Adult Man | 9-month Infant |
|----------|-------------|-----------|----------------|
| Calories | ~1900 kcal | ~2320 kcal | ~615 kcal |
| Protein | 46 g | 54 g | 13.7 g |
| Calcium | 600 mg | 600 mg | 500 mg |
| Iron | 15 mg | 9 mg | 7 mg |
| Zinc | 10 mg | 12 mg | 5.8 mg |
| Vitamin B12 | 1.2 µg | 1.2 µg | 1.2 µg |
| Vitamin D | 15 µg | 15 µg | 10 µg |
| Folate | 220 µg | 220 µg | 80 µg |

---

## 🔧 Adding More Recipes

Edit `importer/datasets/cooked-recipes.json` and add entries like:

```json
{
  "name": "Dal Makhani (Cooked)",
  "brand": "Homemade",
  "category": "Dishes",
  "notes": "Rich black lentil curry with cream and butter",
  "portion": 100,
  "unit": "g",
  "nutrition": {
    "calories": 152,
    "proteins": 8.2,
    "carbohydrates": 18.4,
    "fat": 5.2,
    "fiber": 4.8,
    "calcium": 48,
    "iron": 2.8,
    "zinc": 1.4,
    "sodium": 380,
    "b9": 52
  }
}
```

Then re-run the importer: `cd importer && node index.js`

---

## 📱 Mobile Access

NutriTrace works in any mobile browser. Access from your phone using your Mac's local IP:
1. Find your Mac IP: `ipconfig getifaddr en0`
2. Open `http://<your-mac-ip>:3002` on your phone (same WiFi network)

---

## 🔁 Running on Startup (Optional)

Add to your shell profile (~/.zshrc):
```bash
# Auto-start NutriTrace
alias nutrition="cd /Users/charu/work/project-deerghayu && ./start-nutritrace.sh"
```

---

## 📚 References

- IFCT 2017 — Indian Food Composition Tables 2017 (NIN, Hyderabad)
- ICMR-NIN 2024 — Nutrient Requirements for Indians
- NutriTrace — https://github.com/traceapps/nutritrace

---

## 🛠 Development

```bash
# Regenerate food database (with all vegetarian items)
cd importer && node index.js

# Include non-vegetarian items too (e.g., fish-based items in IFCT)
cd importer && node index.js --all

# Limit output size (for testing)
cd importer && node index.js --max=50
```
