"""NaN/Infinity are not valid JSON — does `to_json_safe` actually catch every
place one can hide?
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.jsonutil import to_json_safe


def test_a_bare_nan_becomes_none():
    assert to_json_safe(float("nan")) is None


def test_infinity_becomes_none():
    assert to_json_safe(float("inf")) is None
    assert to_json_safe(float("-inf")) is None


def test_a_finite_number_is_unchanged():
    assert to_json_safe(3.5) == 3.5
    assert to_json_safe(0) == 0


def test_numpy_scalars_are_handled():
    assert to_json_safe(np.float64("nan")) is None
    assert to_json_safe(np.float64(2.5)) == 2.5
    assert to_json_safe(np.int64(7)) == 7


def test_nan_inside_a_nested_structure_is_replaced():
    payload = {
        "a": [1.0, float("nan"), {"b": float("inf")}],
        "c": (float("-inf"), "text", None, True),
    }
    cleaned = to_json_safe(payload)
    # Must round-trip through strict JSON without `allow_nan=False` raising.
    dumped = json.dumps(cleaned, allow_nan=False)
    reloaded = json.loads(dumped)
    assert reloaded["a"] == [1.0, None, {"b": None}]
    assert reloaded["c"] == [None, "text", None, True]


def test_strings_and_bools_pass_through_untouched():
    assert to_json_safe("hello") == "hello"
    assert to_json_safe(True) is True
    assert to_json_safe(False) is False
    assert to_json_safe(None) is None
