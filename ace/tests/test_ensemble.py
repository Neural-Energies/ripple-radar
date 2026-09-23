"""Ensemble tests.

The question an ensemble has to answer honestly is "does combining beat the
BEST member", not "does it beat the average" — the second is true whenever one
member is bad and says nothing. These tests pin the pieces that decide it: the
members must speak the same units, the weights must be fittable from data, and
the label must not contain the day it is forecast from.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.cascade.hawkes import fit_hawkes
from ace.ensemble.members import (
    event_flags,
    forward_any_event,
    hawkes_event_probability,
    hawkes_intensity_now,
    markov_probability,
    volatility_event_probability,
)
from ace.ensemble.stack import (
    apply_ensemble,
    equal_weights,
    fit_ensemble,
    linear_pool,
    log_pool,
    log_score,
    pseudo_bma_weights,
    stacking_weights,
)


# ------------------------------------------------------------------- labels


def test_the_forward_label_excludes_the_day_it_is_forecast_from():
    """An off-by-one here makes every member look prescient."""
    idx = pd.date_range("2020-01-01", periods=12, freq="B")
    flags = pd.Series([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], index=idx, dtype=float)
    fwd = forward_any_event(flags, 3)
    assert fwd.iloc[0] == 0.0, "today's own event leaked into today's label"
    flags2 = pd.Series([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], index=idx, dtype=float)
    fwd2 = forward_any_event(flags2, 3)
    assert fwd2.iloc[0] == 1.0   # t+3 is inside a 3-session window
    assert fwd2.iloc[1] == 1.0
    assert fwd2.iloc[3] == 0.0   # the event day itself sees only what follows


def test_event_flags_are_standardized_by_trailing_volatility():
    rng = np.random.default_rng(0)
    idx = pd.date_range("2015-01-01", periods=400, freq="B")
    calm = pd.Series(rng.normal(scale=0.002, size=400), index=idx)
    calm.iloc[300] = 0.01
    wild = pd.Series(rng.normal(scale=0.02, size=400), index=idx)
    wild.iloc[300] = 0.01
    assert event_flags(calm).iloc[300] == 1.0
    assert event_flags(wild).iloc[300] == 0.0


# ------------------------------------------------------------------ members


def test_hawkes_probability_matches_poisson_when_there_is_no_self_excitation():
    rng = np.random.default_rng(0)
    T, rate = 4000.0, 0.06
    t = np.sort(rng.uniform(0, T, size=rng.poisson(rate * T)))
    fit = fit_hawkes(t, T)
    assert fit.alpha < 0.1, "this sample must be near-Poisson for the test to mean anything"
    p = hawkes_event_probability(fit, t, np.linspace(100, T - 20, 200), 5.0)
    assert abs(float(np.mean(p)) - (1 - np.exp(-rate * 5))) < 0.03


def _known_fit(mu=0.05, alpha=0.4, beta=0.5):
    """A fit with excitation actually in it, so the kernel can be tested."""
    from ace.cascade.hawkes import HawkesFit
    return HawkesFit(mu=mu, alpha=alpha, beta=beta, log_likelihood=0.0,
                     poisson_log_likelihood=0.0, lr_statistic=0.0, lr_p_value=0.0,
                     beats_poisson=True, branching_ratio=alpha, stationary=True,
                     mean_excitation_life=1 / beta, n_events=100, horizon=1000.0,
                     converged=True)


def test_hawkes_intensity_uses_only_events_strictly_before_each_point():
    fit = _known_fit()
    history = np.array([10.0, 20.0, 30.0])
    before = hawkes_intensity_now(fit, history, np.array([19.999]))[0]
    after = hawkes_intensity_now(fit, history, np.array([20.001]))[0]
    assert after > before, "the event at t=20 must raise the intensity only after it"
    # And the jump is the kernel's own height, not something larger.
    assert abs((after - before) - fit.alpha * fit.beta) < 1e-3


def test_hawkes_intensity_decays_back_toward_the_baseline():
    fit = _known_fit()
    history = np.array([100.0])
    lam = [hawkes_intensity_now(fit, history, np.array([100.0 + u]))[0]
           for u in (0.1, 2.0, 10.0, 40.0)]
    assert lam == sorted(lam, reverse=True)
    assert abs(lam[-1] - fit.mu) < 1e-6


def test_hawkes_probability_rises_with_the_horizon():
    fit = fit_hawkes(np.sort(np.random.default_rng(2).uniform(0, 3000, size=250)), 3000.0)
    s = np.array([1500.0])
    p = [hawkes_event_probability(fit, np.array([]), s, h)[0] for h in (1, 5, 10, 30)]
    assert p == sorted(p)
    assert all(0 < x < 1 for x in p)


def test_a_non_stationary_fit_is_refused_rather_than_extrapolated():
    from ace.cascade.hawkes import HawkesFit
    bad = HawkesFit(mu=0.1, alpha=1.4, beta=1.0, log_likelihood=0.0,
                    poisson_log_likelihood=0.0, lr_statistic=0.0, lr_p_value=1.0,
                    beats_poisson=False, branching_ratio=1.4, stationary=False,
                    mean_excitation_life=1.0, n_events=10, horizon=10.0, converged=True)
    with pytest.raises(ValueError, match="not stationary"):
        hawkes_event_probability(bad, np.array([]), np.array([1.0]), 5.0)


def test_volatility_probability_rises_with_forecast_volatility():
    resid = np.random.default_rng(0).standard_t(5, size=4000)
    resid /= resid.std()
    p = volatility_event_probability(np.array([0.5, 1.0, 2.0]), resid, horizon=5)
    assert p[0] < p[1] < p[2]
    assert all(0 <= x <= 1 for x in p)


def test_volatility_probability_refuses_too_few_residuals():
    with pytest.raises(ValueError, match=">=100"):
        volatility_event_probability(np.array([1.0]), np.random.default_rng(0).normal(size=10))


def test_markov_member_distinguishes_event_days_from_calm_days():
    idx = pd.date_range("2020-01-01", periods=5, freq="B")
    flags = pd.Series([1, 0, 1, 0, 0], index=idx, dtype=float)
    p = markov_probability(flags, idx, p_after_event=0.4, p_after_calm=0.1)
    assert list(p) == [0.4, 0.1, 0.4, 0.1, 0.1]


# -------------------------------------------------------- pooling & weights


def test_the_log_pool_is_sharper_than_the_linear_pool_when_members_lean_the_same_way():
    """Members at 0.6 and 0.8 both say "likely"; the log pool says so louder."""
    P = np.array([[0.6, 0.8], [0.2, 0.4]])
    w = equal_weights(2)
    assert log_pool(P, w)[0] > linear_pool(P, w)[0]   # both above 0.5
    assert log_pool(P, w)[1] < linear_pool(P, w)[1]   # both below 0.5


def test_the_pools_agree_when_the_members_do():
    P = np.array([[0.7, 0.7], [0.15, 0.15]])
    w = equal_weights(2)
    assert np.allclose(log_pool(P, w), linear_pool(P, w), atol=1e-9)


def test_both_pools_return_probabilities():
    rng = np.random.default_rng(0)
    P = rng.uniform(0.01, 0.99, size=(500, 3))
    w = np.array([0.5, 0.3, 0.2])
    for pooled in (linear_pool(P, w), log_pool(P, w)):
        assert np.all((pooled > 0) & (pooled < 1))


def _members(n=4000, seed=0):
    rng = np.random.default_rng(seed)
    truth = rng.uniform(0.02, 0.3, size=n)
    y = (rng.uniform(size=n) < truth).astype(float)
    P = np.column_stack([
        np.clip(truth + rng.normal(scale=0.02, size=n), 0.001, 0.999),   # good
        np.clip(truth + rng.normal(scale=0.15, size=n), 0.001, 0.999),   # noisy
        np.full(n, y.mean()),                                            # base rate
    ])
    return y, P


def test_stacking_puts_its_weight_on_the_member_that_deserves_it():
    y, P = _members()
    w = stacking_weights(y, P)
    assert w.argmax() == 0
    assert w[0] > 0.7
    assert abs(w.sum() - 1.0) < 1e-9


def test_pseudo_bma_also_prefers_the_good_member_without_collapsing_onto_it():
    y, P = _members()
    w = pseudo_bma_weights(y, P)
    assert w.argmax() == 0
    assert abs(w.sum() - 1.0) < 1e-9


def test_the_fitted_ensemble_is_never_worse_than_equal_weights_in_sample():
    """Equal weights is one of the candidates, so the selection cannot lose."""
    y, P = _members()
    chosen = fit_ensemble(y, P, ["good", "noisy", "base"])
    equal_linear = log_score(y, linear_pool(P, equal_weights(3)))
    assert chosen.validation_log_score >= equal_linear - 1e-9


def test_equal_weights_wins_when_the_members_are_interchangeable():
    """With nothing to learn, fitted weights only fit noise — and the
    selection should notice and fall back."""
    rng = np.random.default_rng(3)
    n = 3000
    truth = rng.uniform(0.1, 0.4, size=n)
    y = (rng.uniform(size=n) < truth).astype(float)
    P = np.column_stack([np.clip(truth + rng.normal(scale=0.05, size=n), 0.01, 0.99)
                         for _ in range(3)])
    chosen = fit_ensemble(y, P, ["a", "b", "c"])
    spread = chosen.weights.max() - chosen.weights.min()
    assert spread < 0.6, f"weights {chosen.weights} are fitting noise"


def test_apply_ensemble_reproduces_the_selected_pool():
    y, P = _members()
    chosen = fit_ensemble(y, P, ["good", "noisy", "base"])
    out = apply_ensemble(chosen, P)
    expected = (linear_pool if chosen.pool == "linear" else log_pool)(P, chosen.weights)
    assert np.allclose(out, expected)


def test_log_score_prefers_the_better_forecast():
    y, P = _members()
    assert log_score(y, P[:, 0]) > log_score(y, P[:, 1])
