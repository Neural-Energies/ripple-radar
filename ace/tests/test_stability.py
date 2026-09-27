"""Loading-stability primitives, tested against known-answer fixtures.

Every function here has to solve the sign problem first — a component is
identified only up to sign, so an unaligned comparison calls a genuine match a
total disagreement half the time. Each test below constructs a case whose
sign-aligned answer is known, so getting the alignment wrong shows up as a
wrong number rather than as a plausible-looking one.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.factors.stability import (
    LoadingComparison,
    WindowResult,
    align_sign,
    compare_loadings,
    factor_turnover,
    stability_report,
)


def test_align_sign_flips_when_correlation_is_negative():
    ref = pd.Series({"A": 1.0, "B": 2.0, "C": -1.0})
    candidate = -ref  # perfectly anti-correlated
    aligned = align_sign(ref, candidate)
    pd.testing.assert_series_equal(aligned, ref)


def test_align_sign_leaves_a_positive_correlation_untouched():
    ref = pd.Series({"A": 1.0, "B": 2.0, "C": -1.0})
    candidate = ref * 1.1 + 0.01
    aligned = align_sign(ref, candidate)
    pd.testing.assert_series_equal(aligned, candidate)


def test_align_sign_is_a_no_op_with_too_few_common_series():
    ref = pd.Series({"A": 1.0})
    candidate = pd.Series({"B": 1.0})
    assert align_sign(ref, candidate) is candidate


def test_compare_loadings_of_identical_vectors_is_a_perfect_match():
    a = pd.Series({"X": 0.5, "Y": -0.3, "Z": 0.8})
    result = compare_loadings(a, a.copy())
    assert result.correlation == pytest.approx(1.0)
    assert result.mean_abs_difference == pytest.approx(0.0, abs=1e-9)
    assert result.stable


def test_compare_loadings_of_sign_flipped_identical_vectors_is_still_a_perfect_match():
    """The exact case the sign alignment exists for: two fits that found the
    SAME factor but with opposite signs must not read as unstable."""
    a = pd.Series({"X": 0.5, "Y": -0.3, "Z": 0.8})
    result = compare_loadings(a, -a)
    assert result.correlation == pytest.approx(1.0)
    assert result.stable


def test_compare_loadings_of_unrelated_vectors_is_not_stable():
    rng = np.random.default_rng(0)
    a = pd.Series(rng.normal(size=30), index=[f"S{i}" for i in range(30)])
    b = pd.Series(rng.normal(size=30), index=[f"S{i}" for i in range(30)])
    result = compare_loadings(a, b)
    assert abs(result.correlation) < 0.5
    assert not result.stable


def test_compare_loadings_only_uses_the_shared_series():
    a = pd.Series({"A": 1.0, "B": 2.0, "C": 3.0})
    b = pd.Series({"B": 2.0, "C": 3.0, "D": 4.0})
    result = compare_loadings(a, b)
    assert result.n_common == 2
    assert result.correlation == pytest.approx(1.0)


def test_compare_loadings_handles_too_few_common_series_as_nan_not_a_crash():
    a = pd.Series({"A": 1.0})
    b = pd.Series({"B": 1.0})
    result = compare_loadings(a, b)
    assert np.isnan(result.correlation)
    assert not result.stable


def test_factor_turnover_is_zero_for_an_unchanged_score_series():
    idx = pd.date_range("2020-01-01", periods=24, freq="MS")
    scores = pd.Series(np.linspace(-2, 2, 24), index=idx)
    assert factor_turnover(scores, scores.copy()) == pytest.approx(0.0, abs=1e-9)


def test_factor_turnover_ignores_a_sign_flip_between_fits():
    idx = pd.date_range("2020-01-01", periods=24, freq="MS")
    scores = pd.Series(np.linspace(-2, 2, 24), index=idx)
    assert factor_turnover(scores, -scores) == pytest.approx(0.0, abs=1e-9)


def test_factor_turnover_is_large_for_genuinely_different_readings():
    idx = pd.date_range("2020-01-01", periods=24, freq="MS")
    rng = np.random.default_rng(1)
    a = pd.Series(rng.normal(size=24), index=idx)
    b = pd.Series(rng.normal(size=24) * 5, index=idx)  # much larger, uncorrelated
    turnover = factor_turnover(a, b)
    assert turnover > 1.0


def test_stability_report_over_identical_windows_is_fully_stable():
    loadings = pd.Series({"A": 1.0, "B": -0.5, "C": 0.3})
    windows = [
        WindowResult(as_of=f"202{i}-01-01", n_obs=100, n_series=3, k=1,
                     pc1_loadings=loadings.copy(), explained_variance_ratio=0.6)
        for i in range(4)
    ]
    report = stability_report(windows)
    assert report["n_windows"] == 4
    assert report["n_transitions"] == 3
    assert report["mean_loading_correlation"] == pytest.approx(1.0)
    assert report["share_stable_transitions"] == 1.0
    assert report["k_ever_changed"] is False


def test_stability_report_detects_a_factor_count_change():
    loadings = pd.Series({"A": 1.0, "B": -0.5})
    windows = [
        WindowResult(as_of="2020-01-01", n_obs=100, n_series=2, k=1,
                     pc1_loadings=loadings, explained_variance_ratio=0.6),
        WindowResult(as_of="2021-01-01", n_obs=100, n_series=2, k=2,
                     pc1_loadings=loadings, explained_variance_ratio=0.6),
    ]
    report = stability_report(windows)
    assert report["k_ever_changed"] is True
    assert report["transitions"][0]["k_changed"] is True


def test_stability_report_flags_a_genuinely_unstable_transition():
    rng = np.random.default_rng(2)
    a = pd.Series(rng.normal(size=40), index=[f"S{i}" for i in range(40)])
    b = pd.Series(rng.normal(size=40), index=[f"S{i}" for i in range(40)])
    windows = [
        WindowResult(as_of="2020-01-01", n_obs=100, n_series=40, k=1,
                     pc1_loadings=a, explained_variance_ratio=0.5),
        WindowResult(as_of="2021-01-01", n_obs=100, n_series=40, k=1,
                     pc1_loadings=b, explained_variance_ratio=0.5),
    ]
    report = stability_report(windows)
    assert report["share_stable_transitions"] == 0.0


def test_stability_report_handles_a_single_window_without_crashing():
    loadings = pd.Series({"A": 1.0})
    report = stability_report([
        WindowResult(as_of="2020-01-01", n_obs=50, n_series=1, k=1,
                     pc1_loadings=loadings, explained_variance_ratio=1.0)
    ])
    assert report["n_transitions"] == 0
    assert report["mean_loading_correlation"] is None
    assert report["k_ever_changed"] is False
