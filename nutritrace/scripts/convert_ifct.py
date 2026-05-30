#!/usr/bin/env python3
"""
convert_ifct.py — Convert IFCT 2017 (ICMR-NIN) ingredient data to app JSON.

Source: nodef/ifct2017 extract of the Indian Food Composition Tables 2017,
National Institute of Nutrition (ICMR), Hyderabad. Values are lab-measured.
Output: nutritrace/server/seed/data/ifct-foods.json (committed, reviewable).

Nutrition values are factual; provenance is recorded per row. AGPL-licensed
extract — only numeric facts + citation are carried over (license mitigation).
"""
import os, json, math, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "ifct_compositions.csv")
OUT = os.path.join(HERE, "..", "server", "seed", "data", "ifct-foods.json")
SRC_URL = "https://raw.githubusercontent.com/nodef/ifct2017/master/compositions/index.csv"

# IFCT code -> (app nutrition.js key, multiplier from STORED grams to app unit).
#
# The nodef/ifct2017 extract stores every `type:mass` column in GRAMS and
# `enerc` in kJ (verified against the repo's representations/index.csv, which
# lists each column's display {type, factor, unit}). The app's units differ
# per nutrient (see src/lib/nutrition.js NUTRIMENTS), so each value must be
# scaled from grams to the app's unit:
#   g -> g  : x1        (macros)
#   g -> mg : x1000     (cholesterol, minerals, B1/B2/B3/B6, C, E)
#   g -> µg : x1_000_000 (vitamin A/D/K, folate B9)
# Energy is handled separately (kJ -> kcal, /4.184).
G, MG, UG = 1, 1000, 1_000_000
CODE_MAP = {
    # macronutrients (app unit: g)
    "protcnt": ("proteins", G), "fatce": ("fat", G), "fibtg": ("fiber", G),
    "choavldf": ("carbohydrates", G), "fsugar": ("sugars", G),
    # cholesterol (app unit: mg)
    "cholc": ("cholesterol", MG),
    # minerals (app unit: mg)
    "ca": ("calcium", MG), "fe": ("iron", MG), "mg": ("magnesium", MG),
    "p": ("phosphorus", MG), "k": ("potassium", MG), "na": ("sodium", MG),
    "zn": ("zinc", MG),
    # vitamins (app unit: mg or µg per nutrition.js)
    "vita": ("vitamin-a", UG), "vitc": ("vitamin-c", MG), "vite": ("vitamin-e", MG),
    "thia": ("b1", MG), "ribf": ("b2", MG), "nia": ("b3", MG),
    "vitb6c": ("b6", MG), "folsum": ("b9", UG),
}

def num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None

def diet_from_tags(tags):
    t = (tags or "").lower()
    if "vegetarian" in t:      # compatible with veg diet => it's a veg food
        return "vegetarian"
    if "eggetarian" in t:
        return "eggetarian"
    return "non-vegetarian"    # meat/fish only

def main():
    import csv
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    if not os.path.exists(CACHE):
        print("Downloading IFCT compositions…")
        urllib.request.urlretrieve(SRC_URL, CACHE)
    with open(CACHE, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    print(f"Loaded {len(rows)} IFCT rows; {len(rows[0])} columns")

    out = []
    diet_counts = {}
    for r in rows:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        nutrition = {}
        # Energy: enerc is stored in kJ (representations/index.csv) -> kcal.
        e = num(r.get("enerc"))
        if e and e > 0:
            nutrition["calories"] = round(e / 4.184, 2)
        # Convert each mapped column from stored grams to the app's unit, then
        # round. Rounding AFTER scaling preserves µg-scale vitamins that would
        # otherwise vanish (e.g. 0.0001 g folate = 100 µg, not 0.000).
        for code, (key, mult) in CODE_MAP.items():
            v = num(r.get(code))
            if v is not None and v > 0:
                nutrition[key] = round(v * mult, 3)
        # Vitamin D = D2 (ergcal) + D3 (chocal), stored grams -> µg.
        vd = (num(r.get("ergcal")) or 0) + (num(r.get("chocal")) or 0)
        if vd > 0:
            nutrition["vitamin-d"] = round(vd * UG, 3)
        # Vitamin K = K1 + K2, stored grams -> µg.
        vk = (num(r.get("vitk1")) or 0) + (num(r.get("vitk2")) or 0)
        if vk > 0:
            nutrition["vitamin-k"] = round(vk * UG, 3)
        diet = diet_from_tags(r.get("tags"))
        diet_counts[diet] = diet_counts.get(diet, 0) + 1
        out.append({
            "name": name,
            "scientific": (r.get("scie") or "").strip() or None,
            "source": "IFCT 2017",
            "code": (r.get("code") or "").strip(),
            "group": (r.get("grup") or "").strip() or None,
            "diet_type": diet,
            "nutrition": nutrition,
        })
    out.sort(key=lambda x: x["name"].lower())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"Wrote {len(out)} ingredients -> {OUT}")
    print("Diet split:", diet_counts)
    # Show a couple of samples for manual sanity
    for nm in ("Wheat flour, atta", "Chicken", "Egg", "Spinach"):
        m = [o for o in out if nm.split(",")[0].lower() in o["name"].lower()]
        if m:
            s = m[0]
            print(f"  · {s['name']} [{s['diet_type']}] {s['group']}: "
                  f"kcal={s['nutrition'].get('calories')} protein={s['nutrition'].get('proteins')} "
                  f"iron={s['nutrition'].get('iron')} calcium={s['nutrition'].get('calcium')}")

if __name__ == "__main__":
    main()
