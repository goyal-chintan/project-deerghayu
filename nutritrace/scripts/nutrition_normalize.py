#!/usr/bin/env python3
"""
nutrition_normalize.py — Canonical nutrient normalization helpers.

Provides the SUPPORTED_NUTRIENTS list (matching src/lib/nutrition.js order),
metadata constructors, and a record-level normalizer that ensures every seeded
food/recipe has all 34 nutrient keys with provenance tracking.

Usage (by converter scripts):
    from nutrition_normalize import SUPPORTED_NUTRIENTS, normalize_record, make_meta
"""
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
_IDS_PATH = os.path.join(HERE, "..", "server", "seed", "data", "supported-nutrient-ids.json")

with open(_IDS_PATH, encoding="utf-8") as _fh:
    SUPPORTED_NUTRIENTS = json.load(_fh)

# --- Conversion constants (match nutrition.js) ---
KCAL_TO_KJ = 4.184
SODIUM_MG_PER_SALT_G = 400


def make_meta(status, source, citation=None, confidence=None):
    """Create a provenance metadata dict for a single nutrient value.

    Args:
        status: one of "measured", "derived", "missing", "zero_rule"
        source: short name of the data source (e.g. "IFCT 2017", "INDB")
        citation: optional reference string
        confidence: optional float 0-1

    Returns:
        dict with non-None fields only.
    """
    meta = {"status": status, "source": source}
    if citation is not None:
        meta["citation"] = citation
    if confidence is not None:
        meta["confidence"] = confidence
    return meta


def normalize_record(record, source_name, source_values, zero_rules=None, derived_rules=None):
    """Ensure every supported nutrient key exists in the record with provenance.

    Args:
        record: dict to mutate — must already have a 'nutrition' sub-dict.
        source_name: provenance label for measured values (e.g. "IFCT 2017").
        source_values: dict of nutrient_id -> numeric value from the source.
        zero_rules: set/list of nutrient ids that should be explicit zero when
                    not present in source_values (e.g. caffeine for most foods).
        derived_rules: set/list of nutrient ids eligible for derivation.
                       Currently supports 'kilojoules' and 'salt'.

    Returns:
        The mutated record dict with record['nutrition'] fully populated and
        record['_nutrition_meta'] containing per-key provenance.

    Derivation rules:
        - kilojoules = calories * 4.184 (when calories present)
        - salt = sodium_mg / 400 (when sodium present and salt not measured)
    """
    if zero_rules is None:
        zero_rules = set()
    else:
        zero_rules = set(zero_rules)

    if derived_rules is None:
        derived_rules = {"kilojoules", "salt"}
    else:
        derived_rules = set(derived_rules)

    nutrition = record.setdefault("nutrition", {})
    meta = record.setdefault("_nutrition_meta", {})

    # Phase 1: Apply measured values from source
    for nid in SUPPORTED_NUTRIENTS:
        if nid in source_values and source_values[nid] is not None:
            val = source_values[nid]
            # Treat negative/nan as missing
            if isinstance(val, (int, float)) and val >= 0:
                nutrition[nid] = val
                meta[nid] = make_meta("measured", source_name)

    # Phase 2: Derive kilojoules from calories
    if "kilojoules" in derived_rules and "kilojoules" not in nutrition:
        if "calories" in nutrition and nutrition["calories"] > 0:
            nutrition["kilojoules"] = round(nutrition["calories"] * KCAL_TO_KJ, 1)
            meta["kilojoules"] = make_meta("derived", source_name,
                                           citation="calories * 4.184")

    # Phase 3: Derive salt from sodium (sodium in mg -> salt in g)
    if "salt" in derived_rules and "salt" not in nutrition:
        if "sodium" in nutrition and nutrition["sodium"] > 0:
            nutrition["salt"] = round(nutrition["sodium"] / SODIUM_MG_PER_SALT_G, 3)
            meta["salt"] = make_meta("derived", source_name,
                                     citation="sodium_mg / 400")

    # Phase 4: Fill remaining gaps
    for nid in SUPPORTED_NUTRIENTS:
        if nid not in nutrition:
            if nid in zero_rules:
                nutrition[nid] = 0
                meta[nid] = make_meta("zero_rule", source_name,
                                      citation="explicit zero — not expected in food category")
            else:
                nutrition[nid] = 0
                meta[nid] = make_meta("missing", source_name)

    return record
