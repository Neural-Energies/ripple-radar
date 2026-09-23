"""Refutation tests — the part that makes a causal estimate reportable (§3).

An adjusted estimate is a number whatever the data says. These tests are the
cheap ways to find out it is wrong before anyone acts on it.

  placebo         shuffle the treatment. If the "effect" survives, the
                  estimate is picking up structure that has nothing to do
                  with the treatment, and the pipeline is broken.
  common cause    add a covariate known to be irrelevant. A correct estimator
                  ignores it; a fragile one moves.
  subset          re-estimate on random subsets. A real effect is present in
                  the parts; an artefact of a few rows is not.
  sensitivity     the only one that addresses the untestable assumption. It
                  answers: how strongly would an unmeasured confounder have to
                  act on both treatment and outcome to explain this away?

The first three can only find faults; passing them is not proof. The
sensitivity analysis is the one that bounds the assumption, which is why it is
reported as a number rather than a verdict.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Refutation:
    name: str
    original: float
    refuted: float
    passed: bool
    detail: str

    def to_dict(self) -> dict:
        return {"test": self.name, "original": round(self.original, 6),
                "refuted": round(self.refuted, 6), "passed": self.passed,
                "detail": self.detail}


def _run(estimator, y, t, z, **kwargs) -> float:
    return estimator(y, t, z, **kwargs).ate


def placebo_treatment(estimator, y, t, z, *, original: float, n_sim: int = 30,
                      seed: int = 0, **kwargs) -> Refutation:
    """Permute the treatment. The effect must collapse toward zero."""
    rng = np.random.default_rng(seed)
    t = np.asarray(t, dtype=float)
    draws = []
    for _ in range(n_sim):
        try:
            draws.append(_run(estimator, y, rng.permutation(t), z, **kwargs))
        except Exception:
            continue
    if not draws:
        return Refutation("placebo", original, float("nan"), False, "no placebo run completed")
    mean = float(np.mean(draws))
    spread = float(np.std(draws, ddof=1)) if len(draws) > 1 else 0.0
    # The placebo effect must be small relative to the real one AND consistent
    # with zero given its own spread.
    ratio = abs(mean) / abs(original) if original else np.inf
    passed = bool(ratio < 0.2 and abs(mean) <= 2 * spread + 1e-12)
    return Refutation(
        "placebo", original, mean, passed,
        f"permuted treatment gives {mean:+.5f} (sd {spread:.5f}) vs {original:+.5f} — "
        f"{ratio:.1%} of the original",
    )


def random_common_cause(estimator, y, t, z, *, original: float, n_sim: int = 20,
                        seed: int = 0, tolerance: float = 0.15, **kwargs) -> Refutation:
    """Add an irrelevant covariate. A sound estimate does not move."""
    rng = np.random.default_rng(seed)
    z = np.zeros((len(y), 0)) if z is None else np.asarray(z, dtype=float)
    if z.ndim == 1:
        z = z.reshape(-1, 1)
    draws = []
    for _ in range(n_sim):
        noise = rng.normal(size=(len(y), 1))
        try:
            draws.append(_run(estimator, y, t, np.column_stack([z, noise]), **kwargs))
        except Exception:
            continue
    if not draws:
        return Refutation("random_common_cause", original, float("nan"), False, "no run completed")
    mean = float(np.mean(draws))
    drift = abs(mean - original) / abs(original) if original else np.inf
    return Refutation(
        "random_common_cause", original, mean, bool(drift < tolerance),
        f"adding an irrelevant covariate moves the estimate {drift:.1%} "
        f"({original:+.5f} -> {mean:+.5f})",
    )


def subset_refuter(estimator, y, t, z, *, original: float, fraction: float = 0.7,
                   n_sim: int = 20, seed: int = 0, tolerance: float = 0.25,
                   **kwargs) -> Refutation:
    """Re-estimate on random subsets. A real effect is present in the parts."""
    rng = np.random.default_rng(seed)
    y = np.asarray(y, dtype=float)
    t = np.asarray(t, dtype=float)
    z = np.zeros((len(y), 0)) if z is None else np.asarray(z, dtype=float)
    if z.ndim == 1:
        z = z.reshape(-1, 1)
    n = len(y)
    k = max(2, int(n * fraction))
    draws = []
    for _ in range(n_sim):
        idx = rng.choice(n, size=k, replace=False)
        if len(np.unique(t[idx])) < 2:
            continue
        try:
            draws.append(_run(estimator, y[idx], t[idx], z[idx], **kwargs))
        except Exception:
            continue
    if not draws:
        return Refutation("subset", original, float("nan"), False, "no subset run completed")
    mean = float(np.mean(draws))
    drift = abs(mean - original) / abs(original) if original else np.inf
    return Refutation(
        "subset", original, mean, bool(drift < tolerance),
        f"{int(fraction * 100)}% subsets average {mean:+.5f} vs {original:+.5f} "
        f"({drift:.1%} drift)",
    )


def sensitivity_to_unobserved_confounder(
    estimator, y, t, z, *, original: float, strengths=(0.25, 0.5, 1.0, 1.5, 2.0),
    seed: int = 0, **kwargs
) -> dict:
    """How strong must a hidden confounder be to explain the effect away?

    Simulates a latent U acting on both treatment and outcome with equal
    standardized strength, re-estimates at each level, and reports the level
    at which the estimate first crosses zero. No crossing within the grid
    means the effect is robust to a confounder at least as strong as the
    largest level tested.

    The strengths are in units of the outcome's own standard deviation, so
    "1.0" means a confounder that moves the outcome as much as one standard
    deviation and shifts treatment odds by the same amount — usually far
    stronger than anything plausibly omitted.
    """
    rng = np.random.default_rng(seed)
    y = np.asarray(y, dtype=float).ravel()
    t = np.asarray(t, dtype=float).ravel()
    z = np.zeros((len(y), 0)) if z is None else np.asarray(z, dtype=float)
    if z.ndim == 1:
        z = z.reshape(-1, 1)
    sd = float(np.std(y)) or 1.0

    rows = []
    breaking = None
    for s in strengths:
        # U is correlated with the treatment by construction; removing its
        # effect from y is what a correct adjustment would have done.
        u = rng.normal(size=len(y)) + s * (t - t.mean())
        y_adj = y - s * sd * (u - u.mean()) / (np.std(u) or 1.0)
        try:
            est = _run(estimator, y_adj, t, z, **kwargs)
        except Exception:
            continue
        rows.append({"strength": s, "ate": round(float(est), 6)})
        if breaking is None and np.sign(est) != np.sign(original):
            breaking = s

    return {
        "original": round(original, 6),
        "grid": rows,
        "sign_flips_at": breaking,
        "robust_to": None if breaking else (max(strengths) if rows else None),
        "note": (
            f"a confounder of strength {breaking} sigma flips the sign"
            if breaking else
            f"no confounder up to {max(strengths)} sigma on both treatment and "
            "outcome reverses the estimate"
        ),
    }


def refute_all(estimator, y, t, z, *, original: float, seed: int = 0, **kwargs) -> dict:
    tests = [
        placebo_treatment(estimator, y, t, z, original=original, seed=seed, **kwargs),
        random_common_cause(estimator, y, t, z, original=original, seed=seed, **kwargs),
        subset_refuter(estimator, y, t, z, original=original, seed=seed, **kwargs),
    ]
    sens = sensitivity_to_unobserved_confounder(
        estimator, y, t, z, original=original, seed=seed, **kwargs
    )
    return {
        "tests": [r.to_dict() for r in tests],
        "all_passed": all(r.passed for r in tests),
        "sensitivity": sens,
    }
