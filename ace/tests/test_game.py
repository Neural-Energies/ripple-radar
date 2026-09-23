"""Game solver tests against games with known closed-form answers (§17).

Unlike a forecasting model, a solver has ground truth: the equilibria of
Prisoner's Dilemma, Matching Pennies and Battle of the Sexes are textbook. If
the solver cannot reproduce those it cannot be trusted on a constructed
geopolitical game where nobody knows the answer.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.game.solver import dominated_strategies, solve, verify
from ace.game.uncertainty import simulate


def test_prisoners_dilemma_has_the_unique_defect_equilibrium():
    A = np.array([[3, 0], [5, 1]], dtype=float)
    B = np.array([[3, 5], [0, 1]], dtype=float)
    eqs = solve(A, B)
    assert len(eqs) == 1
    e = eqs[0]
    assert e.is_pure and e.verified
    assert e.row_strategy == [0.0, 1.0] and e.col_strategy == [0.0, 1.0]
    assert e.row_regret == 0.0 and e.col_regret == 0.0


def test_cooperate_is_strictly_dominated_in_prisoners_dilemma():
    A = np.array([[3, 0], [5, 1]], dtype=float)
    B = np.array([[3, 5], [0, 1]], dtype=float)
    assert dominated_strategies(A, B) == {"row": [0], "col": [0]}


def test_matching_pennies_is_exactly_fifty_fifty_and_has_no_pure_equilibrium():
    """The case a best-response scan gets wrong.

    Matching Pennies has no pure equilibrium at all, so a routine that looks
    for a mutual best-response cell finds nothing and must not fall back to
    'whichever cell pays the row player most' and call it the likely play.
    """
    A = np.array([[1, -1], [-1, 1]], dtype=float)
    B = -A
    eqs = solve(A, B)
    assert len(eqs) == 1
    e = eqs[0]
    assert not e.is_pure
    assert np.allclose(e.row_strategy, [0.5, 0.5], atol=1e-9)
    assert np.allclose(e.col_strategy, [0.5, 0.5], atol=1e-9)
    assert e.verified


def test_battle_of_the_sexes_has_two_pure_and_one_mixed_equilibrium():
    A = np.array([[3, 0], [0, 2]], dtype=float)
    B = np.array([[2, 0], [0, 3]], dtype=float)
    eqs = solve(A, B)
    assert len(eqs) == 3
    assert sum(1 for e in eqs for _ in [0] if e.is_pure) == 2
    mixed = [e for e in eqs if not e.is_pure][0]
    assert np.allclose(mixed.row_strategy, [0.6, 0.4], atol=1e-6)
    assert np.allclose(mixed.col_strategy, [0.4, 0.6], atol=1e-6)
    assert all(e.verified for e in eqs)


def test_every_returned_equilibrium_has_zero_regret():
    rng = np.random.default_rng(3)
    for _ in range(8):
        A = rng.normal(size=(3, 3))
        B = rng.normal(size=(3, 3))
        for e in solve(A, B):
            if e.verified:
                assert e.row_regret < 1e-6 and e.col_regret < 1e-6


def test_verify_rejects_a_non_equilibrium():
    A = np.array([[3, 0], [5, 1]], dtype=float)
    B = np.array([[3, 5], [0, 1]], dtype=float)
    ok, rr, cr = verify(A, B, np.array([1.0, 0.0]), np.array([1.0, 0.0]))
    assert not ok and rr > 0  # both cooperating is not an equilibrium


def test_verify_rejects_a_vector_that_is_not_a_distribution():
    A = np.eye(2)
    ok, _, _ = verify(A, A, np.array([0.7, 0.7]), np.array([0.5, 0.5]))
    assert not ok


def test_mismatched_payoff_matrices_are_refused():
    with pytest.raises(ValueError):
        solve(np.zeros((2, 2)), np.zeros((3, 3)))


# ------------------------------------------------------------- uncertainty --
def test_zero_uncertainty_reproduces_the_deterministic_equilibrium():
    A = np.array([[3, 0], [5, 1]], dtype=float)
    B = np.array([[3, 5], [0, 1]], dtype=float)
    s = simulate(A, B, sigma=0.0, n_sims=100, seed=1)
    assert s["available"]
    assert np.allclose(s["row_equilibrium_frequency"], [0.0, 1.0], atol=1e-9)


def test_more_payoff_uncertainty_spreads_the_equilibrium_distribution():
    A = np.array([[-1, 3, 4], [1, 2, 0], [-2, 0, -3]], dtype=float)
    B = np.array([[2, -2, -4], [1, -1, -2], [2, 1, 2]], dtype=float)
    tight = simulate(A, B, sigma=0.2, n_sims=300, seed=2)
    loose = simulate(A, B, sigma=2.0, n_sims=300, seed=2)

    def entropy(p):
        p = np.asarray(p, dtype=float)
        p = p[p > 1e-12]
        return float(-np.sum(p * np.log(p)))

    assert entropy(loose["row_equilibrium_frequency"]) > entropy(tight["row_equilibrium_frequency"])


def test_equilibrium_frequencies_are_a_distribution():
    A = np.array([[-1, 3, 4], [1, 2, 0], [-2, 0, -3]], dtype=float)
    B = np.array([[2, -2, -4], [1, -1, -2], [2, 1, 2]], dtype=float)
    s = simulate(A, B, sigma=1.0, n_sims=300, seed=5)
    for key in ("row_equilibrium_frequency", "col_equilibrium_frequency"):
        f = np.asarray(s[key])
        assert abs(f.sum() - 1.0) < 1e-6
        assert (f >= -1e-9).all()


def test_simulation_is_reproducible_from_its_seed():
    A = np.array([[1, 2], [3, 0]], dtype=float)
    B = np.array([[2, 1], [0, 3]], dtype=float)
    a = simulate(A, B, sigma=1.0, n_sims=200, seed=9)
    b = simulate(A, B, sigma=1.0, n_sims=200, seed=9)
    assert a["row_equilibrium_frequency"] == b["row_equilibrium_frequency"]
