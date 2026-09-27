"""Is a factor's loading structure stable, or does it rewrite itself every time
new data arrives?

A loading is not evidence of anything if a factor fit two years apart on
mostly the same data would describe a different economic idea. The brief asks
for exactly this — expanding-window and rolling-window stability, loading
stability, factor turnover — and this module holds the primitives so
`ace.factors.pca_research` can apply them to real point-in-time snapshots
rather than reimplementing the comparison logic inline.

THE SIGN PROBLEM, AGAIN

Every component here is identified only up to sign (see `ace.factors.pca`'s own
docstring on this). Comparing loadings across two fits without re-aligning sign
first would report a real match as a near-perfect ANTI-correlation — so every
function in this module takes the alignment as its first step, the same way
`ace.state.factors._orient` and `ace.factors.pca._orient_component` fix sign
within a single fit.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


def align_sign(reference: pd.Series, candidate: pd.Series) -> pd.Series:
    """Flip `candidate` if that raises its correlation with `reference`.

    Comparing loadings from two independent fits is meaningless without this:
    PCA and DFM both identify a component only up to sign, so an unaligned
    comparison would call a genuine match a near-total disagreement half the
    time, at random.
    """
    common = reference.index.intersection(candidate.index)
    if len(common) < 2:
        return candidate
    r = reference.loc[common].corr(candidate.loc[common])
    return -candidate if (pd.notna(r) and r < 0) else candidate


@dataclass(frozen=True)
class LoadingComparison:
    """How similar two loading vectors are, on their shared series."""

    n_common: int
    correlation: float
    #: Mean absolute difference after sign alignment AND rescaling both to
    #: unit norm — a magnitude-free shape comparison, since PCA and DFM
    #: loadings live on different scales by construction.
    mean_abs_difference: float

    @property
    def stable(self) -> bool:
        return bool(np.isfinite(self.correlation) and self.correlation >= 0.7)


def compare_loadings(a: pd.Series, b: pd.Series) -> LoadingComparison:
    """Correlation and shape difference between two loading vectors, sign-aligned."""
    common = a.index.intersection(b.index)
    if len(common) < 2:
        return LoadingComparison(n_common=len(common), correlation=float("nan"),
                                  mean_abs_difference=float("nan"))
    aligned_b = align_sign(a, b)
    av, bv = a.loc[common].to_numpy(dtype=float), aligned_b.loc[common].to_numpy(dtype=float)
    corr = float(np.corrcoef(av, bv)[0, 1]) if np.std(av) > 0 and np.std(bv) > 0 else float("nan")
    norm_a = av / np.linalg.norm(av) if np.linalg.norm(av) > 0 else av
    norm_b = bv / np.linalg.norm(bv) if np.linalg.norm(bv) > 0 else bv
    mad = float(np.mean(np.abs(norm_a - norm_b)))
    return LoadingComparison(n_common=len(common), correlation=corr, mean_abs_difference=mad)


@dataclass(frozen=True)
class WindowResult:
    """One anchor date's fit, reduced to what the stability test needs."""

    as_of: str
    n_obs: int
    n_series: int
    k: int
    #: PC1's loadings (or the analogous first component from whatever fit
    #: produced this), for cross-window comparison.
    pc1_loadings: pd.Series
    explained_variance_ratio: float


def factor_turnover(scores_a: pd.Series, scores_b: pd.Series) -> float:
    """How much a factor's OWN reading has moved between two fits, on the
    dates both cover — in units of the earlier fit's own standard deviation.

    Distinct from loading stability: two fits can agree closely on WHAT the
    factor is (high loading correlation) while still disagreeing on WHERE it
    currently sits, if the newer fit's added data shifted the standardisation.
    """
    common = scores_a.index.intersection(scores_b.index)
    if len(common) < 2:
        return float("nan")
    a, b = scores_a.loc[common], scores_b.loc[common]
    b_aligned = align_sign(a, b)
    sd = float(a.std(ddof=0))
    if not np.isfinite(sd) or sd <= 0:
        return float("nan")
    return float((a - b_aligned).abs().mean() / sd)


def stability_report(results: list[WindowResult]) -> dict:
    """Consecutive-window comparisons across an expanding or rolling series of fits."""
    comparisons = []
    for prev, curr in zip(results, results[1:]):
        cmp = compare_loadings(prev.pc1_loadings, curr.pc1_loadings)
        comparisons.append({
            "from": prev.as_of, "to": curr.as_of,
            "n_common_series": cmp.n_common,
            "loading_correlation": round(cmp.correlation, 4) if np.isfinite(cmp.correlation) else None,
            "mean_abs_shape_difference": round(cmp.mean_abs_difference, 4) if np.isfinite(cmp.mean_abs_difference) else None,
            "stable": cmp.stable,
            "k_before": prev.k, "k_after": curr.k,
            "k_changed": prev.k != curr.k,
        })
    correlations = [c["loading_correlation"] for c in comparisons if c["loading_correlation"] is not None]
    return {
        "n_windows": len(results),
        "n_transitions": len(comparisons),
        "transitions": comparisons,
        "mean_loading_correlation": round(float(np.mean(correlations)), 4) if correlations else None,
        "min_loading_correlation": round(float(np.min(correlations)), 4) if correlations else None,
        "share_stable_transitions": (
            round(sum(1 for c in comparisons if c["stable"]) / len(comparisons), 4)
            if comparisons else None
        ),
        "k_ever_changed": any(c["k_changed"] for c in comparisons),
    }
