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

from ace.state.panel import GROUPS, PanelBuild
from ace.state.transforms import standardize

#: Most factors Bai-Ng is allowed to consider. Above this the criterion is
#: being asked about structure a 14-series panel cannot support.
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

    def describe(self) -> str:
        conv = "converged" if self.converged else "DID NOT CONVERGE"
        return (
            f"{self.n_factors} factors over {len(self.series)} series, "
            f"{self.n_obs} months, {conv}, llf {self.llf:,.1f}"
        )


def _block_map(build: PanelBuild) -> dict[str, list[str]]:
    """Assign each series to its economic block, for DynamicFactorMQ.

    A block with fewer than two members cannot identify its own factor, so it
    is folded into the global factor rather than estimated as a block of one —
    which would just relabel that series' own variation as a "factor".
    """
    out: dict[str, list[str]] = {}
    for group in GROUPS:
        members = [s for s in build.used if build.groups.get(group) and s in build.groups[group]]
        if len(members) >= 2:
            out[group] = members
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

    count = bai_ng_factor_count(z, kmax=kmax)
    n_factors = int(k if k is not None else count.k)

    blocks = _block_map(build) if use_blocks else {}
    if blocks:
        # Global factor on everything, plus one factor per economic block. The
        # global factor carries the common cycle; the blocks carry what is
        # specific to labor, prices and so on.
        factors = {
            col: ["global"] + [g for g, members in blocks.items() if col in members]
            for col in z.columns
        }
        factor_orders = {"global": 2, **{g: 1 for g in blocks}}
        factor_multiplicities = {"global": max(1, n_factors - len(blocks))}
    else:
        factors = {col: ["global"] for col in z.columns}
        factor_orders = {"global": 2}
        factor_multiplicities = {"global": n_factors}

    model = DynamicFactorMQ(
        z,
        factors=factors,
        factor_orders=factor_orders,
        factor_multiplicities=factor_multiplicities,
        idiosyncratic_ar1=True,
        standardize=False,  # already standardised, with the moments retained
    )
    res = model.fit(maxiter=maxiter, disp=False)

    estimated = res.factors.smoothed
    loadings = _loadings_from(res, z.columns)

    assigned = {
        col: next((g for g, m in blocks.items() if col in m), "global")
        for col in z.columns
    }
    estimated, loadings = _orient(estimated, loadings, assigned)
    se = _edge_standard_errors(res, estimated)
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
        series=tuple(z.columns),
        mean=mu,
        std=sigma,
        factor_se=se,
    )


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


def _loadings_from(res, columns: pd.Index) -> pd.DataFrame:
    """Pull the observation-equation loadings out of the fitted model.

    statsmodels exposes these on the design matrix of the state space form.
    Reading them rather than re-deriving keeps the reported loading identical
    to the one the filter actually used.
    """
    try:
        design = np.asarray(res.filter_results.design)
        # Time-invariant design comes back as (k_endog, k_states, 1).
        d = design[:, :, 0] if design.ndim == 3 else design
        names = list(getattr(res.model, "state_names", []))[: d.shape[1]]
        if len(names) != d.shape[1]:
            names = [f"state_{i}" for i in range(d.shape[1])]
        frame = pd.DataFrame(d[: len(columns)], index=columns, columns=names)
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
