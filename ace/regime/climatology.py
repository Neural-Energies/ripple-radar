"""WP3's exit condition: score a regime probability against climatology.

WP3 (`ace.regime.mean_vs_variance`) answers "does this factor have a level
regime at all" — a structural question about the fitted model. It has never
been asked the PREDICTIVE question the original work planned to close with:
does knowing the regime probability actually forecast anything better than
just assuming history repeats its average (climatology)? This module is that
missing scorer. `ace.regime.level_regime_validation` is what calls it, on
real point-in-time anchors.

BRIER SCORE, NOT ACCURACY

A probability forecast is not scored well by thresholding it into a
right/wrong count — a model saying "60%" and being wrong is a worse forecast
than one saying "51%" and being wrong, and accuracy cannot see that
difference. Brier score (mean squared error between a probability forecast
and the 0/1 outcome) can, which is why it is the standard scoring rule for
this class of problem (climatology-relative Brier skill is standard practice
in meteorological and macro nowcasting forecast evaluation alike).

CLIMATOLOGY MEANS "THE HISTORICAL BASE RATE, KNOWN AT THE TIME"

The climatology baseline for a given anchor is the share of past transitions
that were "up", computed from data available AT that anchor — never the
share within the evaluation sample itself, which would make climatology
look artificially sharp by peeking at the very outcomes it is being scored
against. `ace.regime.level_regime_validation` is responsible for building
each `AnchorReading`'s `climatology_probability` this way; this module only
scores what it is handed.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class AnchorReading:
    """One point-in-time prediction and the outcome once it was known."""

    as_of: str
    model_probability: float
    climatology_probability: float
    outcome: float  # 0.0 or 1.0


def brier_score(outcomes: np.ndarray, probabilities: np.ndarray) -> float:
    """Mean squared error between a 0/1 outcome and a probability forecast."""
    y = np.asarray(outcomes, dtype=float).ravel()
    p = np.asarray(probabilities, dtype=float).ravel()
    if len(y) == 0:
        return float("nan")
    return float(np.mean((y - p) ** 2))


def _paired_bootstrap_ci(
    rows: list[tuple[float, float, float]],
    statistic,
    *,
    n_boot: int = 2000,
    alpha: float = 0.05,
    seed: int = 17,
) -> dict:
    """Percentile CI for `statistic(outcomes, model_p, clim_p)` by i.i.d.
    resampling of the (outcome, model_p, clim_p) rows.

    `ace.metrics.bootstrap.block_bootstrap_ci` resamples contiguous BLOCKS to
    preserve serial dependence in a daily return series. The anchors here are
    a handful of point-in-time regime refits spaced years apart — there is no
    meaningful within-anchor autocorrelation structure to preserve, so a
    plain i.i.d. row bootstrap is the correctly-matched tool, not a
    duplication of the block one. Rows are also 3-wide (outcome + two
    probabilities); `block_bootstrap_ci`'s signature only takes two arrays.
    """
    n = len(rows)
    if n == 0:
        return {"point": float("nan"), "lo": float("nan"), "hi": float("nan"), "n_boot": 0, "n_anchors": 0}
    arr = np.asarray(rows, dtype=float)
    rng = np.random.default_rng(seed)
    draws: list[float] = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, size=n)
        sample = arr[idx]
        try:
            draws.append(float(statistic(sample[:, 0], sample[:, 1], sample[:, 2])))
        except Exception:
            continue
    point = float(statistic(arr[:, 0], arr[:, 1], arr[:, 2]))
    if not draws:
        return {"point": round(point, 6), "lo": float("nan"), "hi": float("nan"), "n_boot": 0, "n_anchors": n}
    boot = np.asarray(draws)
    return {
        "point": round(point, 6),
        "lo": round(float(np.quantile(boot, alpha / 2)), 6),
        "hi": round(float(np.quantile(boot, 1 - alpha / 2)), 6),
        "n_boot": len(draws),
        "n_anchors": n,
    }


def skill_report(readings: list[AnchorReading], *, n_boot: int = 2000, seed: int = 17) -> dict:
    """Does the model's probability beat its own point-in-time climatology?

    `skill` is `climatology_brier - model_brier`: positive means the model's
    forecast was closer to the truth than always guessing the historical base
    rate. The bootstrap CI is on that SAME difference, resampled across
    anchors — a lower bound above zero is the honest bar for "improves on
    climatology", not just a positive point estimate, which with this few
    anchors could easily be noise.
    """
    if not readings:
        return {
            "n_anchors": 0, "model_brier": None, "climatology_brier": None,
            "skill": None, "ci": None, "verdict": "no anchors produced a reading",
        }

    outcomes = np.array([r.outcome for r in readings], dtype=float)
    model_p = np.array([r.model_probability for r in readings], dtype=float)
    clim_p = np.array([r.climatology_probability for r in readings], dtype=float)

    model_brier = brier_score(outcomes, model_p)
    climatology_brier = brier_score(outcomes, clim_p)
    skill = climatology_brier - model_brier

    def _skill_stat(y, p_model, p_clim):
        return brier_score(y, p_clim) - brier_score(y, p_model)

    rows = list(zip(outcomes.tolist(), model_p.tolist(), clim_p.tolist()))
    ci = _paired_bootstrap_ci(rows, _skill_stat, n_boot=n_boot, seed=seed)

    if ci["n_boot"] == 0 or not np.isfinite(ci["lo"]):
        verdict = "INCONCLUSIVE — too few anchors for a bootstrap CI"
    elif ci["lo"] > 0:
        verdict = "IMPROVES ON CLIMATOLOGY (CI excludes zero)"
    elif ci["hi"] < 0:
        verdict = "WORSE THAN CLIMATOLOGY (CI excludes zero)"
    else:
        verdict = "NO SIGNIFICANT DIFFERENCE FROM CLIMATOLOGY (CI spans zero)"

    return {
        "n_anchors": len(readings),
        "model_brier": round(model_brier, 6),
        "climatology_brier": round(climatology_brier, 6),
        "skill": round(skill, 6),
        "ci": ci,
        "verdict": verdict,
        "readings": [
            {"as_of": r.as_of, "model_probability": round(r.model_probability, 4),
             "climatology_probability": round(r.climatology_probability, 4),
             "outcome": r.outcome}
            for r in readings
        ],
    }
