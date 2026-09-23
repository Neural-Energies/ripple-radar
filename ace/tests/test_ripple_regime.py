"""Tests for the transmission and regime engines.

These target the specific ways each engine could produce a confident lie:
a VAR fitted to non-stationary levels, an edge read off a too-short sample,
and — the big one — a regime readout built from smoothed probabilities that
have already seen the future.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.regime.markov import (
    current_regime,
    filtered_probabilities,
    fit_regimes,
    smoothed_probabilities,
)
from ace.ripple.transmission import build_edges, lead_lag, stationarity, to_returns


def _rw(n=1200, seed=0, scale=0.01):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2015-01-01", periods=n, freq="B", tz="UTC")
    return pd.Series(100 * np.exp(np.cumsum(rng.normal(0, scale, n))), index=idx)


# ------------------------------------------------------------- stationarity --
def test_price_levels_are_not_stationary_but_returns_are():
    px = _rw()
    lvl = stationarity(px)
    ret = stationarity(np.log(px).diff().dropna())
    assert lvl["stationary"] is False, "a random walk in levels must not pass ADF"
    assert ret["stationary"] is True, "its log differences must"


def test_to_returns_differences_yields_and_log_differences_prices():
    idx = pd.date_range("2015-01-01", periods=300, freq="B", tz="UTC")
    panel = pd.DataFrame({"SP500": np.linspace(100, 200, 300), "UST10Y": np.linspace(2.0, 4.0, 300)}, index=idx)
    r = to_returns(panel)
    # a yield's change is a level difference, not a percentage
    assert np.allclose(r["UST10Y"].dropna().iloc[0], 2.0 / 299, atol=1e-9)
    # a price's is a log difference
    assert np.allclose(r["SP500"].dropna().iloc[0], np.log(panel["SP500"].iloc[1] / panel["SP500"].iloc[0]), atol=1e-12)


# --------------------------------------------------------------- lead / lag --
def test_lead_lag_recovers_a_planted_lag():
    rng = np.random.default_rng(4)
    n = 1500
    idx = pd.date_range("2015-01-01", periods=n, freq="B", tz="UTC")
    x = pd.Series(rng.normal(size=n), index=idx)
    y = pd.Series(np.roll(x.values, 3) * 0.8 + rng.normal(0, 0.2, n), index=idx)
    lag, rho, _ = lead_lag(x, y, max_lag=5)
    assert lag == 3, f"planted a 3-day lead, recovered {lag}"
    assert rho > 0.7


def test_independent_series_produce_no_significant_edge():
    rng = np.random.default_rng(11)
    n = 1500
    idx = pd.date_range("2015-01-01", periods=n, freq="B", tz="UTC")
    df = pd.DataFrame({"A": rng.normal(size=n), "B": rng.normal(size=n)}, index=idx)
    edges = build_edges(df, max_lag=5)
    assert edges
    assert not any(e.granger_predictive for e in edges), "independent noise must not be predictive"


def test_short_samples_are_skipped_rather_than_estimated():
    idx = pd.date_range("2015-01-01", periods=80, freq="B", tz="UTC")
    rng = np.random.default_rng(2)
    df = pd.DataFrame({"A": rng.normal(size=80), "B": rng.normal(size=80)}, index=idx)
    assert build_edges(df) == [], "an 80-row sample must not yield edges"


# -------------------------------------------------------------------- regime --
@pytest.fixture(scope="module")
def two_state_series():
    """A series with a genuine variance switch partway through."""
    rng = np.random.default_rng(9)
    calm = rng.normal(0, 0.005, 800)
    stressed = rng.normal(0, 0.02, 400)
    calm2 = rng.normal(0, 0.005, 400)
    vals = np.concatenate([calm, stressed, calm2])
    idx = pd.date_range("2012-01-01", periods=len(vals), freq="B", tz="UTC")
    return pd.Series(vals, index=idx)


def test_regimes_are_labelled_after_estimation_by_variance(two_state_series):
    res, fit = fit_regimes(two_state_series, n_regimes=2)
    assert fit.converged
    assert set(fit.labels) == {"calm", "stressed"}
    hi = int(np.argmax(fit.regime_variance))
    assert fit.labels[hi] == "stressed", "the higher-variance state must be the stressed one"
    assert fit.regime_variance[hi] > fit.regime_variance[1 - hi] * 3


def test_transition_matrix_rows_sum_to_one(two_state_series):
    _, fit = fit_regimes(two_state_series, n_regimes=2)
    for row in fit.transition_matrix:
        assert abs(sum(row) - 1.0) < 1e-6
        assert all(0.0 <= v <= 1.0 for v in row)


def test_expected_durations_are_positive_and_finite(two_state_series):
    _, fit = fit_regimes(two_state_series, n_regimes=2)
    assert all(np.isfinite(d) and d > 0 for d in fit.expected_duration)


def test_filtered_and_smoothed_probabilities_are_not_the_same(two_state_series):
    """The look-ahead guard.

    If these ever coincide, something is feeding the whole sample into what is
    meant to be a real-time estimate.
    """
    res, _ = fit_regimes(two_state_series, n_regimes=2)
    f = np.asarray(filtered_probabilities(res))
    s = np.asarray(smoothed_probabilities(res))
    assert f.shape == s.shape
    assert not np.allclose(f, s), "filtered and smoothed must differ; smoothed has seen the future"


def test_current_regime_is_built_from_filtered_probabilities(two_state_series):
    res, fit = fit_regimes(two_state_series, n_regimes=2)
    cur = current_regime(res, fit)
    assert cur["basis"].startswith("filtered")
    assert 0.0 <= cur["probability"] <= 1.0
    assert abs(sum(cur["all_probabilities"].values()) - 1.0) < 1e-6
    assert cur["regime"] in ("calm", "stressed")


def test_regime_fit_refuses_a_sample_too_short_to_support_it():
    rng = np.random.default_rng(1)
    idx = pd.date_range("2020-01-01", periods=200, freq="B", tz="UTC")
    with pytest.raises(ValueError):
        fit_regimes(pd.Series(rng.normal(0, 0.01, 200), index=idx), n_regimes=2)
