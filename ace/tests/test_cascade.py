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


# ------------------------------------------------ observation clock (A10) --

def _late_start_events():
    """The audit's reproduction: seed-3 exponential gaps, 100 events shifted
    by 1000, observation end five units after the last event."""
    rng = np.random.default_rng(3)
    t = np.cumsum(rng.exponential(1.0, 100)) + 1000.0
    return t, float(t[-1] + 5.0)


def test_reported_likelihood_is_the_likelihood_on_the_window_it_was_fitted_on():
    """PR #5 A10: shifting the events but not T moved the pre-first-event
    stretch to after the last event; the fit reported -127.752 while its
    parameters score -125.918 on the supplied history."""
    from ace.cascade.hawkes import hawkes_log_likelihood

    t, T = _late_start_events()
    fit = fit_hawkes(t, T, start=0.0)
    params = np.array([fit.mu, fit.alpha, fit.beta])
    assert fit.log_likelihood == pytest.approx(-hawkes_log_likelihood(params, t, T), abs=1e-3)

    conditional = fit_hawkes(t, T)  # window opens at the first event
    params = np.array([conditional.mu, conditional.alpha, conditional.beta])
    assert conditional.log_likelihood == pytest.approx(
        -hawkes_log_likelihood(params, t - t[0], T - t[0]), abs=1e-3)


def test_jointly_translating_start_events_and_end_changes_nothing():
    t, T = _late_start_events()
    a = fit_hawkes(t, T, start=900.0)
    b = fit_hawkes(t + 5000.0, T + 5000.0, start=5900.0)
    assert (a.mu, a.alpha, a.beta, a.log_likelihood) == pytest.approx(
        (b.mu, b.alpha, b.beta, b.log_likelihood), rel=1e-4)


def test_long_terminal_silence_is_charged_as_exposure():
    t, T = _late_start_events()
    short = fit_hawkes(t, T, start=t[0])
    long = fit_hawkes(t, T + 500.0, start=t[0])
    assert long.mu < short.mu  # 500 more event-free units must lower the background rate


def test_an_event_before_the_window_opens_is_refused():
    t, T = _late_start_events()
    with pytest.raises(ValueError, match="precedes the observation start"):
        fit_hawkes(t, T, start=1050.0)
