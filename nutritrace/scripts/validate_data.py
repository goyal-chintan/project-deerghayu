#!/usr/bin/env python3
"""
validate_data.py — Accuracy & plausibility gate for the Indian nutrition seed
datasets. Verifies the committed JSON (ifct-foods.json, indb-recipes.json)
BEFORE it can be seeded, and writes a human-reviewable report to
server/seed/data/VALIDATION.md.

Exits non-zero on any HARD failure:
- Structural corruption
- IFCT anchor food outside ±10% accuracy tolerance
- Missing supported nutrient key in nutrition or nutrition_meta
- Unsupported extra nutrient keys
- Invalid status vocabulary in nutrition_meta
- B12 positive value without source/citation/confidence
- Zero value with non-missing status lacking proper provenance

Soft signals (Atwater energy drift, sodium outliers, scientifically honest
`missing` statuses) are reported but do not fail the gate.
"""
import os, json, math, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "server", "seed", "data")
IFCT = os.path.join(DATA, "ifct-foods.json")
INDB = os.path.join(DATA, "indb-recipes.json")
QUARANTINE = os.path.join(DATA, "indb-quarantine.json")
SUPPORTED_IDS = os.path.join(DATA, "supported-nutrient-ids.json")
REPORT = os.path.join(DATA, "VALIDATION.md")

TOL = 0.10  # ±10% accuracy bar vs IFCT 2017 published values

# Valid status vocabulary for nutrition_meta entries
VALID_STATUSES = {"sourced", "derived", "explicit_zero", "estimated", "missing"}

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
    if isinstance(v, bool):
        return True
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


def check_nutrient_completeness(items, kind, supported_keys):
    """HARD: every row must have ALL supported keys in nutrition and nutrition_meta.
    Also rejects unsupported extra keys. Guards against non-dict fields."""
    fails = []
    supported_set = set(supported_keys)
    for i, o in enumerate(items):
        tag = f"{kind}[{i}] {o.get('name','?')!r}"
        nut = o.get("nutrition")
        meta = o.get("nutrition_meta")

        # Guard: nutrition must be a dict
        if not isinstance(nut, dict):
            fails.append(f"{tag}: nutrition is not a dict (got {type(nut).__name__})")
            nut = {}  # skip per-key checks safely

        # Guard: nutrition_meta must be a dict
        if not isinstance(meta, dict):
            fails.append(f"{tag}: nutrition_meta is not a dict (got {type(meta).__name__})")
            meta = {}  # skip per-key checks safely

        # Check missing supported keys in nutrition
        missing_nut = supported_set - set(nut.keys())
        if missing_nut:
            fails.append(f"{tag}: missing nutrition keys: {sorted(missing_nut)}")

        # Check missing supported keys in nutrition_meta
        missing_meta = supported_set - set(meta.keys())
        if missing_meta:
            fails.append(f"{tag}: missing nutrition_meta keys: {sorted(missing_meta)}")

        # Check unsupported extra keys in nutrition
        extra_nut = set(nut.keys()) - supported_set
        if extra_nut:
            fails.append(f"{tag}: unsupported nutrition keys: {sorted(extra_nut)}")

        # Check unsupported extra keys in nutrition_meta
        extra_meta = set(meta.keys()) - supported_set
        if extra_meta:
            fails.append(f"{tag}: unsupported nutrition_meta keys: {sorted(extra_meta)}")
    return fails


def check_status_vocabulary(items, kind):
    """HARD: all nutrition_meta statuses must use valid vocabulary.
    Guards against non-dict nutrition_meta or non-dict meta entries."""
    fails = []
    for i, o in enumerate(items):
        tag = f"{kind}[{i}] {o.get('name','?')!r}"
        meta = o.get("nutrition_meta")
        if not isinstance(meta, dict):
            fails.append(f"{tag}: nutrition_meta is not a dict (got {type(meta).__name__})")
            continue
        for k, m in meta.items():
            if not isinstance(m, dict):
                fails.append(f"{tag}: nutrition_meta[{k!r}] is not a dict (got {type(m).__name__})")
                continue
            status = m.get("status")
            if status not in VALID_STATUSES:
                fails.append(f"{tag}: invalid status {status!r} for {k}")
    return fails


def check_b12_provenance(items, kind):
    """HARD: B12-positive values must have source + citation + confidence.
    Additionally: status must be 'sourced' or 'estimated', source and citation
    must be non-empty strings, confidence must be a finite non-bool numeric
    value in [0, 1].
    Guards against non-dict nutrition/nutrition_meta/meta entries."""
    fails = []
    for i, o in enumerate(items):
        nut = o.get("nutrition")
        if not isinstance(nut, dict):
            continue  # already caught by completeness check
        b12_val = nut.get("b12", 0)
        if not isinstance(b12_val, (int, float)) or isinstance(b12_val, bool) or b12_val <= 0:
            continue
        tag = f"{kind}[{i}] {o.get('name','?')!r}"
        meta_root = o.get("nutrition_meta")
        if not isinstance(meta_root, dict):
            fails.append(f"{tag}: B12={b12_val} but nutrition_meta is not a dict")
            continue
        meta = meta_root.get("b12")
        if not isinstance(meta, dict):
            fails.append(f"{tag}: B12={b12_val} but nutrition_meta.b12 is not a dict")
            continue
        missing_fields = []
        # Status must be sourced or estimated
        status = meta.get("status")
        if status not in ("sourced", "estimated"):
            missing_fields.append(f"status (got {status!r}, need sourced/estimated)")
        # Source must be non-empty string
        source = meta.get("source")
        if not source or not isinstance(source, str) or not source.strip():
            missing_fields.append("source")
        # Citation must be non-empty string
        citation = meta.get("citation")
        if not citation or not isinstance(citation, str) or not citation.strip():
            missing_fields.append("citation")
        # Confidence must be finite non-bool numeric in [0, 1]
        confidence = meta.get("confidence")
        if confidence is None:
            missing_fields.append("confidence")
        elif isinstance(confidence, bool):
            missing_fields.append("confidence (got bool)")
        elif not isinstance(confidence, (int, float)):
            missing_fields.append(f"confidence (got {type(confidence).__name__})")
        elif not math.isfinite(confidence):
            missing_fields.append("confidence (not finite)")
        elif not (0 <= confidence <= 1):
            missing_fields.append(f"confidence (got {confidence}, need 0-1)")
        if missing_fields:
            fails.append(f"{tag}: B12={b12_val} lacks {missing_fields}")
    return fails


def check_zero_provenance(items, kind):
    """HARD: zero values with non-missing status must have proper provenance.
    A zero value with status != 'missing' needs at least a source field.
    Guards against non-dict nutrition/nutrition_meta/meta entries."""
    fails = []
    for i, o in enumerate(items):
        tag = f"{kind}[{i}] {o.get('name','?')!r}"
        nut = o.get("nutrition")
        if not isinstance(nut, dict):
            continue  # already caught by completeness check
        meta = o.get("nutrition_meta")
        if not isinstance(meta, dict):
            continue  # already caught by completeness check
        for k, v in nut.items():
            if v == 0:
                m = meta.get(k)
                if not isinstance(m, dict):
                    continue  # already caught by status vocabulary check
                status = m.get("status", "missing")
                if status == "missing":
                    continue  # missing status is fine for zeros
                if not m.get("source"):
                    fails.append(f"{tag}: {k}=0 status={status!r} but no source")
    return fails


def check_anchors(foods):
    """HARD accuracy gate: anchor foods must be within ±10% of IFCT 2017.
    Guards against non-dict nutrition on anchor rows."""
    by_name = {o["name"].lower(): o for o in foods if (o.get("name") or "")}
    fails, rows = [], []
    for name, expect in ANCHORS.items():
        o = by_name.get(name.lower())
        if not o:
            fails.append(f"anchor missing: {name!r}")
            continue
        nut = o.get("nutrition")
        if not isinstance(nut, dict):
            fails.append(f"anchor {name!r}: nutrition is not a dict "
                         f"(got {type(nut).__name__})")
            continue
        for key, exp in expect.items():
            got = nut.get(key)
            if got is None:
                fails.append(f"anchor {name!r}: missing {key}")
                continue
            if not isinstance(got, (int, float)):
                fails.append(f"anchor {name!r}: {key} is not numeric "
                             f"(got {type(got).__name__})")
                continue
            dev = abs(got - exp) / exp if exp else 0
            ok = dev <= TOL
            rows.append((name, key, exp, got, dev, ok))
            if not ok:
                fails.append(f"anchor {name!r}.{key}: got {got} vs {exp} "
                             f"({dev*100:.1f}% > {TOL*100:.0f}%)")
    return fails, rows


def _safe_num(v):
    """Return v if it's a finite non-negative number, else 0."""
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)) and math.isfinite(v):
        return v
    return 0


def atwater_drift(items):
    """SOFT: compare stated calories to 4*carb+4*protein+9*fat. Returns
    (count_checked, count_over_25pct, worst[list]).
    Skips rows with non-dict nutrition or non-numeric values."""
    worst = []
    checked = over = 0
    for o in items:
        n = o.get("nutrition")
        if not isinstance(n, dict):
            continue
        kcal = _safe_num(n.get("calories"))
        if kcal <= 0:
            continue
        carb = _safe_num(n.get("carbohydrates"))
        prot = _safe_num(n.get("proteins"))
        fat = _safe_num(n.get("fat"))
        pred = 4*carb + 4*prot + 9*fat
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
    """Count resolved (non-missing) nutrient entries per key.

    When nutrition_meta is present, a nutrient is 'resolved' if its meta status
    is anything other than 'missing'. When nutrition_meta is absent (legacy),
    falls back to checking key presence in the nutrition dict.
    Guards against non-dict nutrition_meta or non-dict meta entries.
    """
    counts = {}
    for k in keys:
        resolved = 0
        for o in items:
            meta_root = o.get("nutrition_meta")
            if not isinstance(meta_root, dict):
                # Legacy fallback: key presence counts as resolved
                if k in (o.get("nutrition") if isinstance(o.get("nutrition"), dict) else {}):
                    resolved += 1
                continue
            meta = meta_root.get(k)
            if isinstance(meta, dict):
                if meta.get("status") != "missing":
                    resolved += 1
            elif meta is None:
                # Legacy fallback: key presence counts as resolved
                if k in (o.get("nutrition") if isinstance(o.get("nutrition"), dict) else {}):
                    resolved += 1
            # non-dict, non-None meta entry: treat as unresolved
        counts[k] = resolved
    return counts


def status_breakdown(items, keys):
    """Count per-status totals across all items for each nutrient key.
    Guards against non-dict nutrition_meta or non-dict meta entries."""
    breakdown = {k: Counter() for k in keys}
    for o in items:
        meta_root = o.get("nutrition_meta")
        if not isinstance(meta_root, dict):
            # All keys treated as missing for non-dict meta
            for k in keys:
                breakdown[k]["missing"] += 1
            continue
        for k in keys:
            m = meta_root.get(k)
            if isinstance(m, dict):
                breakdown[k][m.get("status", "unknown")] += 1
            elif m is None:
                # Legacy: treat present keys as sourced, absent as missing
                nut = o.get("nutrition")
                if isinstance(nut, dict) and k in nut:
                    breakdown[k]["sourced"] += 1
                else:
                    breakdown[k]["missing"] += 1
            else:
                # Non-dict meta entry: treat as unknown
                breakdown[k]["unknown"] += 1
    return breakdown


def sodium_outliers(recipes):
    """SOFT: flag recipes with very high sodium per 100g.
    Skips rows with non-dict nutrition, non-numeric sodium, or
    non-numeric/non-positive serving_grams (falls back to 100g)."""
    out = []
    for o in recipes:
        nut = o.get("nutrition")
        if not isinstance(nut, dict):
            continue
        na = nut.get("sodium")
        if not isinstance(na, (int, float)) or isinstance(na, bool):
            continue
        sg_raw = o.get("serving_grams")
        sg = _safe_num(sg_raw)
        if sg <= 0:
            sg = 100  # fallback to per-100g basis
        per100 = na / sg * 100
        if per100 >= SODIUM_REPORT_FLOOR:
            out.append((per100, round(na, 0), o["name"]))
    out.sort(reverse=True)
    return out


def main():
    foods = load(IFCT)
    recipes = load(INDB)
    supported_keys = load(SUPPORTED_IDS)
    quar = load(QUARANTINE) if os.path.exists(QUARANTINE) else {}
    q_contra = quar.get("energy_macro_contradiction", [])
    q_sodium = quar.get("implausible_sodium_dropped", [])

    hard = []
    # Structural checks (existing)
    hard += check_structure(foods, "food")
    hard += check_structure(recipes, "recipe")
    anchor_fails, anchor_rows = check_anchors(foods)
    hard += anchor_fails

    # Nutrient completeness: every row must have all supported keys
    hard += check_nutrient_completeness(foods, "food", supported_keys)
    hard += check_nutrient_completeness(recipes, "recipe", supported_keys)

    # Status vocabulary: only valid statuses allowed
    hard += check_status_vocabulary(foods, "food")
    hard += check_status_vocabulary(recipes, "recipe")

    # B12 provenance: positive values require source + citation + confidence
    hard += check_b12_provenance(foods, "food")
    hard += check_b12_provenance(recipes, "recipe")

    # Zero provenance: non-missing zeros must have a source
    hard += check_zero_provenance(foods, "food")
    hard += check_zero_provenance(recipes, "recipe")

    f_checked, f_over, f_worst = atwater_drift(foods)
    r_checked, r_over, r_worst = atwater_drift(recipes)

    fcov = coverage(foods, supported_keys)
    rcov = coverage(recipes, supported_keys)
    fbd = status_breakdown(foods, supported_keys)
    rbd = status_breakdown(recipes, supported_keys)
    na_out = sodium_outliers(recipes)
    fallback = sum(1 for o in recipes if o.get("basis") == "per_100g")

    # ---- per-nutrient status counts (aggregate) ----
    all_items = foods + recipes
    total_status_counts = Counter()
    for o in all_items:
        meta_root = o.get("nutrition_meta")
        if not isinstance(meta_root, dict):
            total_status_counts["missing"] += len(supported_keys)
            continue
        for k in supported_keys:
            m = meta_root.get(k)
            if isinstance(m, dict):
                total_status_counts[m.get("status", "missing")] += 1
            else:
                total_status_counts["missing"] += 1

    # ---- write report ----
    L = []
    w = L.append
    w(f"# Indian Nutrition Data — Validation Report")
    w("")
    w(f"_Generated by `scripts/validate_data.py`._")
    w("")
    w(f"- **Ingredients (IFCT 2017):** {len(foods)} foods")
    w(f"- **Recipes (INDB 2024.11):** {len(recipes)} dishes "
      f"({fallback} use per-100g fallback; rest per realistic serving)")
    w(f"- **Quarantined at conversion:** {len(q_contra)} recipes (energy/macro "
      f"contradiction) + {len(q_sodium)} sodium field{'s' if len(q_sodium) != 1 else ''} — see below")
    w(f"- **Supported nutrients:** {len(supported_keys)} (from `supported-nutrient-ids.json`)")
    w(f"- **Accuracy bar:** ±{int(TOL*100)}% vs IFCT 2017 published values on anchor foods")
    w(f"- **Gate result:** {'❌ FAIL' if hard else '✅ PASS'} ({len(hard)} hard issues)")
    w("")
    w("## Provenance status summary (all items × all nutrients)")
    w("")
    w("| Status | Count | % |")
    w("|---|--:|--:|")
    total_cells = len(all_items) * len(supported_keys)
    for status in ["sourced", "derived", "explicit_zero", "estimated", "missing"]:
        cnt = total_status_counts.get(status, 0)
        pct = cnt / total_cells * 100 if total_cells else 0
        w(f"| {status} | {cnt} | {pct:.1f}% |")
    w(f"| **total** | **{total_cells}** | **100%** |")
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
    w("## Nutrient coverage (resolved provenance)")
    w("")
    w("Counts entries with `nutrition_meta.status` ≠ `missing` — i.e. sourced, "
      "derived, explicit_zero, or estimated. Missing = scientifically honest "
      "placeholder where no defensible value exists.")
    w("")
    w("| Nutrient | IFCT resolved | INDB resolved | IFCT missing | INDB missing |")
    w("|---|--:|--:|--:|--:|")
    for k in supported_keys:
        fm = fbd[k].get("missing", 0)
        rm = rbd[k].get("missing", 0)
        w(f"| {k} | {fcov[k]} / {len(foods)} | {rcov[k]} / {len(recipes)} "
          f"| {fm} | {rm} |")
    w("")
    # Per-nutrient status breakdown
    w("### Per-nutrient status breakdown")
    w("")
    w("| Nutrient | sourced | derived | explicit_zero | estimated | missing |")
    w("|---|--:|--:|--:|--:|--:|")
    for k in supported_keys:
        s = fbd[k] + rbd[k]  # Counter addition
        w(f"| {k} | {s.get('sourced',0)} | {s.get('derived',0)} "
          f"| {s.get('explicit_zero',0)} | {s.get('estimated',0)} | {s.get('missing',0)} |")
    w("")
    # Highlight nutrients with significant missing counts
    sig_missing = [(k, fbd[k].get("missing", 0), rbd[k].get("missing", 0))
                   for k in supported_keys
                   if fbd[k].get("missing", 0) > len(foods)*0.1
                   or rbd[k].get("missing", 0) > len(recipes)*0.1]
    if sig_missing:
        w("### Unresolved missing (>10% of dataset)")
        w("")
        w("These remain `missing` because no defensible source exists. "
          "The gate accepts scientifically honest missing statuses.")
        w("")
        w("| Nutrient | Dataset | sourced | derived | explicit_zero | estimated | missing |")
        w("|---|---|--:|--:|--:|--:|--:|")
        for k, fm, rm in sig_missing:
            if fm > len(foods)*0.1:
                bd = fbd[k]
                w(f"| {k} | IFCT | {bd.get('sourced',0)} | {bd.get('derived',0)} "
                  f"| {bd.get('explicit_zero',0)} | {bd.get('estimated',0)} | {bd.get('missing',0)} |")
            if rm > len(recipes)*0.1:
                bd = rbd[k]
                w(f"| {k} | INDB | {bd.get('sourced',0)} | {bd.get('derived',0)} "
                  f"| {bd.get('explicit_zero',0)} | {bd.get('estimated',0)} | {bd.get('missing',0)} |")
        w("")
    w("## Validation checks performed")
    w("")
    w("| Check | Type | Description |")
    w("|---|---|---|")
    w("| Structure | HARD | No empty names, valid numbers, no duplicate codes |")
    w("| Anchor accuracy | HARD | IFCT 2017 reference values within ±10% |")
    w("| Nutrient completeness | HARD | All {0} supported keys present in nutrition + nutrition_meta |"
      .format(len(supported_keys)))
    w("| No extra keys | HARD | No unsupported keys in nutrition or nutrition_meta |")
    w("| Status vocabulary | HARD | Only sourced/derived/explicit_zero/estimated/missing |")
    w("| B12 provenance | HARD | Positive B12 requires source + citation + confidence |")
    w("| Zero provenance | HARD | Zero values with non-missing status must have source |")
    w("| Atwater drift | SOFT | Energy vs macro cross-check (>25% flagged) |")
    w("| Sodium outliers | SOFT | Reports high-sodium items for review |")
    w("")
    w("## Known limitations")
    w("")
    w("- **Vitamin B12** — absent from both IFCT and INDB source columns; "
      "provenance is now mixed via supplement rules: plant foods carry "
      "`explicit_zero` (biochemically cannot contain B12), dairy/egg/meat/fish "
      "items have `sourced` or `estimated` values from USDA SR Legacy proxies "
      "with citations, and remaining items (non-vegetarian foods without a "
      "defensible proxy, most INDB recipes) stay `missing`. The app shows B12 "
      "RDA targets; unresolved `missing` entries will read as unmet.")
    na_drop_n = len(q_sodium)
    na_drop_word = "row" if na_drop_n == 1 else "rows"
    w(f"- **Sodium outliers:** the converter dropped sodium from {na_drop_n} "
      f"INDB {na_drop_word} whose source value exceeded 8000 mg/100g "
      f"(physically impossible). {len(na_out)} remaining recipes still report "
      f">{int(SODIUM_REPORT_FLOOR)} mg/100g — high but within INDB's published "
      f"data; listed below for review.")
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
          f"Nutrients={len(supported_keys)} "
          f"AnchorRows={len(anchor_rows)} HardIssues={len(hard)}")
    print(f"Status counts: {dict(total_status_counts)}")
    if hard:
        print("HARD FAILURES:")
        for h in hard[:20]:
            print("  -", h)
        sys.exit(1)
    print("GATE: PASS")


if __name__ == "__main__":
    main()
