"""Hawkes cascade engine tests.

The engine's job is to tell self-excitation from coincidence, so it is tested
in both directions: it must find excitation that is there, and must NOT find
it in data that has none. A model that reports a cascade in every series is
worse than no model.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.cascade.hawkes import (
    expected_offspring,
    fit_hawkes,
    goodness_of_fit,
    poisson_log_likelihood,
    rescaled_times,
)


def _sim_hawkes(mu, alpha, beta, T, seed=0):
    """Ogata thinning simulation."""
    rng = np.random.default_rng(seed)
    t: list[float] = []
    s = 0.0
    while s < T:
        lam = mu + alpha * beta * sum(np.exp(-beta * (s - ti)) for ti in t[-200:])
        s += rng.exponential(1.0 / max(lam, 1e-9))
        if s >= T:
            break
        lam2 = mu + alpha * beta * sum(np.exp(-beta * (s - ti)) for ti in t[-200:])
        if rng.uniform() <= lam2 / max(lam, 1e-9):
            t.append(s)
    return np.array(t)


def test_poisson_data_is_not_reported_as_self_exciting():
    """The false-positive guard: no cascade where none exists."""
    rng = np.random.default_rng(3)
    t = np.cumsum(rng.exponential(1.0, 1500))
    fit = fit_hawkes(t)
    assert not fit.beats_poisson, f"flagged Poisson noise as self-exciting (p={fit.lr_p_value})"


def test_simulated_hawkes_parameters_are_recovered():
    t = _sim_hawkes(0.5, 0.6, 1.2, 1500, seed=1)
    fit = fit_hawkes(t)
    assert fit.beats_poisson
    assert abs(fit.alpha - 0.6) < 0.15, f"branching ratio off: {fit.alpha}"
    assert abs(fit.beta - 1.2) < 0.6, f"decay off: {fit.beta}"


def test_stronger_excitation_is_detected_as_stronger():
    weak = fit_hawkes(_sim_hawkes(1.0, 0.2, 1.0, 1200, seed=5))
    strong = fit_hawkes(_sim_hawkes(0.4, 0.7, 1.0, 1200, seed=5))
    assert strong.alpha > weak.alpha


def test_fitted_process_is_stationary_and_bounded():
    fit = fit_hawkes(_sim_hawkes(0.5, 0.6, 1.2, 1200, seed=2))
    assert fit.stationary and 0.0 <= fit.alpha < 1.0
    assert fit.mu > 0 and fit.beta > 0


def test_hawkes_likelihood_beats_poisson_on_clustered_data():
    t = _sim_hawkes(0.5, 0.6, 1.2, 1200, seed=4)
    fit = fit_hawkes(t)
    ll_pois, _ = poisson_log_likelihood(t - t[0], float((t[-1] - t[0]) * 1.001))
    assert fit.log_likelihood > ll_pois


def test_time_rescaling_residuals_are_exponential_for_a_correct_fit():
    t = _sim_hawkes(0.5, 0.6, 1.2, 2000, seed=6)
    fit = fit_hawkes(t)
    gof = goodness_of_fit(t, fit)
    assert gof["available"] and gof["exponential_by_ks"], f"KS p={gof.get('ks_p_value')}"
    assert abs(gof["mean"] - 1.0) < 0.35


def test_rescaled_times_are_non_negative():
    t = _sim_hawkes(0.5, 0.5, 1.0, 800, seed=8)
    tau = rescaled_times(t, fit_hawkes(t))
    assert np.all(tau >= -1e-9)


def test_cascade_multiplier_grows_with_the_branching_ratio():
    a = fit_hawkes(_sim_hawkes(1.0, 0.2, 1.0, 1200, seed=9))
    b = fit_hawkes(_sim_hawkes(0.4, 0.7, 1.0, 1200, seed=9))
    ca = expected_offspring(a, 10.0)
    cb = expected_offspring(b, 10.0)
    assert cb["cascade_multiplier"] > ca["cascade_multiplier"]
    # geometric sum across generations: 1/(1-alpha)
    # cascade_multiplier is rounded to 4dp, so compare at that precision
    assert abs(cb["cascade_multiplier"] - 1.0 / (1.0 - b.alpha)) < 1e-3


def test_too_few_events_are_refused_rather_than_fitted():
    with pytest.raises(ValueError):
        fit_hawkes(np.array([1.0, 2.0, 3.0]))
