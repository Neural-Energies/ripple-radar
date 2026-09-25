"""The Growth/Inflation quad, built point-in-time.

The framework is the one Hedgeye popularised: classify the economy not by the
LEVEL of growth and inflation but by their RATE OF CHANGE, into four regimes.

                  inflation decelerating   inflation accelerating
  growth accel          Quad 1                    Quad 2
                      "Goldilocks"              "Reflation"
  growth decel          Quad 4                    Quad 3
                      "Deflation"              "Stagflation"

WHY POINT-IN-TIME IS THE WHOLE THING

Macro data is revised for years, and it publishes late. On this sample the
median publication lag is 45 days for industrial production and CPI, 34 for
payrolls, 59 for the real consumption and income series, and 119 for real GDP —
so on 31 March 2020 nobody knew Q1 GDP, and would not until late July.

Classify March 2020 as Quad 4 using today's revised figures and you did not
nowcast a regime, you read an almanac. Every quad here is built from ALFRED
first-release vintages filtered to what had actually been PUBLISHED by the
classification date.

It is also why GDP is not used at all: a 119-day lag means the print describes
a quarter that ended four months ago.

THE THREE THINGS THIS MODULE REFUSES TO DECIDE BY TASTE

1. WHICH SERIES. A quad is only as good as the composite behind it, and
   "industrial production and payrolls" is a convention, not a result. So the
   module carries several named specifications and `ace/macro/revisions.py`
   picks between them on a stated criterion — which one's real-time label most
   often survives contact with the revised data — measured on a training window
   and checked on a holdout.

2. HOW LONG A LOOKBACK. Same treatment: 1, 3 and 6 months are all specified and
   all measured.

3. HOW CONFIDENT. A reading whose rates of change sit a hair from zero is a
   coin flip that will flip. Every reading therefore carries its MARGIN — the
   distance from the nearest boundary — and `revisions.py` turns that margin
   into a measured survival probability rather than a feeling.

WHAT THIS MODULE DOES NOT DO

It does not assert the quads predict asset returns. That is a separate,
testable claim, tested against a base rate out of sample in
`ace/models/quad_model.py` (returns — failed) and `ace/models/quad_vol_model.py`
(volatility — a different claim, tested separately). This module only
classifies, and reports how much to trust the classification.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from ace.data.alfred import current_vintage, release_history


@dataclass(frozen=True)
class SeriesSpec:
    """One input, and why it is eligible."""

    series_id: str
    label: str
    axis: str            # "growth" | "inflation"
    #: Median publication lag in days, measured from the vintage archive. Kept
    #: here as documentation; the live number is recomputed on every export.
    typical_lag_days: int
    #: First observation month ALFRED's first-release archive covers.
    vintage_from: str
    note: str


#: Every eligible input. Each growth series is a REAL quantity whose
#: year-on-year change is a growth rate, and each inflation series is a PRICE
#: INDEX whose year-on-year change is an inflation rate — so averaging across
#: an axis stays dimensionally coherent without standardisation. Utilisation
#: rates and diffusion indices are deliberately absent for that reason.
SERIES: tuple[SeriesSpec, ...] = (
    SeriesSpec("PAYEMS", "Nonfarm payrolls", "growth", 34, "1998-01-01",
               "The fastest broad read on the economy, and the one the rest wait for."),
    SeriesSpec("INDPRO", "Industrial production", "growth", 45, "1998-01-01",
               "Cyclical and volatile; turns before the labour market."),
    SeriesSpec("RRSFS", "Real retail sales", "growth", 45, "2001-06-01",
               "Consumption in volume terms, so inflation does not leak into growth."),
    SeriesSpec("PCEC96", "Real consumption", "growth", 59, "1998-01-01",
               "Two thirds of output, but it publishes three weeks behind payrolls."),
    SeriesSpec("DSPIC96", "Real disposable income", "growth", 59, "1998-01-01",
               "What funds the consumption above; turns earlier in an income shock."),
    SeriesSpec("CPIAUCSL", "CPI", "inflation", 45, "1998-01-01",
               "Headline. What households and index-linked contracts actually face."),
    SeriesSpec("CPILFESL", "Core CPI", "inflation", 45, "1998-01-01",
               "Ex food and energy; less noisy, and slower to turn."),
    SeriesSpec("PPIACO", "Producer prices", "inflation", 43, "1998-01-01",
               "Upstream, so it leads consumer prices when the shock is a cost shock."),
)

SERIES_BY_ID: dict[str, SeriesSpec] = {s.series_id: s for s in SERIES}


@dataclass(frozen=True)
class Spec:
    """A named specification: which series, and how long a rate-of-change."""

    name: str
    growth: tuple[str, ...]
    inflation: tuple[str, ...]
    lookback: int
    rationale: str

    @property
    def series_ids(self) -> tuple[str, ...]:
        return (*self.growth, *self.inflation)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "growth": list(self.growth),
            "inflation": list(self.inflation),
            "lookback": self.lookback,
            "rationale": self.rationale,
        }


_FAST_G = ("INDPRO", "PAYEMS")
_BROAD_G = ("INDPRO", "PAYEMS", "RRSFS", "PCEC96", "DSPIC96")
_BROAD_I = ("CPIAUCSL", "CPILFESL", "PPIACO")

#: The candidate set. Chosen to span the real trade-offs — breadth against
#: timeliness, headline against core, one month of rate-of-change against six —
#: rather than to include every combination. `revisions.select_spec()` decides
#: between them on measured revision survival.
SPECS: dict[str, Spec] = {
    s.name: s
    for s in (
        Spec("fast", _FAST_G, ("CPIAUCSL",), 3,
             "Two of the quickest broad series. Least lag, narrowest evidence."),
        Spec("broad", _BROAD_G, _BROAD_I, 3,
             "Five growth series and three price series. Most evidence, "
             "dragged to the slowest member's publication date."),
        Spec("core", _FAST_G, ("CPILFESL",), 3,
             "Core inflation instead of headline: fewer energy head-fakes, "
             "slower to register a real one."),
        Spec("labour", ("PAYEMS",), ("CPIAUCSL",), 3,
             "Payrolls alone. The single fastest read; no cross-confirmation."),
        Spec("production", ("INDPRO",), ("CPIAUCSL",), 3,
             "Industrial production alone. Turns early and cries wolf."),
        Spec("fast_1m", _FAST_G, ("CPIAUCSL",), 1,
             "One month of rate-of-change. Maximum responsiveness, maximum noise."),
        Spec("fast_6m", _FAST_G, ("CPIAUCSL",), 6,
             "Six months. Smooth enough to miss a turn until it is obvious."),
        Spec("broad_6m", _BROAD_G, _BROAD_I, 6,
             "Broad evidence on a slow clock — the most conservative reading here."),
    )
}

DEFAULT_SPEC = "fast"

QUAD_NAMES = {1: "Goldilocks", 2: "Reflation", 3: "Stagflation", 4: "Deflation"}
QUAD_DESCRIPTION = {
    1: "Growth accelerating while inflation decelerates.",
    2: "Growth and inflation both accelerating.",
    3: "Inflation accelerating while growth decelerates.",
    4: "Growth and inflation both decelerating.",
}

#: A year-on-year rate needs 13 observations, plus the lookback to difference it.
MIN_OBSERVATIONS_BASE = 13


@dataclass(frozen=True)
class AxisReading:
    """One axis of the 2x2, and the inputs that produced it."""

    yoy: float | None
    roc: float | None
    through: str | None
    #: Series that were published far enough back to contribute, and those that
    #: were not. Absence is data: early in the sample the broad specs run on
    #: fewer inputs than they name, and a reader should see that.
    used: tuple[str, ...] = ()
    missing: tuple[str, ...] = ()
    #: Each contributing series' own yoy and roc, so a reader can see whether
    #: the composite is a consensus or one series outvoting the rest.
    contributions: dict[str, dict[str, float]] = field(default_factory=dict)

    @property
    def dispersion(self) -> float | None:
        """Standard deviation of the members' rates of change.

        High dispersion with a small composite means the inputs disagree and
        the axis is being decided by whichever one is loudest this month.
        """
        rocs = [c["roc"] for c in self.contributions.values() if c.get("roc") is not None]
        if len(rocs) < 2:
            return None
        return float(np.std(rocs, ddof=1))

    @property
    def agreement(self) -> float | None:
        """Share of members whose rate of change has the composite's sign."""
        rocs = [c["roc"] for c in self.contributions.values() if c.get("roc") is not None]
        if not rocs or self.roc is None:
            return None
        want = self.roc >= 0
        return float(sum((r >= 0) == want for r in rocs) / len(rocs))


@dataclass(frozen=True)
class QuadReading:
    """One classification, the numbers behind it, and how firm it is."""

    as_of: str
    spec: str
    quad: int | None
    name: str
    growth_yoy: float | None
    inflation_yoy: float | None
    growth_roc: float | None
    inflation_roc: float | None
    growth_through: str | None
    inflation_through: str | None
    #: Days from the START of the newest observation month to the
    #: classification date. Structurally ~60 even for a fast series, because a
    #: month labelled 2026-08-01 is not complete until 2026-08-31.
    data_lag_days: int | None
    #: Whole calendar months between the newest observation month and the
    #: classification month. The number to put on screen: "two months behind".
    months_behind: int | None = None
    reason: str = ""
    #: Distance from the nearest boundary, on each axis and overall. A reading
    #: whose margin is near zero is one revision away from a different quad.
    growth_margin: float | None = None
    inflation_margin: float | None = None
    margin: float | None = None
    growth_used: tuple[str, ...] = ()
    inflation_used: tuple[str, ...] = ()
    growth_missing: tuple[str, ...] = ()
    inflation_missing: tuple[str, ...] = ()
    growth_agreement: float | None = None
    inflation_agreement: float | None = None
    growth_dispersion: float | None = None
    inflation_dispersion: float | None = None
    contributions: dict[str, dict[str, float]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("growth_used", "inflation_used", "growth_missing", "inflation_missing"):
            d[k] = list(d[k])
        return d


def _yoy(values: pd.Series) -> pd.Series:
    """Year-on-year percent change of a monthly series."""
    return values.pct_change(12) * 100.0


def vintage_frame(series_id: str, start: str = "1998-01-01") -> pd.DataFrame:
    """First-release history for a series: obs_date, value, published."""
    return release_history(series_id, start)


def final_frame(series_id: str, start: str = "1998-01-01") -> pd.Series:
    """The series as it stands today, every revision included.

    Hindsight by construction. Its only job is as the answer key in
    `ace/macro/revisions.py`; nothing that feeds a forecast may call it.
    """
    return current_vintage(series_id, start)


def known_at(hist: pd.DataFrame, when: pd.Timestamp) -> pd.Series:
    """The series as it stood at `when`, indexed by observation month.

    Filters on the PUBLICATION timestamp. A value observed in March but
    published in May does not exist on an April classification date.
    """
    seen = hist[hist["published"] <= when]
    if seen.empty:
        return pd.Series(dtype=float)
    # Keep the first release per observation month; a later revision of the
    # same month is a different number that was not known at `when` either.
    out = seen.sort_values("published").groupby("obs_date")["value"].first()
    return out.sort_index()


def classify(growth_roc: float, inflation_roc: float) -> int:
    """The 2x2. Growth accelerating is the top row, inflation the right column."""
    if growth_roc >= 0:
        return 2 if inflation_roc >= 0 else 1
    return 3 if inflation_roc >= 0 else 4


def _axis_reading(
    levels: dict[str, pd.Series],
    ids: tuple[str, ...],
    lookback: int,
) -> AxisReading:
    """Average year-on-year across the inputs, on their common published months.

    The composite is evaluated on the newest month EVERY included series covers,
    and the rate of change differences that same membership against itself a
    `lookback` earlier. Differencing a composite whose membership changed
    between the two dates would book a composition change as an economic turn,
    which is the quiet way a regime model invents a regime.
    """
    blank = AxisReading(yoy=None, roc=None, through=None, missing=tuple(ids))
    need = MIN_OBSERVATIONS_BASE + lookback
    parts: dict[str, pd.Series] = {}
    missing: list[str] = []
    for sid in ids:
        s = levels.get(sid)
        if s is None or len(s) < need:
            missing.append(sid)
            continue
        y = _yoy(s).dropna()
        if len(y) < lookback + 1:
            missing.append(sid)
            continue
        parts[sid] = y
    if not parts:
        return blank

    frame = pd.concat(parts, axis=1).dropna()
    if len(frame) < lookback + 1:
        return blank
    through = frame.index.max()
    composite = frame.mean(axis=1)
    yoy = float(composite.iloc[-1])
    roc = float(composite.iloc[-1] - composite.iloc[-1 - lookback])

    contributions = {
        sid: {
            "yoy": round(float(frame[sid].iloc[-1]), 4),
            "roc": round(float(frame[sid].iloc[-1] - frame[sid].iloc[-1 - lookback]), 4),
        }
        for sid in frame.columns
    }
    return AxisReading(
        yoy=round(yoy, 4),
        roc=round(roc, 4),
        through=str(through.date()),
        used=tuple(frame.columns),
        missing=tuple(missing),
        contributions=contributions,
    )


def reading_from_levels(
    levels: dict[str, pd.Series],
    when: pd.Timestamp,
    spec: Spec,
) -> QuadReading:
    """Classify from already-assembled level series. One arithmetic, two callers.

    Both the point-in-time path and the revised-data answer key come through
    here, so a difference between them is a difference in the DATA and never a
    difference in the method.
    """
    when = pd.Timestamp(when)
    if when.tzinfo is None:
        when = when.tz_localize("UTC")

    g = _axis_reading(levels, spec.growth, spec.lookback)
    i = _axis_reading(levels, spec.inflation, spec.lookback)

    if g.roc is None or i.roc is None:
        missing = sorted({*g.missing, *i.missing})
        return QuadReading(
            as_of=str(when.date()), spec=spec.name, quad=None, name="unclassified",
            growth_yoy=None, inflation_yoy=None, growth_roc=None, inflation_roc=None,
            growth_through=None, inflation_through=None, data_lag_days=None,
            reason="not enough published history for a year-on-year rate"
                   + (f" ({', '.join(missing)})" if missing else ""),
            growth_missing=g.missing, inflation_missing=i.missing,
        )

    quad = classify(g.roc, i.roc)
    newest = max(pd.Timestamp(g.through, tz="UTC"), pd.Timestamp(i.through, tz="UTC"))
    g_margin = abs(g.roc)
    i_margin = abs(i.roc)

    return QuadReading(
        as_of=str(when.date()),
        spec=spec.name,
        quad=quad,
        name=QUAD_NAMES[quad],
        growth_yoy=g.yoy,
        inflation_yoy=i.yoy,
        growth_roc=g.roc,
        inflation_roc=i.roc,
        growth_through=g.through,
        inflation_through=i.through,
        data_lag_days=int((when - newest).days),
        months_behind=(when.year - newest.year) * 12 + (when.month - newest.month),
        reason=QUAD_DESCRIPTION[quad],
        growth_margin=round(g_margin, 4),
        inflation_margin=round(i_margin, 4),
        # The quad changes as soon as EITHER axis crosses, so the reading is
        # only as firm as its weaker axis.
        margin=round(min(g_margin, i_margin), 4),
        growth_used=g.used,
        inflation_used=i.used,
        growth_missing=g.missing,
        inflation_missing=i.missing,
        growth_agreement=None if g.agreement is None else round(g.agreement, 4),
        inflation_agreement=None if i.agreement is None else round(i.agreement, 4),
        growth_dispersion=None if g.dispersion is None else round(g.dispersion, 4),
        inflation_dispersion=None if i.dispersion is None else round(i.dispersion, 4),
        contributions={**g.contributions, **i.contributions},
    )


def reading_at(
    when: pd.Timestamp,
    vintages: dict[str, pd.DataFrame],
    *,
    spec: Spec | str = DEFAULT_SPEC,
) -> QuadReading:
    """Classify the regime using only what had been published by `when`."""
    spec = SPECS[spec] if isinstance(spec, str) else spec
    when = pd.Timestamp(when)
    if when.tzinfo is None:
        when = when.tz_localize("UTC")
    levels = {
        sid: known_at(hist, when)
        for sid, hist in vintages.items()
        if sid in spec.series_ids
    }
    return reading_from_levels(levels, when, spec)


def final_reading_at(
    when: pd.Timestamp,
    finals: dict[str, pd.Series],
    *,
    spec: Spec | str = DEFAULT_SPEC,
    through: pd.Timestamp | None = None,
) -> QuadReading:
    """The same classification from today's revised data — the answer key.

    `through` says which observation month to cut the revised series at, so the
    comparison is like for like: the real-time reading saw months up to X, and
    the answer key is asked what it now says about the very same months.
    """
    spec = SPECS[spec] if isinstance(spec, str) else spec
    levels = {}
    for sid in spec.series_ids:
        s = finals.get(sid)
        if s is None:
            continue
        levels[sid] = s if through is None else s[s.index <= through]
    return reading_from_levels(levels, when, spec)


def load_vintages(spec: Spec | str = DEFAULT_SPEC, start: str = "1998-01-01") -> dict[str, pd.DataFrame]:
    """Fetch first-release archives for one spec's inputs."""
    spec = SPECS[spec] if isinstance(spec, str) else spec
    return {sid: vintage_frame(sid, start) for sid in spec.series_ids}


def load_all_vintages(start: str = "1998-01-01") -> dict[str, pd.DataFrame]:
    """Fetch every eligible input once, so comparing specs costs no extra calls."""
    return {s.series_id: vintage_frame(s.series_id, start) for s in SERIES}


def load_all_finals(start: str = "1998-01-01") -> dict[str, pd.Series]:
    """Today's revised series for every eligible input. Answer key only."""
    return {s.series_id: final_frame(s.series_id, start) for s in SERIES}


def quad_history(
    dates: pd.DatetimeIndex,
    *,
    spec: Spec | str = DEFAULT_SPEC,
    vintages: dict[str, pd.DataFrame] | None = None,
    start: str = "1998-01-01",
) -> pd.DataFrame:
    """A point-in-time quad for every date, from one vintage fetch per series.

    The vintages are fetched once and filtered per date, so this is cheap even
    over decades — and, more importantly, every row uses only what had been
    published by its own date.
    """
    spec = SPECS[spec] if isinstance(spec, str) else spec
    if vintages is None:
        vintages = load_vintages(spec, start)
    rows = [reading_at(d, vintages, spec=spec).to_dict() for d in dates]
    out = pd.DataFrame(rows)
    out.index = pd.DatetimeIndex(dates)
    return out


def month_ends(start: str = "2000-01-01", end: pd.Timestamp | None = None) -> pd.DatetimeIndex:
    """UTC month-ends from `start` to now.

    A helper rather than a one-liner because mixing a naive string with a
    tz-aware `now` is a pandas error, and every caller here needs the same
    UTC-aware index.
    """
    end = pd.Timestamp.now(tz="UTC") if end is None else pd.Timestamp(end)
    if end.tzinfo is None:
        end = end.tz_localize("UTC")
    return pd.date_range(pd.Timestamp(start, tz="UTC"), end, freq="ME")


def transitions(history: pd.DataFrame) -> pd.DataFrame:
    """Empirical quad-to-quad transition counts, as a Markov matrix.

    Descriptive: it says how the regime has historically moved, not how it
    will. Rows are the current quad, columns the next distinct quad.
    """
    q = history["quad"].dropna().astype(int)
    # Collapse runs, so this counts REGIME CHANGES rather than how long each
    # regime happened to last — otherwise the diagonal swamps everything.
    changes = q[q != q.shift()]
    mat = pd.DataFrame(0, index=[1, 2, 3, 4], columns=[1, 2, 3, 4], dtype=float)
    for a, b in zip(changes, changes.shift(-1).dropna().astype(int)):
        mat.loc[a, b] += 1
    totals = mat.sum(axis=1).replace(0, np.nan)
    return mat.div(totals, axis=0).fillna(0.0)


def _largest_remainder(counts: dict[str, int], total: int, places: int = 4) -> dict[str, float]:
    """Round shares so they still sum to exactly one."""
    if total <= 0:
        return {}
    scale = 10 ** places
    exact = {k: v * scale / total for k, v in counts.items()}
    floors = {k: int(v) for k, v in exact.items()}
    short = scale - sum(floors.values())
    order = sorted(exact, key=lambda k: exact[k] - floors[k], reverse=True)
    for k in order[:short]:
        floors[k] += 1
    return {k: v / scale for k, v in floors.items()}


def occupancy(history: pd.DataFrame, months: int = 12) -> dict:
    """Share of the last `months` classified month-ends spent in each quad.

    The point reading flips often — on this data the median spell is about two
    months under every specification tested — so a single month-end label is a
    noisy summary of where the economy has been. The occupancy share is not:
    it is the same evidence read over a window, and it moves when the balance
    of evidence moves rather than when one rate of change crosses zero.

    This is the honest headline for a regime panel. The point reading is the
    honest headline for "what does the newest data say", which is a different
    and more fragile question.
    """
    q = history["quad"].dropna().astype(int)
    if q.empty:
        return {"months": 0, "shares": {}, "dominant": None, "dominant_share": None}
    window = q.tail(months)
    counts = window.value_counts()
    n = int(len(window))
    # Largest-remainder rounding, because these shares drive the widths of a
    # stacked bar: naive per-share rounding made a twelve-month window sum to
    # 1.0001, which is a bar that overflows its track. Rounding the largest
    # remainders up distributes the error to the segments best able to absorb
    # it and leaves the total exactly one.
    shares = _largest_remainder({str(int(k)): int(v) for k, v in counts.sort_index().items()}, n)
    top = int(counts.max())
    # A tie is not a dominant regime, and resolving it by whichever quad came
    # first in the index would put a number on screen that the data does not
    # support. Surface it instead so the caller can say "split" rather than
    # naming an arbitrary winner.
    leaders = sorted(int(k) for k, v in counts.items() if int(v) == top)
    return {
        "months": n,
        "shares": shares,
        "counts": {str(int(k)): int(v) for k, v in counts.sort_index().items()},
        "dominant": leaders[0],
        "dominant_share": round(top / n, 4),
        "tied": len(leaders) > 1,
        "tied_with": leaders[1:],
        "distinct_quads": int(counts.size),
        "switches": int((window != window.shift()).sum() - 1),
    }


def runs(history: pd.DataFrame) -> pd.DataFrame:
    """Contiguous spells in one quad: start, end, length, and whether censored.

    The final spell is right-censored — it has not ended yet — and treating its
    observed length as a completed duration would bias every survival estimate
    downward. `ace/macro/durations.py` handles the censoring properly.
    """
    q = history["quad"].dropna().astype(int)
    if q.empty:
        return pd.DataFrame(columns=["quad", "start", "end", "months", "censored"])
    grp = (q != q.shift()).cumsum()
    rows = []
    last = grp.iloc[-1]
    for gid, chunk in q.groupby(grp):
        rows.append({
            "quad": int(chunk.iloc[0]),
            "start": chunk.index[0],
            "end": chunk.index[-1],
            "months": int(len(chunk)),
            "censored": bool(gid == last),
        })
    return pd.DataFrame(rows)
