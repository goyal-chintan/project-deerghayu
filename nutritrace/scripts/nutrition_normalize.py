#!/usr/bin/env python3
"""
nutrition_normalize.py — Canonical nutrient normalization helpers.

Provides the SUPPORTED_NUTRIENTS list (matching src/lib/nutrition.js order),
metadata constructors, and a record-level normalizer that ensures every seeded
food/recipe has all supported nutrient keys with provenance tracking.

Usage (by converter scripts):
    from nutrition_normalize import SUPPORTED_NUTRIENTS, normalize_record, make_meta

Provenance status vocabulary:
    sourced       — value provided by the data source
    derived       — computed from other sourced/derived values
    explicit_zero — set to 0 by a domain rule (nutrient not expected in category)
    missing       — unresolved placeholder (value unknown)
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_IDS_PATH = os.path.join(HERE, "..", "server", "seed", "data", "supported-nutrient-ids.json")

with open(_IDS_PATH, encoding="utf-8") as _fh:
    SUPPORTED_NUTRIENTS = json.load(_fh)

# --- Status constants ---
STATUS_SOURCED = "sourced"
STATUS_DERIVED = "derived"
STATUS_EXPLICIT_ZERO = "explicit_zero"
STATUS_MISSING = "missing"

# --- Conversion constants (match nutrition.js) ---
KCAL_TO_KJ = 4.184
SODIUM_MG_PER_SALT_G = 400


def _is_valid_numeric(value):
    """Return True if value is a finite non-negative number."""
    if not isinstance(value, (int, float)):
        return False
    if math.isnan(value) or math.isinf(value):
        return False
    return value >= 0


def make_meta(status, source, citation=None, confidence=None):
    """Create a provenance metadata dict for a single nutrient value.

    Args:
        status: one of STATUS_SOURCED, STATUS_DERIVED, STATUS_MISSING,
                STATUS_EXPLICIT_ZERO.
        source: short name of the data source (e.g. "IFCT 2017", "INDB").
        citation: optional reference string.
        confidence: optional float 0-1.

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
    """Build fully-populated nutrition and nutrition_meta from source_values.

    Constructs fresh `nutrition` and `nutrition_meta` dicts covering every
    supported nutrient ID, then assigns them to the record. Any pre-existing
    `record['nutrition']` is replaced to guarantee completeness.

    Args:
        record: dict to populate (typically has name, group, etc.).
        source_name: provenance label for sourced values (e.g. "IFCT 2017").
        source_values: dict of nutrient_id -> numeric value from the source.
        zero_rules: set/list of nutrient ids that should be explicit zero when
                    not present in source_values (e.g. caffeine for most foods).
        derived_rules: set/list of nutrient ids eligible for derivation.
                       Currently supports 'kilojoules' and 'salt'.

    Returns:
        The record dict with record['nutrition'] fully populated and
        record['nutrition_meta'] containing per-key provenance.

    Derivation rules:
        - kilojoules = calories * 4.184 (when calories key is valid numeric)
        - salt = sodium_mg / 400 (when sodium key is valid numeric and salt
          not already sourced)
    """
    if zero_rules is None:
        zero_rules = set()
    else:
        zero_rules = set(zero_rules)

    if derived_rules is None:
        derived_rules = {"kilojoules", "salt"}
    else:
        derived_rules = set(derived_rules)

    nutrition = {}
    meta = {}

    # Phase 1: Apply sourced values
    for nid in SUPPORTED_NUTRIENTS:
        if nid in source_values and source_values[nid] is not None:
            val = source_values[nid]
            if _is_valid_numeric(val):
                nutrition[nid] = val
                meta[nid] = make_meta(STATUS_SOURCED, source_name)

    # Phase 2: Derive kilojoules from calories (any valid value incl. 0)
    if "kilojoules" in derived_rules and "kilojoules" not in nutrition:
        if "calories" in nutrition and _is_valid_numeric(nutrition["calories"]):
            nutrition["kilojoules"] = round(nutrition["calories"] * KCAL_TO_KJ, 1)
            meta["kilojoules"] = make_meta(STATUS_DERIVED, source_name,
                                           citation="calories * 4.184")

    # Phase 3: Derive salt from sodium (sodium in mg -> salt in g)
    if "salt" in derived_rules and "salt" not in nutrition:
        if "sodium" in nutrition and _is_valid_numeric(nutrition["sodium"]):
            nutrition["salt"] = round(nutrition["sodium"] / SODIUM_MG_PER_SALT_G, 3)
            meta["salt"] = make_meta(STATUS_DERIVED, source_name,
                                     citation="sodium_mg / 400")

    # Phase 4: Fill remaining gaps — every supported key gets a value + meta
    for nid in SUPPORTED_NUTRIENTS:
        if nid not in nutrition:
            if nid in zero_rules:
                nutrition[nid] = 0
                meta[nid] = make_meta(STATUS_EXPLICIT_ZERO, source_name,
                                      citation="not expected in food category")
            else:
                nutrition[nid] = 0
                meta[nid] = make_meta(STATUS_MISSING, source_name)

    # Assign fresh objects to record (replaces any pre-existing partial data)
    record["nutrition"] = nutrition
    record["nutrition_meta"] = meta
    return record
