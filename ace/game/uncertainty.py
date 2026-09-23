"""Equilibrium under payoff uncertainty (§16).

Real payoffs are not known. Reporting a single equilibrium of a matrix someone
estimated implies a precision nobody has. So the payoffs are treated as
distributions, the game is re-solved across draws, and the output is the
FREQUENCY with which each strategy appears in equilibrium:

    Escalate     61%
    Probe        29%
    Stand down   10%

Those percentages come from counting simulations, not from judgement. The
distributions themselves remain an assumption, and are recorded alongside the
result so the assumption is visible.
"""
from __future__ import annotations

import numpy as np

from ace.game.solver import solve


def simulate(
    A_mean: np.ndarray,
    B_mean: np.ndarray,
    *,
    sigma: float | np.ndarray = 0.5,
    n_sims: int = 2000,
    seed: int = 17,
    convergence_check: bool = True,
) -> dict:
    """Re-solve the game across payoff draws and count equilibrium strategies.

    `sigma` is the standard deviation of the payoff perturbation, scalar or
    per-cell. Seeded, so a reported frequency is reproducible.
    """
    A_mean = np.asarray(A_mean, dtype=float)
    B_mean = np.asarray(B_mean, dtype=float)
    n_rows, n_cols = A_mean.shape
    rng = np.random.default_rng(seed)
    sig = np.full_like(A_mean, float(sigma)) if np.isscalar(sigma) else np.asarray(sigma, dtype=float)

    row_mass = np.zeros(n_rows)
    col_mass = np.zeros(n_cols)
    solved = 0
    pure_count = 0
    running: list[np.ndarray] = []

    for _ in range(n_sims):
        A = A_mean + rng.normal(0, sig)
        B = B_mean + rng.normal(0, sig)
        eqs = [e for e in solve(A, B) if e.verified]
        if not eqs:
            continue
        solved += 1
        # Average across multiple equilibria in a draw rather than picking one,
        # so a game with several does not get an arbitrary tie-break.
        x = np.mean([e.row_strategy for e in eqs], axis=0)
        y = np.mean([e.col_strategy for e in eqs], axis=0)
        row_mass += x
        col_mass += y
        pure_count += sum(1 for e in eqs if e.is_pure) / len(eqs)
        if convergence_check and solved % 100 == 0:
            running.append(row_mass / solved)

    if solved == 0:
        return {"available": False, "reason": "no verified equilibrium in any draw", "n_sims": n_sims}

    row_freq = row_mass / solved
    col_freq = col_mass / solved

    # Convergence: how much the estimate still moved over the last few
    # checkpoints. Reported rather than assuming a round number of sims.
    convergence = None
    if len(running) >= 3:
        convergence = float(np.max(np.abs(running[-1] - running[-2])))

    return {
        "available": True,
        "n_sims": int(n_sims),
        "n_solved": int(solved),
        "row_equilibrium_frequency": [round(float(v), 4) for v in row_freq],
        "col_equilibrium_frequency": [round(float(v), 4) for v in col_freq],
        "share_pure": round(float(pure_count / solved), 4),
        "sigma": float(sigma) if np.isscalar(sigma) else "per-cell",
        "seed": int(seed),
        "convergence_delta": None if convergence is None else round(convergence, 5),
        "basis": "counted over re-solved games; payoff distributions are an assumption",
    }
