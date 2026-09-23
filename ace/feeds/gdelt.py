"""GDELT 2.0 — global news event database.

The event database ACE's probability engines need. GDELT machine-codes news
coverage worldwide into structured event records every 15 minutes, back to
2015-02-18, with no key. Each record carries a timestamp, CAMEO event code,
actors, geography, tone and a mention count.

That is precisely the shape the model families need and cannot get from the
app's own RSS archive, which is a rolling window that started weeks ago:

  Hawkes / TPP        timestamped event sequences, typed
  competing risks     which of several event types arrives first, and when
  Dynamic BN          conditional probability tables estimated from histories
  hierarchical Bayes  event classes with enough members to pool across

Practical notes, stated because they shape what is feasible: each 15-minute
export is a zipped tab-separated CSV of roughly 100KB, so a full year is about
35,000 files. Ingestion is a background job, not an inline fetch. This module
provides the adapter and caching; a bulk backfill is run separately and
deliberately paced — GDELT asks for one request per five seconds.
"""
from __future__ import annotations

import io
import time
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from ace.config import CACHE

_MASTER = "https://data.gdeltproject.org/gdeltv2/masterfilelist.txt"
_UA = "AlphaRecon-Research/1.0 (research@neuralenergies.com)"
_MIN_GAP_S = 5.0  # GDELT's stated courtesy limit
_last = 0.0

# GDELT 2.0 export schema is 61 unnamed columns. These are the ones ACE needs;
# the indices are fixed by the published spec.
COLUMNS: dict[int, str] = {
    0: "global_event_id",
    1: "sql_date",
    6: "actor1_name",
    7: "actor1_country",
    16: "actor2_name",
    17: "actor2_country",
    26: "event_code",
    28: "event_root_code",
    29: "quad_class",
    30: "goldstein_scale",
    31: "num_mentions",
    33: "num_articles",
    34: "avg_tone",
    52: "action_geo_country",
    53: "action_geo_adm1",
    56: "action_geo_lat",
    57: "action_geo_long",
    59: "date_added",
    60: "source_url",
}

# CAMEO QuadClass: the top-level taxonomy ACE reasons in.
QUAD_CLASS = {
    1: "verbal_cooperation",
    2: "material_cooperation",
    3: "verbal_conflict",
    4: "material_conflict",
}


class FeedUnavailable(RuntimeError):
    pass


def _throttle() -> None:
    global _last
    wait = _MIN_GAP_S - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def master_file_list(*, refresh: bool = False) -> pd.DataFrame:
    """Index of every GDELT export file, with its timestamp."""
    path = CACHE / "gdelt_masterfilelist.txt"
    if not path.exists() or refresh:
        _throttle()
        req = urllib.request.Request(_MASTER, headers={"User-Agent": _UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                path.write_bytes(r.read())
        except Exception as e:
            raise FeedUnavailable(f"GDELT master list: {e}") from e

    rows = []
    for line in path.read_text(errors="ignore").splitlines():
        parts = line.strip().split()
        if len(parts) != 3 or not parts[2].endswith(".export.CSV.zip"):
            continue
        stamp = parts[2].rsplit("/", 1)[-1].split(".")[0]
        if len(stamp) != 14 or not stamp.isdigit():
            continue
        rows.append({"timestamp": pd.to_datetime(stamp, format="%Y%m%d%H%M%S", utc=True),
                     "size": int(parts[0]), "url": parts[2].replace("http://", "https://")})
    if not rows:
        raise FeedUnavailable("GDELT master list contained no export files")
    return pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)


def fetch_export(url: str) -> pd.DataFrame:
    """One 15-minute export file as a tidy frame of the columns ACE uses."""
    name = url.rsplit("/", 1)[-1].replace(".zip", "")
    cached = CACHE / f"gdelt_{name}.parquet"
    if cached.exists():
        return pd.read_parquet(cached)

    _throttle()
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            blob = r.read()
    except Exception as e:
        raise FeedUnavailable(f"GDELT {name}: {e}") from e

    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            inner = z.namelist()[0]
            raw = pd.read_csv(z.open(inner), sep="\t", header=None, dtype=str,
                              usecols=list(COLUMNS), names=range(61), low_memory=False)
    except Exception as e:
        raise FeedUnavailable(f"GDELT {name} unreadable: {e}") from e

    df = raw.rename(columns=COLUMNS)
    for c in ("goldstein_scale", "avg_tone", "action_geo_lat", "action_geo_long"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in ("num_mentions", "num_articles", "quad_class"):
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")
    df["event_time"] = pd.to_datetime(df["date_added"], format="%Y%m%d%H%M%S", utc=True, errors="coerce")
    df = df.dropna(subset=["event_time"])
    try:
        df.to_parquet(cached, index=False)
    except Exception:
        pass
    return df


def sample_window(start: str, end: str, *, every_n: int = 1, limit_files: int = 40) -> pd.DataFrame:
    """Events across a window, sampling every Nth 15-minute file.

    Sampling is explicit rather than hidden: a full window is tens of thousands
    of files, so `every_n` states how coarse the sample is, and the caller
    knows the density of what it received.
    """
    master = master_file_list()
    sel = master[(master.timestamp >= pd.Timestamp(start, tz="UTC"))
                 & (master.timestamp < pd.Timestamp(end, tz="UTC"))]
    sel = sel.iloc[::every_n].head(limit_files)
    if sel.empty:
        raise FeedUnavailable(f"no GDELT files between {start} and {end}")
    frames, failed = [], 0
    for url in sel["url"]:
        try:
            frames.append(fetch_export(url))
        except FeedUnavailable:
            failed += 1
    if not frames:
        raise FeedUnavailable(f"all {len(sel)} GDELT fetches failed")
    out = pd.concat(frames, ignore_index=True)
    out.attrs["files_requested"] = len(sel)
    out.attrs["files_failed"] = failed
    out.attrs["every_n"] = every_n
    return out


# ---------------------------------------------------------------------------
# GDELT 1.0 daily files — the practical ingestion path
# ---------------------------------------------------------------------------
# The 2.0 feed publishes every 15 minutes, which is ~35,000 files a year. At
# GDELT's requested one-request-per-five-seconds that is two days of fetching
# per year of history. The 1.0 daily export carries a full day in ONE file of
# roughly 100,000 events, so a decade is ~4,000 files instead of ~350,000.
# Same CAMEO coding, same actors, same tone — coarser only in that a day
# arrives as one object.
#
# The 1.0 schema has 58 columns and its geography block sits in DIFFERENT
# positions from 2.0. Verified against real files rather than assumed: index
# 56 and 57 are DATEADDED and SOURCEURL, so reading 2.0's positions here would
# silently put a URL where latitude belongs.

DAILY_BASE = "https://data.gdeltproject.org/events"

DAILY_COLUMNS: dict[int, str] = {
    0: "global_event_id",
    1: "sql_date",            # the EVENT's date, which may predate the file
    5: "actor1_code",
    6: "actor1_name",
    7: "actor1_country",
    15: "actor2_code",
    16: "actor2_name",
    17: "actor2_country",
    25: "is_root_event",
    26: "event_code",
    28: "event_root_code",
    29: "quad_class",
    30: "goldstein_scale",
    31: "num_mentions",
    32: "num_sources",
    33: "num_articles",
    34: "avg_tone",
    50: "action_geo_fullname",
    51: "action_geo_country",
    53: "action_geo_lat",
    54: "action_geo_long",
    56: "date_added",
    57: "source_url",
}


def fetch_daily(day: str, *, min_mentions: int = 0, quad_classes: tuple[int, ...] | None = None) -> pd.DataFrame:
    """One day of GDELT events as a tidy frame.

    `day` is YYYYMMDD. Filters are applied before caching so a targeted
    backfill stores only what it will use — the unfiltered day is ~8MB.
    """
    tag = f"{day}_m{min_mentions}_q{''.join(map(str, quad_classes)) if quad_classes else 'all'}"
    cached = CACHE / f"gdelt_daily_{tag}.parquet"
    if cached.exists():
        return pd.read_parquet(cached)

    _throttle()
    url = f"{DAILY_BASE}/{day}.export.CSV.zip"
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            blob = r.read()
    except Exception as e:
        raise FeedUnavailable(f"GDELT daily {day}: {e}") from e

    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            inner = z.namelist()[0]
            raw = pd.read_csv(z.open(inner), sep="\t", header=None, dtype=str,
                              names=range(58), usecols=list(DAILY_COLUMNS), low_memory=False)
    except Exception as e:
        raise FeedUnavailable(f"GDELT daily {day} unreadable: {e}") from e

    df = raw.rename(columns=DAILY_COLUMNS)
    for c in ("goldstein_scale", "avg_tone", "action_geo_lat", "action_geo_long"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in ("num_mentions", "num_sources", "num_articles", "quad_class", "is_root_event"):
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")

    # `date_added` is when GDELT observed the event — the timestamp a
    # point-process model must use. `sql_date` is when the event occurred and
    # can be years earlier for retrospective coverage.
    df["observed_at"] = pd.to_datetime(df["date_added"], format="%Y%m%d", utc=True, errors="coerce")
    df["event_date"] = pd.to_datetime(df["sql_date"], format="%Y%m%d", utc=True, errors="coerce")
    df = df.dropna(subset=["observed_at"])

    if min_mentions:
        df = df[df["num_mentions"].fillna(0) >= min_mentions]
    if quad_classes:
        df = df[df["quad_class"].isin(quad_classes)]

    df = df.reset_index(drop=True)
    try:
        df.to_parquet(cached, index=False)
    except Exception:
        pass
    return df
