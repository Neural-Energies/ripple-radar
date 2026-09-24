"""Reading the backfilled GDELT event database.

GDELT carries two dates per event and they are not interchangeable.

  event_date   when the event is reported to have happened (SQLDATE)
  observed_at  when GDELT first saw the article describing it (DATEADDED)

On the backfilled sample, 95% of events have the two within a day of each
other — and 1.5% are more than a week apart, with a maximum gap of **3,650
days**. GDELT ingests retrospective coverage: an article published in 2022
about an event in 2012 enters the file dated 2022 and carries SQLDATE 2012.

A forecasting model keyed on `event_date` would therefore place a small but
real fraction of its observations before anyone could have known them, some by
years. That is exactly the dual-clock problem ACE's forecast ledger already
solves for its own predictions, and it applies here too: `observed_at` is the
availability clock, and it is the default for everything that produces a time
series. `event_date` remains available for describing what happened, which is
a different question from what was knowable.
"""
from __future__ import annotations

import glob
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from ace.config import CACHE

# CAMEO event root codes, 01-20. The conflict half (14-20) is what a cascade
# or competing-risks model is about; the cooperative half is context.
CAMEO_ROOT = {
    "01": "public statement", "02": "appeal", "03": "express intent to cooperate",
    "04": "consult", "05": "diplomatic cooperation", "06": "material cooperation",
    "07": "provide aid", "08": "yield", "09": "investigate", "10": "demand",
    "11": "disapprove", "12": "reject", "13": "threaten", "14": "protest",
    "15": "exhibit force posture", "16": "reduce relations", "17": "coerce",
    "18": "assault", "19": "fight", "20": "unconventional mass violence",
}
QUAD_CLASS = {1: "verbal cooperation", 2: "material cooperation",
              3: "verbal conflict", 4: "material conflict"}

CLOCKS = {"observed": "observed_at", "event": "event_date"}


def cached_files(min_mentions: int = 10, quad: tuple[int, ...] = (3, 4)) -> list[Path]:
    tag = f"m{min_mentions}_q{''.join(str(q) for q in quad)}" if quad else f"m{min_mentions}_qall"
    return sorted(Path(p) for p in glob.glob(str(CACHE / f"gdelt_daily_*_{tag}.parquet")))


def load_events(
    *,
    start: str | None = None,
    end: str | None = None,
    min_mentions: int = 10,
    quad: tuple[int, ...] = (3, 4),
    clock: str = "observed",
    min_mentions_filter: int | None = None,
) -> pd.DataFrame:
    """Every cached day as one frame, indexed by the chosen clock.

    `min_mentions` selects which cached slice to read; `min_mentions_filter`
    raises the bar further without re-downloading.
    """
    if clock not in CLOCKS:
        raise ValueError(f"clock must be one of {sorted(CLOCKS)}")
    files = cached_files(min_mentions, quad)
    if not files:
        raise FileNotFoundError(
            f"no cached GDELT days for min_mentions={min_mentions} quad={quad}. "
            "Run ace/feeds/backfill_gdelt.py first."
        )
    frames = [pd.read_parquet(f) for f in files]
    df = pd.concat(frames, ignore_index=True)

    for col in ("observed_at", "event_date"):
        df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
    df = df.dropna(subset=[CLOCKS[clock]])

    if min_mentions_filter:
        df = df[df["num_mentions"] >= min_mentions_filter]
    df["event_root_code"] = df["event_root_code"].astype(str).str.zfill(2)
    df["root_label"] = df["event_root_code"].map(CAMEO_ROOT).fillna("unknown")
    df["report_lag_days"] = (df["observed_at"] - df["event_date"]).dt.days

    df = df.sort_values(CLOCKS[clock]).set_index(CLOCKS[clock])
    if start:
        df = df[df.index >= pd.Timestamp(start, tz="UTC")]
    if end:
        df = df[df.index <= pd.Timestamp(end, tz="UTC")]
    if clock == "event":
        warnings.warn(
            "clock='event' places events at the date they happened, not the date "
            "they became knowable. Do not use it to build forecasting features.",
            stacklevel=2,
        )
    return df


# Columns a daily aggregation actually needs. Reading 25 columns of 11M rows to
# produce a count per country per day is how the loader ran the machine out of
# memory; parquet lets us read three.
AGG_COLUMNS = ["observed_at", "quad_class", "event_root_code", "action_geo_country",
               "num_mentions"]


def daily_counts_by(
    column: str,
    *,
    quad_classes: tuple[int, ...] | None = None,
    min_mentions: int = 10,
    quad: tuple[int, ...] = (3, 4),
    min_mentions_filter: int | None = None,
) -> pd.DataFrame:
    """Daily counts per `column` value, accumulated one cached day at a time.

    `load_events` concatenates every cached file into a single frame. At 1,400
    days and 11M rows that is ~2GB of mostly-unneeded text columns, and it was
    killed by the OOM reaper mid-run -- taking the backfill sharing the machine
    with it.

    Nothing downstream of a daily model needs the rows. It needs counts. So
    each file is read with only the columns the aggregation touches, reduced
    immediately, and dropped. Peak memory becomes one day's file plus the
    result grid rather than the whole corpus.

    A day that was fetched and had nothing qualifying is a real 0; a day never
    fetched stays NaN, exactly as `daily_series` does it.
    """
    files = cached_files(min_mentions, quad)
    if not files:
        raise FileNotFoundError(
            f"no cached GDELT days for min_mentions={min_mentions} quad={quad}"
        )
    want = [c for c in AGG_COLUMNS if c != "observed_at"]
    frames: list[pd.Series] = []
    days: list[pd.Timestamp] = []
    for f in files:
        cols = ["observed_at", *want] if column in want or column == "observed_at" else \
            ["observed_at", *want, column]
        try:
            df = pd.read_parquet(f, columns=list(dict.fromkeys(cols)))
        except Exception:
            df = pd.read_parquet(f)
        if quad_classes is not None and "quad_class" in df.columns:
            df = df[df["quad_class"].isin(quad_classes)]
        if min_mentions_filter and "num_mentions" in df.columns:
            df = df[df["num_mentions"] >= min_mentions_filter]
        day = pd.Timestamp(f.name.split("_")[2], tz="UTC")
        days.append(day)
        if df.empty or column not in df.columns:
            frames.append(pd.Series(dtype="int64", name=day))
            continue
        counts = df[column].astype(str).value_counts()
        counts.name = day
        frames.append(counts)
        del df

    wide = pd.DataFrame(frames).fillna(0.0)
    wide.index = pd.DatetimeIndex(days)
    wide = wide.sort_index()
    # Re-expand to a full calendar so never-fetched days read NaN, not 0.
    full = pd.date_range(wide.index.min(), wide.index.max(), freq="D", tz="UTC")
    present = full.isin(wide.index)
    wide = wide.reindex(full)
    wide[~present] = np.nan
    return wide


def coverage(events: pd.DataFrame) -> dict:
    """What the store actually holds — stated, not assumed."""
    idx = events.index
    days = pd.Series(1, index=idx).resample("D").sum()
    expected = pd.date_range(idx.min().normalize(), idx.max().normalize(), freq="D", tz="UTC")
    have = set(cached_days())
    missing = [d for d in expected if d not in have]
    lag = events["report_lag_days"]
    return {
        "n_events": int(len(events)),
        "start": str(idx.min().date()), "end": str(idx.max().date()),
        "days_covered": int((days > 0).sum()), "days_expected": int(len(expected)),
        "days_missing": len(missing),
        "missing_sample": [str(d.date()) for d in missing[:10]],
        "median_events_per_day": float(days[days > 0].median()),
        "report_lag_median_days": float(lag.median()),
        "report_lag_p99_days": float(lag.quantile(0.99)),
        "share_lagged_over_7d": round(float((lag > 7).mean()), 5),
    }


def cached_days(min_mentions: int = 10, quad: tuple[int, ...] = (3, 4)) -> pd.DatetimeIndex:
    """The days actually downloaded, read off the cache filenames.

    Needed to tell "no qualifying events that day" (a zero) from "that day was
    never fetched, or GDELT's file 404s" (a gap). Conflating them is not a
    rounding error: a run of gap-days entered as zeros drags a trailing mean
    down and inflates its standard deviation, which is enough to make a spike
    detector stop firing altogether.
    """
    days = []
    for f in cached_files(min_mentions, quad):
        tag = f.name.split("_")[2]          # gdelt_daily_YYYYMMDD_m10_q34.parquet
        days.append(pd.Timestamp(tag, tz="UTC"))
    return pd.DatetimeIndex(sorted(days))


def daily_series(events: pd.DataFrame, *, by: str | None = None,
                 weight: str | None = None, on_days: pd.DatetimeIndex | None = None
                 ) -> pd.DataFrame:
    """Daily counts (or weighted sums), optionally split by a column.

    A day present in `on_days` with no events is a real zero. A day absent from
    it is NaN — not downloaded, or GDELT has no file for it — and every
    downstream statistic must see the difference.
    """
    v = events[weight] if weight else pd.Series(1.0, index=events.index)
    if by is None:
        out = v.resample("D").sum().to_frame("count")
    else:
        out = v.groupby([pd.Grouper(freq="D"), events[by]]).sum().unstack()
    if on_days is None:
        on_days = cached_days()
    full = pd.date_range(out.index.min(), out.index.max(), freq="D", tz="UTC")
    out = out.reindex(full)
    present = full.isin(on_days.tz_convert("UTC") if on_days.tz else on_days.tz_localize("UTC"))
    # Fetched-and-empty becomes 0; never-fetched stays NaN.
    out = out.where(~present[:, None] | out.notna(), 0.0)
    out[~present] = np.nan
    return out


def spike_days(daily: pd.Series, *, window: int = 60, sigma: float = 2.0) -> pd.Series:
    """Days whose event count is a `sigma` outlier against its trailing norm.

    Counts are right-skewed, so the standardization is done in logs; on the raw
    scale a Gaussian threshold fires on ordinary busy days and misses genuine
    surges during quiet stretches.
    """
    from ace.data.series import rolling_mean, rolling_std
    x = np.log1p(daily.astype(float))
    # rolling_* work on the observed calendar, so a gap day neither counts as a
    # quiet day nor shortens the window it falls in.
    z = (x - rolling_mean(x, window)) / rolling_std(x, window).replace(0, np.nan)
    return (z >= sigma).astype(float).where(z.notna())


def event_times(flags: pd.Series) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """Spike days as days-since-first-observation, for a point-process fit."""
    dates = flags.index[flags.fillna(0) > 0]
    if len(dates) == 0:
        return np.array([]), dates
    origin = flags.index[0]
    t = np.array([(d - origin).total_seconds() / 86400.0 for d in dates], dtype=float)
    return t, dates
