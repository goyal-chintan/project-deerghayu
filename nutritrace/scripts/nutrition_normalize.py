#!/usr/bin/env python3
"""
nutrition_normalize.py — Canonical nutrient normalization helpers.

Provides the SUPPORTED_NUTRIENTS list (matching src/lib/nutrition.js order),
metadata constructors, and a record-level normalizer that ensures every seeded
food/recipe has all supported nutrient keys with provenance tracking.

Also provides the nutrient supplement framework: load_supplements(),
match_supplement_rules(), apply_supplements() — for applying audited
explicit-zero rules and cited B12/positive-value overrides from
nutrient-supplements.json.

Usage (by converter scripts):
    from nutrition_normalize import (
        SUPPORTED_NUTRIENTS, normalize_record, make_meta,
        load_supplements, apply_supplements,
    )

Provenance status vocabulary:
    sourced       — value provided by the data source
    derived       — computed from other sourced/derived values
    explicit_zero — set to 0 by a domain rule (nutrient not expected in category)
    estimated     — cited value from external reference (not original source)
    missing       — unresolved placeholder (value unknown)
"""
import json
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
_IDS_PATH = os.path.join(HERE, "..", "server", "seed", "data", "supported-nutrient-ids.json")
_SUPPLEMENTS_PATH = os.path.join(HERE, "..", "server", "seed", "data", "nutrient-supplements.json")

with open(_IDS_PATH, encoding="utf-8") as _fh:
    SUPPORTED_NUTRIENTS = json.load(_fh)

# --- Status constants ---
STATUS_SOURCED = "sourced"
STATUS_DERIVED = "derived"
STATUS_EXPLICIT_ZERO = "explicit_zero"
STATUS_ESTIMATED = "estimated"
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


# ===========================================================================
# Nutrient Supplement Framework
# ===========================================================================

_supplements_cache = None


def load_supplements():
    """Load and cache the nutrient-supplements.json data.

    Returns:
        dict with keys: schema_version, sources, rules, item_overrides,
        recipe_overrides.
    """
    global _supplements_cache
    if _supplements_cache is not None:
        return _supplements_cache
    with open(_SUPPLEMENTS_PATH, encoding="utf-8") as fh:
        _supplements_cache = json.load(fh)
    return _supplements_cache


def _name_matches_any_pattern(name, patterns):
    """Return True if the item name matches any regex pattern (case-insensitive).

    Patterns use word-boundary anchors (\\b) to avoid substring false positives.
    """
    if not patterns:
        return False
    name_lower = name.lower()
    for pattern in patterns:
        if re.search(pattern, name_lower, re.IGNORECASE):
            return True
    return False


def _rule_matches_item(rule, item_code, item_name, item_group, item_diet_type,
                       item_source, item_nutrition=None):
    """Check whether a supplement rule matches a given item.

    Args:
        rule: dict from supplements['rules'].
        item_code: IFCT/INDB code (e.g. "C001").
        item_name: item name string.
        item_group: item group string (e.g. "Green Leafy Vegetables").
        item_diet_type: one of "vegetarian", "eggetarian", "non-vegetarian".
        item_source: data source string (e.g. "IFCT 2017", "INDB 2024.11").
        item_nutrition: dict of already-resolved nutrition values (for
                        requires_sourced checks).

    Returns:
        True if rule conditions are satisfied and item is not excluded.
    """
    match = rule.get("match", {})

    # Check data_source constraint
    ds = match.get("data_source")
    if ds is not None:
        if isinstance(ds, str):
            if item_source != ds:
                return False
        elif isinstance(ds, list):
            if item_source not in ds:
                return False

    # Check diet_type constraint
    dt = match.get("diet_type")
    if dt is not None:
        if isinstance(dt, str):
            if item_diet_type != dt:
                return False
        elif isinstance(dt, list):
            if item_diet_type not in dt:
                return False

    # Check groups_include constraint
    groups = match.get("groups_include")
    if groups is not None:
        if item_group not in groups:
            return False

    # Check requires_sourced constraint (nutrition keys that must have sourced values)
    req_sourced = match.get("requires_sourced")
    if req_sourced is not None and item_nutrition is not None:
        for req_nid in req_sourced:
            if req_nid not in item_nutrition or item_nutrition[req_nid] is None:
                return False

    # Check item exclusions
    exclude_items = rule.get("exclude_items", [])
    if item_code in exclude_items:
        return False

    # Check name-based exclusions (item should NOT match exclusion patterns)
    exclude_patterns = rule.get("exclude_name_patterns", [])
    if exclude_patterns and _name_matches_any_pattern(item_name, exclude_patterns):
        return False

    return True


def match_supplement_rules(item_code, item_name, item_group, item_diet_type,
                           item_source, item_nutrition=None):
    """Find all supplement rules that match an item and return per-nutrient results.

    Args:
        item_code: e.g. "C001".
        item_name: e.g. "Agathi leaves".
        item_group: e.g. "Green Leafy Vegetables".
        item_diet_type: e.g. "vegetarian".
        item_source: e.g. "IFCT 2017".
        item_nutrition: dict of sourced nutrition values (optional, for
                        requires_sourced checks).

    Returns:
        dict of nutrient_id -> {value, status, source_ref, citation?, ...}
        Only nutrients with matched rules are included.
    """
    supplements = load_supplements()
    results = {}

    for rule in supplements.get("rules", []):
        nid = rule["nutrient_id"]
        # Skip if already matched by a previous (higher-priority) rule
        if nid in results:
            continue
        if _rule_matches_item(rule, item_code, item_name, item_group,
                              item_diet_type, item_source, item_nutrition):
            source_ref = rule.get("source_ref", "supplement_rule")
            source_name = supplements["sources"].get(source_ref, {}).get("name", source_ref)
            results[nid] = {
                "value": rule["value"],
                "status": rule["status"],
                "source": source_name,
                "citation": rule.get("description", ""),
                "rule_id": rule["id"],
            }

    return results


def match_item_overrides(item_code, item_source):
    """Look up item-specific nutrient overrides by prefixed code.

    Args:
        item_code: e.g. "C001", "L002".
        item_source: e.g. "IFCT 2017", "INDB 2024.11".

    Returns:
        dict of nutrient_id -> {value, status, source, citation, confidence?}
        Empty dict if no override exists for this item.
    """
    supplements = load_supplements()

    # Determine prefix from source
    if "IFCT" in item_source:
        prefix = "ifct"
    elif "INDB" in item_source:
        prefix = "indb"
    else:
        return {}

    key = f"{prefix}:{item_code}"

    # Check item_overrides
    overrides_section = supplements.get("item_overrides", {})
    item_data = overrides_section.get(key, {})

    # Also check recipe_overrides for INDB items
    if prefix == "indb":
        recipe_section = supplements.get("recipe_overrides", {})
        recipe_data = recipe_section.get(key, {})
        # Merge: item_overrides take precedence
        merged = {**recipe_data, **item_data}
        item_data = merged

    results = {}
    for nid, override in item_data.items():
        if nid.startswith("_"):
            continue  # Skip metadata keys like _notes
        if not isinstance(override, dict):
            continue
        source_ref = override.get("source_ref", "supplement_override")
        source_name = supplements["sources"].get(source_ref, {}).get("name", source_ref)
        results[nid] = {
            "value": override["value"],
            "status": override.get("status", STATUS_ESTIMATED),
            "source": source_name,
            "citation": override.get("citation"),
            "confidence": override.get("confidence"),
        }

    return results


def apply_supplements(record, item_code, item_name, item_group, item_diet_type,
                      item_source):
    """Apply supplement rules and item overrides to a record's nutrition/meta.

    This should be called AFTER normalize_record() has populated the full
    nutrition dict. It upgrades 'missing' entries to 'explicit_zero' or
    'estimated' values where supplement data is available. It does NOT
    overwrite 'sourced' or 'derived' values from the primary data source.

    Args:
        record: dict with record['nutrition'] and record['nutrition_meta'] already
                set by normalize_record().
        item_code: item code (e.g. "C001").
        item_name: item name.
        item_group: item group.
        item_diet_type: diet type.
        item_source: data source string.

    Returns:
        The record dict with supplement values applied. Records which nutrients
        were supplemented in record['nutrition_meta'].
    """
    nutrition = record.get("nutrition", {})
    meta = record.get("nutrition_meta", {})

    # Gather current sourced nutrition for requires_sourced checks
    sourced_nutrition = {}
    for nid, m in meta.items():
        if m.get("status") == STATUS_SOURCED:
            sourced_nutrition[nid] = nutrition.get(nid)

    # Phase 1: Apply category-level rules (explicit zeros)
    rule_results = match_supplement_rules(
        item_code, item_name, item_group, item_diet_type, item_source,
        item_nutrition=sourced_nutrition,
    )
    for nid, result in rule_results.items():
        current_status = meta.get(nid, {}).get("status")
        # Only apply to 'missing' entries — never overwrite sourced/derived
        if current_status == STATUS_MISSING:
            nutrition[nid] = result["value"]
            meta[nid] = make_meta(
                result["status"], result["source"],
                citation=result.get("citation"),
            )

    # Phase 2: Apply item-specific overrides (positive values / estimates)
    override_results = match_item_overrides(item_code, item_source)
    for nid, result in override_results.items():
        current_status = meta.get(nid, {}).get("status")
        # Override applies to 'missing' or 'explicit_zero' (positive data
        # is more informative than a category-level zero rule)
        if current_status in (STATUS_MISSING, STATUS_EXPLICIT_ZERO):
            nutrition[nid] = result["value"]
            meta[nid] = make_meta(
                result["status"], result["source"],
                citation=result.get("citation"),
                confidence=result.get("confidence"),
            )

    record["nutrition"] = nutrition
    record["nutrition_meta"] = meta
    return record
