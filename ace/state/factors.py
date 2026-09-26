"""Latent macro factors from a ragged, point-in-time panel.

WHY A FACTOR MODEL RATHER THAN A HAND-SCORED INDEX

A hand-weighted composite is a set of assertions about which series matter and
how much. Nothing measures those weights and nothing can falsify them. A factor
model estimates them from the covariance of the panel, and the estimate can be
wrong in a way a reader can check — loadings are reported, and a factor whose
loadings do not match its name is visible rather than hidden in a spreadsheet.

WHY DynamicFactorMQ SPECIFICALLY

The panel is ragged by construction: payrolls is ~34 days behind, real
consumption ~59, and on any given date the newest observation differs per
series. `DynamicFactorMQ` handles that natively through the Kalman filter and
estimates by EM, which is what makes a nowcast from an incomplete month
possible at all. It also carries `.news()`, which is Module 8's decomposition —
so the model that produces the state is the same one that explains why the
state moved.

statsmodels is BSD-3-Clause and already a dependency. Used as a library; no
code copied.

WHAT IS ESTABLISHED HERE AND WHAT IS NOT

Established: the factors summarise the panel's common variation, and the
loadings say which series drive each one. Not established: that a factor is
"growth" in any sense beyond the block of series assigned to it. The block
structure is an economic assumption, stated in `ace/state/panel.py` as the
`group` field, and a reader should judge the label by the loadings rather than
by the name.

Nothing here claims a forecast. `ace/models/macro_state_model.py` tests whether
the nowcast beats a random walk, and registers the answer either way.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.dynamic_factor_mq import DynamicFactorMQ

from ace.state.panel import PanelBuild
from ace.state.transforms import standardize

#: Most factors Bai-Ng is allowed to consider. Six is not a claim about the
#: data — it is the ceiling above which the criterion is being asked to rank
#: structures that the nine block factors below already span. `bai_ng_factor_count`
#: reports whether the chosen k sat AT this boundary, which is the case where the
#: number came from the ceiling rather than from the panel.
DEFAULT_KMAX = 6

#: EM iterations. Enough to converge on a panel this size without a run taking
#: minutes; `fit_factors` reports whether it actually converged.
DEFAULT_MAXITER = 200


@dataclass(frozen=True)
class FactorCount:
    """Bai-Ng's answer, and the curve behind it."""

    k: int
    criterion: str
    kmax: int
    n: int
    t: int
    #: IC value per candidate k. A flat curve means the criterion is not
    #: discriminating and the choice should not be treated as settled.
    ic: dict[int, float] = field(default_factory=dict)

    @property
    def decisive(self) -> bool:
        """False when the best and second-best IC are within 1%.

        A near-tie is a real outcome. Reporting `k` without it invites a reader
        to treat an arbitrary pick as a finding.
        """
        vals = sorted(self.ic.values())
        if len(vals) < 2 or not np.isfinite(vals[0]) or vals[0] == 0:
            return False
        return abs(vals[1] - vals[0]) > abs(vals[0]) * 0.01

    @property
    def at_boundary(self) -> bool:
        """True when the criterion picked the largest k it was offered.

        This is not a selection, it is a boundary hit: the IC was still falling
        when the search stopped, so the data is saying "more factors" and the
        only thing stopping it is `kmax`. On this panel that happens because 14
        correlated series keep buying explained variance faster than the
        penalty removes it.

        A caller that treats a boundary solution as a chosen k is reporting a
        number the criterion did not actually decide.
        """
        return bool(self.ic) and self.k == max(self.ic)


def bai_ng_factor_count(
    z: pd.DataFrame, *, kmax: int = DEFAULT_KMAX, criterion: str = "ICp2"
) -> FactorCount:
    """Bai and Ng (2002) information criterion for the number of factors.

    REIMPLEMENTED FROM THE PUBLISHED CRITERION. For k factors,

        IC_p1(k) = ln V(k) + k · ((N+T)/(N·T)) · ln((N·T)/(N+T))
        IC_p2(k) = ln V(k) + k · ((N+T)/(N·T)) · ln(min(N, T))

    where V(k) is the mean squared residual after projecting the standardised
    panel onto its first k principal components. ICp2 is the default because it
    penalises harder in small N, and this panel's N is 14.

    Needs a BALANCED matrix, so the ragged tail is dropped here. That is a
    choice about the factor COUNT only; the factors themselves are estimated on
    the ragged panel by `fit_factors`.
    """
    balanced = z.dropna(axis=0, how="any")
    t, n = balanced.shape
    if t < 20 or n < 2:
        return FactorCount(k=1, criterion=criterion, kmax=kmax, n=n, t=t, ic={})

    x = balanced.to_numpy(dtype=float)
    # Principal components via SVD on the standardised matrix.
    u, s, vt = np.linalg.svd(x, full_matrices=False)
    total = float(np.sum(x**2))
    ic: dict[int, float] = {}
    top = min(kmax, n - 1, t - 1)
    for k in range(1, top + 1):
        approx = (u[:, :k] * s[:k]) @ vt[:k, :]
        resid = float(np.sum((x - approx) ** 2))
        v_k = resid / (n * t)
        if v_k <= 0:
            ic[k] = -np.inf
            continue
        scale = (n + t) / (n * t)
        penalty = (
            scale * np.log((n * t) / (n + t)) if criterion == "ICp1"
            else scale * np.log(min(n, t))
        )
        ic[k] = float(np.log(v_k) + k * penalty)

    if not ic:
        return FactorCount(k=1, criterion=criterion, kmax=kmax, n=n, t=t, ic={})
    best = min(ic, key=lambda kk: ic[kk])
    # `total` is unused in the criterion but recorded implicitly: V(k) is
    # already normalised by N·T, so no further scaling is needed.
    del total
    return FactorCount(k=int(best), criterion=criterion, kmax=kmax, n=n, t=t, ic=ic)


@dataclass(frozen=True)
class FactorFit:
    """A fitted factor model and the provenance to audit it."""

    as_of: str
    #: Estimated factors, indexed by observation month. The ragged tail is
    #: present here because the Kalman filter fills it — that is the nowcast.
    factors: pd.DataFrame
    #: Loading of each series on each factor.
    loadings: pd.DataFrame
    #: Factor block each series was assigned to.
    blocks: dict[str, str]
    n_factors: int
    factor_count: FactorCount
    converged: bool
    llf: float
    n_obs: int
    series: tuple[str, ...]
    #: Training moments, kept so a later date standardises with these rather
    #: than refitting them and leaking its own distribution into the state.
    mean: pd.Series = field(default_factory=pd.Series)
    std: pd.Series = field(default_factory=pd.Series)
    #: Kalman smoother posterior standard error per factor at the newest month.
    #: This is the model's own uncertainty, not a confidence score anyone chose.
    #: It is larger at the ragged edge, which is the correct behaviour: the most
    #: recent month is estimated from the fewest observations.
    factor_se: pd.Series = field(default_factory=pd.Series)
    #: The `series` split by native frequency. Quarterly members enter through
    #: `endog_quarterly`, so they contribute to the factors but are NOT part of
    #: the monthly panel Bai-Ng counted factors over — a distinction that
    #: matters when reading `factor_count`.
    series_monthly: tuple[str, ...] = ()
    series_quarterly: tuple[str, ...] = ()
    #: Did the Bai-Ng count actually change the specification? Under the block
    #: structure it only does so when k exceeds the number of blocks, because
    #: each block already gets a factor. False means `factor_count` is reported
    #: for the record and did not shape this fit.
    count_binding: bool = True

    def describe(self) -> str:
        conv = "converged" if self.converged else "DID NOT CONVERGE"
        mix = (
            f" ({len(self.series_monthly)}m + {len(self.series_quarterly)}q)"
            if self.series_quarterly else ""
        )
        return (
            f"{self.n_factors} factors over {len(self.series)} series{mix}, "
            f"{self.n_obs} months, {conv}, llf {self.llf:,.1f}"
        )


def _block_map(build: PanelBuild) -> dict[str, list[str]]:
    """Assign each series to its economic block, for DynamicFactorMQ.

    A block with fewer than two members cannot identify its own factor, so it
    is folded into the global factor rather than estimated as a block of one —
    which would just relabel that series' own variation as a "factor".

    Reads `build.groups`, which `build_asof` derives from the specs it was
    actually handed. Iterating a module-level block list instead would silently
    drop a block belonging to a custom panel, and the failure would look like a
    modelling result rather than a filter.
    """
    out: dict[str, list[str]] = {}
    for group, members in build.groups.items():
        present = [s for s in members if s in build.used]
        if len(present) >= 2:
            out[group] = present
    return out


def fit_factors(
    build: PanelBuild,
    *,
    k: int | None = None,
    kmax: int = DEFAULT_KMAX,
    maxiter: int = DEFAULT_MAXITER,
    use_blocks: bool = True,
) -> FactorFit:
    """Estimate latent factors from a point-in-time panel.

    `k` overrides the Bai-Ng count; leaving it None lets the criterion choose
    and records the whole IC curve so the choice can be second-guessed.
    """
    if build.frame.empty:
        raise ValueError("cannot fit factors on an empty panel")

    z, mu, sigma = standardize(build.frame)
    # Columns that standardised to all-NaN were constant; they carry no
    # information and would make the EM step singular.
    z = z.dropna(axis=1, how="all")
    if z.shape[1] < 2:
        raise ValueError(f"only {z.shape[1]} usable series after standardising")

    # Quarterly members go in through `endog_quarterly`, standardised on their
    # OWN moments. Sharing the monthly panel's moments would be wrong twice: a
    # quarterly growth rate is roughly three times a monthly one, and the two
    # frames do not have the same number of observations to average over.
    zq, mu_q, sigma_q = (pd.DataFrame(), pd.Series(dtype=float), pd.Series(dtype=float))
    if not build.frame_q.empty:
        zq, mu_q, sigma_q = standardize(build.frame_q)
        zq = zq.dropna(axis=1, how="all")

    # Bai-Ng is a criterion for a balanced-ish panel of one frequency. It is run
    # on the MONTHLY block only; the quarterly members join the estimation but
    # do not vote on how many factors there are.
    count = bai_ng_factor_count(z, kmax=kmax)
    n_factors = int(k if k is not None else count.k)

    blocks = _block_map(build) if use_blocks else {}
    modelled = list(z.columns) + list(zq.columns)
    if blocks:
        # Global factor on everything, plus one factor per economic block. The
        # global factor carries the common cycle; the blocks carry what is
        # specific to labor, prices and so on.
        factors = {
            col: ["global"] + [g for g, members in blocks.items() if col in members]
            for col in modelled
        }
        factor_orders = {"global": 2, **{g: 1 for g in blocks}}
        # The block specification already commits one factor per block, so
        # Bai-Ng's k only adds anything once it exceeds the number of blocks.
        # On the nine-block panel it does not: k=6 against 9 blocks floors this
        # at one global factor, and the criterion is INERT. That is recorded
        # rather than left for a reader to infer from a number that looks
        # load-bearing beside a block list.
        extra_global = n_factors - len(blocks)
        factor_multiplicities = {"global": max(1, extra_global)}
        count_binding = extra_global > 1
    else:
        factors = {col: ["global"] for col in modelled}
        factor_orders = {"global": 2}
        factor_multiplicities = {"global": n_factors}
        # Without blocks the count is the whole specification.
        count_binding = True

    # DynamicFactorMQ needs an unambiguous frequency to align the two blocks,
    # and converts a tz-aware DatetimeIndex to periods with a warning. Doing
    # the conversion here makes the alignment explicit instead of incidental,
    # and `_restore_index` puts the original stamps back on the output.
    model = DynamicFactorMQ(
        _as_periods(z, "M"),
        endog_quarterly=_as_periods(zq, "Q") if not zq.empty else None,
        factors=factors,
        factor_orders=factor_orders,
        factor_multiplicities=factor_multiplicities,
        idiosyncratic_ar1=True,
        standardize=False,  # already standardised, with the moments retained
    )
    res = model.fit(maxiter=maxiter, disp=False)

    # Read the smoother's uncertainty while the frame is still on the
    # PeriodIndex statsmodels built, because `res.factors.smoothed_cov` is keyed
    # on that index. Restoring the timestamps first would make every lookup miss
    # and turn the standard errors silently into NaN.
    se = _edge_standard_errors(res, res.factors.smoothed)

    estimated = _restore_index(res.factors.smoothed, build.frame.index)
    loadings = _loadings_from(res, modelled)

    assigned = {
        col: next((g for g, m in blocks.items() if col in m), "global")
        for col in modelled
    }
    estimated, loadings = _orient(estimated, loadings, assigned)
    return FactorFit(
        as_of=build.as_of,
        factors=estimated,
        loadings=loadings,
        blocks=assigned,
        n_factors=int(estimated.shape[1]),
        factor_count=count,
        converged=bool(getattr(res.mlefit, "mle_retvals", {}).get("converged", True))
        if hasattr(res, "mlefit") else True,
        llf=float(res.llf),
        n_obs=int(z.shape[0]),
        series=tuple(modelled),
        mean=pd.concat([mu, mu_q]) if not zq.empty else mu,
        std=pd.concat([sigma, sigma_q]) if not zq.empty else sigma,
        factor_se=se,
        series_monthly=tuple(z.columns),
        series_quarterly=tuple(zq.columns),
        count_binding=count_binding,
    )


def _as_periods(frame: pd.DataFrame, freq: str) -> pd.DataFrame:
    """Re-stamp a frame on a PeriodIndex at `freq`, dropping the timezone.

    A period is a span, not an instant, so a timezone on it is meaningless —
    which is why statsmodels drops it with a warning when handed tz-aware
    dates. Every observation date in this panel is a FRED reference-period
    label at midnight UTC, so nothing is lost.
    """
    out = frame.copy()
    idx = pd.DatetimeIndex(out.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    out.index = idx.to_period(freq)
    return out


def _restore_index(frame: pd.DataFrame, like: pd.Index) -> pd.DataFrame:
    """Put the panel's own timestamps back on a frame statsmodels returned.

    The estimated factors come back on the monthly PeriodIndex `_as_periods`
    built. Everything downstream — the regime models, the state contract, the
    exporter — joins against `build.frame`, so the factors are returned on that
    index rather than leaving each consumer to guess the convention.
    """
    if frame.empty or not isinstance(frame.index, pd.PeriodIndex):
        return frame
    out = frame.copy()
    stamps = pd.DatetimeIndex([p.to_timestamp(how="start") for p in out.index])
    tz = getattr(pd.DatetimeIndex(like), "tz", None) if len(like) else None
    stamps = stamps.tz_localize(tz) if tz is not None else stamps
    # Carry the panel's index NAME too, not just its stamps and zone. A frame
    # that matches on values but not on name fails an equality check for a
    # reason that has nothing to do with the data.
    out.index = stamps.rename(getattr(like, "name", None))
    return out


def _edge_standard_errors(res, factors: pd.DataFrame) -> pd.Series:
    """Posterior standard error of each factor at the newest month.

    `res.factors.smoothed_cov` is indexed (factor, date) with one column per
    factor, so the variance of factor f at date d is the (f, d) row's f column.
    Taking the NEWEST month is deliberate: that is the nowcast, it rests on the
    fewest observations because of the ragged edge, and it is the one number a
    reader is most likely to over-trust.

    Returns NaN per factor when the results object does not carry a covariance.
    The caller renders that absence rather than substituting a value.
    """
    blank = pd.Series(np.nan, index=factors.columns, dtype=float)
    cov = getattr(getattr(res, "factors", None), "smoothed_cov", None)
    if cov is None or getattr(cov, "empty", True) or factors.empty:
        return blank
    try:
        newest = factors.index.max()
        out = {}
        for column in factors.columns:
            try:
                var = float(cov.loc[(column, newest), column])
            except (KeyError, TypeError):
                var = np.nan
            out[column] = float(np.sqrt(var)) if np.isfinite(var) and var >= 0 else np.nan
        return pd.Series(out, dtype=float)
    except Exception:  # noqa: BLE001 — uncertainty is reported, never invented
        return blank


def _orient(
    factors: pd.DataFrame, loadings: pd.DataFrame, blocks: dict[str, str]
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fix each factor's sign so "up" means what its name says.

    A factor and its loadings are only identified up to sign: flipping both
    leaves the likelihood identical. Left alone, a run can produce a growth
    factor that falls when growth rises, and every downstream statement about
    direction inverts with it between refits.

    The convention: a block factor is oriented so the MAJORITY of its own
    block's series load positively. The global factor is oriented on the whole
    panel the same way. This is a labelling convention, not an estimate, and it
    changes nothing about fit.
    """
    if factors.empty or loadings.empty:
        return factors, loadings
    f = factors.copy()
    l = loadings.copy()
    for column in f.columns:
        name = str(column).split(".")[0]
        members = [s for s, g in blocks.items() if g == name] if name != "global" else list(l.index)
        members = [s for s in members if s in l.index]
        if not members or column not in l.columns:
            continue
        signs = np.sign(l.loc[members, column].dropna())
        if signs.empty or signs.sum() >= 0:
            continue
        f[column] = -f[column]
        l[column] = -l[column]
    return f, l


def _loadings_from(res, columns) -> pd.DataFrame:
    """Pull the observation-equation loadings out of the fitted model.

    statsmodels exposes these on the design matrix of the state space form.
    Reading them rather than re-deriving keeps the reported loading identical
    to the one the filter actually used.

    The design's ROWS are in the model's own endog order, which for a mixed
    frequency fit is monthly-then-quarterly. That happens to match `columns` as
    `fit_factors` builds it, but the row labels are taken from the model rather
    than assumed, because a silent off-by-one here would attribute every series'
    loading to its neighbour and read as a modelling result.

    Note for a quarterly member: `DynamicFactorMQ` loads it on the factor AND
    four of its lags, with the Mariano-Murasawa weights that turn three latent
    monthly values into a quarterly average. Only the contemporaneous weight
    survives the lag filter below, so a quarterly row here understates the
    series' total exposure. It is a diagnostic table, not the filter.
    """
    try:
        design = np.asarray(res.filter_results.design)
        # Time-invariant design comes back as (k_endog, k_states, 1).
        d = design[:, :, 0] if design.ndim == 3 else design
        names = list(getattr(res.model, "state_names", []))[: d.shape[1]]
        if len(names) != d.shape[1]:
            names = [f"state_{i}" for i in range(d.shape[1])]
        rows = list(getattr(res.model, "endog_names", []) or [])
        if len(rows) != d.shape[0]:
            rows = list(columns)
        frame = pd.DataFrame(d, index=rows[: d.shape[0]], columns=names)
        frame = frame.loc[[c for c in columns if c in frame.index]]
        # Drop the idiosyncratic AR(1) states. Every series loads 1.0 on its
        # own error term by construction, so leaving them in makes each row's
        # largest "loading" the uninformative one and buries the factor
        # loadings a reader is actually reading the table for.
        keep = [c for c in frame.columns if not str(c).startswith(("eps", "L1.eps"))]
        frame = frame[keep]
        # Collapse lag states: `global.1` and `L1.global.1` are the same factor
        # at different lags, and the contemporaneous loading is the one that
        # answers "what does this series say about the factor now".
        contemporaneous = [c for c in frame.columns if not str(c).startswith("L")]
        return frame[contemporaneous] if contemporaneous else frame
    except Exception:  # noqa: BLE001 — loadings are diagnostic, not load-bearing
        return pd.DataFrame(index=columns)
