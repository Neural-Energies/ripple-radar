"""Phase 8 of the factor-engine brief: the Factor State API.

`ace.state.state.MacroState` is Module 1's contract for the PRODUCTION
DynamicFactorMQ panel (89 series, blocks named in `ace.state.panel`), and
nothing here touches it — the brief is explicit that the existing regime
model stays unless factor features are shown to improve it, which is
Phase 10's job, not this one's.

What this module does is give the COMPREHENSIVE-panel factors from
`ace.factors.pca` (global PCA and the 12 domain PCAs from Phase 6/7) the same
kind of contract, extended to the brief's full field list: `factor_id`,
`factor_name`, `model_version`, `level`, `z_score`, `historical_percentile`,
`momentum`, `acceleration`, `direction`, `volatility`, `uncertainty`,
`change_since_previous_run`, `change_1w`/`change_1m`/`change_3m`,
`top_positive_loadings`/`top_negative_loadings`, `number_of_active_series`,
`number_of_missing_series`, `data_coverage`, `data_freshness_days`,
`as_of_date`, `last_model_fit`.

FACTOR NAMES ARE STILL NEVER ASSIGNED HERE

`factor_name` defaults to a neutral technical label (`"{panel_label} PC{n}"`)
unless the caller supplies an override via `names=`. Nothing in this module
reads a loading table and decides a component is "growth" — that reading, if
it is ever made, belongs one file downstream (see `ace.factors.pca`'s own
docstring), and defaulting to the neutral form is what keeps this module from
quietly becoming the place a name gets assigned by position.

UNCERTAINTY IS HONEST ABOUT WHAT STATIC PCA DOES NOT HAVE

`ace.state.factors.FactorFit` carries a Kalman-smoother posterior standard
error because `DynamicFactorMQ` is a filter with an explicit uncertainty
estimate at every date. Static PCA is a fixed projection with no such
posterior — there is no model-native number to report. Rather than invent one
(a bootstrap or jackknife estimate would be a real thing to build, but it is
not built here), `uncertainty` is reported as NaN for every PCA-based factor,
same convention as `ace.state.state._uncertainty` returning NaN when the
smoother does not expose a covariance: absence of evidence is rendered as
absence, never substituted. `volatility` is a different, answerable question
— the factor's own realised variability over a trailing window — and IS
computed, because "how much does this bounce around" and "how confident is
the model in today's read" are not the same claim.

CHANGE_1W IS NaN BY DESIGN, NOT BY OMISSION

Every fit `ace.factors.pca.fit` produces is on a panel built from
`ace.state.panel.build_asof`, which is monthly (quarterly members go through
`endog_quarterly` in the DFM path and are not part of what PCA is fit on —
see `ace.factors.pca`'s module docstring). A "1-week change" computed by
looking up the nearest monthly print before today is not a weekly change, it
is last month's change wearing a weekly label — exactly the "pretend-daily
forward-fill" the brief's `<frequency_management>` section forbids. This
module measures the actual cadence of each factor's own score history and
reports `change_1w` as None whenever that cadence is coarser than ten days,
which today is every factor this module ever sees.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from ace.config import ROOT
from ace.factors.pca import ComponentLoadings, PCAFit
from ace.state.panel import PanelBuild
from ace.state.transforms import standardize

#: Same convention `ace.state.state.MOMENTUM_MONTHS` uses: a quarter's worth
#: of monthly periods. Every PCA fit is monthly (see module docstring), so
#: "months" and "periods" are the same count here.
MOMENTUM_PERIODS = 3

#: Trailing window for `volatility`, in periods. A year, long enough to average
#: over a few prints without smearing across a full cycle.
VOLATILITY_WINDOW = 12

#: Momentum inside +/- this many standard deviations of the factor's own
#: history reads as "flat". Same convention and same value as
#: `ace.state.state.DIRECTION_FLOOR`, kept local because PCA's loadings and
#: DFM's live in different modules and neither should import the other's
#: internals for a five-line rule.
DIRECTION_FLOOR = 0.10

#: A calendar gap wider than this, in days, means the factor's own score
#: history is not fine-grained enough for a week-over-week reading to mean
#: anything — see "CHANGE_1W IS NaN BY DESIGN" above.
WEEKLY_CADENCE_CEILING_DAYS = 10

#: How many series to name as quantitative drivers — the non-LLM "what moved
#: this factor and why" the brief's Factor Data Explorer section asks for.
#: Same count `ace.state.state.TOP_DRIVERS` uses.
TOP_DRIVERS = 4

MODEL_ID = "ace_pca_factor_state"
MODEL_VERSION = "v1"

DEFAULT_SNAPSHOT_PATH = ROOT / "artifacts" / "state" / "factor_state_snapshot.json"


@dataclass(frozen=True)
class Driver:
    """One series' quantitative contribution to where a factor sits this month.

    `contribution` is `loading x standardised observation` — the same
    construction `ace.state.state.Driver` uses for the production DFM panel,
    applied here to a PCA component's own loading and the panel's newest
    standardised row. This is the quantitative (not LLM) attribution the
    brief's Factor Data Explorer section asks for.
    """

    series_id: str
    label: str
    contribution: float
    z: float
    loading: float
    through: str
    days_behind: int


@dataclass(frozen=True)
class FactorState:
    """One factor's state, in the brief's full field contract."""

    factor_id: str
    factor_name: str
    panel_label: str
    model_version: str
    as_of_date: str
    last_model_fit: str
    level: float
    z_score: float
    historical_percentile: float
    momentum: float
    acceleration: float
    direction: str
    volatility: float
    #: NaN for every PCA-based factor — see "UNCERTAINTY IS HONEST" above.
    uncertainty: float
    change_since_previous_run: float | None
    change_1w: float | None
    change_1m: float | None
    change_3m: float | None
    top_positive_loadings: tuple[tuple[str, float], ...]
    top_negative_loadings: tuple[tuple[str, float], ...]
    number_of_active_series: int
    number_of_missing_series: int
    data_coverage: float
    data_freshness_days: int | None
    drivers: tuple[Driver, ...] = ()
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict:
        return {
            "factor_id": self.factor_id,
            "factor_name": self.factor_name,
            "panel_label": self.panel_label,
            "model_version": self.model_version,
            "as_of_date": self.as_of_date,
            "last_model_fit": self.last_model_fit,
            "level": self.level,
            "z_score": self.z_score,
            "historical_percentile": self.historical_percentile,
            "momentum": self.momentum,
            "acceleration": self.acceleration,
            "direction": self.direction,
            "volatility": self.volatility,
            "uncertainty": self.uncertainty,
            "change_since_previous_run": self.change_since_previous_run,
            "change_1w": self.change_1w,
            "change_1m": self.change_1m,
            "change_3m": self.change_3m,
            "top_positive_loadings": [(s, v) for s, v in self.top_positive_loadings],
            "top_negative_loadings": [(s, v) for s, v in self.top_negative_loadings],
            "number_of_active_series": self.number_of_active_series,
            "number_of_missing_series": self.number_of_missing_series,
            "data_coverage": self.data_coverage,
            "data_freshness_days": self.data_freshness_days,
            "drivers": [
                {
                    "series_id": d.series_id, "label": d.label,
                    "contribution": d.contribution, "z": d.z, "loading": d.loading,
                    "through": d.through, "days_behind": d.days_behind,
                }
                for d in self.drivers
            ],
            "notes": list(self.notes),
        }


def _direction(momentum: float, floor: float = DIRECTION_FLOOR) -> str:
    if not np.isfinite(momentum) or abs(momentum) < floor:
        return "flat"
    return "rising" if momentum > 0 else "falling"


def _percentile(history: pd.Series, value: float) -> float:
    clean = history.dropna()
    if clean.empty or not np.isfinite(value):
        return float("nan")
    return float((clean <= value).mean() * 100.0)


def _cadence_days(index: pd.Index) -> float | None:
    """Median gap between consecutive observations, in days."""
    if len(index) < 2:
        return None
    gaps = pd.Series(pd.DatetimeIndex(index)).diff().dt.days.dropna()
    return float(gaps.median()) if not gaps.empty else None


def _asof_change(series: pd.Series, newest: pd.Timestamp, offset: pd.DateOffset) -> float | None:
    """`level` minus the value at or before `newest - offset`.

    Uses `Series.asof` rather than an index-position lookback, so a gap in the
    history does not silently pull the wrong period's value in. Returns None
    when no observation exists that far back — never a fabricated zero.
    """
    target = pd.Timestamp(newest) - offset
    prior = series.asof(target)
    if prior is None or not np.isfinite(prior):
        return None
    return float(series.loc[newest] - prior)


def _intended_series(panel_label: str, build: PanelBuild | None) -> tuple[str, ...] | None:
    """The series this factor's panel was drawn from, before PCA's own coverage
    drop — used for `number_of_missing_series` / `data_coverage`.

    Returns None when no `build` was supplied, so the caller falls back to what
    the `PCAFit` alone can see (see `build_factor_states`'s docstring for why
    that is a narrower but still honest answer).
    """
    if build is None:
        return None
    if panel_label == "global":
        return tuple(build.frame.columns)
    return tuple(m for m in build.groups.get(panel_label, ()) if m in build.frame.columns)


def _drivers(
    fit: PCAFit, build: PanelBuild | None, component: ComponentLoadings, top: int = TOP_DRIVERS
) -> tuple[Driver, ...]:
    """Quantitative attribution: `loading x this month's standardised print`.

    Needs `build.frame` to read the newest raw observation — the `PCAFit`
    itself only carries the balanced, already-standardised matrix, not the
    full ragged frame a "what moved this" table wants to point back into.
    Returns empty when no `build` was supplied rather than guessing.
    """
    if build is None or fit.scores.empty or component.loadings.empty:
        return ()
    newest = fit.scores.index.max()
    if newest not in build.frame.index:
        return ()
    row = build.frame.loc[newest, list(fit.series)]
    z = (row - fit.mean.reindex(fit.series)) / fit.std.reindex(fit.series).replace(0.0, np.nan)

    records: dict[str, object] = {}
    try:
        from ace.universe.registry import by_id as _registry_by_id
        records = _registry_by_id()
    except Exception:  # noqa: BLE001 — driver labels degrade to series_id, not a crash
        records = {}

    out: list[Driver] = []
    for sid in fit.series:
        loading = float(component.loadings.get(sid, float("nan")))
        value = float(z.get(sid, float("nan")))
        if not np.isfinite(loading) or not np.isfinite(value):
            continue
        edge = build.edge.get(sid, {})
        record = records.get(sid)
        out.append(Driver(
            series_id=sid,
            label=record.canonical_name if record else sid,
            contribution=round(loading * value, 6),
            z=round(value, 6),
            loading=round(loading, 6),
            through=str(edge.get("through", "")),
            days_behind=int(edge.get("days_behind", -1)),
        ))
    out.sort(key=lambda d: abs(d.contribution), reverse=True)
    return tuple(out[:top])


def build_factor_states(
    fit: PCAFit,
    *,
    build: PanelBuild | None = None,
    previous: dict[str, float] | None = None,
    names: dict[str, str] | None = None,
) -> tuple[FactorState, ...]:
    """One `FactorState` per component in a `PCAFit`.

    `build` is the `PanelBuild` the fit's `frame` came from. It is optional:
    without it, `number_of_missing_series` / `data_coverage` fall back to what
    the `PCAFit` alone records (its own `dropped_for_coverage`, which only
    sees columns that reached `fit()` in the first place) and `drivers` is
    empty, because there is no raw frame left to attribute this month's print
    against. Passing `build` — the same object `ace.factors.pca_research`
    already has in hand — gives the fuller answer.

    `previous` maps `factor_id -> level` from a prior run, for
    `change_since_previous_run`. Loading and saving that snapshot is the
    caller's job (see `load_snapshot` / `save_snapshot`); this function only
    reads the dict it is handed, so it stays testable without touching disk.

    `names` maps `factor_id -> factor_name` for the rare case an
    interpretation has already been made elsewhere. Left out, `factor_name`
    is the neutral technical label — see the module docstring.
    """
    previous = previous or {}
    names = names or {}
    intended = _intended_series(fit.panel_label, build)
    active = fit.series
    n_active = len(active)
    if intended is not None:
        n_missing = max(0, len(intended) - n_active)
        coverage = n_active / len(intended) if intended else float("nan")
    else:
        n_missing = len(fit.dropped_for_coverage)
        denom = n_active + n_missing
        coverage = n_active / denom if denom else float("nan")

    freshness_days: int | None = None
    if not fit.scores.empty:
        try:
            # `fit.as_of` is a plain date string (`ace.state.panel.build_asof`
            # stores it as `str(when.date())`), tz-naive by construction, while
            # the score index carries the panel's UTC tz — strip it before
            # subtracting rather than let a naive/aware mismatch raise.
            newest_naive = pd.Timestamp(fit.scores.index.max()).tz_localize(None)
            freshness_days = int((pd.Timestamp(fit.as_of) - newest_naive).days)
        except (TypeError, ValueError):
            freshness_days = None

    out: list[FactorState] = []
    for component in fit.components:
        col = f"PC{component.index}"
        if col not in fit.scores.columns:
            continue
        series = fit.scores[col].dropna()
        if len(series) < MOMENTUM_PERIODS * 2 + 1:
            continue

        factor_id = f"{fit.panel_label}.PC{component.index}"
        newest = series.index.max()
        level = float(series.loc[newest])
        history_std = float(series.std(ddof=1)) if len(series) > 1 else float("nan")
        z_score = (
            (level - float(series.mean())) / history_std
            if np.isfinite(history_std) and history_std > 0 else float("nan")
        )
        momentum = float(series.iloc[-1] - series.iloc[-1 - MOMENTUM_PERIODS])
        prior_momentum = float(
            series.iloc[-1 - MOMENTUM_PERIODS] - series.iloc[-1 - 2 * MOMENTUM_PERIODS]
        )
        trailing = series.iloc[-VOLATILITY_WINDOW:]
        volatility = float(trailing.std(ddof=1)) if len(trailing) > 1 else float("nan")

        cadence = _cadence_days(series.index)
        change_1w = (
            None if cadence is None or cadence > WEEKLY_CADENCE_CEILING_DAYS
            else _asof_change(series, newest, pd.DateOffset(weeks=1))
        )
        change_1m = _asof_change(series, newest, pd.DateOffset(months=1))
        change_3m = _asof_change(series, newest, pd.DateOffset(months=3))

        prev_level = previous.get(factor_id)
        change_since_previous = (
            float(level - prev_level) if prev_level is not None and np.isfinite(prev_level)
            else None
        )

        out.append(FactorState(
            factor_id=factor_id,
            factor_name=names.get(factor_id, f"{fit.panel_label} PC{component.index}"),
            panel_label=fit.panel_label,
            model_version=MODEL_VERSION,
            as_of_date=str(pd.Timestamp(newest).date()),
            last_model_fit=fit.as_of,
            level=round(level, 6),
            z_score=round(z_score, 6) if np.isfinite(z_score) else float("nan"),
            historical_percentile=round(_percentile(series, level), 2),
            momentum=round(momentum, 6),
            acceleration=round(momentum - prior_momentum, 6),
            direction=_direction(momentum),
            volatility=round(volatility, 6) if np.isfinite(volatility) else float("nan"),
            uncertainty=float("nan"),
            change_since_previous_run=(
                round(change_since_previous, 6) if change_since_previous is not None else None
            ),
            change_1w=round(change_1w, 6) if change_1w is not None else None,
            change_1m=round(change_1m, 6) if change_1m is not None else None,
            change_3m=round(change_3m, 6) if change_3m is not None else None,
            top_positive_loadings=component.top_positive,
            top_negative_loadings=component.top_negative,
            number_of_active_series=n_active,
            number_of_missing_series=n_missing,
            data_coverage=round(coverage, 4) if np.isfinite(coverage) else float("nan"),
            data_freshness_days=freshness_days,
            drivers=_drivers(fit, build, component),
            notes=(
                ("static PCA has no posterior; uncertainty is not estimated (NaN), "
                 "see ace.state.factors for the production DFM panel's Kalman-based "
                 "uncertainty",)
            ),
        ))
    return tuple(out)


def load_snapshot(path: Path = DEFAULT_SNAPSHOT_PATH) -> dict[str, float]:
    """Prior run's `factor_id -> level`, or empty if none exists yet."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return {str(k): float(v) for k, v in data.items() if isinstance(v, (int, float))}


def save_snapshot(states: tuple[FactorState, ...], path: Path = DEFAULT_SNAPSHOT_PATH) -> None:
    """Persist this run's `factor_id -> level`, for the next run's
    `change_since_previous_run`.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    levels = {s.factor_id: s.level for s in states if np.isfinite(s.level)}
    path.write_text(json.dumps(levels, indent=2, sort_keys=True))
