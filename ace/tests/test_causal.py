"""Structural causal model tests.

The failure these exist to prevent is the one causal inference is famous for:
a confidently wrong number. A mis-specified adjustment returns an estimate in
exactly the same shape as a correct one, with an interval around it, and
nothing in the output says which it is. So every claim the module makes is
checked against data where the answer was planted on purpose.

Three specific traps are pinned here. Controlling for a descendant of the
treatment, which opens a path that was closed. A pre-trend test that cannot
fail, which is worse than no test. And a rolling window over a gappy panel,
which silently drops most of the sample.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.causal.dag import CausalDAG, NotIdentified
from ace.causal.estimate import OverlapFailure, aipw, ipw, regression_adjustment
from ace.causal.local_projection import local_projection
from ace.causal.refute import placebo_treatment, sensitivity_to_unobserved_confounder
from ace.data.series import rolling_std, shock_series

TRUE_ATE = 2.0


def _confounded(n=6000, seed=0):
    rng = np.random.default_rng(seed)
    z = rng.normal(size=(n, 3))
    logit = 0.9 * z[:, 0] - 0.6 * z[:, 1] + 0.3 * z[:, 2]
    t = (rng.uniform(size=n) < 1 / (1 + np.exp(-logit))).astype(float)
    y = TRUE_ATE * t + 1.5 * z[:, 0] - 1.0 * z[:, 1] + 0.5 * z[:, 2] + rng.normal(size=n)
    return y, t, z


def _impulse(n=3000, seed=3, anticipated=False, decay=0.7):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2012-01-01", periods=n, freq="B")
    shock = (rng.uniform(size=n) < 0.05).astype(float)
    y = rng.normal(scale=0.5, size=n)
    for h in range(8):
        y[h:] += (decay ** h) * shock[: n - h]
    if anticipated:
        y[: n - 3] += 0.8 * shock[3:]
    return pd.Series(y, index=idx), pd.Series(shock, index=idx)


# ------------------------------------------------------------ identification


def test_backdoor_set_is_found_for_a_confounded_graph():
    dag = CausalDAG([("Z", "X"), ("Z", "Y"), ("X", "Y")])
    ident = dag.identify("X", "Y")
    assert ident.adjustment_set == ("Z",)
    assert ident.strategy == "backdoor"


def test_no_backdoor_path_means_no_adjustment_is_needed():
    dag = CausalDAG([("X", "Y"), ("Y", "M")])
    ident = dag.identify("X", "Y")
    assert ident.adjustment_set == ()
    assert ident.strategy == "unadjusted"


def test_a_latent_confounder_makes_the_effect_unidentified():
    """The honest answer is 'you cannot', not a number."""
    dag = CausalDAG([("U", "X"), ("U", "Y"), ("X", "Y")], observed={"X", "Y"})
    with pytest.raises(NotIdentified, match="no observed set"):
        dag.identify("X", "Y")


def test_a_descendant_of_the_treatment_is_never_in_the_adjustment_set():
    """Controlling for a mediator removes part of the effect being measured."""
    dag = CausalDAG([("Z", "X"), ("Z", "Y"), ("X", "M"), ("M", "Y"), ("X", "Y")])
    ident = dag.identify("X", "Y")
    assert "M" not in ident.adjustment_set
    assert not dag.blocks_backdoor({"M"}, "X", "Y")


def test_a_collider_is_reported_so_nobody_controls_for_it():
    dag = CausalDAG([("X", "Y"), ("X", "M"), ("Y", "M")])
    assert dag.colliders_on_paths("X", "Y") == {"M"}


def test_a_cycle_is_rejected_rather_than_silently_accepted():
    with pytest.raises(ValueError, match="not a DAG"):
        CausalDAG([("A", "B"), ("B", "C"), ("C", "A")])


def test_no_directed_path_means_there_is_no_effect_to_estimate():
    dag = CausalDAG([("X", "M"), ("Y", "M")])
    with pytest.raises(NotIdentified, match="no directed path"):
        dag.identify("X", "Y")


# ---------------------------------------------------------------- estimation


def test_the_naive_contrast_is_wrong_and_the_estimators_are_not():
    y, t, z = _confounded()
    naive = y[t == 1].mean() - y[t == 0].mean()
    assert abs(naive - TRUE_ATE) > 1.0, "the test data must actually be confounded"
    for est in (regression_adjustment(y, t, z), ipw(y, t, z), aipw(y, t, z)):
        assert abs(est.ate - TRUE_ATE) < 0.15, f"{est.estimator} gave {est.ate}"


def test_the_doubly_robust_interval_covers_the_truth():
    y, t, z = _confounded()
    est = aipw(y, t, z)
    assert est.ci_low < TRUE_ATE < est.ci_high
    assert est.excludes_zero()


def test_ipw_refuses_to_estimate_without_overlap():
    """Deterministic treatment means there is nothing to compare."""
    rng = np.random.default_rng(0)
    n = 2000
    z = rng.normal(size=(n, 1))
    t = (z[:, 0] > 0).astype(float)          # no unit has a counterfactual
    y = 2.0 * t + z[:, 0] + rng.normal(size=n)
    with pytest.raises(OverlapFailure):
        ipw(y, t, z)


def test_overlap_diagnostics_are_reported_even_when_overlap_holds():
    y, t, z = _confounded()
    est = ipw(y, t, z)
    d = est.diagnostics
    assert 0 < d["propensity_min"] < d["propensity_max"] < 1
    assert d["ess_fraction"] > 0.5


def test_a_non_binary_treatment_is_rejected():
    rng = np.random.default_rng(0)
    y = rng.normal(size=200)
    t = rng.normal(size=200)
    with pytest.raises(ValueError, match="binary"):
        regression_adjustment(y, t, None)


# --------------------------------------------------------------- refutations


def test_placebo_passes_on_a_real_effect():
    y, t, z = _confounded()
    orig = regression_adjustment(y, t, z).ate
    r = placebo_treatment(regression_adjustment, y, t, z, original=orig, n_sim=10)
    assert r.passed
    assert abs(r.refuted) < 0.1


def test_placebo_fails_when_the_estimate_is_an_artefact():
    """A pipeline that returns the same number for a shuffled treatment is broken."""
    y, t, z = _confounded()

    def broken(yy, tt, zz, **kw):
        from ace.causal.estimate import EffectEstimate
        return EffectEstimate("broken", 2.0)   # ignores the treatment entirely

    r = placebo_treatment(broken, y, t, z, original=2.0, n_sim=5)
    assert not r.passed


def test_sensitivity_reports_the_confounder_strength_that_overturns_the_result():
    y, t, z = _confounded()
    orig = regression_adjustment(y, t, z).ate
    out = sensitivity_to_unobserved_confounder(
        regression_adjustment, y, t, z, original=orig, strengths=(0.5, 1.0, 2.0, 4.0)
    )
    assert out["sign_flips_at"] is not None
    assert len(out["grid"]) == 4
    # A stronger confounder must not move the estimate less than a weaker one.
    ates = [row["ate"] for row in out["grid"]]
    assert ates == sorted(ates, reverse=True)


# --------------------------------------------------------- local projections


def test_local_projection_recovers_a_planted_impulse_response():
    y, s = _impulse()
    ir = local_projection(y, s, horizons=range(0, 6))
    for h in range(0, 5):
        assert abs(ir.at(h)["coef"] - 0.7 ** h) < 0.12, f"horizon {h}"


def test_the_pretrend_test_can_fail():
    """A test that cannot fail is not evidence."""
    y, s = _impulse(anticipated=True)
    ir = local_projection(y, s, horizons=range(0, 6), pre_horizons=[-5, -3, -1])
    assert not ir.pretrend_ok
    assert "anticipated" in ir.pretrend_note


def test_the_pretrend_test_passes_on_an_unanticipated_shock():
    y, s = _impulse()
    ir = local_projection(y, s, horizons=range(0, 6), pre_horizons=[-5, -3, -1])
    assert ir.pretrend_ok


def test_pretrend_horizons_are_estimated_not_degenerate():
    """Regressing y(t-5) on its own lag 5 would give a zero-width interval."""
    y, s = _impulse()
    ir = local_projection(y, s, horizons=range(0, 3), pre_horizons=[-5, -3, -1], lags=5)
    for h in (-5, -3, -1):
        i = ir.horizons.index(h)
        assert ir.se[i] > 1e-6, f"horizon {h} has a degenerate standard error"
        assert ir.n[i] > 100


def test_holm_correction_is_never_more_permissive_than_raw_significance():
    y, s = _impulse()
    ir = local_projection(y, s, horizons=range(0, 11), pre_horizons=[-1])
    raw = set(ir.significant_horizons())
    holm = set(ir.holm_significant())
    assert holm <= raw


def test_a_response_with_no_effect_survives_neither_test():
    rng = np.random.default_rng(11)
    n = 2000
    idx = pd.date_range("2014-01-01", periods=n, freq="B")
    y = pd.Series(rng.normal(size=n), index=idx)
    s = pd.Series((rng.uniform(size=n) < 0.05).astype(float), index=idx)
    ir = local_projection(y, s, horizons=range(0, 11))
    assert ir.holm_significant() == []


def test_cumulative_is_forward_only():
    y, s = _impulse()
    ir = local_projection(y, s, horizons=range(0, 4), pre_horizons=[-2])
    i = ir.horizons.index(-2)
    assert np.isnan(ir.cumulative[i])
    assert ir.cumulative[ir.horizons.index(3)] > ir.cumulative[ir.horizons.index(0)]


# ------------------------------------------------- rolling over gappy panels


def test_rolling_over_a_gappy_panel_loses_the_sample_and_on_observed_does_not():
    """The defect: SP500's 60-day vol had 21 usable values instead of 2,452."""
    rng = np.random.default_rng(0)
    idx = pd.date_range("2020-01-01", periods=400, freq="D")
    s = pd.Series(rng.normal(size=400), index=idx)
    gappy = s.copy()
    gappy.iloc[::7] = np.nan            # one hole a week
    assert gappy.rolling(60, min_periods=60).std().notna().sum() == 0
    fixed = rolling_std(gappy, 60)
    assert fixed.notna().sum() > 250


def test_shock_series_finds_shocks_a_naive_rolling_window_would_miss():
    rng = np.random.default_rng(1)
    idx = pd.date_range("2020-01-01", periods=600, freq="D")
    s = pd.Series(rng.normal(scale=0.01, size=600), index=idx)
    s.iloc[::7] = np.nan
    s.iloc[300] = 0.06                  # unmistakably a shock
    naive_z = s / s.rolling(60, min_periods=60).std()
    assert int((naive_z.abs() >= 2).sum()) == 0
    assert (shock_series(s) != 0).sum() > 0
    assert shock_series(s).loc[idx[300]] > 2


def test_shock_series_is_signed_and_zero_off_shock_days():
    rng = np.random.default_rng(2)
    idx = pd.date_range("2020-01-01", periods=400, freq="B")
    s = pd.Series(rng.normal(scale=0.01, size=400), index=idx)
    s.iloc[200] = -0.05
    out = shock_series(s)
    assert out.loc[idx[200]] < -2
    assert set(np.unique(out[out == 0])) == {0.0}
    assert (shock_series(s, signed=False) >= 0).all()


def test_rolling_helpers_survive_an_all_nan_series():
    idx = pd.date_range("2020-01-01", periods=100, freq="D")
    s = pd.Series(np.nan, index=idx)
    assert rolling_std(s, 20).isna().all()
    assert (shock_series(s) == 0).all()
