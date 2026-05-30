#!/usr/bin/env python3
"""
validate_data.py — Accuracy & plausibility gate for the Indian nutrition seed
datasets. Verifies the committed JSON (ifct-foods.json, indb-recipes.json)
BEFORE it can be seeded, and writes a human-reviewable report to
server/seed/data/VALIDATION.md.

Exits non-zero on any HARD failure (structural corruption or an IFCT anchor
food outside the ±10% accuracy tolerance), so it can run in CI / pre-seed.
Soft signals (Atwater energy drift, sodium outliers, coverage gaps) are
reported but do not fail the gate.
"""
import os, json, math, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "server", "seed", "data")
IFCT = os.path.join(DATA, "ifct-foods.json")
INDB = os.path.join(DATA, "indb-recipes.json")
QUARANTINE = os.path.join(DATA, "indb-quarantine.json")
REPORT = os.path.join(DATA, "VALIDATION.md")

TOL = 0.10  # ±10% accuracy bar vs IFCT 2017 published values

# IFCT 2017 (ICMR-NIN) PUBLISHED per-100g reference values, transcribed from
# the printed tables, used as an EXTERNAL check that unit conversion is correct.
# Matched by case-insensitive exact name. Only fields with a confident published
# value are checked. Units: kcal, g (macros), mg (minerals), mg/µg (vitamins).
ANCHORS = {
    "Wheat flour, atta": {"calories": 321, "proteins": 10.57, "fat": 1.53,
                          "carbohydrates": 64.2, "iron": 4.10, "calcium": 30.9},
    "Spinach": {"calories": 24, "proteins": 2.14, "iron": 2.96, "calcium": 82.3},
    "Rice, raw, milled": {"calories": 356, "proteins": 7.94, "carbohydrates": 78.2},
    # Bengal gram iron is omitted on purpose: IFCT 2017 revised legume iron after
    # correcting for soil/dust contamination, and reliable external transcriptions
    # disagree. Protein is well-established and still anchors the mineral set via
    # wheat atta (iron 4.10) and spinach (iron 2.96) above.
    "Bengal gram, whole": {"proteins": 18.0},
}

# Physiological per-100g ceilings used purely for REPORTING outliers (the
# converter already drops impossible sodium; this re-derives the picture).
SODIUM_REPORT_FLOOR = 2000.0  # mg/100g — flag salty dishes for reviewer eyes


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def is_bad_number(v):
    return (not isinstance(v, (int, float))) or (not math.isfinite(v)) or v < 0


def check_structure(items, kind):
    """HARD structural checks. Returns list of failure strings."""
    fails = []
    seen_codes = {}
    for i, o in enumerate(items):
        tag = f"{kind}[{i}] {o.get('name','?')!r}"
        if not (o.get("name") or "").strip():
            fails.append(f"{tag}: empty name")
        nut = o.get("nutrition")
        if not isinstance(nut, dict) or not nut:
            fails.append(f"{tag}: empty/missing nutrition")
            continue
        for k, v in nut.items():
            if is_bad_number(v):
                fails.append(f"{tag}: bad value {k}={v!r}")
        code = (o.get("code") or "").strip()
        if code:
            seen_codes.setdefault(code, []).append(o["name"])
    dupes = {c: n for c, n in seen_codes.items() if len(n) > 1}
    for c, n in dupes.items():
        fails.append(f"{kind}: duplicate code {c} -> {n}")
    return fails


def check_anchors(foods):
    """HARD accuracy gate: anchor foods must be within ±10% of IFCT 2017."""
    by_name = {o["name"].lower(): o for o in foods}
    fails, rows = [], []
    for name, expect in ANCHORS.items():
        o = by_name.get(name.lower())
        if not o:
            fails.append(f"anchor missing: {name!r}")
            continue
        for key, exp in expect.items():
            got = o["nutrition"].get(key)
            if got is None:
                fails.append(f"anchor {name!r}: missing {key}")
                continue
            dev = abs(got - exp) / exp if exp else 0
            ok = dev <= TOL
            rows.append((name, key, exp, got, dev, ok))
            if not ok:
                fails.append(f"anchor {name!r}.{key}: got {got} vs {exp} "
                             f"({dev*100:.1f}% > {TOL*100:.0f}%)")
    return fails, rows


def atwater_drift(items):
    """SOFT: compare stated calories to 4*carb+4*protein+9*fat. Returns
    (count_checked, count_over_25pct, worst[list])."""
    worst = []
    checked = over = 0
    for o in items:
        n = o["nutrition"]
        kcal = n.get("calories")
        if not kcal or kcal <= 0:
            continue
        pred = 4*n.get("carbohydrates", 0) + 4*n.get("proteins", 0) + 9*n.get("fat", 0)
        if pred <= 0:
            continue
        checked += 1
        dev = abs(pred - kcal) / kcal
        if dev > 0.25:
            over += 1
            worst.append((dev, o["name"], round(kcal, 1), round(pred, 1)))
    worst.sort(reverse=True)
    return checked, over, worst[:8]


def coverage(items, keys):
    tot = len(items)
    return {k: sum(1 for o in items if k in o["nutrition"]) for k in keys}


def sodium_outliers(recipes):
    out = []
    for o in recipes:
        sg = o.get("serving_grams") or 100
        na = o["nutrition"].get("sodium")
        if na is None:
            continue
        per100 = na / sg * 100
        if per100 >= SODIUM_REPORT_FLOOR:
            out.append((per100, round(na, 0), o["name"]))
    out.sort(reverse=True)
    return out


def main():
    foods = load(IFCT)
    recipes = load(INDB)
    quar = load(QUARANTINE) if os.path.exists(QUARANTINE) else {}
    q_contra = quar.get("energy_macro_contradiction", [])
    q_sodium = quar.get("implausible_sodium_dropped", [])

    hard = []
    hard += check_structure(foods, "food")
    hard += check_structure(recipes, "recipe")
    anchor_fails, anchor_rows = check_anchors(foods)
    hard += anchor_fails

    f_checked, f_over, f_worst = atwater_drift(foods)
    r_checked, r_over, r_worst = atwater_drift(recipes)

    APP_KEYS = ["calories", "proteins", "fat", "carbohydrates", "fiber", "sugars",
                "saturated-fat", "cholesterol", "sodium", "calcium", "iron",
                "potassium", "magnesium", "zinc", "phosphorus", "vitamin-a",
                "vitamin-c", "vitamin-d", "vitamin-e", "vitamin-k",
                "b1", "b2", "b3", "b6", "b9", "b12"]
    fcov = coverage(foods, APP_KEYS)
    rcov = coverage(recipes, APP_KEYS)
    na_out = sodium_outliers(recipes)
    fallback = sum(1 for o in recipes if o.get("basis") == "per_100g")

    # ---- write report ----
    L = []
    w = L.append
    w(f"# Indian Nutrition Data — Validation Report")
    w("")
    w(f"_Generated {datetime.date.today().isoformat()} by `scripts/validate_data.py`._")
    w("")
    w(f"- **Ingredients (IFCT 2017):** {len(foods)} foods")
    w(f"- **Recipes (INDB 2024.11):** {len(recipes)} dishes "
      f"({fallback} use per-100g fallback; rest per realistic serving)")
    w(f"- **Quarantined at conversion:** {len(q_contra)} recipes (energy/macro "
      f"contradiction) + {len(q_sodium)} sodium fields — see below")
    w(f"- **Accuracy bar:** ±{int(TOL*100)}% vs IFCT 2017 published values on anchor foods")
    w(f"- **Gate result:** {'❌ FAIL' if hard else '✅ PASS'} ({len(hard)} hard issues)")
    w("")
    w("## Anchor accuracy (IFCT 2017 published vs converted)")
    w("")
    w("| Food | Nutrient | Published | Converted | Δ | Within ±10% |")
    w("|---|---|--:|--:|--:|:--:|")
    for name, key, exp, got, dev, ok in anchor_rows:
        w(f"| {name} | {key} | {exp} | {got} | {dev*100:.1f}% | {'✅' if ok else '❌'} |")
    w("")
    w("## Energy (Atwater) cross-check")
    w("")
    w("Stated calories vs 4·carb + 4·protein + 9·fat. Drift is expected from "
      "fiber, organic acids, alcohol and rounding; only >25% is listed.")
    w("")
    w(f"- Ingredients: {f_over}/{f_checked} over 25% drift")
    w(f"- Recipes: {r_over}/{r_checked} over 25% drift")
    if f_worst or r_worst:
        w("")
        w("| Dataset | Item | Stated kcal | Atwater kcal | Δ |")
        w("|---|---|--:|--:|--:|")
        for dev, nm, k, p in f_worst:
            w(f"| IFCT | {nm} | {k} | {p} | {dev*100:.0f}% |")
        for dev, nm, k, p in r_worst:
            w(f"| INDB | {nm} | {k} | {p} | {dev*100:.0f}% |")
    w("")
    w("## Nutrient coverage")
    w("")
    w("| Nutrient | IFCT foods | INDB recipes |")
    w("|---|--:|--:|")
    for k in APP_KEYS:
        w(f"| {k} | {fcov[k]} / {len(foods)} | {rcov[k]} / {len(recipes)} |")
    w("")
    w("## Known limitations")
    w("")
    w("- **Vitamin B12 is absent** from both IFCT 2017 and INDB 2024.11 source "
      "data, so no B12 value is seeded. It is left empty (not fabricated); the "
      "app still shows B12 RDA targets, which will read as unmet for these items.")
    w("- **Sodium outliers:** the converter drops sodium from ~23 INDB soup/sauce "
      "rows whose source value exceeded 8000 mg/100g (physically impossible). "
      f"{len(na_out)} remaining recipes still report >{int(SODIUM_REPORT_FLOOR)} "
      "mg/100g — high but within INDB's published data; listed below for review.")
    w("- **Per-100g fallback:** {0} condiment-type recipes (jams/sauces/etc.) "
      "have no defined Indian serving in INDB, so their values are per 100 g."
      .format(fallback))
    w("- Trace nutrients without an app field (copper, selenium, manganese, "
      "B5, biotin, carotenoids) are intentionally not carried over.")
    if q_contra:
        w("")
        w("### Quarantined: energy vs macro contradiction ({0} recipes)"
          .format(len(q_contra)))
        w("")
        w("Excluded from the seed set. Their INDB energy column reads like a "
          "clear soup while protein/fat columns imply 4-7x more energy, so the "
          "whole row is untrustworthy (fiber-corrected Atwater > 1.5x stated).")
        w("")
        w("| Atwater ÷ stated | Stated kcal | Recipe |")
        w("|--:|--:|---|")
        for r in q_contra:
            w(f"| {r['atwater_ratio']}x | {r['stated_kcal']} | {r['name']} |")
    if na_out:
        w("")
        w("<details><summary>Sodium > {0} mg/100g ({1} recipes)</summary>"
          .format(int(SODIUM_REPORT_FLOOR), len(na_out)))
        w("")
        w("| mg/100g | mg/serving | Recipe |")
        w("|--:|--:|---|")
        for per100, na, nm in na_out:
            w(f"| {per100:.0f} | {na:.0f} | {nm} |")
        w("")
        w("</details>")
    w("")
    if hard:
        w("## ❌ Hard failures")
        w("")
        for h in hard:
            w(f"- {h}")
        w("")

    with open(REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

    print(f"Wrote {REPORT}")
    print(f"Foods={len(foods)} Recipes={len(recipes)} "
          f"AnchorRows={len(anchor_rows)} HardIssues={len(hard)}")
    if hard:
        print("HARD FAILURES:")
        for h in hard[:20]:
            print("  -", h)
        sys.exit(1)
    print("GATE: PASS")


if __name__ == "__main__":
    main()
