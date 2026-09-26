"""The macro regime engine, and the parameter read under it.

This file exists because of a defect that hid well. `res.params[:k]` was being
read as the regime means, but statsmodels orders the vector

    ['p[0->0]', 'p[1->0]', 'const[0]', 'const[1]', 'sigma2[0]', 'sigma2[1]']

so those first entries are the TRANSITION BLOCK. The symptom is invisible: the
values are in [0, 1], they differ across regimes, and they move when the data
moves — exactly like means would. It was caught only by fitting a series whose
means were known in advance.

Every test here uses synthetic data with a known answer, so a wrong read is
unambiguous rather than merely surprising.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.regime.macro_regime import (
    MIN_OBS,
    TAXONOMY,
    AxisFit,
    build_regime_state,
    fit_axis,
    independence_check,
    joint_probabilities,
)
from ace.regime.markov import regime_params


def _two_state(n: int = 700, lo: float = -2.0, hi: float = 2.0,
               sd: float = 0.5, persist: float = 0.95, seed: int = 7):
    """A series that really is two-state, with known means."""
    rng = np.random.default_rng(seed)
    state = np.zeros(n, dtype=int)
    for t in range(1, n):
        state[t] = state[t - 1] if rng.random() < persist else 1 - state[t - 1]
    values = np.where(state == 1, hi, lo) + rng.normal(0, sd, n)
    idx = pd.date_range("1960-01-01", periods=n, freq="MS")
    return pd.Series(values, index=idx), state


# --- the parameter read -----------------------------------------------------

def test_regime_params_recovers_known_means_and_variances():
    """The ground-truth test that caught the defect."""
    from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression
    y, _ = _two_state(n=700, lo=-2.0, hi=2.0, sd=0.5)
    from ace.regime.macro_regime import SEARCH_REPS
    res = MarkovRegression(y.to_numpy(), k_regimes=2, trend="c",
                           switching_variance=True).fit(disp=False, search_reps=SEARCH_REPS)
    means, variances = regime_params(res, 2)
    assert sorted(round(m, 1) for m in means) == [-2.0, 2.0], f"means came back {means}"
    for v in variances:
        assert 0.15 < v < 0.40, f"variance {v} is not near the true 0.25"
    # And the failure mode: the first k entries are transition probabilities,
    # every one inside [0, 1], which is why reading them as means looked fine.
    first_k = [float(res.params[i]) for i in range(2)]
    assert all(0.0 <= p <= 1.0 for p in first_k)
    assert sorted(round(m, 1) for m in first_k) != [-2.0, 2.0]


def test_regime_params_refuses_to_guess_when_names_are_missing():
    class _FakeModel:
        param_names: list[str] = []

    class _FakeRes:
        model = _FakeModel()
        params = np.array([0.9, 0.1, 1.0, -1.0, 0.2, 0.2])

    with pytest.raises(ValueError, match="refusing to guess"):
        regime_params(_FakeRes(), 2)


# --- the axis fit -----------------------------------------------------------

def test_fit_axis_labels_the_high_state_by_its_estimated_mean():
    y, _ = _two_state(n=600, lo=-1.5, hi=1.5)
    fit = fit_axis(y, axis="growth")
    assert fit.n_states == 2
    assert fit.means[fit.high_state] == max(fit.means)
    assert fit.labels[fit.high_state] == "growth_high"
    assert fit.labels[1 - fit.high_state] == "growth_low"


def test_the_transition_matrix_is_row_stochastic():
    y, _ = _two_state(n=600)
    fit = fit_axis(y, axis="growth")
    for row in fit.transition:
        assert sum(row) == pytest.approx(1.0, abs=1e-6)
        assert all(0.0 <= p <= 1.0 for p in row)
    # Expected duration is 1/(1-P_ii) and must agree with the matrix it came from.
    for i, d in enumerate(fit.expected_duration):
        # Stored rounded to two places, so compare at that precision.
        assert d == pytest.approx(1.0 / (1.0 - fit.transition[i][i]), abs=0.01)


def test_a_persistent_series_yields_long_expected_durations():
    persistent, _ = _two_state(n=600, persist=0.98)
    flighty, _ = _two_state(n=600, persist=0.70, seed=9)
    assert max(fit_axis(persistent, axis="growth").expected_duration) > max(
        fit_axis(flighty, axis="growth").expected_duration
    )


def test_filtered_and_smoothed_are_not_the_same_series():
    """Smoothed conditions on the future. If they match, something is wrong.

    Deliberately a NOISY, less persistent series. When states are far apart and
    very persistent the two series nearly coincide — because the state is
    obvious either way — and the check would pass without testing anything.
    Smoothing only earns its keep when the current observation is ambiguous.
    """
    y, _ = _two_state(n=600, lo=-0.7, hi=0.7, sd=1.0, persist=0.85, seed=21)
    fit = fit_axis(y, axis="growth")
    assert not fit.filtered.empty and not fit.smoothed.empty
    assert fit.filtered.shape == fit.smoothed.shape
    diff = float((fit.filtered - fit.smoothed).abs().to_numpy().max())
    assert diff > 0.01, (
        f"filtered and smoothed differ by only {diff:.2e} — on an ambiguous series "
        "they should differ materially, so the lookahead distinction is not real"
    )


def test_fit_axis_refuses_a_series_that_is_too_short():
    y, _ = _two_state(n=MIN_OBS - 1)
    with pytest.raises(ValueError, match="need >="):
        fit_axis(y, axis="growth")


# --- the joint ---------------------------------------------------------------

def _two_axes(seed_g: int = 3, seed_i: int = 11):
    g, _ = _two_state(n=600, seed=seed_g)
    i, _ = _two_state(n=600, seed=seed_i)
    return fit_axis(g, axis="growth"), fit_axis(i, axis="inflation")


def test_joint_probabilities_are_a_distribution_over_the_taxonomy():
    g, i = _two_axes()
    joint = joint_probabilities(g, i, use="filtered")
    assert not joint.empty
    assert set(joint.columns) == set(TAXONOMY.values())
    totals = joint.sum(axis=1)
    assert np.allclose(totals.to_numpy(), 1.0, atol=1e-9)
    assert (joint.to_numpy() >= 0).all()


def test_the_joint_defaults_to_filtered_and_says_so():
    g, i = _two_axes()
    filt = joint_probabilities(g, i, use="filtered")
    smooth = joint_probabilities(g, i, use="smoothed")
    assert not filt.equals(smooth), "the two bases must differ"
    with pytest.raises(ValueError, match="filtered.*smoothed"):
        joint_probabilities(g, i, use="whatever")
    state = build_regime_state(g, i)
    assert "filtered" in state.basis


def test_independence_is_measured_rather_than_assumed():
    g, i = _two_axes()
    check = independence_check(g, i)
    assert check["available"]
    assert set(check["empirical"]) == set(TAXONOMY.values())
    assert 0.0 <= check["max_abs_deviation"] <= 1.0
    assert 0.0 <= check["p_value"] <= 1.0
    # Independently generated axes should not be flagged as dependent.
    assert check["independent_at_5pct"], "independent inputs read as dependent"
    # The empirical joint must be a distribution.
    assert sum(check["empirical"].values()) == pytest.approx(1.0, abs=0.01)


def test_dependent_axes_are_detected():
    """Two axes driven by the same state process must fail the check."""
    y, state = _two_state(n=600)
    shared = pd.Series(np.where(state == 1, 1.5, -1.5) + np.random.default_rng(2).normal(0, .4, len(state)),
                       index=y.index)
    g = fit_axis(y, axis="growth")
    i = fit_axis(shared, axis="inflation")
    check = independence_check(g, i)
    assert check["available"]
    assert not check["independent_at_5pct"], "perfectly coupled axes read as independent"


def test_the_regime_state_reports_change_against_the_previous_month():
    g, i = _two_axes()
    state = build_regime_state(g, i)
    assert state.probabilities and state.previous
    for k in state.probabilities:
        assert state.change[k] == pytest.approx(
            state.probabilities[k] - state.previous[k], abs=1e-6
        )
    assert state.leading in TAXONOMY.values()
    assert state.probabilities[state.leading] == max(state.probabilities.values())
    assert state.expected_duration_months is not None and state.expected_duration_months > 0


def test_an_empty_fit_yields_an_empty_state_rather_than_raising():
    empty = AxisFit(axis="growth", n_states=2, n_obs=0, converged=False, llf=0.0,
                    aic=0.0, bic=0.0, means=[0.0, 0.0], variances=[1.0, 1.0],
                    transition=[[0.5, 0.5], [0.5, 0.5]], expected_duration=[2.0, 2.0],
                    high_state=0, labels=["growth_low", "growth_high"])
    state = build_regime_state(empty, empty)
    assert state.probabilities == {}
    assert "no overlapping" in " ".join(state.notes)


# --- the degeneracy guard ---------------------------------------------------

def test_a_one_state_series_is_reported_degenerate_not_fitted():
    """The failure that reports `converged: True` and means nothing.

    Markov-switching MLE is badly multi-modal. Given data with no regime
    structure it happily returns two states with the same mean and the same
    variance, a near-uniform transition matrix, and a converged flag. Nothing
    in the result object says the answer is vacuous, so the model has to say it.
    """
    rng = np.random.default_rng(5)
    idx = pd.date_range("1960-01-01", periods=400, freq="MS")
    flat = pd.Series(rng.normal(0.0, 1.0, len(idx)), index=idx)
    fit = fit_axis(flat, axis="growth")
    assert fit.degenerate, (
        f"a single-state series fitted as separated states: means {fit.means}, "
        f"separation {fit.separation}"
    )
    # The BIC comparison is what caught it, and it had to be: this same noise
    # fits to a separation of ~0.73 — two plausible-looking states, from a
    # single Gaussian. Any fixed separation threshold low enough to catch it
    # would also reject real regimes, which is why the test is a baseline
    # comparison and not a magic number.
    assert fit.bic >= fit.bic_one_state, "the two-state fit should not beat one state here"
    assert fit.separation > 0.25, (
        "this fixture exists to show separation is NOT a degeneracy test; if it "
        "has become small, pick noise that splits more convincingly"
    )


def test_a_genuinely_two_state_series_is_not_flagged_degenerate():
    y, _ = _two_state(n=600, lo=-2.0, hi=2.0, sd=0.5)
    fit = fit_axis(y, axis="growth")
    assert not fit.degenerate
    assert fit.separation > 1.0
    # And the recovered means really are the ones that were planted.
    assert sorted(round(m, 1) for m in fit.means) == [-2.0, 2.0]


def test_a_degenerate_axis_makes_the_regime_state_say_so():
    rng = np.random.default_rng(5)
    idx = pd.date_range("1960-01-01", periods=400, freq="MS")
    flat = pd.Series(rng.normal(0.0, 1.0, len(idx)), index=idx)
    good, _ = _two_state(n=400, lo=-2.0, hi=2.0, sd=0.5, seed=4)
    state = build_regime_state(fit_axis(flat, axis="growth"),
                               fit_axis(good, axis="inflation"))
    joined = " ".join(state.notes)
    assert "DEGENERATE" in joined
    assert "growth" in joined


# --- reproducibility --------------------------------------------------------

def test_the_fit_is_deterministic_and_ignores_ambient_random_state():
    """The brief requires reproducibility, and statsmodels' own search is not.

    Its `search_reps` gave three different optima from identical data across
    three calls, and perturbing the global `np.random` state changed the answer
    again — meaning TEST ORDER could change a fitted model. The search is owned
    in `_best_of_many` with a seeded Generator so that cannot happen.
    """
    y, _ = _two_state(n=400, lo=-1.2, hi=1.2, sd=0.8, seed=13)
    first = fit_axis(y, axis="growth")
    second = fit_axis(y, axis="growth")
    assert first.llf == second.llf
    assert first.means == second.means
    assert first.transition == second.transition

    np.random.rand(5000)  # perturb the legacy global state
    third = fit_axis(y, axis="growth")
    assert third.llf == first.llf, "ambient random state changed the fit"
    assert third.means == first.means


def test_a_fragile_optimum_is_counted_not_hidden():
    """How many restarts reached the best mode is a fragility measure."""
    y, _ = _two_state(n=600, lo=-2.0, hi=2.0, sd=0.5)
    fit = fit_axis(y, axis="growth")
    assert fit.n_starts > 1
    assert 1 <= fit.n_at_best <= fit.n_starts


# --- the taxonomy gate ------------------------------------------------------

def test_the_taxonomy_is_withheld_when_states_are_not_mean_separated():
    """Volatility regimes must not be handed level names.

    On the real macro factors the fitted states differ by 400x in VARIANCE and
    by 0.17 pooled standard deviations in MEAN. Calling the low-variance state
    "growth_high" and shipping "reflation: 2.8%" would put a level claim on a
    model that estimated no level difference. The gate refuses instead.
    """
    from ace.regime.macro_regime import TAXONOMY_SEPARATION
    # Two states that differ almost entirely in variance, barely in mean.
    rng = np.random.default_rng(3)
    n = 500
    state = np.zeros(n, dtype=int)
    for t in range(1, n):
        state[t] = state[t - 1] if rng.random() < 0.95 else 1 - state[t - 1]
    vals = np.where(state == 1, rng.normal(0.02, 3.0, n), rng.normal(0.0, 0.3, n))
    idx = pd.date_range("1960-01-01", periods=n, freq="MS")
    vol_only = pd.Series(vals, index=idx)

    fit = fit_axis(vol_only, axis="growth")
    assert not fit.mean_separated, (
        f"a variance-only process was judged mean-separated: means {fit.means}, "
        f"separation {fit.separation}"
    )
    assert max(fit.variances) / max(min(fit.variances), 1e-9) > 5, "fixture is not variance-split"

    good, _ = _two_state(n=500, lo=-2.0, hi=2.0, sd=0.5, seed=4)
    state_out = build_regime_state(fit, fit_axis(good, axis="inflation"))
    assert state_out.probabilities == {}, "taxonomy was applied to volatility regimes"
    assert state_out.leading == ""
    joined = " ".join(state_out.notes)
    assert "TAXONOMY WITHHELD" in joined
    assert "growth" in joined and str(TAXONOMY_SEPARATION) in joined
    # The axis diagnostics survive — the fit is still reported, just not named.
    assert state_out.axes["growth"]["separation"] == fit.separation


def test_mean_separated_axes_still_produce_the_taxonomy():
    g, _ = _two_state(n=500, lo=-2.0, hi=2.0, sd=0.5, seed=3)
    i, _ = _two_state(n=500, lo=-2.0, hi=2.0, sd=0.5, seed=11)
    gf, if_ = fit_axis(g, axis="growth"), fit_axis(i, axis="inflation")
    assert gf.mean_separated and if_.mean_separated
    out = build_regime_state(gf, if_)
    assert out.probabilities and out.leading in TAXONOMY.values()
