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

WHAT "BALANCED" ACTUALLY MEANS HERE

Naive full-panel listwise deletion — drop any row with a NaN anywhere — does
not degrade gracefully as the panel widens. Measured on the 167-series
comprehensive monthly panel: with 166 of 167 columns carrying a NaN SOMEWHERE
in their history (different start dates, a handful of discontinued series
before the registry excluded them, isolated gaps), not one of 561 months was
ever fully complete. `dropna(how="any")` on the whole sample returns ZERO
rows, silently, and only shows up as a division-by-zero several lines later.

The fix is the same three-step admission standard applied macro-PCA work uses:
drop a column below a stated COVERAGE floor first (report which, and why),
trim the survivors to the date range where ALL of them are non-null (their
overlap, not their union), and only then drop any still-isolated gap. See
`_balanced_matrix` for the implementation and exactly what it reports.

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
    #: The ADMITTED matrix's own mean/std (see `_admit_matrix`) — the
    #: balanced, coverage-filtered subsample this fit actually ran on, not
    #: the original ragged frame's. A later date scored against the wrong
    #: moments would not be in the basis the loadings were fit in; see
    #: `_AdmittedMatrix`'s docstring for the bug this fixed.
    mean: pd.Series
    std: pd.Series
    #: Series dropped for falling below `MIN_COLUMN_COVERAGE`, with their
    #: coverage share — the accounting `ace.factors.pca_research` reports
    #: rather than silently losing.
    dropped_for_coverage: dict[str, float] = field(default_factory=dict)

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
            "dropped_for_coverage": self.dropped_for_coverage,
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


#: A column below this share of non-null observations, WITHIN ITS OWN ACTIVE
#: RANGE (first valid observation to last), is dropped before the balanced
#: matrix is built — reported, never silently. 0.90 is a floor, not a target.
#:
#: Measured against a series' OWN range, not the full panel window, on
#: purpose. An earlier version measured coverage against the whole 561-month
#: window, and it starved four entire domain panels (banking, commodities,
#: manufacturing, trade_external) to zero surviving columns: a commodity index
#: starting in 2015 is perfectly dense from 2015 onward, but covers only 23%
#: of a panel that starts in 1980, so the full-window measure flagged it as
#: "low coverage" and dropped it before the overlap-trim step — the step
#: BUILT to handle a late start gracefully — ever got a chance to run. A
#: series failing the WITHIN-RANGE measure by more than a rounding gap has an
#: internal hole, which is the actual defect this floor exists to catch.
MIN_COLUMN_COVERAGE = 0.90


def _within_range_coverage(column: pd.Series) -> float:
    """Share of non-null values between a column's own first and last observation.

    A column that has not started yet, or has already ended, is not a "gap" in
    the sense this function measures — that is what the overlap-trim step in
    `_balanced_matrix` is for. This measures whether the column has holes
    WITHIN the range it is actually active.
    """
    first, last = column.first_valid_index(), column.last_valid_index()
    if first is None or last is None:
        return 0.0
    span = column.loc[first:last]
    return float(span.notna().mean()) if len(span) else 0.0


@dataclass(frozen=True)
class BalancedMatrix:
    frame: pd.DataFrame
    dropped_columns: dict[str, float]  # series_id -> within-range coverage, for the report


def _balanced_matrix(z: pd.DataFrame, *, min_coverage: float = MIN_COLUMN_COVERAGE) -> BalancedMatrix:
    """Coverage floor, then trim to the survivors' overlap, then drop any gap.

    Full listwise deletion over the WHOLE sample (`z.dropna(how="any")` with no
    prior column filter) does not degrade gracefully as a panel widens — see
    the module docstring for the measured failure at 167 columns. This is the
    three-step admission standard applied macro-PCA work uses instead:

      1. drop any column whose WITHIN-RANGE coverage is below `min_coverage`
         (see `_within_range_coverage` for why that and not the full window);
      2. trim remaining rows to the date range where every SURVIVING column has
         data (their overlap — not the union, which would still have holes);
      3. drop any still-isolated gap inside that trimmed range.

    Step 3 exists for a genuinely isolated single-month outage; if it removes
    more than a handful of rows, that is itself worth noticing, and the caller
    sees it in the row count either way.
    """
    coverage = z.apply(_within_range_coverage)
    keep = coverage[coverage >= min_coverage].index
    dropped = {str(c): round(float(coverage[c]), 4) for c in z.columns if c not in keep}
    trimmed = z[keep]
    if trimmed.empty:
        return BalancedMatrix(frame=trimmed, dropped_columns=dropped)

    starts = trimmed.apply(lambda col: col.first_valid_index())
    ends = trimmed.apply(lambda col: col.last_valid_index())
    if starts.isna().any() or ends.isna().any():
        return BalancedMatrix(frame=trimmed.iloc[0:0], dropped_columns=dropped)
    overlap_start, overlap_end = starts.max(), ends.min()
    if overlap_start > overlap_end:
        return BalancedMatrix(frame=trimmed.iloc[0:0], dropped_columns=dropped)

    windowed = trimmed.loc[overlap_start:overlap_end]
    balanced = windowed.dropna(axis=0, how="any")
    return BalancedMatrix(frame=balanced, dropped_columns=dropped)


@dataclass(frozen=True)
class _AdmittedMatrix:
    """The ONE matrix every later step — factor-count selection, the SVD, and
    the total-variance denominator — must agree on. Building it is two steps:

      1. `_balanced_matrix` picks the rows and columns (coverage floor,
         overlap trim, residual-gap drop — see that function).
      2. The survivors are RE-STANDARDISED on their OWN mean and std.

    Step 2 exists because of a defect an external audit caught by execution,
    not by inspection: `z` going into step 1 is centred against the FULL
    panel. Once rows are trimmed away, the surviving subsample's own mean
    need not be zero any more — dropping 50 of 100 rows for coverage shifts
    the effective mean of what is left. A PCA fit whose analysed matrix is
    not actually centred does not have the property its own variance
    bookkeeping assumes: summing ALL of a full-rank fit's eigenvalues should
    reproduce the matrix's total variance exactly, and it did not. Measured
    on a 100x4 seed-123 synthetic panel with one column missing its first 50
    rows: `explained_variance_ratio` summed to 0.6508046967 across all four
    (full-rank) components, not 1.0, because the SVD ran on rows 51-100 of an
    only-globally-centred matrix while the reported ratio's denominator used
    a mismatched row/column combination on top of that. Re-standardising the
    admitted matrix — and using THIS SAME matrix for Bai-Ng, the SVD, and the
    total-variance sum — closes both gaps at once rather than patching the
    denominator formula in isolation, which would still leave Bai-Ng voting
    on a different sample than the one actually fit.
    """

    frame: pd.DataFrame
    #: This admission's own mean/std, restricted to the columns that
    #: survived — NOT `standardize(original_frame)`'s moments. A driver
    #: table built from the wrong moments would report "this month's
    #: standardised print" in a basis the loadings were never fit in.
    mean: pd.Series
    std: pd.Series
    dropped_columns: dict[str, float]


def _admit_matrix(z: pd.DataFrame, *, min_coverage: float = MIN_COLUMN_COVERAGE) -> _AdmittedMatrix:
    matrix = _balanced_matrix(z, min_coverage=min_coverage)
    if matrix.frame.shape[0] < 2 or matrix.frame.shape[1] < 2:
        return _AdmittedMatrix(
            frame=matrix.frame, mean=pd.Series(dtype=float), std=pd.Series(dtype=float),
            dropped_columns=matrix.dropped_columns,
        )
    re_z, bal_mu, bal_sigma = standardize(matrix.frame)
    # A column that is constant WITHIN the balanced window (rows the overlap
    # trim kept happened to be identical) standardises to all-NaN here and is
    # dropped for the same reason a globally-constant one already is in
    # `fit()`: it carries no information in this window and would make the
    # SVD singular. Rare, but the admission has to survive it rather than
    # hand `_svd_fit` a NaN column.
    re_z = re_z.dropna(axis=1, how="all")
    dropped = dict(matrix.dropped_columns)
    for col in set(matrix.frame.columns) - set(re_z.columns):
        dropped[str(col)] = 0.0  # not low coverage — constant within this window
    return _AdmittedMatrix(
        frame=re_z, mean=bal_mu.reindex(re_z.columns), std=bal_sigma.reindex(re_z.columns),
        dropped_columns=dropped,
    )


def _svd_fit(x: pd.DataFrame, k: int) -> tuple[pd.DataFrame, pd.DataFrame, np.ndarray]:
    """Bare SVD on an ALREADY admitted matrix — no balancing decision happens
    here, so this always runs on exactly the matrix `_admit_matrix` produced,
    the same one Bai-Ng was handed. Loadings are scaled so that
    `scores @ loadings.T ≈ x` — the observation-equation convention
    `ace.state.factors` reports its DFM loadings under, so the two are
    comparable without a unit conversion.
    """
    arr = x.to_numpy(dtype=float)
    t, n = arr.shape
    u, s, vt = np.linalg.svd(arr, full_matrices=False)
    k = min(k, len(s))
    eigenvalues = (s[:k] ** 2) / t
    scores = pd.DataFrame(u[:, :k] * s[:k], index=x.index, columns=[f"PC{i+1}" for i in range(k)])
    loadings = pd.DataFrame(vt[:k, :].T, index=x.columns, columns=[f"PC{i+1}" for i in range(k)])
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
    z, _, _ = standardize(frame)
    z = z.dropna(axis=1, how="all")
    if z.shape[1] < 2:
        raise ValueError(f"only {z.shape[1]} usable series after standardising")

    admitted = _admit_matrix(z)
    balanced = admitted.frame
    if balanced.shape[0] < 2 or balanced.shape[1] < 2:
        available = ", ".join(f"{k}={v:.0%}" for k, v in
                               sorted(admitted.dropped_columns.items(), key=lambda kv: kv[1]))
        raise ValueError(
            f"no balanced window survives coverage filtering and overlap-"
            f"trimming ({balanced.shape[0]} rows x {balanced.shape[1]} cols). "
            f"Columns dropped for low coverage: {available or 'none'}"
        )

    # Bai-Ng, the SVD and the variance denominator below all run on this SAME
    # admitted matrix now — see `_AdmittedMatrix`'s docstring for the defect
    # that existed when they did not.
    count = bai_ng_factor_count(balanced, kmax=kmax)
    n_factors = int(k if k is not None else count.k)
    n_factors = max(1, min(n_factors, MAX_REPORTED_COMPONENTS))

    scores, loadings, eigenvalues = _svd_fit(balanced, n_factors)
    balanced_cols = list(loadings.index)
    total_var = float(np.nansum(balanced.to_numpy(dtype=float) ** 2)) / len(balanced)

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
        components=tuple(components), scores=scores,
        mean=admitted.mean, std=admitted.std,
        dropped_for_coverage=admitted.dropped_columns,
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
