"""The Growth/Inflation quad model, built point-in-time.

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
payrolls, and 119 for real GDP — so on 31 March 2020 nobody knew Q1 GDP, and
would not until late July.

Classify March 2020 as Quad 4 using today's revised figures and you did not
nowcast a regime, you read an almanac. Every quad here is built from ALFRED
first-release vintages filtered to what had actually been PUBLISHED by the
classification date.

It is also why GDP is not used: a 119-day lag means the print describes a
quarter that ended four months ago. Monthly industrial production and payrolls
are what a real-time classification can lean on.

WHAT THIS MODULE DOES NOT DO

It does not assert the quads predict asset returns. That is a separate,
testable claim, tested against a base rate out of sample in
`ace/models/quad_model.py`. This module only classifies.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from ace.data.alfred import release_history

# Monthly, and fast enough to publish inside a nowcast. GDP's 119-day lag
# excludes it: by the time it lands the quarter is four months gone.
GROWTH_SERIES = ("INDPRO", "PAYEMS")
INFLATION_SERIES = ("CPIAUCSL",)

QUAD_NAMES = {1: "Goldilocks", 2: "Reflation", 3: "Stagflation", 4: "Deflation"}
QUAD_DESCRIPTION = {
    1: "Growth accelerating while inflation decelerates.",
    2: "Growth and inflation both accelerating.",
    3: "Inflation accelerating while growth decelerates.",
    4: "Growth and inflation both decelerating.",
}

#: Months over which a year-on-year rate is compared with its own past to
#: decide "accelerating". One month is noise; a quarter is the shortest span
#: over which a turn in the second derivative beats revision churn.
ROC_LOOKBACK_MONTHS = 3
#: A year-on-year rate needs 13 observations. Below this there is no reading.
MIN_OBSERVATIONS = 13 + ROC_LOOKBACK_MONTHS


@dataclass(frozen=True)
class QuadReading:
    """One classification, and the numbers behind it."""

    as_of: str
    quad: int | None
    name: str
    growth_yoy: float | None
    inflation_yoy: float | None
    growth_roc: float | None
    inflation_roc: float | None
    #: Latest observation month each input had PUBLISHED by `as_of`.
    growth_through: str | None
    inflation_through: str | None
    #: Days between the newest input observation and the classification date.
    data_lag_days: int | None
    reason: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _yoy(values: pd.Series) -> pd.Series:
    """Year-on-year percent change of a monthly series."""
    return values.pct_change(12) * 100.0


def vintage_frame(series_id: str, start: str = "1998-01-01") -> pd.DataFrame:
    """First-release history for a series: obs_date, value, published."""
    return release_history(series_id, start)


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


def reading_at(
    when: pd.Timestamp,
    vintages: dict[str, pd.DataFrame],
    *,
    lookback: int = ROC_LOOKBACK_MONTHS,
) -> QuadReading:
    """Classify the regime using only what had been published by `when`."""
    when = pd.Timestamp(when)
    if when.tzinfo is None:
        when = when.tz_localize("UTC")
    blank = QuadReading(
        as_of=str(when.date()), quad=None, name="unclassified",
        growth_yoy=None, inflation_yoy=None, growth_roc=None, inflation_roc=None,
        growth_through=None, inflation_through=None, data_lag_days=None,
    )

    def composite(ids: tuple[str, ...]) -> tuple[pd.Series | None, pd.Timestamp | None]:
        """Average YoY across the inputs, on their common published months."""
        parts = []
        for sid in ids:
            hist = vintages.get(sid)
            if hist is None:
                continue
            known = known_at(hist, when)
            if len(known) < MIN_OBSERVATIONS:
                continue
            parts.append(_yoy(known).dropna())
        if not parts:
            return None, None
        frame = pd.concat(parts, axis=1).dropna()
        if len(frame) < lookback + 1:
            return None, None
        return frame.mean(axis=1), frame.index.max()

    g, g_through = composite(GROWTH_SERIES)
    i, i_through = composite(INFLATION_SERIES)
    if g is None or i is None:
        return QuadReading(**{**blank.to_dict(),
                              "reason": "not enough published history for a year-on-year rate"})

    # Rate of change: how the year-on-year rate compares with itself a quarter
    # ago. This is the second derivative the framework turns on.
    g_roc = float(g.iloc[-1] - g.iloc[-1 - lookback])
    i_roc = float(i.iloc[-1] - i.iloc[-1 - lookback])
    quad = classify(g_roc, i_roc)
    newest = max(g_through, i_through)

    return QuadReading(
        as_of=str(when.date()),
        quad=quad,
        name=QUAD_NAMES[quad],
        growth_yoy=round(float(g.iloc[-1]), 4),
        inflation_yoy=round(float(i.iloc[-1]), 4),
        growth_roc=round(g_roc, 4),
        inflation_roc=round(i_roc, 4),
        growth_through=str(g_through.date()),
        inflation_through=str(i_through.date()),
        data_lag_days=int((when - newest).days),
        reason=QUAD_DESCRIPTION[quad],
    )


def quad_history(
    dates: pd.DatetimeIndex,
    *,
    start: str = "1998-01-01",
    lookback: int = ROC_LOOKBACK_MONTHS,
) -> pd.DataFrame:
    """A point-in-time quad for every date, from one vintage fetch per series.

    The vintages are fetched once and filtered per date, so this is cheap even
    over decades — and, more importantly, every row uses only what had been
    published by its own date.
    """
    vintages = {
        sid: vintage_frame(sid, start)
        for sid in (*GROWTH_SERIES, *INFLATION_SERIES)
    }
    rows = [reading_at(d, vintages, lookback=lookback).to_dict() for d in dates]
    out = pd.DataFrame(rows)
    out.index = pd.DatetimeIndex(dates)
    return out


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
