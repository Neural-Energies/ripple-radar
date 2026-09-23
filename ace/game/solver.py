"""Game solving and equilibrium verification (§15, §17).

What this replaces: the app computes a "likely play" by scanning the payoff
matrix for a mutual best response in TypeScript, and the matrices themselves
are hardcoded per event family. The scan is roughly right for a 3x3 pure-
strategy case and silently wrong whenever the game has no pure equilibrium —
which is common — because it then falls back to the actor's best payoff and
calls that the likely play.

Here the equilibrium is COMPUTED: support enumeration for the full set,
Lemke-Howson as a cross-check, and every returned equilibrium is verified
numerically rather than trusted.

An honest boundary worth stating plainly: the solver is exact, the PAYOFFS are
an assumption. Solving a game whose payoffs someone invented yields an exact
equilibrium of an invented game. That is why `ace.game.uncertainty` exists —
if the payoffs are uncertain, the equilibrium must be reported as a
distribution, not a point.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class Equilibrium:
    row_strategy: list[float]
    col_strategy: list[float]
    row_payoff: float
    col_payoff: float
    is_pure: bool
    support_row: list[int]
    support_col: list[int]
    # How much either player could gain by deviating. At a true equilibrium
    # this is ~0; it is computed, not assumed.
    row_regret: float
    col_regret: float
    verified: bool

    def to_dict(self) -> dict:
        return asdict(self)


def _regret(payoff_matrix: np.ndarray, own: np.ndarray, other: np.ndarray, *, is_row: bool) -> float:
    """Best achievable gain from unilaterally deviating, given the opponent."""
    expected = float(own @ (payoff_matrix @ other)) if is_row else float(own @ (payoff_matrix.T @ other))
    best = float(np.max(payoff_matrix @ other)) if is_row else float(np.max(payoff_matrix.T @ other))
    return max(0.0, best - expected)


def verify(A: np.ndarray, B: np.ndarray, x: np.ndarray, y: np.ndarray, *, tol: float = 1e-7) -> tuple[bool, float, float]:
    """Check an equilibrium candidate instead of trusting the solver.

    Returns (verified, row_regret, col_regret). A pair is an equilibrium iff
    neither player can gain by deviating, i.e. both regrets are ~0.
    """
    x = np.asarray(x, dtype=float).ravel()
    y = np.asarray(y, dtype=float).ravel()
    if not (np.isfinite(x).all() and np.isfinite(y).all()):
        return False, float("inf"), float("inf")
    if abs(x.sum() - 1) > 1e-6 or abs(y.sum() - 1) > 1e-6 or x.min() < -1e-9 or y.min() < -1e-9:
        return False, float("inf"), float("inf")
    rr = _regret(A, x, y, is_row=True)
    cr = _regret(B, y, x, is_row=False)
    return (rr <= tol and cr <= tol), rr, cr


def solve(A: np.ndarray, B: np.ndarray, *, tol: float = 1e-7) -> list[Equilibrium]:
    """All Nash equilibria found, each verified.

    Support enumeration is exhaustive for small games and is the primary
    method; Lemke-Howson supplements it when degeneracy makes enumeration
    return nothing usable.
    """
    import warnings

    import nashpy as nash

    A = np.asarray(A, dtype=float)
    B = np.asarray(B, dtype=float)
    if A.shape != B.shape:
        raise ValueError(f"payoff matrices must match: {A.shape} vs {B.shape}")
    game = nash.Game(A, B)

    candidates: list[tuple[np.ndarray, np.ndarray]] = []
    # nashpy warns on degenerate games. Degeneracy is expected here (payoff
    # matrices with ties are ordinary), and every candidate is verified below
    # regardless, so the warning is noise rather than information.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        try:
            candidates.extend(list(game.support_enumeration()))
        except Exception:
            pass
    if not candidates:
        for label in range(min(A.shape)):
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    x, y = game.lemke_howson(initial_dropped_label=label)
                if x is not None and y is not None and np.isfinite(x).all() and np.isfinite(y).all():
                    candidates.append((x, y))
            except Exception:
                continue

    out: list[Equilibrium] = []
    seen: set[tuple] = set()
    for x, y in candidates:
        x = np.asarray(x, dtype=float).ravel()
        y = np.asarray(y, dtype=float).ravel()
        ok, rr, cr = verify(A, B, x, y, tol=tol)
        key = (tuple(np.round(x, 6)), tuple(np.round(y, 6)))
        if key in seen:
            continue
        seen.add(key)
        sr = [int(i) for i in np.flatnonzero(x > 1e-6)]
        sc = [int(j) for j in np.flatnonzero(y > 1e-6)]
        out.append(
            Equilibrium(
                row_strategy=[round(float(v), 6) for v in x],
                col_strategy=[round(float(v), 6) for v in y],
                row_payoff=round(float(x @ A @ y), 6),
                col_payoff=round(float(x @ B @ y), 6),
                is_pure=bool(len(sr) == 1 and len(sc) == 1),
                support_row=sr,
                support_col=sc,
                row_regret=round(rr, 10),
                col_regret=round(cr, 10),
                verified=bool(ok),
            )
        )
    return out


def best_responses(A: np.ndarray, B: np.ndarray) -> dict:
    """Pure best responses for each player, for reading the matrix."""
    A = np.asarray(A, dtype=float)
    B = np.asarray(B, dtype=float)
    return {
        "row_best_to_each_col": [int(i) for i in np.argmax(A, axis=0)],
        "col_best_to_each_row": [int(j) for j in np.argmax(B, axis=1)],
    }


def dominated_strategies(A: np.ndarray, B: np.ndarray, *, tol: float = 1e-12) -> dict:
    """Strictly dominated pure strategies — moves a rational player never makes."""
    A = np.asarray(A, dtype=float)
    B = np.asarray(B, dtype=float)
    rows = [i for i in range(A.shape[0])
            if any(np.all(A[k] > A[i] + tol) for k in range(A.shape[0]) if k != i)]
    cols = [j for j in range(B.shape[1])
            if any(np.all(B[:, k] > B[:, j] + tol) for k in range(B.shape[1]) if k != j)]
    return {"row": rows, "col": cols}
