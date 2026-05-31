#!/usr/bin/env python3
"""
test_nutrient_supplements.py — Smoke tests for the nutrient supplement framework.

Validates:
1. Plant IFCT items get B12 explicit_zero via rule.
2. Milk/egg/fish/meat items get nonzero B12 with citation.
3. Caffeine exclusion works for tea/coffee-like names.
4. Ambiguous added-sugars remains 'missing' for recipes.
5. Cholesterol zero for plant items; not for ghee.
6. Alcohol zero for normal foods; not for toddy.
7. Word-boundary matching avoids false positives (e.g. 'steak', 'drumstick').

Run: python3 nutritrace/scripts/test_nutrient_supplements.py
"""
import sys
import os

# Add scripts dir to path for importing
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

from nutrition_normalize import (
    SUPPORTED_NUTRIENTS, normalize_record, make_meta, apply_supplements,
    load_supplements, match_supplement_rules, match_item_overrides,
    invalidate_supplements_cache, _validate_supplements,
    STATUS_SOURCED, STATUS_DERIVED, STATUS_EXPLICIT_ZERO, STATUS_ESTIMATED,
    STATUS_MISSING,
)

passed = 0
failed = 0


def assert_eq(actual, expected, msg):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  ✓ {msg}")
    else:
        failed += 1
        print(f"  ✗ {msg}")
        print(f"    expected: {expected!r}")
        print(f"    actual:   {actual!r}")


def assert_true(condition, msg):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✓ {msg}")
    else:
        failed += 1
        print(f"  ✗ {msg}")


def make_test_record(name, code, group, diet_type, source, nutrition=None):
    """Create a minimal record and run normalize + supplements."""
    record = {
        "name": name,
        "code": code,
        "group": group,
        "diet_type": diet_type,
        "source": source,
    }
    source_values = nutrition or {}
    # normalize_record fills all keys
    normalize_record(record, source, source_values)
    # apply_supplements upgrades missing->explicit_zero or estimated
    apply_supplements(record, code, name, group, diet_type, source)
    return record


# -----------------------------------------------------------------------
print("\n[Test 1] Plant IFCT item gets B12 explicit_zero")
# -----------------------------------------------------------------------
rec = make_test_record(
    name="Agathi leaves", code="C001",
    group="Green Leafy Vegetables", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 80, "proteins": 8.4},
)
assert_eq(rec["nutrition"]["b12"], 0, "B12 value is 0")
assert_eq(rec["nutrition_meta"]["b12"]["status"], STATUS_EXPLICIT_ZERO,
           "B12 status is explicit_zero")
assert_true("citation" in rec["nutrition_meta"]["b12"] or
            "source" in rec["nutrition_meta"]["b12"],
            "B12 meta has provenance info")

# Also test cereals
rec2 = make_test_record(
    name="Rice, raw, milled", code="A001",
    group="Cereals and Millets", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 356, "carbohydrates": 78.2},
)
assert_eq(rec2["nutrition"]["b12"], 0, "Cereal B12 = 0")
assert_eq(rec2["nutrition_meta"]["b12"]["status"], STATUS_EXPLICIT_ZERO,
           "Cereal B12 status is explicit_zero")

# -----------------------------------------------------------------------
print("\n[Test 2] Milk/egg/fish/meat items get nonzero B12 with citation")
# -----------------------------------------------------------------------
# Cow milk (L002)
rec_milk = make_test_record(
    name="Milk, whole, Cow", code="L002",
    group="Milk and Milk Products", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 67, "fat": 4.1, "proteins": 3.3},
)
assert_true(rec_milk["nutrition"]["b12"] > 0,
            f"Cow milk B12 > 0 (got {rec_milk['nutrition']['b12']})")
assert_eq(rec_milk["nutrition"]["b12"], 0.45, "Cow milk B12 = 0.45 µg/100g")
assert_true(rec_milk["nutrition_meta"]["b12"].get("citation") is not None,
            "Cow milk B12 has citation")
assert_true(rec_milk["nutrition_meta"]["b12"].get("confidence") is not None,
            "Cow milk B12 has confidence")

# Egg whole raw (M001)
rec_egg = make_test_record(
    name="Egg, poultry, whole, raw", code="M001",
    group="Egg and Egg Products", diet_type="eggetarian",
    source="IFCT 2017",
    nutrition={"calories": 143, "fat": 9.5, "proteins": 13.6},
)
assert_true(rec_egg["nutrition"]["b12"] > 0,
            f"Egg B12 > 0 (got {rec_egg['nutrition']['b12']})")
assert_eq(rec_egg["nutrition"]["b12"], 0.89, "Egg whole raw B12 = 0.89 µg/100g")
assert_true("USDA" in (rec_egg["nutrition_meta"]["b12"].get("citation") or ""),
            "Egg B12 citation mentions USDA")

# Chicken breast (N003)
rec_chicken = make_test_record(
    name="Chicken, poultry, breast, skinless", code="N003",
    group="Poultry", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 110, "proteins": 25},
)
assert_true(rec_chicken["nutrition"]["b12"] > 0,
            f"Chicken breast B12 > 0 (got {rec_chicken['nutrition']['b12']})")
assert_eq(rec_chicken["nutrition"]["b12"], 0.34, "Chicken breast B12 = 0.34")

# Marine fish (anchovy P003)
rec_fish = make_test_record(
    name="Anchovy", code="P003",
    group="Marine Fish", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 131, "proteins": 20},
)
assert_true(rec_fish["nutrition"]["b12"] > 0,
            f"Anchovy B12 > 0 (got {rec_fish['nutrition']['b12']})")

# Beef liver (O032) — extremely high B12
rec_liver = make_test_record(
    name="Beef, liver", code="O032",
    group="Animal Meat", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 135, "proteins": 20},
)
assert_true(rec_liver["nutrition"]["b12"] > 10,
            f"Beef liver B12 > 10 (got {rec_liver['nutrition']['b12']})")

# -----------------------------------------------------------------------
print("\n[Test 3] Caffeine exclusion works for tea/coffee-like names")
# -----------------------------------------------------------------------
# Normal food → caffeine = 0
rec_rice = make_test_record(
    name="Rice, raw, milled", code="A001",
    group="Cereals and Millets", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 356},
)
assert_eq(rec_rice["nutrition"]["caffeine"], 0, "Rice caffeine = 0")
assert_eq(rec_rice["nutrition_meta"]["caffeine"]["status"], STATUS_EXPLICIT_ZERO,
           "Rice caffeine status = explicit_zero")

# Tea recipe → caffeine NOT set to explicit_zero (remains missing)
rec_tea = make_test_record(
    name="Hot tea (Garam Chai)", code="ASC001",
    group="", diet_type="vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 35},
)
assert_eq(rec_tea["nutrition_meta"]["caffeine"]["status"], STATUS_MISSING,
           "Tea caffeine remains missing (not explicit_zero)")

# Coffee recipe → caffeine NOT set to explicit_zero
rec_coffee = make_test_record(
    name="Instant coffee", code="ASC002",
    group="", diet_type="vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 40},
)
assert_eq(rec_coffee["nutrition_meta"]["caffeine"]["status"], STATUS_MISSING,
           "Coffee caffeine remains missing")

# Word-boundary test: "steak" should NOT match "tea"
rec_steak = make_test_record(
    name="Roasted cauliflower steak", code="OSR078",
    group="", diet_type="vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 80},
)
assert_eq(rec_steak["nutrition"]["caffeine"], 0, "'steak' does not match 'tea' pattern")
assert_eq(rec_steak["nutrition_meta"]["caffeine"]["status"], STATUS_EXPLICIT_ZERO,
           "steak item gets caffeine=explicit_zero")

# "Kehwa" (Kashmiri tea) should remain missing (it's a tea)
rec_kehwa = make_test_record(
    name="Kashmiri tea (Kehwa)", code="BFP007",
    group="", diet_type="vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 20},
)
assert_eq(rec_kehwa["nutrition_meta"]["caffeine"]["status"], STATUS_MISSING,
           "Kehwa/tea caffeine remains missing (excluded from zero rule)")

# -----------------------------------------------------------------------
print("\n[Test 4] Ambiguous added-sugars remains 'missing' for INDB recipes")
# -----------------------------------------------------------------------
rec_recipe = make_test_record(
    name="Chocolate cake", code="ASC420",
    group="", diet_type="vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 350, "sugars": 25},
)
assert_eq(rec_recipe["nutrition_meta"]["added-sugars"]["status"], STATUS_MISSING,
           "Recipe added-sugars remains missing (can't determine from name)")

# IFCT vegetable WITH sourced sugars → added-sugars = explicit_zero
rec_veg = make_test_record(
    name="Tomato, ripe", code="D045",
    group="Other Vegetables", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 18, "sugars": 2.6},
)
assert_eq(rec_veg["nutrition"]["added-sugars"], 0,
           "Whole vegetable added-sugars = 0")
assert_eq(rec_veg["nutrition_meta"]["added-sugars"]["status"], STATUS_EXPLICIT_ZERO,
           "Whole vegetable added-sugars status = explicit_zero")

# IFCT vegetable WITHOUT sourced sugars → added-sugars remains missing
rec_no_sugar = make_test_record(
    name="Onion", code="D030",
    group="Other Vegetables", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 40},  # no sugars value provided
)
assert_eq(rec_no_sugar["nutrition_meta"]["added-sugars"]["status"], STATUS_MISSING,
           "Vegetable without sourced sugars → added-sugars remains missing")

# -----------------------------------------------------------------------
print("\n[Test 5] Cholesterol zero for plant items; not for ghee")
# -----------------------------------------------------------------------
rec_lentil = make_test_record(
    name="Bengal gram, dhal", code="B001",
    group="Grain Legumes", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 360},
)
assert_eq(rec_lentil["nutrition"]["cholesterol"], 0, "Legume cholesterol = 0")
assert_eq(rec_lentil["nutrition_meta"]["cholesterol"]["status"], STATUS_EXPLICIT_ZERO,
           "Legume cholesterol status = explicit_zero")

# Ghee should NOT get cholesterol=0 (excluded from rule)
rec_ghee = make_test_record(
    name="Ghee", code="T013",
    group="Edible Oils and Fats", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 900, "fat": 100},
)
assert_eq(rec_ghee["nutrition_meta"]["cholesterol"]["status"], STATUS_MISSING,
           "Ghee cholesterol remains missing (excluded from zero rule)")

# Coconut oil should get cholesterol=0
rec_coconut_oil = make_test_record(
    name="Coconut oil", code="T001",
    group="Edible Oils and Fats", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 900, "fat": 100},
)
assert_eq(rec_coconut_oil["nutrition"]["cholesterol"], 0,
           "Coconut oil cholesterol = 0")
assert_eq(rec_coconut_oil["nutrition_meta"]["cholesterol"]["status"], STATUS_EXPLICIT_ZERO,
           "Coconut oil cholesterol status = explicit_zero")

# -----------------------------------------------------------------------
print("\n[Test 6] Alcohol zero for normal foods; not for toddy")
# -----------------------------------------------------------------------
rec_normal = make_test_record(
    name="Agathi leaves", code="C001",
    group="Green Leafy Vegetables", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 80},
)
assert_eq(rec_normal["nutrition"]["alcohol"], 0, "Normal food alcohol = 0")
assert_eq(rec_normal["nutrition_meta"]["alcohol"]["status"], STATUS_EXPLICIT_ZERO,
           "Normal food alcohol status = explicit_zero")

# Toddy should remain missing (alcoholic beverage)
rec_toddy = make_test_record(
    name="Toddy", code="K001",
    group="Miscellaneous Foods", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 36},
)
assert_eq(rec_toddy["nutrition_meta"]["alcohol"]["status"], STATUS_MISSING,
           "Toddy alcohol remains missing (excluded from zero rule)")

# -----------------------------------------------------------------------
print("\n[Test 7] Word-boundary matching avoids false positives")
# -----------------------------------------------------------------------
# "Drumstick" should NOT match "rum" pattern
rec_drum = make_test_record(
    name="Drumstick", code="D046",
    group="Other Vegetables", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 26},
)
assert_eq(rec_drum["nutrition"]["alcohol"], 0,
           "Drumstick gets alcohol=0 (does not match 'rum')")
assert_eq(rec_drum["nutrition_meta"]["alcohol"]["status"], STATUS_EXPLICIT_ZERO,
           "Drumstick alcohol status = explicit_zero")

# "Rumex leaves" should NOT match "rum" pattern
rec_rumex = make_test_record(
    name="Rumex leaves", code="C032",
    group="Green Leafy Vegetables", diet_type="vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 30},
)
assert_eq(rec_rumex["nutrition"]["alcohol"], 0,
           "Rumex leaves gets alcohol=0 (does not match 'rum')")

# -----------------------------------------------------------------------
print("\n[Test 8] Supplement schema loads correctly")
# -----------------------------------------------------------------------
supplements = load_supplements()
assert_eq(supplements["schema_version"], "1.0", "Schema version is 1.0")
assert_true(len(supplements["rules"]) >= 5,
            f"At least 5 rules defined (got {len(supplements['rules'])})")
assert_true(len(supplements["item_overrides"]) >= 20,
            f"At least 20 item overrides (got {len(supplements['item_overrides'])})")
assert_true("usda_sr_legacy" in supplements["sources"],
            "USDA SR Legacy source defined")

# -----------------------------------------------------------------------
print("\n[Test 9] B12 override does not overwrite sourced values")
# -----------------------------------------------------------------------
# If IFCT already provided B12 (hypothetical), supplement should NOT overwrite
rec_sourced = {
    "name": "Milk, whole, Cow", "code": "L002",
    "group": "Milk and Milk Products", "diet_type": "vegetarian",
    "source": "IFCT 2017",
}
# Simulate: source already has B12 = 0.50 (hypothetically sourced)
normalize_record(rec_sourced, "IFCT 2017", {"calories": 67, "b12": 0.50})
assert_eq(rec_sourced["nutrition"]["b12"], 0.50, "Sourced B12 = 0.50 before supplement")
assert_eq(rec_sourced["nutrition_meta"]["b12"]["status"], STATUS_SOURCED,
           "B12 status is sourced before supplement")
# Apply supplements — should NOT overwrite
apply_supplements(rec_sourced, "L002", "Milk, whole, Cow",
                  "Milk and Milk Products", "vegetarian", "IFCT 2017")
assert_eq(rec_sourced["nutrition"]["b12"], 0.50,
           "Sourced B12 preserved after supplement (not overwritten)")
assert_eq(rec_sourced["nutrition_meta"]["b12"]["status"], STATUS_SOURCED,
           "Status remains sourced after supplement")

# -----------------------------------------------------------------------
print("\n[Test 10] Validation rejects bad positive override (no citation)")
# -----------------------------------------------------------------------
bad_data_no_citation = {
    "schema_version": "1.0",
    "sources": {"test_src": {"name": "Test", "note": "test"}},
    "rules": [],
    "item_overrides": {
        "ifct:X001": {
            "b12": {
                "value": 1.5,
                "status": "estimated",
                "source_ref": "test_src",
                "confidence": 0.7
                # missing citation!
            }
        }
    },
    "recipe_overrides": {}
}
try:
    _validate_supplements(bad_data_no_citation)
    assert_true(False, "Should have raised ValueError for missing citation")
except ValueError as e:
    assert_true("citation" in str(e).lower(),
                f"ValueError mentions citation: {e}")

# -----------------------------------------------------------------------
print("\n[Test 11] Validation rejects bad positive override (no confidence)")
# -----------------------------------------------------------------------
bad_data_no_conf = {
    "schema_version": "1.0",
    "sources": {"test_src": {"name": "Test", "note": "test"}},
    "rules": [],
    "item_overrides": {
        "ifct:X001": {
            "b12": {
                "value": 1.5,
                "status": "estimated",
                "source_ref": "test_src",
                "citation": "Some citation"
                # missing confidence!
            }
        }
    },
    "recipe_overrides": {}
}
try:
    _validate_supplements(bad_data_no_conf)
    assert_true(False, "Should have raised ValueError for missing confidence")
except ValueError as e:
    assert_true("confidence" in str(e).lower(),
                f"ValueError mentions confidence: {e}")

# -----------------------------------------------------------------------
print("\n[Test 12] Validation rejects undefined source_ref in rule")
# -----------------------------------------------------------------------
bad_data_bad_ref = {
    "schema_version": "1.0",
    "sources": {"test_src": {"name": "Test", "note": "test"}},
    "rules": [
        {"id": "bad_rule", "nutrient_id": "b12", "value": 0,
         "status": "explicit_zero", "source_ref": "nonexistent_source",
         "match": {}}
    ],
    "item_overrides": {},
    "recipe_overrides": {}
}
try:
    _validate_supplements(bad_data_bad_ref)
    assert_true(False, "Should have raised ValueError for undefined source_ref")
except ValueError as e:
    assert_true("nonexistent_source" in str(e),
                f"ValueError mentions bad source_ref: {e}")

# -----------------------------------------------------------------------
print("\n[Test 13] Validation rejects bad status on positive override")
# -----------------------------------------------------------------------
bad_data_bad_status = {
    "schema_version": "1.0",
    "sources": {"test_src": {"name": "Test", "note": "test"}},
    "rules": [],
    "item_overrides": {
        "ifct:X001": {
            "b12": {
                "value": 1.5,
                "status": "explicit_zero",  # Wrong for positive value!
                "source_ref": "test_src",
                "citation": "Some citation",
                "confidence": 0.7
            }
        }
    },
    "recipe_overrides": {}
}
try:
    _validate_supplements(bad_data_bad_status)
    assert_true(False, "Should have raised ValueError for bad status on positive")
except ValueError as e:
    assert_true("status" in str(e).lower(),
                f"ValueError mentions status: {e}")

# -----------------------------------------------------------------------
print("\n[Test 14] Recipe overrides: Afghani chicken gets positive B12")
# -----------------------------------------------------------------------
rec_afghani = make_test_record(
    name="Afghani chicken", code="OSR062",
    group="", diet_type="non-vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 200, "proteins": 18},
)
assert_true(rec_afghani["nutrition"]["b12"] > 0,
            f"Afghani chicken B12 > 0 (got {rec_afghani['nutrition']['b12']})")
assert_true(rec_afghani["nutrition_meta"]["b12"].get("citation") is not None,
            "Afghani chicken B12 has citation")
assert_true(rec_afghani["nutrition_meta"]["b12"].get("confidence") is not None,
            "Afghani chicken B12 has confidence")

# -----------------------------------------------------------------------
print("\n[Test 15] Recipe overrides: Shrikhand gets positive B12")
# -----------------------------------------------------------------------
rec_shrikhand = make_test_record(
    name="Sweetened yogurt (Shrikhand)", code="OSR024",
    group="", diet_type="vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 180, "sugars": 20},
)
assert_true(rec_shrikhand["nutrition"]["b12"] > 0,
            f"Shrikhand B12 > 0 (got {rec_shrikhand['nutrition']['b12']})")
assert_true("yogurt" in (rec_shrikhand["nutrition_meta"]["b12"].get("citation") or "").lower()
            or "curd" in (rec_shrikhand["nutrition_meta"]["b12"].get("citation") or "").lower(),
            "Shrikhand citation mentions yogurt/curd source")

# -----------------------------------------------------------------------
print("\n[Test 16] IFCT overrides: Goat liver (O008) gets high B12")
# -----------------------------------------------------------------------
rec_goat_liver = make_test_record(
    name="Goat, liver", code="O008",
    group="Animal Meat", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 135, "proteins": 19},
)
assert_true(rec_goat_liver["nutrition"]["b12"] > 30,
            f"Goat liver B12 > 30 (got {rec_goat_liver['nutrition']['b12']})")
assert_true(rec_goat_liver["nutrition_meta"]["b12"].get("citation") is not None,
            "Goat liver B12 has citation")

# -----------------------------------------------------------------------
print("\n[Test 17] IFCT overrides: Chicken liver (N005) gets high B12")
# -----------------------------------------------------------------------
rec_chicken_liver = make_test_record(
    name="Poultry, chicken, liver", code="N005",
    group="Poultry", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 119, "proteins": 16},
)
assert_true(rec_chicken_liver["nutrition"]["b12"] > 10,
            f"Chicken liver B12 > 10 (got {rec_chicken_liver['nutrition']['b12']})")
assert_eq(rec_chicken_liver["nutrition"]["b12"], 16.58,
           "Chicken liver B12 = 16.58 (USDA)")

# -----------------------------------------------------------------------
print("\n[Test 18] IFCT overrides: Oyster (Q006) gets high B12")
# -----------------------------------------------------------------------
rec_oyster = make_test_record(
    name="Oyster", code="Q006",
    group="Marine Shellfish", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 68, "proteins": 7},
)
assert_true(rec_oyster["nutrition"]["b12"] > 10,
            f"Oyster B12 > 10 (got {rec_oyster['nutrition']['b12']})")
assert_eq(rec_oyster["nutrition"]["b12"], 16.0, "Oyster B12 = 16.0 (USDA)")

# -----------------------------------------------------------------------
print("\n[Test 19] IFCT overrides: Clam green shell (R001) gets very high B12")
# -----------------------------------------------------------------------
rec_clam = make_test_record(
    name="Clam, green shell", code="R001",
    group="Marine Mollusks", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 74, "proteins": 13},
)
assert_true(rec_clam["nutrition"]["b12"] > 50,
            f"Clam B12 > 50 (got {rec_clam['nutrition']['b12']})")

# -----------------------------------------------------------------------
print("\n[Test 20] IFCT overrides: Goat shoulder (O001) gets moderate B12")
# -----------------------------------------------------------------------
rec_goat = make_test_record(
    name="Goat, shoulder, meat", code="O001",
    group="Animal Meat", diet_type="non-vegetarian",
    source="IFCT 2017",
    nutrition={"calories": 109, "proteins": 20},
)
assert_true(rec_goat["nutrition"]["b12"] > 0.5,
            f"Goat shoulder B12 > 0.5 (got {rec_goat['nutrition']['b12']})")
assert_eq(rec_goat["nutrition"]["b12"], 1.13, "Goat shoulder B12 = 1.13 (USDA)")

# -----------------------------------------------------------------------
print("\n[Test 21] Recipe override: Egg curry gets positive B12")
# -----------------------------------------------------------------------
rec_egg_curry = make_test_record(
    name="Egg curry (Anda curry)", code="BFP240",
    group="", diet_type="eggetarian",
    source="INDB 2024.11",
    nutrition={"calories": 150, "proteins": 8},
)
assert_true(rec_egg_curry["nutrition"]["b12"] > 0,
            f"Egg curry B12 > 0 (got {rec_egg_curry['nutrition']['b12']})")

# -----------------------------------------------------------------------
print("\n[Test 22] Recipe override: Prawn curry gets positive B12")
# -----------------------------------------------------------------------
rec_prawn = make_test_record(
    name="Prawn curry (with coconut) (Jhinga curry)", code="BFP230",
    group="", diet_type="non-vegetarian",
    source="INDB 2024.11",
    nutrition={"calories": 130, "proteins": 10},
)
assert_true(rec_prawn["nutrition"]["b12"] > 0,
            f"Prawn curry B12 > 0 (got {rec_prawn['nutrition']['b12']})")

# -----------------------------------------------------------------------
print("\n[Test 23] Existing supplement JSON passes full validation")
# -----------------------------------------------------------------------
invalidate_supplements_cache()
try:
    data = load_supplements()
    assert_true(True, "Full supplement JSON passes validation on load")
    assert_true(len(data["item_overrides"]) >= 60,
                f"At least 60 item overrides (got {len(data['item_overrides'])})")
    recipe_count = len([k for k in data["recipe_overrides"] if not k.startswith("_")])
    assert_true(recipe_count >= 30,
                f"At least 30 recipe overrides (got {recipe_count})")
except ValueError as e:
    assert_true(False, f"Supplement JSON validation failed: {e}")

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
print(f"\n{'='*60}")
print(f"Results: {passed} passed, {failed} failed, {passed+failed} total")
print(f"{'='*60}")

if failed > 0:
    sys.exit(1)
else:
    print("All smoke tests passed!")
    sys.exit(0)
