"""Competing-risks engine tests.

The defect these exist to prevent is the classic one: treating a competing
event as censoring. If de-escalation is modelled as "we stopped watching"
rather than "something else happened first", the estimated probability of
escalation is the probability in a world where de-escalation cannot occur —
always too high, and confidently so.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.survival.competing import calibration_by_horizon, fit_competing_risks


def _two_cause_sample(n=20000, l1=0.1, l2=0.05, lc=0.025, seed=0):
    rng = np.random.default_rng(seed)
    t1 = rng.exponential(1 / l1, n)
    t2 = rng.exponential(1 / l2, n)
    cens = rng.exponential(1 / lc, n)
    t = np.minimum(np.minimum(t1, t2), cens)
    cause = np.where((t1 <= t2) & (t1 <= cens), 1,
                     np.where((t2 < t1) & (t2 <= cens), 2, 0))
    return t, cause


def test_cif_matches_the_analytic_solution_for_competing_exponentials():
    """Ground truth: CIF_k(t) = lambda_k/L * (1 - exp(-L t)), L = sum lambda."""
    t, cause = _two_cause_sample()
    fit = fit_competing_risks(t, cause, {1: "fast", 2: "slow"})
    l1, l2 = 0.1, 0.05
    L = l1 + l2
    for horizon in (5.0, 10.0, 15.0):
        p = fit.probabilities_at(horizon)
        assert abs(p["fast"] - l1 / L * (1 - np.exp(-L * horizon))) < 0.02
        assert abs(p["slow"] - l2 / L * (1 - np.exp(-L * horizon))) < 0.02


def test_incidence_and_no_event_form_a_distribution():
    """Closure: the scenario set must sum to 1 at every horizon."""
    t, cause = _two_cause_sample(n=5000)
    fit = fit_competing_risks(t, cause, {1: "fast", 2: "slow"})
    for horizon in (1.0, 5.0, 20.0, 40.0):
        p = fit.probabilities_at(horizon)
        assert abs(sum(p.values()) - 1.0) < 1e-6
        assert all(0.0 <= v <= 1.0 for v in p.values())


def test_cumulative_incidence_is_monotone_in_time():
    t, cause = _two_cause_sample(n=5000)
    fit = fit_competing_risks(t, cause, {1: "fast", 2: "slow"})
    for name in fit.causes:
        curve = np.asarray(fit.cif[name])
        assert np.all(np.diff(curve) >= -1e-9), f"{name} CIF decreased"


def test_a_faster_cause_has_higher_incidence():
    t, cause = _two_cause_sample()
    fit = fit_competing_risks(t, cause, {1: "fast", 2: "slow"})
    p = fit.probabilities_at(15.0)
    assert p["fast"] > p["slow"]


def test_treating_a_competitor_as_censoring_overstates_risk():
    """The specific error the engine exists to avoid.

    Relabelling cause 2 as censored asks "how often does cause 1 happen if
    cause 2 never can". The Kaplan-Meier complement answers that question and
    is strictly larger than the true incidence, because the competitor no
    longer removes anyone from the risk set as an event.
    """
    from sksurv.nonparametric import kaplan_meier_estimator

    t, cause = _two_cause_sample()
    proper = fit_competing_risks(t, cause, {1: "fast", 2: "slow"})

    times, surv = kaplan_meier_estimator(cause == 1, t)   # cause 2 -> censored
    naive_at_30 = 1.0 - float(np.interp(30.0, times, surv))

    assert naive_at_30 > proper.probabilities_at(30.0)["fast"] + 0.05, (
        f"naive {naive_at_30:.3f} should overstate proper "
        f"{proper.probabilities_at(30.0)['fast']:.3f}"
    )


def test_single_cause_is_refused_with_a_clear_message():
    t, cause = _two_cause_sample(n=2000)
    with pytest.raises(ValueError, match="Kaplan-Meier"):
        fit_competing_risks(t, np.where(cause == 1, 1, 0), {1: "only"})


def test_unnamed_cause_in_the_data_is_refused():
    t, cause = _two_cause_sample(n=2000)
    with pytest.raises(ValueError, match="not named"):
        fit_competing_risks(t, cause, {1: "fast", 3: "other"})


def test_censored_subjects_are_retained_not_dropped():
    t, cause = _two_cause_sample(n=3000)
    fit = fit_competing_risks(t, cause, {1: "fast", 2: "slow"})
    assert fit.n_censored > 0
    assert fit.n_subjects == len(t)


def test_calibration_reports_predicted_against_realized():
    t, cause = _two_cause_sample(n=8000, seed=1)
    fit = fit_competing_risks(t, cause, {1: "fast", 2: "slow"})
    t2, c2 = _two_cause_sample(n=8000, seed=2)
    rows = calibration_by_horizon(fit, t2, c2, {1: "fast", 2: "slow"}, (5.0, 15.0))
    assert len(rows) == 4
    for r in rows:
        assert abs(r["error"]) < 0.06, f"{r['cause']} at {r['horizon']}: {r['error']}"


def test_too_few_subjects_are_refused():
    with pytest.raises(ValueError):
        fit_competing_risks(np.array([1.0, 2.0]), np.array([1, 0]), {1: "a"})


def test_mismatched_inputs_are_refused():
    with pytest.raises(ValueError):
        fit_competing_risks(np.ones(100), np.ones(50, dtype=int), {1: "a"})


# ------------------------------------ step-function CIF and censor-aware holdout --

def test_in_house_aalen_johansen_matches_sksurv_with_ties_and_censoring():
    """The estimator the fit and the holdout now share, checked against the
    library it replaced on data where the library works: three causes,
    rounded (tied) times, heavy censoring."""
    from sksurv.nonparametric import cumulative_incidence_competing_risks

    from ace.survival.competing import aalen_johansen

    rng = np.random.default_rng(4)
    n = 3000
    t = np.round(rng.exponential(10, n), 1) + 0.1
    cause = rng.choice([0, 1, 2, 3], size=n, p=[0.4, 0.3, 0.2, 0.1])
    times, cif, _ = aalen_johansen(t, cause, [1, 2, 3])
    lib_t, lib_cif = cumulative_incidence_competing_risks(cause, t)
    for k in (1, 2, 3):
        lib_at = np.interp(times, lib_t, lib_cif[k])  # both are evaluated AT jump times
        np.testing.assert_allclose(cif[k - 1], lib_at, atol=1e-10)


def test_a_cif_is_read_as_a_right_continuous_step():
    """PR #5 A07: CIF 0.5 at day 10 and 1.0 at day 20 was read as 0.75 at
    day 15 (interpolated) and 0.5 at day 0 (clamped to the first grid point)."""
    from ace.survival.competing import CompetingRisksFit

    fit = CompetingRisksFit(
        causes=["a", "b"], n_subjects=4, n_censored=0,
        horizon_grid=[0.0, 10.0, 20.0],
        cif={"a": [0.0, 0.5, 0.5], "b": [0.0, 0.0, 0.5]},
        event_counts={"a": 2, "b": 2}, median_time={"a": 10.0, "b": 20.0},
    )
    assert fit.probabilities_at(0.0)["a"] == 0.0
    assert fit.probabilities_at(-1.0)["a"] == 0.0
    assert fit.probabilities_at(9.999)["a"] == 0.0
    assert fit.probabilities_at(10.0)["a"] == 0.5
    assert fit.probabilities_at(15.0) == {"a": 0.5, "b": 0.0, "no_event": 0.5}
    assert fit.probabilities_at(20.0) == {"a": 0.5, "b": 0.5, "no_event": 0.0}
    assert fit.probabilities_at(99.0)["b"] == 0.5


def test_the_fitted_curve_keeps_every_jump_and_starts_at_zero():
    t = np.array([10.0, 10.0, 20.0, 20.0] * 20)
    cause = np.array([1, 1, 2, 2] * 20)
    fit = fit_competing_risks(t, cause, {1: "a", 2: "b"})
    assert fit.horizon_grid == [0.0, 10.0, 20.0]
    assert fit.cif["a"] == [0.0, 0.5, 0.5]
    assert fit.cif["b"] == [0.0, 0.0, 0.5]
    assert fit.probabilities_at(15.0)["a"] == 0.5
    assert fit.median_time == {"a": 10.0, "b": 20.0}


def test_early_censoring_is_not_scored_as_a_known_negative():
    """PR #5 A06, the audit's own counterexample: 50 censored on day 1, 25
    cause-A events on day 2, 25 followed event-free to day 20. At day 10 the
    old calibration reported 0.25; the risk-set answer is 0.50."""
    t, cause = _two_cause_sample(n=4000)
    fit = fit_competing_risks(t, cause, {1: "A", 2: "B"})
    d = np.array([1.0] * 50 + [2.0] * 25 + [20.0] * 25)
    c = np.array([0] * 50 + [1] * 25 + [0] * 25)
    rows = calibration_by_horizon(fit, d, c, {1: "A", 2: "B"}, (10.0,), n_boot=50)
    by = {r["cause"]: r for r in rows}
    assert by["A"]["realized"] == pytest.approx(0.50)
    assert by["B"]["realized"] == 0.0
    assert by["A"]["n_at_risk"] == 25


def test_holdout_incidence_tracks_the_truth_at_any_censoring_rate():
    """Independent censoring should not move the realized incidence. The old
    count-based realized frequency fell as censoring rose."""
    l1, l2, horizon = 0.1, 0.05, 10.0
    truth = l1 / (l1 + l2) * (1 - np.exp(-(l1 + l2) * horizon))
    fit = fit_competing_risks(*_two_cause_sample(n=4000), {1: "fast", 2: "slow"})
    for lc in (0.001, 0.03, 0.1):
        d, c = _two_cause_sample(n=20000, lc=lc, seed=int(lc * 1000) + 5)
        row = next(r for r in calibration_by_horizon(fit, d, c, {1: "fast", 2: "slow"},
                                                     (horizon,), n_boot=20)
                   if r["cause"] == "fast")
        assert row["realized"] == pytest.approx(truth, abs=0.015), f"censoring {lc}"
        assert row["realized_ci"][0] <= row["realized"] <= row["realized_ci"][1]


def test_without_censoring_the_holdout_incidence_is_the_plain_fraction():
    rng = np.random.default_rng(8)
    d = rng.exponential(5, 500) + 0.01
    c = rng.choice([1, 2], size=500)
    fit = fit_competing_risks(d, c, {1: "a", 2: "b"})
    rows = calibration_by_horizon(fit, d, c, {1: "a", 2: "b"}, (3.0,), n_boot=10)
    for r in rows:
        k = 1 if r["cause"] == "a" else 2
        assert r["realized"] == pytest.approx(np.mean((c == k) & (d <= 3.0)), abs=1e-4)


def test_a_horizon_past_the_holdout_follow_up_is_unsupported():
    fit = fit_competing_risks(*_two_cause_sample(n=4000), {1: "fast", 2: "slow"})
    d = np.full(200, 5.0)
    c = np.zeros(200, dtype=int)
    c[:40] = 1
    d[:40] = 2.0
    rows = calibration_by_horizon(fit, d, c, {1: "fast", 2: "slow"}, (3.0, 10.0), n_boot=10)
    assert all(r["supported"] for r in rows if r["horizon"] == 3.0)
    assert not any(r["supported"] for r in rows if r["horizon"] == 10.0)


def test_jump_times_milliseconds_apart_stay_distinct_knots():
    base = 3.0
    t = np.array([base, base + 1e-8, base + 2e-8, 10.0] * 20)
    cause = np.array([1, 2, 1, 0] * 20)
    fit = fit_competing_risks(t, cause, {1: "a", 2: "b"})
    grid = np.asarray(fit.horizon_grid)
    assert np.all(np.diff(grid) > 0)
    assert len(grid) == 4
