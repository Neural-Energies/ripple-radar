"""Scenario distribution and volatility tests."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.scenarios.distribution import (
    coverage,
    fhs_probabilities,
    fhs_quantiles,
    fit_tail_df,
    pit_diagnostics,
    pit_values,
    scenario_bands,
)
from ace.volatility.har import forward_vol, har_features, qlike, score


# --------------------------------------------------------------- volatility --
def test_forward_vol_excludes_the_current_bar():
    """The leak that would make a volatility model look clairvoyant."""
    s = pd.Series(np.arange(12, dtype=float), index=pd.date_range("2020-01-01", periods=12, freq="B", tz="UTC"))
    fv = forward_vol(s, 3)
    for i in range(6):
        assert abs(float(fv.iloc[i]) - float(s.iloc[i + 1 : i + 4].std())) < 1e-12


def test_todays_return_does_not_leak_into_forward_vol():
    rng = np.random.default_rng(0)
    n = 3000
    s = pd.Series(rng.normal(0, 0.01, n), index=pd.date_range("2015-01-01", periods=n, freq="B", tz="UTC"))
    d = pd.concat([s.abs().rename("a"), forward_vol(s, 20).rename("f")], axis=1).dropna()
    assert abs(float(d.a.corr(d.f))) < 0.05


def test_har_features_never_use_future_bars():
    rng = np.random.default_rng(1)
    idx = pd.date_range("2015-01-01", periods=900, freq="B", tz="UTC")
    s = pd.Series(rng.normal(0, 0.01, 900), index=idx)
    full = har_features(s)
    part = har_features(s.iloc[:700])
    a = full.iloc[:700].to_numpy(dtype=float)
    b = part.to_numpy(dtype=float)
    both = ~np.isnan(a) & ~np.isnan(b)
    assert both.sum() > 0 and np.allclose(a[both], b[both], atol=1e-12)


def test_qlike_is_minimised_by_the_truth():
    rng = np.random.default_rng(2)
    truth = np.abs(rng.normal(0.01, 0.002, 500))
    assert qlike(truth, truth) < qlike(truth, truth * 1.5)
    assert qlike(truth, truth) < qlike(truth, truth * 0.6)


def test_score_detects_a_biased_forecast():
    rng = np.random.default_rng(3)
    y = np.log(np.abs(rng.normal(0.01, 0.003, 800)))
    rep = score("half", y, y + np.log(0.5))
    assert rep.bias_slope > 1.5  # systematically too low -> slope above 1


# ------------------------------------------------------------- distribution --
def test_scenario_bands_quantiles_are_ordered_and_keys_zero_padded():
    b = scenario_bands(0.01, horizon_days=20, df=5.0)
    q = b.quantiles
    assert set(q) >= {"p05", "p10", "p25", "p50", "p75", "p90", "p95"}
    assert q["p05"] < q["p25"] < q["p50"] < q["p75"] < q["p95"]


def test_scenario_probabilities_are_valid_and_consistent():
    b = scenario_bands(0.012, horizon_days=20, df=6.0)
    for k, v in b.probabilities.items():
        assert 0.0 <= v <= 1.0, f"{k} outside [0,1]"
    up = b.probabilities["P(move > +5%)"]
    dn = b.probabilities["P(move < -5%)"]
    both = b.probabilities["P(|move| > 5%)"]
    assert abs((up + dn) - both) < 1e-6


def test_higher_forecast_vol_widens_the_bands():
    lo = scenario_bands(0.005, horizon_days=20, df=5.0)
    hi = scenario_bands(0.020, horizon_days=20, df=5.0)
    assert hi.quantiles["p95"] > lo.quantiles["p95"]
    assert hi.probabilities["P(|move| > 5%)"] > lo.probabilities["P(|move| > 5%)"]


def test_drift_shifts_the_distribution_without_changing_its_width():
    a = scenario_bands(0.01, horizon_days=20, df=5.0, drift=0.0)
    b = scenario_bands(0.01, horizon_days=20, df=5.0, drift=0.02)
    assert b.quantiles["p50"] > a.quantiles["p50"]
    wa = a.quantiles["p95"] - a.quantiles["p05"]
    wb = b.quantiles["p95"] - b.quantiles["p05"]
    assert abs(wa - wb) < 1e-9


def test_degenerate_inputs_are_refused_rather_than_fudged():
    with pytest.raises(ValueError):
        scenario_bands(0.0, horizon_days=20, df=5.0)
    with pytest.raises(ValueError):
        scenario_bands(0.01, horizon_days=20, df=1.5)  # t variance undefined


def test_fit_tail_df_recovers_fat_tails():
    from scipy import stats

    rng = np.random.default_rng(7)
    heavy = stats.t.rvs(4, size=5000, random_state=rng)
    light = rng.normal(size=5000)
    assert fit_tail_df(heavy) < fit_tail_df(light)


# ----------------------------------------------------------------- PIT / FHS --
def test_pit_is_uniform_when_the_distribution_is_correct():
    from scipy import stats

    rng = np.random.default_rng(11)
    n, df = 4000, 6.0
    sigma = np.full(n, 0.04)
    unit = np.sqrt(df / (df - 2.0))
    actual = stats.t.rvs(df, size=n, random_state=rng) * (sigma / unit)
    diag = pit_diagnostics(pit_values(actual, sigma, df))
    assert diag["uniform_by_ks"], f"correct model should give uniform PIT, got p={diag['ks_p_value']}"


def test_pit_detects_a_misspecified_distribution():
    from scipy import stats

    rng = np.random.default_rng(12)
    n, df = 4000, 6.0
    sigma = np.full(n, 0.04)
    unit = np.sqrt(df / (df - 2.0))
    # realized moves three times wider than the forecast claims
    actual = stats.t.rvs(df, size=n, random_state=rng) * (sigma / unit) * 3.0
    diag = pit_diagnostics(pit_values(actual, sigma, df))
    assert not diag["uniform_by_ks"], "a 3x too-narrow forecast must fail the PIT test"


def test_coverage_reports_undercoverage_of_a_too_narrow_forecast():
    from scipy import stats

    rng = np.random.default_rng(13)
    n, df = 3000, 6.0
    sigma = np.full(n, 0.04)
    unit = np.sqrt(df / (df - 2.0))
    actual = stats.t.rvs(df, size=n, random_state=rng) * (sigma / unit) * 2.0
    for row in coverage(actual, sigma, df):
        assert row["empirical"] < row["nominal"]


def test_fhs_reproduces_the_empirical_shape():
    rng = np.random.default_rng(15)
    z = rng.standard_t(5, size=2000)
    q = fhs_quantiles(z, sigma_h=0.05)
    assert q["p05"] < q["p50"] < q["p95"]
    # the p95 of the rescaled empirical set is the empirical p95 times sigma
    # the function rounds to 6dp, so compare at that precision
    assert abs(q["p95"] - 0.05 * np.quantile(z, 0.95)) < 1e-6


def test_fhs_probabilities_count_the_empirical_set():
    rng = np.random.default_rng(16)
    z = rng.standard_normal(3000)
    p = fhs_probabilities(z, sigma_h=0.04)
    for k, v in p.items():
        assert 0.0 <= v <= 1.0
    assert abs((p["P(move > +5%)"] + p["P(move < -5%)"]) - p["P(|move| > 5%)"]) < 1e-9


def test_fhs_refuses_a_residual_history_too_short_to_use():
    with pytest.raises(ValueError):
        fhs_quantiles(np.array([0.1, -0.2, 0.3]), sigma_h=0.05)
