#!/usr/bin/env python3
"""
test_validate_data.py — Robustness and determinism tests for validate_data.py.

Validates:
1. Malformed anchor row (nutrition=null) does not crash, yields hard issue.
2. String calories/sodium do not crash, yield hard issue or skip in soft checks.
3. Non-dict nutrition_meta yields hard issue.
4. Non-dict meta entry yields hard issue.
5. Repeated report generation is deterministic (no diff).
6. Null/list nutrition handled in all check functions.
7. Soft checks (Atwater, sodium) skip gracefully on malformed data.

Run: python3 nutritrace/scripts/test_validate_data.py
"""
import sys
import os
import json
import tempfile

# Add scripts dir to path for importing
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import validate_data as vd

passed = 0
failed = 0


def assert_true(condition, msg):
    global passed, failed
    if condition:
        passed += 1
        print(f"  \u2713 {msg}")
    else:
        failed += 1
        print(f"  \u2717 FAIL: {msg}")


def assert_eq(actual, expected, msg):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  \u2713 {msg}")
    else:
        failed += 1
        print(f"  \u2717 FAIL: {msg} — expected {expected!r}, got {actual!r}")


def assert_no_crash(fn, *args, msg=""):
    """Call fn(*args) and assert it does not raise."""
    global passed, failed
    try:
        result = fn(*args)
        passed += 1
        print(f"  \u2713 {msg}")
        return result
    except Exception as e:
        failed += 1
        print(f"  \u2717 FAIL: {msg} — raised {type(e).__name__}: {e}")
        return None


# -----------------------------------------------------------------------
# Test 1: Malformed anchor row (nutrition=null)
# -----------------------------------------------------------------------
print("\n[Test 1] Malformed anchor row (nutrition=null) does not crash")

# Create a food list with an anchor name but nutrition=null
foods_with_null_nut = [
    {"name": "Wheat flour, atta", "code": "A001", "nutrition": None,
     "nutrition_meta": {"calories": {"status": "sourced"}}},
]

result = assert_no_crash(vd.check_anchors, foods_with_null_nut,
                         msg="check_anchors does not crash on nutrition=null")
if result is not None:
    fails, rows = result
    assert_true(len(fails) > 0, f"Yields hard issue (got {len(fails)} issues)")
    assert_true(any("not a dict" in f for f in fails),
                "Hard issue mentions 'not a dict'")

# -----------------------------------------------------------------------
# Test 2: String calories in anchor check
# -----------------------------------------------------------------------
print("\n[Test 2] String calories in anchor row does not crash")

foods_with_str_cal = [
    {"name": "Wheat flour, atta", "code": "A001",
     "nutrition": {"calories": "321", "proteins": 10.57, "fat": 1.53,
                   "carbohydrates": 64.2, "iron": 4.10, "calcium": 30.9},
     "nutrition_meta": {}},
]

result = assert_no_crash(vd.check_anchors, foods_with_str_cal,
                         msg="check_anchors does not crash on string calories")
if result is not None:
    fails, rows = result
    assert_true(any("not numeric" in f for f in fails),
                "Hard issue mentions 'not numeric'")

# -----------------------------------------------------------------------
# Test 3: String calories in atwater_drift (soft check)
# -----------------------------------------------------------------------
print("\n[Test 3] String calories in atwater_drift does not crash")

items_str_cal = [
    {"name": "Bad food", "nutrition": {"calories": "100", "proteins": 5,
                                        "fat": 3, "carbohydrates": 10}},
]

result = assert_no_crash(vd.atwater_drift, items_str_cal,
                         msg="atwater_drift does not crash on string calories")
if result is not None:
    checked, over, worst = result
    assert_eq(checked, 0, "String calories skipped (checked=0)")

# -----------------------------------------------------------------------
# Test 4: String sodium in sodium_outliers (soft check)
# -----------------------------------------------------------------------
print("\n[Test 4] String sodium in sodium_outliers does not crash")

recipes_str_sodium = [
    {"name": "Bad recipe", "nutrition": {"sodium": "5000"},
     "serving_grams": 100},
]

result = assert_no_crash(vd.sodium_outliers, recipes_str_sodium,
                         msg="sodium_outliers does not crash on string sodium")
if result is not None:
    assert_eq(result, [], "String sodium skipped (no outliers)")

# -----------------------------------------------------------------------
# Test 5: nutrition_meta=null yields hard issue
# -----------------------------------------------------------------------
print("\n[Test 5] nutrition_meta=null yields hard issue")

items_null_meta = [
    {"name": "Bad item", "nutrition": {"calories": 100}, "nutrition_meta": None},
]

result = assert_no_crash(vd.check_nutrient_completeness, items_null_meta,
                         "test", ["calories"],
                         msg="check_nutrient_completeness handles null meta")
if result is not None:
    assert_true(len(result) > 0, "Yields hard issue")
    assert_true(any("not a dict" in f for f in result),
                "Hard issue mentions 'not a dict'")

result = assert_no_crash(vd.check_status_vocabulary, items_null_meta, "test",
                         msg="check_status_vocabulary handles null meta")
if result is not None:
    assert_true(any("not a dict" in f for f in result),
                "Status vocabulary: hard issue for null meta")

# -----------------------------------------------------------------------
# Test 6: Non-dict meta entry yields hard issue
# -----------------------------------------------------------------------
print("\n[Test 6] Non-dict meta entry (string) yields hard issue")

items_str_meta_entry = [
    {"name": "Bad item", "nutrition": {"calories": 100},
     "nutrition_meta": {"calories": "sourced"}},
]

result = assert_no_crash(vd.check_status_vocabulary, items_str_meta_entry, "test",
                         msg="check_status_vocabulary handles string meta entry")
if result is not None:
    assert_true(len(result) > 0, "Yields hard issue")
    assert_true(any("not a dict" in f for f in result),
                "Hard issue mentions 'not a dict' for meta entry")

# -----------------------------------------------------------------------
# Test 7: nutrition=[] yields hard issue
# -----------------------------------------------------------------------
print("\n[Test 7] nutrition=[] yields hard issue in completeness check")

items_list_nut = [
    {"name": "Bad item", "nutrition": [], "nutrition_meta": {}},
]

result = assert_no_crash(vd.check_nutrient_completeness, items_list_nut,
                         "test", ["calories"],
                         msg="check_nutrient_completeness handles list nutrition")
if result is not None:
    assert_true(any("not a dict" in f for f in result),
                "Hard issue mentions 'not a dict'")

# -----------------------------------------------------------------------
# Test 8: check_structure handles nutrition=null
# -----------------------------------------------------------------------
print("\n[Test 8] check_structure handles nutrition=null")

items_null_struct = [
    {"name": "Null food", "code": "X1", "nutrition": None},
]

result = assert_no_crash(vd.check_structure, items_null_struct, "test",
                         msg="check_structure does not crash on nutrition=null")
if result is not None:
    assert_true(any("empty/missing nutrition" in f for f in result),
                "Detects empty/missing nutrition")

# -----------------------------------------------------------------------
# Test 9: B12 provenance with non-dict meta entry for b12
# -----------------------------------------------------------------------
print("\n[Test 9] B12 provenance with non-dict meta.b12 entry")

items_b12_str_meta = [
    {"name": "Fish item", "nutrition": {"b12": 5.0},
     "nutrition_meta": {"b12": "sourced"}},
]

result = assert_no_crash(vd.check_b12_provenance, items_b12_str_meta, "test",
                         msg="check_b12_provenance handles non-dict b12 meta")
if result is not None:
    assert_true(len(result) > 0, "Yields hard issue")
    assert_true(any("not a dict" in f for f in result),
                "Hard issue mentions b12 meta not a dict")

# -----------------------------------------------------------------------
# Test 10: Zero provenance skips gracefully on malformed data
# -----------------------------------------------------------------------
print("\n[Test 10] Zero provenance with non-dict meta entry")

items_zero_str_meta = [
    {"name": "Bad item", "nutrition": {"caffeine": 0},
     "nutrition_meta": {"caffeine": "explicit_zero"}},
]

result = assert_no_crash(vd.check_zero_provenance, items_zero_str_meta, "test",
                         msg="check_zero_provenance handles non-dict meta entry")
if result is not None:
    assert_eq(result, [], "Skips gracefully (caught by status vocab)")

# -----------------------------------------------------------------------
# Test 11: atwater_drift with nutrition=null
# -----------------------------------------------------------------------
print("\n[Test 11] atwater_drift with nutrition=null")

items_null_at = [{"name": "Null item", "nutrition": None}]

result = assert_no_crash(vd.atwater_drift, items_null_at,
                         msg="atwater_drift skips null nutrition")
if result is not None:
    checked, over, worst = result
    assert_eq(checked, 0, "Checked=0 (skipped)")

# -----------------------------------------------------------------------
# Test 12: sodium_outliers with nutrition=null
# -----------------------------------------------------------------------
print("\n[Test 12] sodium_outliers with nutrition=null")

result = assert_no_crash(vd.sodium_outliers, [{"name": "X", "nutrition": None}],
                         msg="sodium_outliers skips null nutrition")
if result is not None:
    assert_eq(result, [], "Empty result (skipped)")

# -----------------------------------------------------------------------
# Test 13: Atwater with non-numeric macros (mixed types)
# -----------------------------------------------------------------------
print("\n[Test 13] atwater_drift with mixed non-numeric macros")

items_mixed = [
    {"name": "Mixed bad", "nutrition": {"calories": 200, "proteins": "ten",
                                         "fat": None, "carbohydrates": True}},
]

result = assert_no_crash(vd.atwater_drift, items_mixed,
                         msg="atwater_drift handles non-numeric macros")
if result is not None:
    checked, over, worst = result
    # Bool True -> _safe_num returns 0, string "ten" -> 0, None -> 0
    # pred would be 0, so this item is skipped
    assert_eq(checked, 0, "Skipped (non-numeric macros yield pred=0)")

# -----------------------------------------------------------------------
# Test 14: Deterministic report generation
# -----------------------------------------------------------------------
print("\n[Test 14] Deterministic report generation (no diff on repeated runs)")

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT_PATH = os.path.join(HERE, "..", "server", "seed", "data", "VALIDATION.md")

# Run validate_data main twice by calling the script
import subprocess

run1 = subprocess.run(
    [sys.executable, os.path.join(HERE, "validate_data.py")],
    capture_output=True, text=True, cwd=os.path.join(HERE, "..")
)
assert_eq(run1.returncode, 0, "First run exits 0 (PASS)")

with open(REPORT_PATH, "r", encoding="utf-8") as f:
    content1 = f.read()

run2 = subprocess.run(
    [sys.executable, os.path.join(HERE, "validate_data.py")],
    capture_output=True, text=True, cwd=os.path.join(HERE, "..")
)
assert_eq(run2.returncode, 0, "Second run exits 0 (PASS)")

with open(REPORT_PATH, "r", encoding="utf-8") as f:
    content2 = f.read()

assert_eq(content1, content2, "Report content identical across runs (deterministic)")

# Also verify no date string in output
assert_true("Generated 20" not in content1,
            "No wall-clock date in report (no 'Generated 20xx')")

# -----------------------------------------------------------------------
# Test 15: _safe_num helper
# -----------------------------------------------------------------------
print("\n[Test 15] _safe_num helper correctness")

assert_eq(vd._safe_num(42), 42, "_safe_num(42) = 42")
assert_eq(vd._safe_num(3.14), 3.14, "_safe_num(3.14) = 3.14")
assert_eq(vd._safe_num(0), 0, "_safe_num(0) = 0")
assert_eq(vd._safe_num("hello"), 0, "_safe_num('hello') = 0")
assert_eq(vd._safe_num(None), 0, "_safe_num(None) = 0")
assert_eq(vd._safe_num(True), 0, "_safe_num(True) = 0 (bool excluded)")

# -----------------------------------------------------------------------
# Test 16: CLI validates explicit positional dataset paths
# -----------------------------------------------------------------------
print("\n[Test 16] CLI validates explicit positional dataset paths")

with tempfile.TemporaryDirectory() as td:
    bad_foods = os.path.join(td, "bad-ifct.json")
    bad_recipes = os.path.join(td, "bad-indb.json")
    with open(bad_foods, "w", encoding="utf-8") as f:
        json.dump([{"name": "Broken IFCT row", "code": "BAD001", "nutrition": {}}], f)
    with open(bad_recipes, "w", encoding="utf-8") as f:
        json.dump([{"name": "Broken INDB row", "code": "BADR001", "nutrition": {}}], f)

    with open(REPORT_PATH, "r", encoding="utf-8") as f:
        original_report = f.read()
    try:
        bad_run = subprocess.run(
            [sys.executable, os.path.join(HERE, "validate_data.py"), bad_foods, bad_recipes],
            capture_output=True, text=True, cwd=os.path.join(HERE, "..")
        )
    finally:
        with open(REPORT_PATH, "w", encoding="utf-8") as f:
            f.write(original_report)
    assert_true(bad_run.returncode != 0,
                "Explicit invalid dataset paths fail validation instead of falling back to canonical files")
assert_eq(vd._safe_num(False), 0, "_safe_num(False) = 0 (bool excluded)")
assert_eq(vd._safe_num(float('inf')), 0, "_safe_num(inf) = 0")
assert_eq(vd._safe_num(float('nan')), 0, "_safe_num(nan) = 0")
assert_eq(vd._safe_num([1, 2]), 0, "_safe_num([1,2]) = 0")

# -----------------------------------------------------------------------
# Test 16: Anchor row with nutrition=[] (list)
# -----------------------------------------------------------------------
print("\n[Test 16] Anchor row with nutrition=[] (list)")

foods_list_nut = [
    {"name": "Spinach", "code": "V001", "nutrition": [],
     "nutrition_meta": {}},
]

result = assert_no_crash(vd.check_anchors, foods_list_nut,
                         msg="check_anchors handles nutrition=[]")
if result is not None:
    fails, rows = result
    assert_true(any("not a dict" in f for f in fails),
                "Hard issue for list nutrition on anchor")

# -----------------------------------------------------------------------
# Test 17: sodium_outliers with malformed serving_grams
# -----------------------------------------------------------------------
print("\n[Test 17] sodium_outliers with malformed serving_grams")

# String serving_grams — previously crashed with TypeError
recipes_str_sg = [
    {"name": "Salty dish", "nutrition": {"sodium": 3000.0},
     "serving_grams": "200"},
]
result = assert_no_crash(vd.sodium_outliers, recipes_str_sg,
                         msg="sodium_outliers handles string serving_grams")
if result is not None:
    # sg falls back to 100 → 3000/100*100 = 3000 mg/100g → flagged
    assert_true(len(result) > 0,
                "Flags high sodium (falls back to 100g basis)")

# Bool serving_grams
recipes_bool_sg = [
    {"name": "Bool dish", "nutrition": {"sodium": 2500.0},
     "serving_grams": True},
]
result = assert_no_crash(vd.sodium_outliers, recipes_bool_sg,
                         msg="sodium_outliers handles bool serving_grams")
if result is not None:
    # Bool → _safe_num returns 0 → falls back to 100g
    assert_true(len(result) > 0,
                "Flags high sodium (bool sg falls back to 100g)")

# None serving_grams
recipes_none_sg = [
    {"name": "None dish", "nutrition": {"sodium": 2100.0},
     "serving_grams": None},
]
result = assert_no_crash(vd.sodium_outliers, recipes_none_sg,
                         msg="sodium_outliers handles None serving_grams")
if result is not None:
    assert_true(len(result) > 0,
                "Flags high sodium (None sg falls back to 100g)")

# Zero serving_grams (non-positive)
recipes_zero_sg = [
    {"name": "Zero dish", "nutrition": {"sodium": 2100.0},
     "serving_grams": 0},
]
result = assert_no_crash(vd.sodium_outliers, recipes_zero_sg,
                         msg="sodium_outliers handles zero serving_grams")
if result is not None:
    assert_true(len(result) > 0,
                "Flags high sodium (zero sg falls back to 100g)")

# Negative serving_grams
recipes_neg_sg = [
    {"name": "Neg dish", "nutrition": {"sodium": 2100.0},
     "serving_grams": -50},
]
result = assert_no_crash(vd.sodium_outliers, recipes_neg_sg,
                         msg="sodium_outliers handles negative serving_grams")
if result is not None:
    assert_true(len(result) > 0,
                "Flags high sodium (negative sg falls back to 100g)")

# Valid serving_grams still works correctly
recipes_valid_sg = [
    {"name": "Normal dish", "nutrition": {"sodium": 500.0},
     "serving_grams": 250},
]
result = assert_no_crash(vd.sodium_outliers, recipes_valid_sg,
                         msg="sodium_outliers works with valid serving_grams")
if result is not None:
    # 500/250*100 = 200 mg/100g → below threshold, not flagged
    assert_eq(result, [],
              "Normal sodium not flagged (200 mg/100g < 2000 threshold)")

# -----------------------------------------------------------------------
# Test 18: is_bad_number rejects booleans
# -----------------------------------------------------------------------
print("\n[Test 18] is_bad_number rejects booleans")

assert_eq(vd.is_bad_number(True), True, "is_bad_number(True) = True")
assert_eq(vd.is_bad_number(False), True, "is_bad_number(False) = True")
assert_eq(vd.is_bad_number(0), False, "is_bad_number(0) = False (int zero is valid)")
assert_eq(vd.is_bad_number(1), False, "is_bad_number(1) = False")
assert_eq(vd.is_bad_number(3.14), False, "is_bad_number(3.14) = False")
assert_eq(vd.is_bad_number(-1), True, "is_bad_number(-1) = True (negative)")
assert_eq(vd.is_bad_number(float('nan')), True, "is_bad_number(NaN) = True")
assert_eq(vd.is_bad_number(float('inf')), True, "is_bad_number(inf) = True")
assert_eq(vd.is_bad_number("5"), True, "is_bad_number('5') = True")
assert_eq(vd.is_bad_number(None), True, "is_bad_number(None) = True")

# -----------------------------------------------------------------------
# Test 19: check_structure rejects bool nutrient values
# -----------------------------------------------------------------------
print("\n[Test 19] check_structure rejects bool nutrient values")

items_bool_nut = [
    {"name": "Bool item", "code": "X1",
     "nutrition": {"calories": True, "fat": False, "proteins": 10}},
]
result = assert_no_crash(vd.check_structure, items_bool_nut, "test",
                         msg="check_structure handles bool values")
if result is not None:
    assert_true(any("bad value" in f for f in result),
                "Detects bool as bad value")

# -----------------------------------------------------------------------
# Test 20: B12 provenance requires status sourced/estimated
# -----------------------------------------------------------------------
print("\n[Test 20] B12 provenance requires status sourced/estimated")

items_b12_bad_status = [
    {"name": "Bad B12 status", "nutrition": {"b12": 1.5},
     "nutrition_meta": {"b12": {"status": "explicit_zero", "source": "X",
                                "citation": "Y", "confidence": 0.5}}},
]
result = assert_no_crash(vd.check_b12_provenance, items_b12_bad_status, "test",
                         msg="check_b12_provenance rejects bad status")
if result is not None:
    assert_true(len(result) > 0, "Yields hard issue for bad B12 status")
    assert_true(any("status" in f for f in result),
                "Hard issue mentions status")

# -----------------------------------------------------------------------
# Test 21: B12 provenance requires non-empty string citation
# -----------------------------------------------------------------------
print("\n[Test 21] B12 provenance requires non-empty string citation")

items_b12_empty_citation = [
    {"name": "Empty citation", "nutrition": {"b12": 0.5},
     "nutrition_meta": {"b12": {"status": "estimated", "source": "USDA",
                                "citation": "", "confidence": 0.5}}},
]
result = assert_no_crash(vd.check_b12_provenance, items_b12_empty_citation, "test",
                         msg="check_b12_provenance rejects empty citation")
if result is not None:
    assert_true(len(result) > 0, "Yields hard issue for empty citation")

# -----------------------------------------------------------------------
# Test 22: B12 provenance requires numeric confidence in [0,1]
# -----------------------------------------------------------------------
print("\n[Test 22] B12 provenance requires numeric confidence in [0,1]")

items_b12_bad_conf = [
    {"name": "Bool conf", "nutrition": {"b12": 0.5},
     "nutrition_meta": {"b12": {"status": "sourced", "source": "USDA",
                                "citation": "test", "confidence": True}}},
]
result = assert_no_crash(vd.check_b12_provenance, items_b12_bad_conf, "test",
                         msg="check_b12_provenance rejects bool confidence")
if result is not None:
    assert_true(len(result) > 0, "Yields hard issue for bool confidence")

items_b12_high_conf = [
    {"name": "High conf", "nutrition": {"b12": 0.5},
     "nutrition_meta": {"b12": {"status": "sourced", "source": "USDA",
                                "citation": "test", "confidence": 1.5}}},
]
result = assert_no_crash(vd.check_b12_provenance, items_b12_high_conf, "test",
                         msg="check_b12_provenance rejects confidence > 1")
if result is not None:
    assert_true(len(result) > 0, "Yields hard issue for confidence > 1")

# -----------------------------------------------------------------------
# Test 23: B12 provenance passes for correct data
# -----------------------------------------------------------------------
print("\n[Test 23] B12 provenance passes for correct data")

items_b12_good = [
    {"name": "Good B12", "nutrition": {"b12": 0.45},
     "nutrition_meta": {"b12": {"status": "sourced", "source": "USDA SR",
                                "citation": "USDA FDC #01077", "confidence": 0.9}}},
]
result = assert_no_crash(vd.check_b12_provenance, items_b12_good, "test",
                         msg="check_b12_provenance passes for valid data")
if result is not None:
    assert_eq(result, [], "No issues for valid B12 provenance")

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
print(f"\n{'='*60}")
print(f"Results: {passed} passed, {failed} failed, {passed+failed} total")
print(f"{'='*60}")

if failed > 0:
    sys.exit(1)
else:
    print("All validation robustness tests passed!")
    sys.exit(0)
