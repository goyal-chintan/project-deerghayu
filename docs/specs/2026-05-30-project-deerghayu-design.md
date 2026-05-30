# Project Deerghayu: Design Specification

Local-first, privacy-respecting family nutrition tracking and meal planning system tailored for North Indian vegetarian/vegan diets and infant development.

---

## 1. System Architecture

Project Deerghayu is composed of three main parts:
1.  **NutriTrace Core**: Containerized instance of the NutriTrace SvelteKit app running locally on SQLite.
2.  **Indian Food Database Importer**: A Node.js utility script that compiles a hybrid dataset of raw ingredients (IFCT 2017) and cooked dishes (INDB 2024) into a single JSON import file.
3.  **Family Target Configurations**: Pre-defined ICMR-NIN 2024 target profiles for the family members (Adult Male, Adult Female, and 9-Month-Old Infant) that can be imported to set daily RDA goals.

```mermaid
graph TD
    A[Docker Compose] --> B(NutriTrace SvelteKit PWA)
    B --> C[(Local SQLite Database)]
    D[Node.js Importer Script] -->|Query| E[@nodef/ifct2017 npm]
    D -->|Process| F[INDB 2024 Cooked Recipes]
    D -->|Generate| G[nutritrace-indian-foods.json]
    G -->|Web UI Settings Import| B
    H[ICMR-NIN 2024 Profiles] -->|Manual Target Config| B
```

---

## 2. Directory Structure

```
project-deerghayu/
├── docker-compose.yml         # NutriTrace container configuration
├── .env.example               # Template for paths and secrets
├── data/                      # Persisted SQLite db and image uploads (git-ignored)
│   ├── db/
│   └── uploads/
├── docs/
│   ├── specs/                 # Design specs
│   │   └── 2026-05-30-project-deerghayu-design.md
│   └── targets/               # RDA Profile target values
│       └── family-targets.md  # ICMR-NIN 2024 nutritional target guide
└── importer/                  # Node.js compiler toolchain
    ├── package.json           # Importer dependencies (@nodef/ifct2017)
    ├── index.js               # Merges IFCT 2017 & INDB 2024 -> Portable JSON
    └── datasets/              # Bundled cooked recipes (INDB 2024)
```

---

## 3. Data Integration & Column Mapping

The Node.js importer script merges raw ingredients and cooked recipes. All nutrient values are scaled to **per 100g** to match NutriTrace's database standard.

### Nutrient Key Mappings

| NutriTrace Key | IFCT 2017 Code | Unit | Description |
| :--- | :--- | :--- | :--- |
| `calories` | `enerc` | kcal | Calories |
| `proteins` | `prot` | g | Protein |
| `carbohydrates` | `cho` | g | Carbohydrates |
| `fat` | `fat` | g | Total Fat |
| `fiber` | `fibtg` | g | Dietary Fiber |
| `calcium` | `ca` | mg | Calcium (Critical for infant/adult) |
| `iron` | `fe` | mg | Iron (Critical for infant/female) |
| `zinc` | `zn` | mg | Zinc (Bioavailability focus) |
| `magnesium` | `mg` | mg | Magnesium |
| `potassium` | `k` | mg | Potassium |
| `sodium` | `na` | mg | Sodium |
| `vitamin-c` | `vitc` | mg | Vitamin C (Enhances iron absorption) |
| `vitamin-a` | `vita` | µg RAE | Vitamin A |
| `vitamin-d` | `vitd` | µg | Vitamin D |
| `vitamin-e` | `vite` | mg | Vitamin E |
| `vitamin-k` | `vitk1` | µg | Vitamin K |
| `b1` | `thia` | mg | Thiamine |
| `b2` | `ribf` | mg | Riboflavin |
| `b3` | `nia` | mg | Niacin |
| `b6` | `vitb6` | mg | Vitamin B6 |
| `b9` | `folsum` | µg | Folate |
| `b12` | `vitb12` | µg | Vitamin B12 (Critical for vegetarians) |

---

## 4. Family Target Configurations (ICMR-NIN 2024)

These daily targets will be documented in `docs/targets/family-targets.md` for manual configuration in the NutriTrace Profile Settings:

### Profiles Overview

1.  **Adult Male (Sedentary)**: Focuses on baseline energy (2,110 kcal), fiber (30g), and standard vitamins.
2.  **Adult Female (Sedentary, Premenopausal)**: Focuses on higher Iron (21mg/day) and Folate (220 mcg).
3.  **9-Month-Old Infant**: Focuses on high Iron (11mg/day), Calcium (270mg/day), Zinc (3mg/day), and Vitamin D (400 IU/day).

---

## 5. Setup & Verification Plan

### Automated Verification
*   **Syntax Check**: Validate generated JSON file schema compatibility.
*   **Container Startup**: Verify Docker Compose brings up NutriTrace and creates the SQLite database successfully.

### Manual Verification
*   **Web Portal**: Verify the dashboard is accessible on `http://localhost:3000`.
*   **Import Test**: Execute the Portable JSON import via the Settings interface and verify Indian raw foods (e.g., "Ragi") and cooked dishes are searchable and loggable.
*   **LAN Connectivity**: Test accessing the local IP address on a mobile device and adding the PWA to the home screen.
