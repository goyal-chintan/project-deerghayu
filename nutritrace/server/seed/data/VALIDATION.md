# Indian Nutrition Data — Validation Report

_Generated 2026-05-31 by `scripts/validate_data.py`._

- **Ingredients (IFCT 2017):** 542 foods
- **Recipes (INDB 2024.11):** 984 dishes (81 use per-100g fallback; rest per realistic serving)
- **Quarantined at conversion:** 30 recipes (energy/macro contradiction) + 1 sodium fields — see below
- **Accuracy bar:** ±10% vs IFCT 2017 published values on anchor foods
- **Gate result:** ✅ PASS (0 hard issues)

## Anchor accuracy (IFCT 2017 published vs converted)

| Food | Nutrient | Published | Converted | Δ | Within ±10% |
|---|---|--:|--:|--:|:--:|
| Wheat flour, atta | calories | 321 | 320.27 | 0.2% | ✅ |
| Wheat flour, atta | proteins | 10.57 | 10.57 | 0.0% | ✅ |
| Wheat flour, atta | fat | 1.53 | 1.53 | 0.0% | ✅ |
| Wheat flour, atta | carbohydrates | 64.2 | 64.17 | 0.0% | ✅ |
| Wheat flour, atta | iron | 4.1 | 4.1 | 0.0% | ✅ |
| Wheat flour, atta | calcium | 30.9 | 30.94 | 0.1% | ✅ |
| Spinach | calories | 24 | 24.38 | 1.6% | ✅ |
| Spinach | proteins | 2.14 | 2.14 | 0.0% | ✅ |
| Spinach | iron | 2.96 | 2.95 | 0.3% | ✅ |
| Spinach | calcium | 82.3 | 82.29 | 0.0% | ✅ |
| Rice, raw, milled | calories | 356 | 356.36 | 0.1% | ✅ |
| Rice, raw, milled | proteins | 7.94 | 7.94 | 0.0% | ✅ |
| Rice, raw, milled | carbohydrates | 78.2 | 78.24 | 0.1% | ✅ |
| Bengal gram, whole | proteins | 18.0 | 18.77 | 4.3% | ✅ |

## Energy (Atwater) cross-check

Stated calories vs 4·carb + 4·protein + 9·fat. Drift is expected from fiber, organic acids, alcohol and rounding; only >25% is listed.

- Ingredients: 3/528 over 25% drift
- Recipes: 5/984 over 25% drift

| Dataset | Item | Stated kcal | Atwater kcal | Δ |
|---|---|--:|--:|--:|
| IFCT | Lemon, juice | 36.6 | 8.4 | 77% |
| IFCT | Chicken, poultry, leg, skinless | 383.6 | 191.5 | 50% |
| IFCT | Crab | 82.0 | 53.6 | 35% |
| INDB | Minced meat pancake (with chicken) | 155.9 | 235.2 | 51% |
| INDB | Cream of green peas soup | 522.2 | 770.2 | 47% |
| INDB | Small onion pickle | 18.9 | 26.2 | 39% |
| INDB | Chicken pulao | 723.2 | 970.5 | 34% |
| INDB | Mutton pulao | 866.5 | 1114.1 | 29% |

## Nutrient coverage (resolved provenance)

Counts entries with `nutrition_meta.status` ≠ `missing` — i.e. sourced, derived, explicit_zero, or estimated. Missing = unresolved placeholder.

| Nutrient | IFCT resolved | INDB resolved | IFCT missing | INDB missing |
|---|--:|--:|--:|--:|
| calories | 528 / 542 | 984 / 984 | 14 | 0 |
| kilojoules | 528 / 542 | 984 / 984 | 14 | 0 |
| proteins | 528 / 542 | 983 / 984 | 14 | 1 |
| fat | 542 / 542 | 982 / 984 | 0 | 2 |
| saturated-fat | 523 / 542 | 981 / 984 | 19 | 3 |
| trans-fat | 2 / 542 | 0 / 984 | 540 | 984 |
| polyunsaturated-fat | 523 / 542 | 981 / 984 | 19 | 3 |
| monounsaturated-fat | 523 / 542 | 979 / 984 | 19 | 5 |
| cholesterol | 534 / 542 | 621 / 984 | 8 | 363 |
| sodium | 528 / 542 | 982 / 984 | 14 | 2 |
| salt | 528 / 542 | 982 / 984 | 14 | 2 |
| carbohydrates | 313 / 542 | 983 / 984 | 229 | 1 |
| fiber | 306 / 542 | 933 / 984 | 236 | 51 |
| sugars | 314 / 542 | 983 / 984 | 228 | 1 |
| added-sugars | 299 / 542 | 0 / 984 | 243 | 984 |
| calcium | 527 / 542 | 983 / 984 | 15 | 1 |
| iron | 527 / 542 | 983 / 984 | 15 | 1 |
| potassium | 528 / 542 | 983 / 984 | 14 | 1 |
| magnesium | 527 / 542 | 983 / 984 | 15 | 1 |
| zinc | 528 / 542 | 983 / 984 | 14 | 1 |
| phosphorus | 527 / 542 | 983 / 984 | 15 | 1 |
| vitamin-a | 481 / 542 | 618 / 984 | 61 | 366 |
| vitamin-c | 229 / 542 | 885 / 984 | 313 | 99 |
| vitamin-d | 498 / 542 | 945 / 984 | 44 | 39 |
| vitamin-e | 524 / 542 | 979 / 984 | 18 | 5 |
| vitamin-k | 519 / 542 | 969 / 984 | 23 | 15 |
| b1 | 522 / 542 | 982 / 984 | 20 | 2 |
| b2 | 526 / 542 | 982 / 984 | 16 | 2 |
| b3 | 527 / 542 | 982 / 984 | 15 | 2 |
| b6 | 528 / 542 | 981 / 984 | 14 | 3 |
| b9 | 347 / 542 | 979 / 984 | 195 | 5 |
| b12 | 399 / 542 | 44 / 984 | 143 | 940 |
| caffeine | 542 / 542 | 946 / 984 | 0 | 38 |
| alcohol | 541 / 542 | 983 / 984 | 1 | 1 |

### Status breakdown (nutrients with >10% missing)

| Nutrient | Dataset | sourced | derived | explicit_zero | estimated | missing |
|---|---|--:|--:|--:|--:|--:|
| trans-fat | IFCT | 2 | 0 | 0 | 0 | 540 |
| trans-fat | INDB | 0 | 0 | 0 | 0 | 984 |
| cholesterol | INDB | 621 | 0 | 0 | 0 | 363 |
| carbohydrates | IFCT | 313 | 0 | 0 | 0 | 229 |
| fiber | IFCT | 306 | 0 | 0 | 0 | 236 |
| sugars | IFCT | 314 | 0 | 0 | 0 | 228 |
| added-sugars | IFCT | 0 | 0 | 299 | 0 | 243 |
| added-sugars | INDB | 0 | 0 | 0 | 0 | 984 |
| vitamin-a | IFCT | 481 | 0 | 0 | 0 | 61 |
| vitamin-a | INDB | 618 | 0 | 0 | 0 | 366 |
| vitamin-c | IFCT | 229 | 0 | 0 | 0 | 313 |
| vitamin-c | INDB | 885 | 0 | 0 | 0 | 99 |
| b9 | IFCT | 347 | 0 | 0 | 0 | 195 |
| b12 | IFCT | 26 | 0 | 323 | 50 | 143 |
| b12 | INDB | 0 | 0 | 3 | 41 | 940 |

## Known limitations

- **Vitamin B12** — absent from both IFCT and INDB source columns; provenance is now mixed via supplement rules: plant foods carry `explicit_zero` (biochemically cannot contain B12), dairy/egg/meat/fish items have `sourced` or `estimated` values from USDA SR Legacy proxies with citations, and remaining items (non-vegetarian foods without a defensible proxy, most INDB recipes) stay `missing`. The app shows B12 RDA targets; unresolved `missing` entries will read as unmet.
- **Sodium outliers:** the converter drops sodium from ~23 INDB soup/sauce rows whose source value exceeded 8000 mg/100g (physically impossible). 16 remaining recipes still report >2000 mg/100g — high but within INDB's published data; listed below for review.
- **Per-100g fallback:** 81 condiment-type recipes (jams/sauces/etc.) have no defined Indian serving in INDB, so their values are per 100 g.
- Trace nutrients without an app field (copper, selenium, manganese, B5, biotin, carotenoids) are intentionally not carried over.

### Quarantined: energy vs macro contradiction (30 recipes)

Excluded from the seed set. Their INDB energy column reads like a clear soup while protein/fat columns imply 4-7x more energy, so the whole row is untrustworthy (fiber-corrected Atwater > 1.5x stated).

| Atwater ÷ stated | Stated kcal | Recipe |
|--:|--:|---|
| 6.6x | 84.6 | Egg drop soup |
| 6.2x | 68.5 | Chicken sweet corn soup |
| 6.2x | 184.5 | Meat consomme (with mutton) |
| 6.1x | 187.7 | Consomme au vermicelli |
| 5.5x | 163.9 | Spinach soup (Palak ka soup) |
| 5.4x | 213.7 | Consomme au julienne |
| 5.0x | 121.3 | Lentil soup |
| 5.0x | 183.0 | Cheese soup |
| 4.7x | 131.5 | Talaumein soup |
| 4.5x | 50.7 | Classic seasoned black beans |
| 4.3x | 221.3 | Green pea soup (Matar ka soup) |
| 4.1x | 157.4 | Mixed vegetable soup |
| 3.5x | 98.2 | Minestrone soup |
| 3.5x | 189.8 | Mulligatawny soup |
| 3.4x | 195.7 | French onion soup |
| 3.4x | 151.0 | Cold summer garden soup |
| 3.3x | 108.3 | Chicken consomme (Clear chicken soup) |
| 3.3x | 129.8 | Curried Cauliflower soup |
| 3.3x | 129.6 | Millet soup |
| 2.9x | 258.6 | Cream of broccoli soup |
| 2.7x | 278.3 | Cream of carrot soup |
| 2.7x | 286.4 | Cream of potato soup |
| 2.6x | 109.2 | Brown sauce |
| 2.3x | 375.2 | Almond soup (Badam ka soup) |
| 2.1x | 216.2 | Cream of mixed vegetable soup |
| 1.7x | 318.4 | Clear tomato soup (Tamatar ka soup) |
| 1.7x | 364.7 | Spaghetti bolognese |
| 1.5x | 452.3 | Cream of tomato soup |
| 1.5x | 465.1 | Cream of spinach soup |
| 1.5x | 439.8 | Cream of mushroom soup |

<details><summary>Sodium > 2000 mg/100g (16 recipes)</summary>

| mg/100g | mg/serving | Recipe |
|--:|--:|---|
| 7559 | 7559 | Lemon green chilli pickle (Nimboo aur hari mirch ka achaar) |
| 6416 | 6416 | Sweet lemon pickle (Neembu ka meetha achaar) |
| 5000 | 20424 | Cream of green peas soup |
| 4941 | 6641 | Minced meat pancake (with chicken) |
| 4249 | 19779 | Chinese cabbage and meat ball soup |
| 3508 | 3508 | Brinjal pickle (Baingan ka achaar) |
| 3430 | 3430 | Mango pickle (Aam ka achaar) |
| 3116 | 20645 | Mutton pulao |
| 3106 | 3106 | Kashmiri masala |
| 3094 | 20668 | Chicken pulao |
| 2512 | 10061 | Meat and macaroni casserole |
| 2488 | 2488 | Mixed vegetable pickle (Sabziyoon ka achaar) |
| 2415 | 10739 | Chicken manchurian |
| 2274 | 3147 | Savoury puffs |
| 2258 | 10421 | Soya chunks sweet and sour (Nutrinugget sweet and sour) |
| 2067 | 2067 | Jhatpat achar with carrot (Jhatpat achaar gajar ke saath) |

</details>

