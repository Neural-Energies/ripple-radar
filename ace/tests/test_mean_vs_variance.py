"""Can the level/volatility discriminator actually tell them apart?

`ace/regime/mean_vs_variance.py` exists because "beats a one-state Gaussian" is
not evidence of a level regime: a series whose mean never moves and whose
variance switches by a factor of ten thousand beats a one-state Gaussian by
thousands of BIC points. The real macro factors do exactly that — credit's
states separate by 0.004 standard deviations in mean and by a factor of 10,180
in variance.

So the discriminator is tested here on THREE synthetic series whose answers are
known by construction, because a discriminator that cannot be shown to
discriminate is just a second opinion:

  1. means move, variance does not          -> level regime
  2. variance moves, mean does not          -> NOT a level regime
  3. one enormous outlier month             -> NOT a level regime

The third is the one that matters most in practice. Growth on the full panel
separates its means by 1.11 SD, which clears every threshold — and holds the
low state for 1.1 months with a 143x variance ratio, because the filter found
April 2020 and gave it a state of its own.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.regime.mean_vs_variance import (
    MIN_BIC_GAIN,
    MIN_MEAN_SEPARATION,
    MIN_REGIME_MONTHS,
    MIN_STATE_VARIANCE_FRACTION,
    assess_factor as run_spec_test,
)


def _markov_states(n: int, persist: float, rng) -> np.ndarray:
    state = np.zeros(n, dtype=int)
    for t in range(1, n):
        state[t] = state[t - 1] if rng.random() < persist else 1 - state[t - 1]
    return state


def _series(values: np.ndarray) -> pd.Series:
    return pd.Series(
        values, index=pd.date_range("1960-01-01", periods=len(values), freq="MS")
    )


def _level_regime(n: int = 600, seed: int = 5) -> pd.Series:
    """Means at -2 and +2, ONE variance. The answer is a level regime."""
    rng = np.random.default_rng(seed)
    state = _markov_states(n, 0.97, rng)
    return _series(np.where(state == 1, 2.0, -2.0) + rng.normal(0, 0.6, n))


def _volatility_regime(n: int = 600, seed: int = 5) -> pd.Series:
    """ONE mean, standard deviations of 0.3 and 3.0. Not a level regime."""
    rng = np.random.default_rng(seed)
    state = _markov_states(n, 0.97, rng)
    return _series(rng.normal(0, 1, n) * np.where(state == 1, 3.0, 0.3))


def _short_lived_state(n: int = 600, seed: int = 5) -> pd.Series:
    """Two well-separated means, where the low one only ever lasts ~2 months.

    This isolates the PERSISTENCE gate, and getting it to do that took a
    correction. The first version of this fixture was a single observation
    twenty standard deviations down — shaped after what the growth factor looks
    like — and it did not test persistence at all: the optimiser gave that one
    point a state with essentially zero variance, so the fit came back
    degenerate and the verdict was INCONCLUSIVE rather than "too short".

    Repeated short episodes with real noise inside them leave the variances
    healthy, so the only thing left for the model to fail on is duration. The
    real growth factor is the same shape and is NOT degenerate: its low-state
    variance is 0.128 of the series variance, against a floor of 1e-8.
    """
    rng = np.random.default_rng(seed)
    state = np.zeros(n, dtype=int)
    for t in range(1, n):
        # Low state leaves quickly (expected ~2.5 months), high state persists.
        stay = 0.98 if state[t - 1] == 0 else 0.60
        state[t] = state[t - 1] if rng.random() < stay else 1 - state[t - 1]
    return _series(np.where(state == 1, -4.0, 0.0) + rng.normal(0, 1.0, n))


def test_a_level_regime_is_found():
    r = run_spec_test(_level_regime(), "synthetic_level")
    assert r.mean_pays, f"mean bought only {r.mean_gain} BIC points"
    assert r.separated, r.mean_separation
    assert r.persistent, r.expected_duration
    assert r.level_regime
    assert r.verdict == "LEVEL REGIME"
    # The means should come back near the planted ones, in some order.
    assert sorted(round(m) for m in r.means) == [-2, 2]


def test_a_volatility_regime_is_not_reported_as_a_level_regime():
    """The failure this whole module exists to prevent."""
    r = run_spec_test(_volatility_regime(), "synthetic_volatility")
    assert not r.level_regime
    assert not r.separated, f"means separated by {r.mean_separation} SD"
    assert r.variance_ratio > 10, r.variance_ratio
    # And it still beats a single Gaussian by a wide margin — which is exactly
    # why beating one is not the test.
    assert r.bic_one_state - r.bic_switching_mean > 50


def test_a_volatility_regime_still_wins_the_naive_comparison():
    """Stated separately because it is the whole argument.

    If this ever fails, the naive one-state comparison has become informative
    and the extra machinery could be dropped. It has not.
    """
    r = run_spec_test(_volatility_regime(), "synthetic_volatility")
    naive_gain = r.bic_one_state - r.bic_switching_mean
    assert naive_gain > MIN_BIC_GAIN
    # Almost all of that gain is the variance, not the mean.
    assert r.variance_share > 0.9, r.variance_share


def test_a_state_that_never_lasts_is_not_a_regime():
    """Separation and a paying mean are not enough without duration."""
    r = run_spec_test(_short_lived_state(), "synthetic_short")
    assert not r.variance_degenerate, r.variances
    assert r.separated, r.mean_separation
    assert not r.persistent, r.expected_duration
    assert min(r.expected_duration) < MIN_REGIME_MONTHS
    assert not r.level_regime
    assert "shortest state" in r.verdict


def test_all_three_conditions_are_required_not_any_one():
    """Each condition alone is satisfiable by something that is not a regime."""
    level = run_spec_test(_level_regime(), "level")
    vol = run_spec_test(_volatility_regime(), "vol")
    short = run_spec_test(_short_lived_state(), "short")
    # Volatility clears persistence but not separation.
    assert vol.persistent and not vol.separated
    # The short-lived state clears separation but not persistence.
    assert short.separated and not short.persistent
    # Only the level series clears all three.
    assert [r.level_regime for r in (level, vol, short)] == [True, False, False]


def test_a_collapsed_state_variance_is_inconclusive_not_a_verdict():
    """A Gaussian mixture's likelihood is unbounded, and the optimiser knows it.

    Drive one state's variance to zero on points it passes exactly and the
    density there goes to infinity, so BIC improves without limit. The
    manufacturing factor did exactly this: variance 1.9e-33, BIC -11,808
    against a one-state baseline of 1,162. Read naively that is the strongest
    row in the table; it is a broken fit, and both BIC figures on it are
    artefacts.

    A series with a run of literally identical values gives the optimiser the
    same opening, so the detector can be tested without waiting for a real
    factor to break.
    """
    rng = np.random.default_rng(4)
    n = 400
    values = rng.normal(0.0, 1.0, n)
    values[100:260] = 0.5  # a long stretch with zero within-state variance
    r = run_spec_test(_series(values), "synthetic_spike")
    assert r.variance_degenerate, r.variances
    assert min(r.variances) < MIN_STATE_VARIANCE_FRACTION * float(np.var(values))
    assert not r.level_regime
    assert r.verdict.startswith("INCONCLUSIVE")


def test_a_healthy_fit_is_not_flagged_degenerate():
    """The floor must not fire on an ordinary two-state series."""
    for series, name in ((_level_regime(), "level"), (_volatility_regime(), "vol")):
        r = run_spec_test(series, name)
        assert not r.variance_degenerate, (name, r.variances)


def test_the_thresholds_are_stated_rather_than_implied():
    assert MIN_MEAN_SEPARATION > 0
    assert MIN_REGIME_MONTHS >= 2
    assert MIN_BIC_GAIN >= 2.0  # Kass-Raftery "positive evidence"
    assert 0 < MIN_STATE_VARIANCE_FRACTION < 1e-4


def test_a_short_series_is_refused_rather_than_fitted():
    with pytest.raises(ValueError, match="observations"):
        run_spec_test(_level_regime(n=60), "too_short")
