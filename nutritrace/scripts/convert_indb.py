#!/usr/bin/env python3
"""
convert_indb.py — Convert the Indian Nutrient Databank (INDB 2024.11) recipe
workbook to app JSON.

Source: Anuvaad_INDB_2024.11.xlsx — 1,014 pan-Indian cooked recipes/dishes,
published with the peer-reviewed methodology in *Current Developments in
Nutrition* (2024). Values are per realistic Indian serving (katori/bowl/plate
etc.), taken from the workbook's `unit_serving_*` columns so diary entries use
culturally accurate portions rather than an abstract 100 g.

Only numeric facts + provenance are carried over. No verbatim cooking
instructions are copied (license mitigation — facts are not copyrightable).
Output: nutritrace/server/seed/data/indb-recipes.json (committed, reviewable).

Diet type is intentionally NOT decided here; recipes are keyword-classified at
seed time by server/seed/classify.js so the rules are unit-testable.
"""
import os, json, math
import openpyxl
from nutrition_normalize import normalize_record, apply_supplements

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "Anuvaad_INDB_2024.11.xlsx")
OUT = os.path.join(HERE, "..", "server", "seed", "data", "indb-recipes.json")
QUARANTINE = os.path.join(HERE, "..", "server", "seed", "data", "indb-quarantine.json")

G, MG_TO_G = 1, 0.001  # app stores fat sub-fractions in g; INDB gives them in mg

# unit_serving_* column -> (app key, multiplier to app unit). The app's units
# (src/lib/nutrition.js) match INDB's per-serving columns except the fatty-acid
# fractions, which INDB reports in mg while the app stores them in g.
SERVING_MAP = {
    "unit_serving_energy_kcal": ("calories", 1),
    "unit_serving_carb_g": ("carbohydrates", G),
    "unit_serving_protein_g": ("proteins", G),
    "unit_serving_fat_g": ("fat", G),
    "unit_serving_freesugar_g": ("sugars", G),
    "unit_serving_fibre_g": ("fiber", G),
    "unit_serving_sfa_mg": ("saturated-fat", MG_TO_G),
    "unit_serving_mufa_mg": ("monounsaturated-fat", MG_TO_G),
    "unit_serving_pufa_mg": ("polyunsaturated-fat", MG_TO_G),
    "unit_serving_cholesterol_mg": ("cholesterol", 1),
    "unit_serving_calcium_mg": ("calcium", 1),
    "unit_serving_phosphorus_mg": ("phosphorus", 1),
    "unit_serving_magnesium_mg": ("magnesium", 1),
    "unit_serving_sodium_mg": ("sodium", 1),
    "unit_serving_potassium_mg": ("potassium", 1),
    "unit_serving_iron_mg": ("iron", 1),
    "unit_serving_zinc_mg": ("zinc", 1),
    "unit_serving_vita_ug": ("vitamin-a", 1),
    "unit_serving_vite_mg": ("vitamin-e", 1),
    "unit_serving_folate_ug": ("b9", 1),  # folate == vitb9 in INDB
    "unit_serving_vitb1_mg": ("b1", 1),
    "unit_serving_vitb2_mg": ("b2", 1),
    "unit_serving_vitb3_mg": ("b3", 1),
    "unit_serving_vitb6_mg": ("b6", 1),
    "unit_serving_vitc_mg": ("vitamin-c", 1),
}
# Vitamin D = D2 + D3 (µg); Vitamin K = K1 + K2 (µg). Summed from per-serving cols.
VITD_COLS = ("unit_serving_vitd2_ug", "unit_serving_vitd3_ug")
VITK_COLS = ("unit_serving_vitk1_ug", "unit_serving_vitk2_ug")

# Per-100g fallback: ~82 condiment-type rows (jams/sauces/frostings) carry no
# defined Indian serving, so their unit_serving_* cells are blank. For those we
# fall back to the per-100g columns (same names without the "unit_serving_"
# prefix) and label the portion "100 g" so every recipe still has nutrition.
def _base(col):  # "unit_serving_carb_g" -> "carb_g"
    return col[len("unit_serving_"):]
PER100_MAP = {_base(c): v for c, v in SERVING_MAP.items()}
VITD_COLS_100 = tuple(_base(c) for c in VITD_COLS)
VITK_COLS_100 = tuple(_base(c) for c in VITK_COLS)
# Columns with no app equivalent (documented, intentionally dropped):
#   copper, selenium, chromium, manganese, molybdenum, vitb5, vitb7 (biotin),
#   carotenoids. Vitamin B12 is absent from INDB entirely (limitation).


def num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# Physiological plausibility cap (per 100 g). A small number of INDB rows
# carry impossible sodium (>8 g/100 g; seawater is ~1.1 g, soy sauce ~6 g) —
# clearly a source error. We drop ONLY the offending sodium value (keeping each
# recipe's valid macros) so RDA tracking isn't poisoned. Reported in stdout and
# picked up by validate_data.py for VALIDATION.md. Kept nutrient-specific and
# conservative on purpose: every other nutrient passes a per-100g sanity scan.
SODIUM_MAX_PER_100G = 8000.0  # mg
_dropped_sodium = []

# Internal-consistency quarantine. A food's stated energy cannot be materially
# LESS than the metabolizable energy its own macros provide. ~25-31 INDB
# soup/sauce rows are internally self-contradictory by 4-7x: their energy
# column reads like a clear soup (~30 kcal/100g) while their protein/fat/
# mineral columns are inflated ~6x (e.g. Egg drop soup: 27 kcal but 13 g
# protein + 14 g fat = 178 kcal). Such a row is untrustworthy in EVERY field,
# so we drop the whole recipe rather than seed partly-corrupt data. We use the
# fiber-corrected Atwater factors (available carb x4, fiber x2, protein x4,
# fat x9) so genuinely high-fiber foods are not false-positives.
ATWATER_MAX_RATIO = 1.5  # drop if macro-energy > 1.5x stated energy
_quarantined = []


def atwater_kcal(nutrition):
    carb = nutrition.get("carbohydrates", 0)
    fiber = nutrition.get("fiber", 0)
    avail = max(carb - fiber, 0)
    return 4 * avail + 2 * fiber + 4 * nutrition.get("proteins", 0) + 9 * nutrition.get("fat", 0)


def main():
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb["Sheet1"]
    it = ws.iter_rows(values_only=True)
    hdr = list(next(it))
    idx = {h: i for i, h in enumerate(hdr)}

    def cell(row, col):
        i = idx.get(col)
        return num(row[i]) if i is not None else None

    out = []
    src_counts = {}
    no_energy = 0
    for row in it:
        name = (row[idx["food_name"]] or "")
        name = str(name).strip()
        if not name:
            continue
        nutrition = {}
        # Source zeros are preserved as sourced; only blank/null/NaN are
        # omitted (become status: missing after normalize).
        for col, (key, mult) in SERVING_MAP.items():
            v = cell(row, col)
            if v is not None and v >= 0:
                nutrition[key] = round(v * mult, 3)
        # Vitamin D: preserve sum (incl. zero) if at least one component present.
        vd_parts = [cell(row, c) for c in VITD_COLS]
        if any(p is not None for p in vd_parts):
            vd = sum(p or 0 for p in vd_parts)
            if vd >= 0:
                nutrition["vitamin-d"] = round(vd, 3)
        # Vitamin K: same logic.
        vk_parts = [cell(row, c) for c in VITK_COLS]
        if any(p is not None for p in vk_parts):
            vk = sum(p or 0 for p in vk_parts)
            if vk >= 0:
                nutrition["vitamin-k"] = round(vk, 3)

        # Back-compute the serving weight (g) from the per-serving vs per-100g
        # energy ratio so the app can show "1 <unit> (~Ng)".
        e100 = cell(row, "energy_kj")
        eserv = cell(row, "unit_serving_energy_kj")
        serving_unit = str(row[idx["servings_unit"]] or "").strip() or None
        if nutrition:
            serving_g = round(eserv / e100 * 100, 1) if (e100 and eserv) else None
            basis = "per_serving"
        else:
            # Fall back to per-100g for serving-less condiment rows.
            for col, (key, mult) in PER100_MAP.items():
                v = cell(row, col)
                if v is not None and v >= 0:
                    nutrition[key] = round(v * mult, 3)
            vd_parts = [cell(row, c) for c in VITD_COLS_100]
            if any(p is not None for p in vd_parts):
                vd = sum(p or 0 for p in vd_parts)
                if vd >= 0:
                    nutrition["vitamin-d"] = round(vd, 3)
            vk_parts = [cell(row, c) for c in VITK_COLS_100]
            if any(p is not None for p in vk_parts):
                vk = sum(p or 0 for p in vk_parts)
                if vk >= 0:
                    nutrition["vitamin-k"] = round(vk, 3)
            serving_unit = "100 g"
            serving_g = 100.0
            basis = "per_100g"
        if "calories" not in nutrition:
            no_energy += 1

        # Internal-consistency quarantine: drop irrecoverably contradictory rows.
        kcal = nutrition.get("calories")
        if kcal and kcal > 0:
            atw = atwater_kcal(nutrition)
            if atw > ATWATER_MAX_RATIO * kcal:
                _quarantined.append((name, round(atw / kcal, 1), round(kcal, 1)))
                continue

        # Drop impossible sodium (source error) — see SODIUM_MAX_PER_100G.
        if "sodium" in nutrition and serving_g:
            per100 = nutrition["sodium"] / serving_g * 100
            if per100 > SODIUM_MAX_PER_100G:
                _dropped_sodium.append((name, round(per100, 1)))
                del nutrition["sodium"]

        psrc = str(row[idx["primarysource"]] or "").strip()
        src_counts[psrc] = src_counts.get(psrc, 0) + 1
        code = str(row[idx["food_code"]] or "").strip()
        record = {
            "name": name,
            "source": "INDB 2024.11",
            "code": code,
            "primarysource": psrc,
            "serving_unit": serving_unit,
            "serving_grams": serving_g,
            "basis": basis,
        }
        # Normalize: fill all 34 supported nutrient keys with provenance.
        # source_values is the partially-filled nutrition dict from INDB columns.
        normalize_record(record, "INDB 2024.11", nutrition)
        # Apply supplement rules and recipe overrides.
        # INDB has no group/diet_type classification; pass empty strings.
        # serving_grams is already on record for per_100g override scaling.
        apply_supplements(record, code, name, "", "", "INDB 2024.11")
        out.append(record)

    out.sort(key=lambda x: x["name"].lower())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)

    # Auditable record of everything excluded, so VALIDATION.md and reviewers
    # can see exactly what was dropped and why.
    quarantine = {
        "energy_macro_contradiction": [
            {"name": n, "atwater_ratio": r, "stated_kcal": k}
            for n, r, k in sorted(_quarantined, key=lambda x: -x[1])
        ],
        "implausible_sodium_dropped": [
            {"name": n, "mg_per_100g": p}
            for n, p in sorted(_dropped_sodium, key=lambda x: -x[1])
        ],
    }
    with open(QUARANTINE, "w", encoding="utf-8") as fh:
        json.dump(quarantine, fh, ensure_ascii=False, indent=1)
    print(f"Wrote {len(out)} recipes -> {OUT}")
    print("Primary source split:", src_counts)
    print(f"Recipes without energy: {no_energy}")
    print(f"Quarantined (energy/macro contradiction >{ATWATER_MAX_RATIO}x): "
          f"{len(_quarantined)} recipes")
    for nm, r, k in sorted(_quarantined, key=lambda x: -x[1])[:5]:
        print(f"    · {nm[:40]:<42} {r}x (stated {k} kcal)")
    print(f"Dropped implausible sodium (>{SODIUM_MAX_PER_100G:.0f} mg/100g): "
          f"{len(_dropped_sodium)} recipes")
    for nm, p in sorted(_dropped_sodium, key=lambda x: -x[1])[:5]:
        print(f"    · {nm[:40]:<42} {p} mg/100g")
    for nm in ("Hot tea", "Plain khitchdi", "Chicken curry", "Palak paneer"):
        m = [o for o in out if nm.lower() in o["name"].lower()]
        if m:
            s = m[0]; n = s["nutrition"]
            print(f"  · {s['name'][:38]:<38} 1 {s['serving_unit']} (~{s['serving_grams']}g): "
                  f"kcal={n.get('calories')} P={n.get('proteins')} "
                  f"fat={n.get('fat')} Ca={n.get('calcium')} Fe={n.get('iron')}")


if __name__ == "__main__":
    main()
