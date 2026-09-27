"""Phase 10 / WP3 exit condition machinery: the parts that don't need a live
DFM or PCA fit — purging, causal climatology, and the anchor-loop's wiring —
tested against known answers, plus one real (but small) regime fit to check
`_high_mean_probability` actually reads the high state and not the low one.
"""
from __future__ import annotations

import sys
from unittest.mock import patch
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.regime.level_regime_validation import (
    _climatology_rate_at,
    _high_mean_probability,
    forward_direction_outcomes,
    run_validation,
)


def test_forward_direction_outcomes_purges_the_unobserved_tail():
    series = pd.Series([1, 2, 1, 3, 5, 4], index=pd.date_range("2020-01-01", periods=6, freq="MS"))
    out = forward_direction_outcomes(series, horizon_periods=2)
    # index 0: compare to index 2 (1 -> 1): not higher -> 0
    # index 1: compare to index 3 (2 -> 3): higher -> 1
    # index 2: compare to index 4 (1 -> 5): higher -> 1
    # index 3: compare to index 5 (3 -> 4): higher -> 1
    # index 4, 5: no future value -> NaN, dropped
    assert out.dropna().tolist() == [0.0, 1.0, 1.0, 1.0]
    assert out.isna().sum() == 2


def test_climatology_rate_is_the_mean_of_realized_transitions_only():
    series = pd.Series(np.arange(20.0), index=pd.date_range("2020-01-01", periods=20, freq="MS"))
    rate = _climatology_rate_at(series, horizon_periods=3)
    # Strictly increasing: every realized transition is "up".
    assert rate == pytest.approx(1.0)


def test_climatology_rate_is_none_with_no_realized_transitions():
    series = pd.Series([1.0, 2.0], index=pd.date_range("2020-01-01", periods=2, freq="MS"))
    assert _climatology_rate_at(series, horizon_periods=6) is None


def test_high_mean_probability_reads_the_high_state_not_the_low_one():
    rng = np.random.default_rng(11)
    n = 160
    # First half: low mean, second half: high mean, both well-separated and
    # persistent — an easy, unambiguous two-regime series.
    low = rng.normal(loc=-3.0, scale=0.5, size=n // 2)
    high = rng.normal(loc=3.0, scale=0.5, size=n // 2)
    series = pd.Series(np.concatenate([low, high]), index=pd.date_range("2000-01-01", periods=n, freq="MS"))

    p_high = _high_mean_probability(series, seed=3)
    assert p_high is not None
    # The series ends in the high-mean regime, so the filtered probability of
    # being in the high state should be well above a coin flip.
    assert p_high > 0.7


def test_high_mean_probability_is_none_below_the_minimum_observation_count():
    series = pd.Series(np.arange(10.0), index=pd.date_range("2020-01-01", periods=10, freq="MS"))
    assert _high_mean_probability(series) is None


def test_run_validation_wires_climatology_and_outcome_correctly():
    idx = pd.date_range("2000-01-01", periods=300, freq="MS", tz="UTC")
    reference = pd.Series(np.arange(300.0), index=idx)  # strictly increasing

    def source(as_of: pd.Timestamp) -> pd.Series:
        return reference[reference.index <= as_of]

    anchors = pd.DatetimeIndex([idx[150], idx[298]])  # one interior, one too close to the end
    with patch("ace.regime.level_regime_validation._high_mean_probability", return_value=0.7):
        report = run_validation(source, reference, anchors, horizon_periods=6)

    assert report["n_anchors"] == 1  # the near-the-end anchor has no realized future value
    reading = report["readings"][0]
    assert reading["model_probability"] == pytest.approx(0.7)
    # Strictly increasing series: every realized transition, and the actual
    # outcome, are "up".
    assert reading["climatology_probability"] == pytest.approx(1.0)
    assert reading["outcome"] == 1.0
    assert str(idx[298].date()) in report["skipped"]
