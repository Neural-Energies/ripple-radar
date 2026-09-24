"""Conflict-cascade gate tests.

Two failures these exist to prevent, both of which shipped once during this
model's development and were caught by looking at the output rather than the
verdict.

A gate that PASSES A CHECK THAT NEVER RAN. The per-country Ogata test needs
~50 residuals and these countries have 12-17 held-out events, so it silently
returned "unavailable" and the pass condition -- written as "not False" --
waved it through while the verdict claimed correct specification.

A model that STOPS QUALIFYING and keeps its production status. Retiring only
the models being replaced left Pakistan in PRODUCTION on the strength of an
earlier run.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.cascade.hawkes import fit_hawkes, rescaled_times
from ace.models.gdelt_cascade_model import (
    MIN_POOLED_RESIDUALS,
    oos_log_likelihood,
    pooled_specification,
)


def _hawkes_sample(mu=0.05, alpha=0.4, beta=0.6, T=4000.0, seed=0):
    """Ogata thinning: a genuinely self-exciting process to score against."""
    rng = np.random.default_rng(seed)
    events: list[float] = []
    t = 0.0
    while t < T:
        lam_bar = mu + alpha * beta * sum(np.exp(-beta * (t - s)) for s in events[-400:])
        t += rng.exponential(1 / max(lam_bar, 1e-9))
        if t >= T:
            break
        lam = mu + alpha * beta * sum(np.exp(-beta * (t - s)) for s in events[-400:])
        if rng.uniform() <= lam / max(lam_bar, 1e-9):
            events.append(t)
    return np.array(events)


# ------------------------------------------------- pooled specification

def test_pooling_makes_an_untestable_sample_testable():
    rng = np.random.default_rng(1)
    small = [rng.exponential(1.0, size=15).tolist() for _ in range(4)]
    for one in small:
        assert pooled_specification([one])["available"] is False, "one country alone cannot be tested"
    pooled = pooled_specification(small)
    assert pooled["available"] is True
    assert pooled["n"] == 60


def test_exp1_residuals_are_not_rejected():
    rng = np.random.default_rng(7)
    tau = [rng.exponential(1.0, size=200).tolist()]
    out = pooled_specification(tau)
    assert out["exponential_by_ks"] is True, f"correct residuals rejected at p={out['ks_p_value']}"
    assert abs(out["mean"] - 1.0) < 0.2


def test_wrongly_shaped_residuals_are_rejected():
    # A gate that cannot fail is not a gate.
    #
    # Gamma(3, 1/3) has mean 1.0 -- the same first moment as Exp(1) -- and a
    # completely different shape: it is far less skewed and its hazard rises
    # rather than staying flat. Matching the mean while failing the shape is
    # exactly the error the real run found in the conflict data, so the fixture
    # reproduces that error rather than an easier one.
    #
    # (A lognormal was tried first and was NOT rejected at n=300 -- it mimics
    # Exp(1) too closely. Checking the fixture empirically rather than assuming
    # it was wrong is what made this test meaningful.)
    rng = np.random.default_rng(3)
    tau = [rng.gamma(3.0, 1 / 3, size=300).tolist()]
    out = pooled_specification(tau)
    assert abs(out["mean"] - 1.0) < 0.1, "the fixture must match Exp(1)'s mean"
    assert out["exponential_by_ks"] is False, "a misspecified kernel must be caught"


def test_too_few_residuals_reports_unavailable_rather_than_passing():
    out = pooled_specification([[0.5] * (MIN_POOLED_RESIDUALS - 1)])
    assert out["available"] is False
    assert "available" in out and out.get("exponential_by_ks") is None, (
        "an untestable sample must not report a verdict the test never produced"
    )


def test_no_residuals_at_all_is_handled():
    out = pooled_specification([])
    assert out["available"] is False
    assert out["n"] == 0


def test_negative_and_nonfinite_residuals_are_dropped_not_counted():
    rng = np.random.default_rng(5)
    clean = rng.exponential(1.0, size=120).tolist()
    dirty = clean + [-1.0, np.nan, np.inf, -5.0]
    assert pooled_specification([dirty])["n"] == 120


# ---------------------------------------------- out-of-sample likelihood

def test_a_self_exciting_holdout_scores_better_under_hawkes_than_poisson():
    events = _hawkes_sample(seed=11)
    assert len(events) > 120, f"sample too small to split: {len(events)}"
    cut = events[int(len(events) * 0.7)]
    train, test = events[events < cut], events[events >= cut] - cut
    fit = fit_hawkes(train)
    ll_h, ll_p, gain = oos_log_likelihood(test, fit)
    assert np.isfinite(gain)
    assert gain > 0, f"Hawkes must beat Poisson out of sample on clustered data, got {gain}"
    assert abs((ll_h - ll_p) - gain) < 1e-9


def test_a_poisson_holdout_gives_hawkes_no_real_edge():
    rng = np.random.default_rng(4)
    T = 4000.0
    events = np.sort(rng.uniform(0, T, size=rng.poisson(0.06 * T)))
    cut = events[int(len(events) * 0.7)]
    train, test = events[events < cut], events[events >= cut] - cut
    fit = fit_hawkes(train)
    assert fit.alpha < 0.25, "a Poisson sample should fit with little excitation"
    _, _, gain = oos_log_likelihood(test, fit)
    assert gain < 5.0, f"no meaningful gain should appear on unclustered data, got {gain}"


def test_too_few_holdout_events_returns_nan_rather_than_a_number():
    fit = fit_hawkes(_hawkes_sample(seed=2))
    for thin in (np.array([]), np.array([1.0])):
        _, _, gain = oos_log_likelihood(thin, fit)
        assert np.isnan(gain)


# ------------------------------------------- the residuals the gate uses

def test_rescaled_times_of_a_correct_fit_pool_to_exp1():
    """End to end: fit a known process, pool its residuals, do not reject."""
    sets = []
    for seed in range(4):
        ev = _hawkes_sample(seed=seed)
        fit = fit_hawkes(ev)
        sets.append(rescaled_times(ev, fit).tolist())
    out = pooled_specification(sets)
    assert out["available"] is True
    assert out["n"] > 200
    assert out["exponential_by_ks"] is True, (
        f"a correctly specified exponential-kernel fit was rejected at p={out['ks_p_value']}"
    )
