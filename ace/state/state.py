"""MacroState — the Module 1 output contract.

One record per economic block, carrying what the brief requires: level,
momentum, acceleration, uncertainty, historical percentile, direction, last
update, drivers and data freshness.

WHERE EACH NUMBER COMES FROM, AND WHERE NONE OF THEM COMES FROM

  level         the smoothed factor, in standard deviations of its own history
  momentum      change in the level over `MOMENTUM_MONTHS`
  acceleration  change in that momentum — the second difference
  uncertainty   the Kalman smoother's own standard error for that state
  percentile    rank of the current level within the estimated history
  direction     the sign of momentum, with a dead zone (see `DIRECTION_FLOOR`)
  drivers       loading x standardised observation, per series

Not one of them is a hand-set constant. `uncertainty` in particular is the
model's posterior standard deviation rather than a confidence score someone
chose, which is the difference between an uncertainty and a decoration.

WHAT THIS DOES NOT CLAIM

A level is a position in this panel's own history, not a forecast and not a
judgement. "Growth at the 20th percentile" means the growth factor has been
higher 80% of the time since 1990 — it does not mean growth is about to fall.
The direction field is the first difference of an estimate, and on a ragged
edge the most recent month is the least certain, which is exactly why
`uncertainty` travels beside it.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from ace.state.factors import FactorFit
from ace.state.panel import PANEL_BY_ID, PanelBuild

#: Months over which momentum is measured. A quarter, matching the rate-of-
#: change convention the rest of the macro stack uses.
MOMENTUM_MONTHS = 3

#: Momentum inside +/- this many standard deviations reads as "flat" rather
#: than as a direction. Without a dead zone every reading has a direction,
#: including the ones that are noise, and the word stops carrying information.
DIRECTION_FLOOR = 0.10

#: How many series to name as drivers.
TOP_DRIVERS = 4


@dataclass(frozen=True)
class Driver:
    """One series' contribution to where a factor currently sits."""

    series_id: str
    label: str
    #: loading x standardised observation. Same units as the factor.
    contribution: float
    #: The standardised observation itself, so a reader can see whether a large
    #: contribution came from a large loading or a large surprise.
    z: float
    loading: float
    #: Newest published observation for this series, and how stale it is.
    through: str
    days_behind: int


@dataclass(frozen=True)
class BlockState:
    """One economic block's state."""

    block: str
    level: float
    momentum: float
    acceleration: float
    uncertainty: float
    percentile: float
    direction: str
    #: Observation month this state describes — NOT the date it was computed.
    through: str
    #: Days between that month and the as-of date.
    days_behind: int
    n_series: int
    drivers: tuple[Driver, ...] = ()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["drivers"] = [asdict(x) for x in self.drivers]
        return d


@dataclass(frozen=True)
class MacroState:
    """The full state, plus the provenance to audit every number in it."""

    as_of: str
    blocks: dict[str, BlockState]
    #: Whole months between the newest observation anywhere and `as_of`.
    months_behind: int | None
    n_series: int
    dropped: dict[str, str]
    model_id: str = "ace_macro_state"
    model_version: str = "v1"
    #: Recorded so a consumer can refuse a state whose factor count was a
    #: boundary hit rather than a selection.
    factor_count: int = 0
    factor_count_decisive: bool = False
    factor_count_at_boundary: bool = False
    converged: bool = True
    provenance: str = "point_in_time_alfred_vintages"
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict:
        return {
            "as_of": self.as_of,
            "model_id": self.model_id,
            "model_version": self.model_version,
            "provenance": self.provenance,
            "months_behind": self.months_behind,
            "n_series": self.n_series,
            "dropped": self.dropped,
            "factor_count": self.factor_count,
            "factor_count_decisive": self.factor_count_decisive,
            "factor_count_at_boundary": self.factor_count_at_boundary,
            "converged": self.converged,
            "notes": list(self.notes),
            "blocks": {k: v.to_dict() for k, v in self.blocks.items()},
        }


def _direction(momentum: float, floor: float = DIRECTION_FLOOR) -> str:
    if not np.isfinite(momentum) or abs(momentum) < floor:
        return "flat"
    return "rising" if momentum > 0 else "falling"


def _percentile(history: pd.Series, value: float) -> float:
    """Share of the estimated history at or below `value`, in percent.

    Computed over the factor's OWN estimated history, which is the only
    reference class that exists for a latent state.
    """
    clean = history.dropna()
    if clean.empty or not np.isfinite(value):
        return float("nan")
    return float((clean <= value).mean() * 100.0)


def _uncertainty(fit: FactorFit, column: str) -> float:
    """The smoother's standard error for a state at the newest month.

    Pulled from the Kalman smoother's covariance rather than assumed. When the
    results object does not expose it, this returns NaN and the caller renders
    the absence — it does not substitute a number.
    """
    se = getattr(fit, "factor_se", None)
    if se is None or getattr(se, "empty", True) or column not in se.index:
        return float("nan")
    value = float(se.loc[column])
    return value if np.isfinite(value) else float("nan")


def _drivers(
    fit: FactorFit, build: PanelBuild, column: str, block: str, top: int = TOP_DRIVERS
) -> tuple[Driver, ...]:
    """Which series put the factor where it is, this month.

    Contribution is `loading x standardised observation`. A series whose
    newest observation is missing at the ragged edge contributes nothing and is
    absent from the list — it did not move the factor, the filter carried the
    factor without it.
    """
    if fit.loadings.empty or column not in fit.loadings.columns:
        return ()
    z = build.frame.sub(fit.mean, axis=1).div(fit.std.replace(0.0, np.nan), axis=1)
    if z.empty:
        return ()
    newest = z.index.max()
    row = z.loc[newest]

    out: list[Driver] = []
    for sid in fit.series:
        if sid not in fit.loadings.index or sid not in row.index:
            continue
        # Only series in this block, except for the global factor which is
        # loaded by everything.
        if block != "global" and fit.blocks.get(sid) != block:
            continue
        loading = float(fit.loadings.loc[sid, column])
        value = float(row[sid])
        if not np.isfinite(loading) or not np.isfinite(value):
            continue
        spec = PANEL_BY_ID.get(sid)
        edge = build.edge.get(sid, {})
        out.append(
            Driver(
                series_id=sid,
                label=spec.label if spec else sid,
                contribution=round(loading * value, 6),
                z=round(value, 6),
                loading=round(loading, 6),
                through=str(edge.get("through", "")),
                days_behind=int(edge.get("days_behind", -1)),
            )
        )
    out.sort(key=lambda d: abs(d.contribution), reverse=True)
    return tuple(out[:top])


def build_state(fit: FactorFit, build: PanelBuild) -> MacroState:
    """Turn a fitted factor model into the Module 1 contract."""
    blocks: dict[str, BlockState] = {}
    notes: list[str] = []

    if fit.factors.empty:
        return MacroState(
            as_of=build.as_of, blocks={}, months_behind=build.months_behind,
            n_series=build.n_series, dropped=build.dropped,
            notes=("no factors were estimated",),
        )

    for column in fit.factors.columns:
        series = fit.factors[column].dropna()
        if len(series) < MOMENTUM_MONTHS * 2 + 1:
            continue
        name = str(column)
        block = name.split(".")[0]
        # The global factor can be multiplied; keep each copy distinct rather
        # than averaging them into one number nobody can trace back.
        key = name if name.startswith("global") else block

        level = float(series.iloc[-1])
        momentum = float(series.iloc[-1] - series.iloc[-1 - MOMENTUM_MONTHS])
        prior_momentum = float(
            series.iloc[-1 - MOMENTUM_MONTHS] - series.iloc[-1 - 2 * MOMENTUM_MONTHS]
        )
        newest = pd.Timestamp(series.index.max())
        edge_days = [
            e["days_behind"] for s, e in build.edge.items()
            if block == "global" or fit.blocks.get(s) == block
        ]
        members = [s for s in fit.series if block == "global" or fit.blocks.get(s) == block]

        blocks[key] = BlockState(
            block=key,
            level=round(level, 6),
            momentum=round(momentum, 6),
            acceleration=round(momentum - prior_momentum, 6),
            uncertainty=_uncertainty(fit, name),
            percentile=round(_percentile(series, level), 2),
            direction=_direction(momentum),
            through=str(newest.date()),
            days_behind=int(min(edge_days)) if edge_days else -1,
            n_series=len(members),
            drivers=_drivers(fit, build, name, block),
        )

    count = fit.factor_count
    if count.at_boundary:
        notes.append(
            f"Bai-Ng selected k={count.k}, the largest it was offered — the criterion "
            "was still falling, so this is a boundary hit rather than a selection"
        )
    if not fit.converged:
        notes.append("the EM step did not converge; treat every level as provisional")
    if build.dropped:
        notes.append(f"{len(build.dropped)} series dropped: {', '.join(build.dropped)}")

    return MacroState(
        as_of=build.as_of,
        blocks=blocks,
        months_behind=build.months_behind,
        n_series=build.n_series,
        dropped=build.dropped,
        factor_count=count.k,
        factor_count_decisive=count.decisive,
        factor_count_at_boundary=count.at_boundary,
        converged=fit.converged,
        notes=tuple(notes),
    )
