"""Causal effect estimation once the effect is identified (§3 Engine 4).

Three estimators of the average treatment effect, deliberately kept separate
so they can disagree. When regression adjustment, inverse-propensity weighting
and the doubly-robust combination land in the same place, the estimate rests
on something; when they diverge, one of the two nuisance models is wrong and
the divergence is the finding.

The doubly-robust estimator (AIPW) is consistent if EITHER the outcome model
or the propensity model is right. It is cross-fitted — nuisance models are
trained on one fold and applied to another — because plugging in-sample
machine-learned predictions into the influence function biases the estimate
toward zero variance and away from the truth.

Overlap is reported, never assumed. If treated and untreated units do not
share a region of covariate space, no adjustment can compare them, and the
honest output is the warning rather than a tighter interval.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.model_selection import KFold


class OverlapFailure(Exception):
    """Treated and untreated units do not share covariate space."""


@dataclass
class EffectEstimate:
    estimator: str
    ate: float
    ci_low: float = float("nan")
    ci_high: float = float("nan")
    n: int = 0
    n_treated: int = 0
    diagnostics: dict = field(default_factory=dict)

    def excludes_zero(self) -> bool:
        return np.isfinite(self.ci_low) and np.isfinite(self.ci_high) and (
            (self.ci_low > 0) or (self.ci_high < 0)
        )

    def to_dict(self) -> dict:
        return {
            "estimator": self.estimator, "ate": round(self.ate, 6),
            "ci": [round(self.ci_low, 6), round(self.ci_high, 6)],
            "n": self.n, "n_treated": self.n_treated,
            "excludes_zero": self.excludes_zero(), "diagnostics": self.diagnostics,
        }


def _as_arrays(y, t, z):
    y = np.asarray(y, dtype=float).ravel()
    t = np.asarray(t, dtype=float).ravel()
    z = np.zeros((len(y), 0)) if z is None else np.asarray(z, dtype=float)
    if z.ndim == 1:
        z = z.reshape(-1, 1)
    if not (len(y) == len(t) == len(z)):
        raise ValueError(f"length mismatch: y={len(y)} t={len(t)} z={len(z)}")
    if not set(np.unique(t)) <= {0.0, 1.0}:
        raise ValueError("treatment must be binary 0/1")
    return y, t, z


def _outcome_model(flexible: bool):
    return GradientBoostingRegressor(random_state=0) if flexible else LinearRegression()


def _propensity_model(flexible: bool):
    return (GradientBoostingClassifier(random_state=0) if flexible
            else LogisticRegression(max_iter=2000))


def overlap_report(propensity: np.ndarray, t: np.ndarray, *, floor: float = 0.02) -> dict:
    """How far the propensity distribution is from being comparable."""
    p = np.asarray(propensity, dtype=float)
    w = np.where(t == 1, 1 / np.clip(p, 1e-6, 1), 1 / np.clip(1 - p, 1e-6, 1))
    ess = float(w.sum() ** 2 / np.sum(w ** 2))
    return {
        "propensity_min": round(float(p.min()), 5),
        "propensity_max": round(float(p.max()), 5),
        "share_below_floor": round(float(np.mean(p < floor)), 5),
        "share_above_ceiling": round(float(np.mean(p > 1 - floor)), 5),
        "effective_sample_size": round(ess, 1),
        "n": int(len(p)),
        "ess_fraction": round(ess / len(p), 4),
    }


def regression_adjustment(y, t, z, *, flexible: bool = False) -> EffectEstimate:
    """g-computation: model E[Y | T, Z], then average Y(1) - Y(0) over the sample."""
    y, t, z = _as_arrays(y, t, z)
    x = np.column_stack([t, z])
    model = _outcome_model(flexible).fit(x, y)
    mu1 = model.predict(np.column_stack([np.ones_like(t), z]))
    mu0 = model.predict(np.column_stack([np.zeros_like(t), z]))
    return EffectEstimate("regression_adjustment", float(np.mean(mu1 - mu0)),
                          n=len(y), n_treated=int(t.sum()))


def ipw(y, t, z, *, flexible: bool = False, floor: float = 0.02,
        require_overlap: bool = True) -> EffectEstimate:
    """Inverse-propensity weighting, with the overlap check as a gate."""
    y, t, z = _as_arrays(y, t, z)
    if z.shape[1] == 0:
        p = np.full(len(t), float(t.mean()))
    else:
        p = _propensity_model(flexible).fit(z, t).predict_proba(z)[:, 1]
    rep = overlap_report(p, t, floor=floor)
    if require_overlap and (rep["share_below_floor"] > 0.05 or rep["share_above_ceiling"] > 0.05):
        raise OverlapFailure(
            f"propensity outside [{floor}, {1 - floor}] for "
            f"{rep['share_below_floor'] + rep['share_above_ceiling']:.1%} of units — "
            "treated and untreated units do not share covariate space"
        )
    pc = np.clip(p, floor, 1 - floor)
    # Hajek (self-normalized) form: unbiased under correct propensities and far
    # less volatile than the raw Horvitz-Thompson ratio in finite samples.
    w1, w0 = t / pc, (1 - t) / (1 - pc)
    ate = float(np.sum(w1 * y) / np.sum(w1) - np.sum(w0 * y) / np.sum(w0))
    return EffectEstimate("ipw", ate, n=len(y), n_treated=int(t.sum()), diagnostics=rep)


def aipw(y, t, z, *, flexible: bool = True, n_splits: int = 5, floor: float = 0.02,
         seed: int = 0) -> EffectEstimate:
    """Cross-fitted doubly-robust ATE with an influence-function interval."""
    y, t, z = _as_arrays(y, t, z)
    n = len(y)
    if z.shape[1] == 0:
        diff = y[t == 1].mean() - y[t == 0].mean()
        se = np.sqrt(y[t == 1].var(ddof=1) / max(1, (t == 1).sum())
                     + y[t == 0].var(ddof=1) / max(1, (t == 0).sum()))
        return EffectEstimate("aipw", float(diff), float(diff - 1.96 * se),
                              float(diff + 1.96 * se), n, int(t.sum()),
                              {"note": "no covariates — difference in means"})

    mu1 = np.zeros(n)
    mu0 = np.zeros(n)
    p = np.zeros(n)
    folds = KFold(n_splits=n_splits, shuffle=True, random_state=seed)
    for train, test in folds.split(z):
        # Nuisances fitted on the complement of the fold they score.
        om = _outcome_model(flexible).fit(np.column_stack([t[train], z[train]]), y[train])
        mu1[test] = om.predict(np.column_stack([np.ones(len(test)), z[test]]))
        mu0[test] = om.predict(np.column_stack([np.zeros(len(test)), z[test]]))
        pm = _propensity_model(flexible).fit(z[train], t[train])
        p[test] = pm.predict_proba(z[test])[:, 1]

    rep = overlap_report(p, t, floor=floor)
    pc = np.clip(p, floor, 1 - floor)
    influence = (mu1 - mu0) + t * (y - mu1) / pc - (1 - t) * (y - mu0) / (1 - pc)
    ate = float(influence.mean())
    se = float(influence.std(ddof=1) / np.sqrt(n))
    return EffectEstimate("aipw", ate, ate - 1.96 * se, ate + 1.96 * se, n, int(t.sum()),
                          {**rep, "influence_se": round(se, 6), "n_splits": n_splits})


def bootstrap_effect(estimator, y, t, z, *, n_boot: int = 400, seed: int = 0,
                     block: int | None = None, **kwargs) -> EffectEstimate:
    """Percentile CI by resampling. `block` keeps serial dependence intact."""
    y, t, z = _as_arrays(y, t, z)
    point = estimator(y, t, z, **kwargs)
    rng = np.random.default_rng(seed)
    n = len(y)
    draws = []
    for _ in range(n_boot):
        if block:
            starts = rng.integers(0, max(1, n - block + 1), size=int(np.ceil(n / block)))
            idx = np.concatenate([np.arange(s, min(s + block, n)) for s in starts])[:n]
        else:
            idx = rng.integers(0, n, size=n)
        if len(np.unique(t[idx])) < 2:
            continue
        try:
            draws.append(estimator(y[idx], t[idx], z[idx], **kwargs).ate)
        except Exception:
            continue
    if len(draws) < n_boot // 4:
        return point
    point.ci_low = float(np.quantile(draws, 0.025))
    point.ci_high = float(np.quantile(draws, 0.975))
    point.diagnostics = {**point.diagnostics, "n_bootstrap": len(draws),
                         "block": block or "iid"}
    return point
