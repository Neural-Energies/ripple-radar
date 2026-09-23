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
