"""The macro panel, assembled point-in-time.

A factor model is only as honest as the panel under it. Two things can ruin one
and neither is visible in the output:

1. A value that had not been PUBLISHED on the date being modelled. The quad
   work measured what this costs on this exact data — 74.2% of real-time labels
   survived contact with the revised series, and 72% of the failures flipped
   the growth axis. A panel built from today's revised figures does not nowcast
   a state, it reads an almanac.

2. A transform applied before the point-in-time filter. Differencing the full
   revised series and THEN cutting to the vintage leaves the last difference
   computed against a number nobody had. The order here is filter first,
   transform second, always.

RAGGED EDGES ARE KEPT, NOT FILLED

Series publish on different calendars — payrolls at ~34 days, real consumption
at ~59, industrial production at ~45 — so on any given date the newest
observation differs per series. The panel keeps that raggedness as NaN and
hands it to `DynamicFactorMQ`, which is built for exactly this via the Kalman
filter. Forward-filling to square the panel would invent observations and, far
worse, would make the most-delayed series look as current as the fastest.

A series is DROPPED rather than imputed when it has too little published
history to carry its transform. Absence is data; a fabricated value is not.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from ace.data.alfred import release_history
from ace.macro.quads import known_at
from ace.state.transforms import TRANSFORM_NAMES, apply_code, lags_consumed


@dataclass(frozen=True)
class SeriesSpec:
    """One panel member, and the convention it is read under."""

    series_id: str
    label: str
    #: Economic block. The factor model does not use this; the DRIVERS
    #: attribution does, and so does a reader deciding whether a factor means
    #: what its name says.
    group: str
    #: FRED-MD transform code. See `ace.state.transforms`.
    code: int
    #: Median publication lag in days, measured from the vintage archive. Kept
    #: as documentation; the live figure is recomputed on every panel build.
    typical_lag_days: int
    note: str = ""

    def __post_init__(self) -> None:
        if self.code not in TRANSFORM_NAMES:
            raise ValueError(f"{self.series_id}: unknown transform code {self.code}")


#: The first-slice panel: growth, inflation and labor, per the brief.
#:
#: Deliberately smaller than FRED-MD's ~120 series. Every member here has a
#: first-release vintage archive going back to at least 2001, which is what
#: makes a point-in-time backtest possible at all. Breadth without vintages
#: would buy a prettier factor and an untestable one.
PANEL: tuple[SeriesSpec, ...] = (
    # --- labor -------------------------------------------------------------
    SeriesSpec("PAYEMS", "Nonfarm payrolls", "labor", 5, 34,
               "The fastest broad read, and the one the rest wait for."),
    SeriesSpec("UNRATE", "Unemployment rate", "labor", 2, 34,
               "A rate, so differenced rather than log-differenced."),
    SeriesSpec("AWHMAN", "Manufacturing weekly hours", "labor", 1, 34,
               "Hours move before heads; already stationary in level."),
    SeriesSpec("MANEMP", "Manufacturing employment", "labor", 5, 34,
               "The cyclical end of the labor market."),
    # --- production and consumption ---------------------------------------
    SeriesSpec("INDPRO", "Industrial production", "growth", 5, 45,
               "Cyclical and volatile; turns before the labour market."),
    SeriesSpec("TCU", "Capacity utilization", "growth", 2, 45,
               "A utilisation rate, so differenced."),
    SeriesSpec("RRSFS", "Real retail sales", "consumption", 5, 45,
               "Consumption in volume terms, so inflation does not leak in."),
    SeriesSpec("PCEC96", "Real consumption", "consumption", 5, 59,
               "Two thirds of output, three weeks behind payrolls."),
    SeriesSpec("DSPIC96", "Real disposable income", "consumption", 5, 59,
               "What funds consumption; turns earlier in an income shock."),
    # --- housing -----------------------------------------------------------
    SeriesSpec("HOUST", "Housing starts", "housing", 4, 47,
               "Rate-sensitive and early. Logged, not differenced — the level "
               "of log starts is the cycle."),
    # --- prices ------------------------------------------------------------
    SeriesSpec("CPIAUCSL", "CPI", "inflation", 6, 45,
               "Price indices take a second log difference: the first gives "
               "inflation, the second gives whether inflation is turning."),
    SeriesSpec("CPILFESL", "Core CPI", "inflation", 6, 45,
               "Ex food and energy; less noisy, slower to turn."),
    SeriesSpec("PPIACO", "Producer prices", "inflation", 6, 43,
               "Upstream, so it leads consumer prices on a cost shock."),
    SeriesSpec("CES0500000003", "Average hourly earnings", "inflation", 6, 34,
               "The wage side of inflation, and the fastest price read."),
)

PANEL_BY_ID: dict[str, SeriesSpec] = {s.series_id: s for s in PANEL}
GROUPS: tuple[str, ...] = ("labor", "growth", "consumption", "housing", "inflation")

#: A series needs this many published observations AFTER its transform before
#: it may join. Below it the column is nearly all NaN and contributes a loading
#: estimated from a handful of points.
MIN_USABLE_OBS = 36


@dataclass(frozen=True)
class PanelBuild:
    """A point-in-time panel and everything needed to audit it."""

    as_of: str
    #: Transformed, ragged, one column per surviving series.
    frame: pd.DataFrame
    #: Untransformed levels as published — kept so a reader can check a factor
    #: against the number a human would have seen.
    levels: pd.DataFrame
    used: tuple[str, ...]
    dropped: dict[str, str]
    #: Newest PUBLISHED observation month per series, and days behind `as_of`.
    edge: dict[str, dict]
    #: Whole months between the newest observation anywhere and `as_of`.
    months_behind: int | None = None
    groups: dict[str, tuple[str, ...]] = field(default_factory=dict)

    @property
    def n_series(self) -> int:
        return len(self.used)

    def describe(self) -> str:
        lag = "unknown" if self.months_behind is None else f"{self.months_behind} month(s)"
        return (
            f"{self.n_series}/{len(PANEL)} series as of {self.as_of}, "
            f"newest observation {lag} behind, {len(self.dropped)} dropped"
        )


def load_vintages(
    specs: tuple[SeriesSpec, ...] = PANEL, start: str = "1990-01-01"
) -> dict[str, pd.DataFrame]:
    """First-release archives for every panel member, fetched once.

    Fetching once and filtering per date is what makes a historical replay
    cheap: a 300-month backtest is 300 filters, not 300 × 14 API calls.
    """
    out: dict[str, pd.DataFrame] = {}
    for spec in specs:
        try:
            out[spec.series_id] = release_history(spec.series_id, start)
        except Exception as exc:  # noqa: BLE001 — a missing series is data
            # Recorded as absent, never substituted. `build_asof` reports it.
            out[spec.series_id] = pd.DataFrame(
                columns=["obs_date", "value", "published"]
            ).astype({"value": float})
            out[f"__error__{spec.series_id}"] = str(exc)  # type: ignore[assignment]
    return out


def build_asof(
    when: pd.Timestamp | str,
    vintages: dict[str, pd.DataFrame],
    *,
    specs: tuple[SeriesSpec, ...] = PANEL,
    min_usable: int = MIN_USABLE_OBS,
) -> PanelBuild:
    """Assemble the panel using only what had been published by `when`.

    Filter first, transform second. See the module docstring for why that order
    is not interchangeable.
    """
    when = pd.Timestamp(when)
    if when.tzinfo is None:
        when = when.tz_localize("UTC")

    levels: dict[str, pd.Series] = {}
    transformed: dict[str, pd.Series] = {}
    dropped: dict[str, str] = {}
    edge: dict[str, dict] = {}

    for spec in specs:
        hist = vintages.get(spec.series_id)
        if hist is None or hist.empty:
            dropped[spec.series_id] = "no vintage archive"
            continue

        # (1) point-in-time filter — first releases published on or before `when`
        published = known_at(hist, when)
        if published.empty:
            dropped[spec.series_id] = "nothing published by this date"
            continue

        need = lags_consumed(spec.code) + min_usable
        if len(published) < need:
            dropped[spec.series_id] = (
                f"{len(published)} published observations, needs {need} "
                f"for transform {spec.code}"
            )
            continue

        # (2) transform, on the filtered series only
        try:
            values = apply_code(published, spec.code)
        except Exception as exc:  # noqa: BLE001 — a bad transform is data
            dropped[spec.series_id] = f"transform failed: {exc}"
            continue

        usable = values.dropna()
        if len(usable) < min_usable:
            dropped[spec.series_id] = f"{len(usable)} usable after transform"
            continue

        levels[spec.series_id] = published
        transformed[spec.series_id] = values
        # `known_at` returns a UTC-aware index; normalising here rather than
        # assuming either way keeps this working if that ever changes.
        newest = pd.Timestamp(published.index.max())
        newest = newest.tz_localize("UTC") if newest.tzinfo is None else newest.tz_convert("UTC")
        edge[spec.series_id] = {
            "through": str(newest.date()),
            "days_behind": int((when - newest).days),
            "n_published": int(len(published)),
            "n_usable": int(len(usable)),
        }

    if not transformed:
        return PanelBuild(
            as_of=str(when.date()), frame=pd.DataFrame(), levels=pd.DataFrame(),
            used=(), dropped=dropped, edge={},
        )

    frame = pd.DataFrame(transformed).sort_index()
    level_frame = pd.DataFrame(levels).sort_index()
    newest_any = max(pd.Timestamp(e["through"]) for e in edge.values())
    months_behind = (when.year - newest_any.year) * 12 + (when.month - newest_any.month)

    used = tuple(frame.columns)
    groups = {
        g: tuple(s for s in used if PANEL_BY_ID[s].group == g) for g in GROUPS
    }
    return PanelBuild(
        as_of=str(when.date()),
        frame=frame,
        levels=level_frame,
        used=used,
        dropped=dropped,
        edge=edge,
        months_behind=int(months_behind),
        groups={g: v for g, v in groups.items() if v},
    )
