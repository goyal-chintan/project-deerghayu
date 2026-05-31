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
from nutrition_normalize import normalize_record, apply_supplements

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
    # fatty-acid breakdown (app unit: g; IFCT stores these in grams, factor 1).
    # saturated-fat is a default-visible Nutrition Facts row, so omitting it
    # left every IFCT food blank where the app expects a value.
    "fasat": ("saturated-fat", G), "fams": ("monounsaturated-fat", G),
    "fapu": ("polyunsaturated-fat", G), "fatrn": ("trans-fat", G),
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
        if e is not None and e >= 0:
            nutrition["calories"] = round(e / 4.184, 2)
        # Convert each mapped column from stored grams to the app's unit, then
        # round. Rounding AFTER scaling preserves µg-scale vitamins that would
        # otherwise vanish (e.g. 0.0001 g folate = 100 µg, not 0.000).
        # Source zeros are preserved as sourced (finite nonneg); only
        # blank/null/NaN are omitted (become status: missing after normalize).
        for code, (key, mult) in CODE_MAP.items():
            v = num(r.get(code))
            if v is not None and v >= 0:
                nutrition[key] = round(v * mult, 3)
        # Vitamin D = D2 (ergcal) + D3 (chocal), stored grams -> µg.
        # Preserve the sum (including zero) when at least one component is
        # explicitly present in the source (non-None).
        d2 = num(r.get("ergcal"))
        d3 = num(r.get("chocal"))
        if d2 is not None or d3 is not None:
            vd = (d2 or 0) + (d3 or 0)
            if vd >= 0:
                nutrition["vitamin-d"] = round(vd * UG, 3)
        # Vitamin K = K1 + K2, stored grams -> µg.
        k1 = num(r.get("vitk1"))
        k2 = num(r.get("vitk2"))
        if k1 is not None or k2 is not None:
            vk = (k1 or 0) + (k2 or 0)
            if vk >= 0:
                nutrition["vitamin-k"] = round(vk * UG, 3)
        # Fatty-acid consistency guard. IFCT assays individual fatty acids
        # separately from crude "total fat" (fatce), so for some lean or
        # trace-fat foods (lean fish plus a few low-fat vegetables/fruits) the
        # SFA+MUFA+PUFA sum exceeds total fat. Showing a breakdown larger than
        # its parent is incoherent, so drop the breakdown (keeping the
        # authoritative total fat) whenever the sum exceeds total fat by more
        # than the 10% tolerance that already absorbs rounding noise.
        fat = nutrition.get("fat")
        fa_sum = sum(nutrition.get(k, 0) for k in
                     ("saturated-fat", "monounsaturated-fat", "polyunsaturated-fat"))
        if fat is not None and fa_sum > fat * 1.1:
            for k in ("saturated-fat", "monounsaturated-fat",
                      "polyunsaturated-fat", "trans-fat"):
                nutrition.pop(k, None)
        diet = diet_from_tags(r.get("tags"))
        diet_counts[diet] = diet_counts.get(diet, 0) + 1
        code = (r.get("code") or "").strip()
        group = (r.get("grup") or "").strip() or None
        record = {
            "name": name,
            "scientific": (r.get("scie") or "").strip() or None,
            "source": "IFCT 2017",
            "code": code,
            "group": group,
            "diet_type": diet,
        }
        # Normalize: fill all 34 supported nutrient keys with provenance
        normalize_record(record, "IFCT 2017", nutrition)
        # Apply supplement rules (explicit zeros) and item overrides (B12 etc.)
        apply_supplements(record, code, name, group or "", diet, "IFCT 2017")
        out.append(record)
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
