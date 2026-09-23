"""Combining the engines: stacking and Bayesian model averaging (§3).

Classic BMA weights a model by its posterior probability of being *the* true
model. That assumption — that one of the candidates generated the data — is
false here and known to be false, and it has a specific consequence: as the
sample grows, BMA concentrates all weight on a single member. For forecasting,
the better-behaved relative is pseudo-BMA, which weights by expected
out-of-sample log score instead, and stacking, which picks the weights that
directly optimize the combined forecast.

All three are implemented so they can be compared rather than assumed. The
weights are always fitted on out-of-fold predictions: fitting them on
in-sample scores rewards whichever member overfits hardest.

Two pooling rules, because they fail differently. A linear pool averages
probabilities and is systematically under-confident — averaging 0.1 and 0.9
gives 0.5 even when both members are certain and merely disagree about which
way. A logarithmic pool averages log-odds and is sharper, but one member's
confident zero drags the pool to zero. Which is better is an empirical
question, so it is selected on validation data rather than argued about.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize

EPS = 1e-6


@dataclass
class EnsembleWeights:
    members: list[str]
    weights: np.ndarray
    method: str
    pool: str
    validation_log_score: float

    def as_dict(self) -> dict:
        return {
            "method": self.method, "pool": self.pool,
            "validation_log_score": round(self.validation_log_score, 6),
            "weights": {m: round(float(w), 4) for m, w in zip(self.members, self.weights)},
        }


def _clean(p: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)


def linear_pool(P: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Weighted arithmetic mean of probabilities."""
    return _clean(_clean(P) @ w)


def log_pool(P: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Weighted geometric mean of odds, renormalized."""
    p = _clean(P)
    z = np.log(p / (1 - p)) @ w
    return _clean(1 / (1 + np.exp(-z)))


POOLS = {"linear": linear_pool, "log": log_pool}


def log_score(y: np.ndarray, p: np.ndarray) -> float:
    """Mean log predictive density. Higher is better."""
    y = np.asarray(y, dtype=float)
    p = _clean(p)
    return float(np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def equal_weights(n: int) -> np.ndarray:
    return np.full(n, 1.0 / n)


def stacking_weights(y: np.ndarray, P: np.ndarray, *, pool: str = "linear") -> np.ndarray:
    """Simplex weights that maximize the combined out-of-fold log score."""
    n_members = P.shape[1]
    fn = POOLS[pool]

    def objective(raw):
        w = np.exp(raw - raw.max())
        w /= w.sum()
        return -log_score(y, fn(P, w))

    best, best_val = None, np.inf
    # Several starts: the softmax parameterization is smooth but not convex.
    for start in [np.zeros(n_members)] + [np.eye(n_members)[i] * 2 for i in range(n_members)]:
        res = minimize(objective, start, method="Nelder-Mead",
                       options={"maxiter": 4000, "fatol": 1e-10, "xatol": 1e-8})
        if res.fun < best_val:
            best_val, best = res.fun, res.x
    w = np.exp(best - best.max())
    return w / w.sum()


def pseudo_bma_weights(y: np.ndarray, P: np.ndarray) -> np.ndarray:
    """Weights proportional to exp(expected out-of-sample log score).

    The forecasting-friendly cousin of BMA: it never needs the true model to be
    in the set, and it degrades to near-equal weights when members perform
    alike instead of collapsing onto one.
    """
    elpd = np.array([log_score(y, P[:, k]) * len(y) for k in range(P.shape[1])])
    w = np.exp(elpd - elpd.max())
    return w / w.sum()


def bma_weights_bic(y: np.ndarray, P: np.ndarray, n_params: list[int] | None = None) -> np.ndarray:
    """Classic BMA via BIC. Included to show what it does, not because it is best."""
    n = len(y)
    k = n_params or [1] * P.shape[1]
    bic = np.array([-2 * log_score(y, P[:, j]) * n + k[j] * np.log(n)
                    for j in range(P.shape[1])])
    w = np.exp(-0.5 * (bic - bic.min()))
    return w / w.sum()


def fit_ensemble(y: np.ndarray, P: np.ndarray, members: list[str]) -> EnsembleWeights:
    """Choose method and pooling rule on the same out-of-fold predictions.

    Equal weights is a real candidate and frequently wins: with few members and
    a noisy validation window, fitted weights are mostly fitting the noise.
    """
    y = np.asarray(y, dtype=float)
    candidates: list[EnsembleWeights] = []
    for pool in POOLS:
        for name, w in (
            ("equal", equal_weights(P.shape[1])),
            ("stacking", stacking_weights(y, P, pool=pool)),
            ("pseudo_bma", pseudo_bma_weights(y, P)),
            ("bma_bic", bma_weights_bic(y, P)),
        ):
            score = log_score(y, POOLS[pool](P, w))
            candidates.append(EnsembleWeights(members, w, name, pool, score))
    candidates.sort(key=lambda c: -c.validation_log_score)
    return candidates[0]


def apply_ensemble(weights: EnsembleWeights, P: np.ndarray) -> np.ndarray:
    return POOLS[weights.pool](P, weights.weights)
