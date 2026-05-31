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
