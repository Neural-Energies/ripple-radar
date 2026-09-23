"""Block bootstrap confidence intervals (§38).

Daily financial observations are serially dependent, so an ordinary bootstrap
that resamples single rows understates the variance and makes a marginal AUC
look decisive. Resampling contiguous blocks preserves the local dependence.
"""
from __future__ import annotations

import numpy as np


def block_bootstrap_ci(
    y: np.ndarray,
    p: np.ndarray,
    statistic,
    *,
    n_boot: int = 1000,
    block: int = 20,
    alpha: float = 0.05,
    seed: int = 17,
) -> dict:
    """Percentile CI for `statistic(y, p)` using a moving-block bootstrap."""
    y = np.asarray(y, dtype=float).ravel()
    p = np.asarray(p, dtype=float).ravel()
    n = len(y)
    if n < block * 2:
        block = max(1, n // 4)
    rng = np.random.default_rng(seed)
    n_blocks = int(np.ceil(n / block))
    draws: list[float] = []
    for _ in range(n_boot):
        starts = rng.integers(0, max(1, n - block + 1), size=n_blocks)
        idx = np.concatenate([np.arange(s, min(s + block, n)) for s in starts])[:n]
        yb, pb = y[idx], p[idx]
        if len(np.unique(yb)) < 2:
            continue
        try:
            draws.append(float(statistic(yb, pb)))
        except Exception:
            continue
    if not draws:
        return {"point": float("nan"), "lo": float("nan"), "hi": float("nan"), "n_boot": 0}
    arr = np.asarray(draws)
    return {
        "point": round(float(statistic(y, p)), 6),
        "lo": round(float(np.quantile(arr, alpha / 2)), 6),
        "hi": round(float(np.quantile(arr, 1 - alpha / 2)), 6),
        "n_boot": len(draws),
    }
