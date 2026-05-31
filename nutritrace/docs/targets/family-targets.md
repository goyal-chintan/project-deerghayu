# Family Nutrient Targets — ICMR-NIN 2024

All daily targets computed by `server/routes/family.js` → `calculateTargets()`.

## Macronutrients

| Nutrient | Key | Unit | Method |
|----------|-----|------|--------|
| Calories | `calories` | kcal | Mifflin-St Jeor × activity multiplier ± goal adjustment |
| Protein | `proteins` | g | Weight-based (0.8–1.8 g/kg depending on goal) |
| Carbohydrates | `carbohydrates` | g | Remainder after protein + fat calories |
| Fat | `fat` | g | 22–25% of total calories |
| Fiber | `fiber` | g | Age/gender bracketed (see table below) |

## Minerals

| Nutrient | Key | Unit |
|----------|-----|------|
| Calcium | `calcium` | mg |
| Iron | `iron` | mg |
| Zinc | `zinc` | mg |
| Magnesium | `magnesium` | mg |
| Potassium | `potassium` | mg |

## Vitamins

| Nutrient | Key | Unit |
|----------|-----|------|
| Vitamin A | `vitamin-a` | mcg RAE |
| Vitamin C | `vitamin-c` | mg |
| Vitamin D | `vitamin-d` | mcg |
| Folate (B9) | `b9` | mcg DFE |
| Vitamin B12 | `b12` | mcg |

---

## ICMR-NIN 2024 Reference Values

### Zinc (mg/day)

| Age | Male | Female | Pregnancy | Lactation |
|-----|------|--------|-----------|-----------|
| <1 | 2.8 | 2.8 | - | - |
| 1–3 | 3.3 | 3.3 | - | - |
| 4–6 | 5.6 | 5.6 | - | - |
| 7–9 | 7.0 | 7.0 | - | - |
| 10–12 | 8.4 | 8.4 | - | - |
| 13–15 | 11.2 | 9.8 | - | - |
| 16–17 | 12.5 | 9.8 | - | - |
| 18+ | 12.0 | 10.0 | 12.0 | 12.0 |

### Fiber (g/day)

| Age | Male | Female | Pregnancy | Lactation |
|-----|------|--------|-----------|-----------|
| <1 | 0 | 0 | - | - |
| 1–3 | 15 | 15 | - | - |
| 4–8 | 20 | 20 | - | - |
| 9–13 | 26 | 26 | - | - |
| 14–18 | 38 | 26 | - | - |
| 19+ | 38 | 25 | 28 | 29 |

### Folate / B9 (mcg DFE/day)

| Age | All | Pregnancy | Lactation |
|-----|-----|-----------|-----------|
| <1 | 80 | - | - |
| 1–3 | 150 | - | - |
| 4–8 | 200 | - | - |
| 9–13 | 300 | - | - |
| 14+ | 400 | 600 | 500 |

### Vitamin B12 (mcg/day)

| Age | All | Pregnancy | Lactation |
|-----|-----|-----------|-----------|
| <1 | 0.5 | - | - |
| 1–3 | 0.9 | - | - |
| 4–8 | 1.2 | - | - |
| 9–13 | 1.8 | - | - |
| 14+ | 2.2 | 2.6 | 2.8 |

### Magnesium (mg/day)

| Age | Male | Female | Pregnancy | Lactation |
|-----|------|--------|-----------|-----------|
| <1 | 40 | 40 | - | - |
| 1–3 | 65 | 65 | - | - |
| 4–8 | 110 | 110 | - | - |
| 9–13 | 200 | 200 | - | - |
| 14–18 | 340 | 300 | 335 | 300 |
| 19+ | 350 | 310 | 350 | 310 |

### Potassium (mg/day)

| Age | All | Pregnancy | Lactation |
|-----|-----|-----------|-----------|
| <1 | 700 | - | - |
| 1–3 | 2000 | - | - |
| 4–8 | 2300 | - | - |
| 9–13 | 2500 | - | - |
| 14+ | 3500 | 4000 | 4000 |

### Calcium (mg/day)

| Age | All | Pregnancy | Lactation |
|-----|-----|-----------|-----------|
| <1 | 500 | - | - |
| 1–8 | 800 | - | - |
| 9–18 | 1300 | - | - |
| 19+ | 1000 | 1200 | 1200 |

### Iron (mg/day)

| Age | Male | Female | Pregnancy | Lactation |
|-----|------|--------|-----------|-----------|
| <1 | 7 | 7 | - | - |
| 1–8 | 10 | 10 | - | - |
| 9–12 | 8 | 8 | - | - |
| 13–18 | 11 | 15 | - | - |
| 19+ | 8 | 18 | 27 | 9 |

### Vitamin A (mcg RAE/day)

| Age | Male | Female | Pregnancy | Lactation |
|-----|------|--------|-----------|-----------|
| <1 | 400 | 400 | - | - |
| 1–8 | 400 | 400 | - | - |
| 9–12 | 600 | 600 | - | - |
| 13–18 | 900 | 700 | - | - |
| 19+ | 900 | 700 | 770 | 1300 |

### Vitamin C (mg/day)

| Age | Male | Female | Pregnancy | Lactation |
|-----|------|--------|-----------|-----------|
| <1 | 40 | 40 | - | - |
| 1–8 | 45 | 45 | - | - |
| 9–12 | 45 | 45 | - | - |
| 13–18 | 75 | 65 | - | - |
| 19+ | 90 | 75 | 85 | 120 |

### Vitamin D (mcg/day)

| Age | All | Pregnancy | Lactation |
|-----|-----|-----------|-----------|
| <1 | 10 | - | - |
| 1+ | 15 | 15 | 15 |

---

## Implementation Notes

- All targets computed server-side in `calculateTargets()` and stored as JSON in the `targets` column.
- Custom overrides via `custom_targets` merge on top of computed values.
- Frontend keys match `nutrition.js` NUTRIMENTS IDs: `zinc`, `fiber`, `b9`, `b12`, `magnesium`, `potassium`.
- Life stages (pregnancy/lactation) override all age-bracketed values.
