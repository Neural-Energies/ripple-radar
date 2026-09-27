"""Static PCA on the point-in-time panel: dimensionality reduction, loading
analysis, and stability testing — the transparent baseline the brief asks to
be run and compared against `DynamicFactorMQ` rather than assumed inferior.

WHY THIS REUSES `bai_ng_factor_count` RATHER THAN REIMPLEMENTING IT

`ace.state.factors.bai_ng_factor_count` already reimplements Bai-Ng ICp2 from
the published criterion, on exactly the SVD decomposition static PCA needs — it
drops the ragged tail to a balanced matrix and picks k from the same eigenvalue
structure a scree plot would show. There is nothing PCA-specific left to build;
importing it is the "extend, don't duplicate" instruction applied literally.

WHAT "STATIC" MEANS HERE, AND WHY IT IS STILL POINT-IN-TIME

Static PCA has no Kalman filter, so it cannot handle the ragged edge the way
`DynamicFactorMQ` does — every fit here runs on a BALANCED matrix, dropping
whatever the ragged tail leaves incomplete. That is a real limitation, not a
detail: it is the central thing this module measures against the DFM.

But "static" does not mean "not point-in-time". Every fit takes a `PanelBuild`
produced by `ace.state.panel.build_asof(when, ...)`, which already enforces
that nothing published after `when` is present. An expanding-window PCA run at
five historical dates is five separate point-in-time snapshots, each built the
same way the quad work's historical replay is built — never today's revised
panel sliced by date, which would leak revisions the same way a naive backtest
does.

HIERARCHICAL FACTORS: GLOBAL PANEL vs DOMAIN PANELS

`fit_global` runs PCA across the whole panel; `fit_domain` runs it separately
within one economic block (the registry's `economic_category`). Comparing the
two is the brief's proposed alternative to a single PCA trying to explain the
whole economy at once — and the comparison decides nothing in advance: a
domain factor and a slice of the global factor may turn out to carry the same
information, in which case the extra machinery buys nothing, and this module's
job is to say so.

NAMES ARE NEVER ASSIGNED HERE

`FactorLoadings.top_positive` / `top_negative` rank series by loading
magnitude. Nothing in this module writes "growth" or "inflation" on a
component — that reading is made by whoever examines the loadings, and it goes
in `ace.factors.interpretation`, one file downstream of the numbers so it
cannot be confused with them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ace.state.factors import FactorCount, bai_ng_factor_count
from ace.state.transforms import standardize

#: Components beyond this are almost never economically legible even when
#: Bai-Ng's curve keeps falling — a ceiling for reporting, not for the search.
MAX_REPORTED_COMPONENTS = 10

#: How many series to name per side of a loading table.
TOP_LOADINGS = 8


@dataclass(frozen=True)
class ComponentLoadings:
    """One principal component: its loadings, and what it explains."""

    index: int  # 1-based: PC1, PC2, ...
    explained_variance_ratio: float
    cumulative_variance_ratio: float
    eigenvalue: float
    #: loading per series, already sign-oriented (see `_orient_component`).
    loadings: pd.Series
    top_positive: tuple[tuple[str, float], ...]
    top_negative: tuple[tuple[str, float], ...]

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "explained_variance_ratio": round(self.explained_variance_ratio, 6),
            "cumulative_variance_ratio": round(self.cumulative_variance_ratio, 6),
            "eigenvalue": round(self.eigenvalue, 6),
            "top_positive": [(s, round(v, 4)) for s, v in self.top_positive],
            "top_negative": [(s, round(v, 4)) for s, v in self.top_negative],
        }


@dataclass(frozen=True)
class PCAFit:
    """A static PCA fit: scores, loadings per component, and the count evidence."""

    as_of: str
    panel_label: str
    n_series: int
    n_obs: int
    #: Series actually used — after dropping to a balanced matrix.
    series: tuple[str, ...]
    #: Rows (dates) that survived the balanced-matrix requirement.
    dates: tuple[pd.Timestamp, ...]
    factor_count: FactorCount
    components: tuple[ComponentLoadings, ...]
    #: T x k matrix of factor scores, indexed by date.
    scores: pd.DataFrame
    #: Training mean/std, so a later date can be scored without leaking its
    #: own distribution into the fit — the same discipline `ace.state.factors`
    #: applies for the DFM.
    mean: pd.Series
    std: pd.Series

    def describe(self) -> str:
        return (
            f"{len(self.components)} components over {self.n_series} series, "
            f"{self.n_obs} months (balanced), "
            f"{self.components[-1].cumulative_variance_ratio:.1%} variance explained"
        )

    def to_dict(self) -> dict:
        return {
            "as_of": self.as_of,
            "panel_label": self.panel_label,
            "n_series": self.n_series,
            "n_obs": self.n_obs,
            "series": list(self.series),
            "factor_count": {
                "k": self.factor_count.k,
                "decisive": self.factor_count.decisive,
                "at_boundary": self.factor_count.at_boundary,
            },
            "components": [c.to_dict() for c in self.components],
        }


def _orient_component(loading: pd.Series, score: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Fix the sign so the majority of loadings are positive.

    PCA identifies a component up to sign — flipping both the loading vector
    and its score leaves everything else unchanged. Without a convention, a
    re-fit on slightly different data can flip an otherwise-identical factor,
    and every "up means X" statement downstream inverts with it. Same
    convention as `ace.state.factors._orient`, applied to PCA's own output
    rather than shared code, because PCA's loadings and DFM's are different
    objects living in different modules.
    """
    if loading.sum() < 0:
        return -loading, -score
    return loading, score


def _fit_pca(z: pd.DataFrame, k: int) -> tuple[pd.DataFrame, pd.DataFrame, np.ndarray]:
    """SVD-based PCA on a balanced, standardised matrix.

    Returns (scores T x k, loadings N x k, eigenvalues length k). Loadings are
    scaled so that `scores @ loadings.T ≈ z` — the observation-equation
    convention `ace.state.factors` reports its DFM loadings under, so the two
    are comparable without a unit conversion.
    """
    balanced = z.dropna(axis=0, how="any")
    x = balanced.to_numpy(dtype=float)
    t, n = x.shape
    u, s, vt = np.linalg.svd(x, full_matrices=False)
    k = min(k, len(s))
    eigenvalues = (s[:k] ** 2) / t
    scores = pd.DataFrame(
        u[:, :k] * s[:k], index=balanced.index,
        columns=[f"PC{i+1}" for i in range(k)],
    )
    loadings = pd.DataFrame(
        vt[:k, :].T, index=balanced.columns,
        columns=[f"PC{i+1}" for i in range(k)],
    )
    return scores, loadings, eigenvalues


def fit(
    frame: pd.DataFrame,
    *,
    as_of: str,
    label: str = "global",
    k: int | None = None,
    kmax: int = 10,
) -> PCAFit:
    """Static PCA on one transformed, point-in-time panel slice.

    `frame` is expected to already be the OUTPUT of `ace.state.panel.build_asof`
    — filtered to what was published by `as_of` and transformed — so this
    function adds nothing to the point-in-time discipline; it only decomposes
    what it is handed.
    """
    z, mu, sigma = standardize(frame)
    z = z.dropna(axis=1, how="all")
    if z.shape[1] < 2:
        raise ValueError(f"only {z.shape[1]} usable series after standardising")

    count = bai_ng_factor_count(z, kmax=kmax)
    n_factors = int(k if k is not None else count.k)
    n_factors = max(1, min(n_factors, MAX_REPORTED_COMPONENTS))

    scores, loadings, eigenvalues = _fit_pca(z, n_factors)
    balanced_cols = list(loadings.index)
    total_var = float(np.nansum(z[balanced_cols].to_numpy(dtype=float) ** 2)) / len(scores)

    components = []
    cumulative = 0.0
    for i, col in enumerate(scores.columns):
        loading, score = _orient_component(loadings[col], scores[col])
        scores[col] = score
        ratio = float(eigenvalues[i] / total_var) if total_var > 0 else float("nan")
        cumulative += ratio
        ranked = loading.sort_values(ascending=False)
        components.append(ComponentLoadings(
            index=i + 1,
            explained_variance_ratio=ratio,
            cumulative_variance_ratio=cumulative,
            eigenvalue=float(eigenvalues[i]),
            loadings=loading,
            top_positive=tuple(
                (s, float(v)) for s, v in ranked.head(TOP_LOADINGS).items() if v > 0
            ),
            top_negative=tuple(
                (s, float(v)) for s, v in ranked.tail(TOP_LOADINGS).items() if v < 0
            ),
        ))

    return PCAFit(
        as_of=as_of, panel_label=label, n_series=len(balanced_cols),
        n_obs=int(len(scores)), series=tuple(balanced_cols),
        dates=tuple(scores.index), factor_count=count,
        components=tuple(components), scores=scores, mean=mu, std=sigma,
    )


def domain_panels(frame: pd.DataFrame, groups: dict[str, tuple[str, ...]]) -> dict[str, pd.DataFrame]:
    """Slice a transformed panel into its economic blocks.

    Reads `PanelBuild.groups` directly rather than re-deriving block membership
    — the one place block assignment is decided is the registry / panel spec,
    and this must agree with it rather than keep a second opinion.
    """
    out = {}
    for group, members in groups.items():
        cols = [m for m in members if m in frame.columns]
        if len(cols) >= 4:  # too few series for a domain factor to mean anything
            out[group] = frame[cols]
    return out
