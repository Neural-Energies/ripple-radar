"""Point-in-time macro series from ALFRED (FRED's vintage archive).

This is the module that makes macro features honest. FRED's normal endpoint
returns the CURRENT value of a series, including every later revision — using
that as a feature is one of the most common ways a financial backtest ends up
reporting performance that never existed (§32).

ALFRED answers a different question: what was the published value AS OF a
given date. Asking for CPIAUCSL with realtime_start=realtime_end=2024-03-15
returns January and February only, because March had not been released yet.
That is the series a model is allowed to see when forecasting on 2024-03-15.

Every accessor here takes an `as_of` and refuses to return anything stamped
after it.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

from ace.config import CACHE

_BASE = "https://api.stlouisfed.org/fred"


class MacroUnavailable(RuntimeError):
    """No key, or the series cannot be retrieved. Callers surface it (§51)."""


def _key() -> str:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        raise MacroUnavailable("FRED_API_KEY is not set; macro features are unavailable")
    return key


def _get(path: str, params: dict[str, str]) -> dict:
    q = dict(params)
    q.update({"api_key": _key(), "file_type": "json"})
    url = f"{_BASE}/{path}?{urllib.parse.urlencode(q)}"
    # Cache on everything except the key, so artifacts never embed a secret.
    cache_key = urllib.parse.urlencode({k: v for k, v in q.items() if k != "api_key"})
    digest = hashlib.sha256(cache_key.encode()).hexdigest()[:16]
    path_c = CACHE / f"fred_{path.replace('/', '_')}_{digest}.json"
    if path_c.exists():
        return json.loads(path_c.read_text())
    last: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                payload = json.loads(r.read().decode())
            path_c.write_text(json.dumps(payload))
            return payload
        except Exception as e:
            last = e
            time.sleep(2 ** attempt)
    raise MacroUnavailable(f"{path}: {last}")


def release_history(series_id: str, start: str = "2010-01-01") -> pd.DataFrame:
    """Every (observation date, value, first-published date) for a series.

    `realtime_start` on an ALFRED row is when that value first became public,
    which is the timestamp a feature must key off — not the observation month.
    Returns columns: obs_date, value, published (all UTC, tz-aware).
    """
    payload = _get(
        "series/observations",
        {
            "series_id": series_id,
            "observation_start": start,
            "realtime_start": start,
            "realtime_end": "9999-12-31",
            "output_type": "4",  # initial release only — no later revisions
        },
    )
    rows = payload.get("observations") or []
    if not rows:
        raise MacroUnavailable(f"{series_id}: no observations")
    df = pd.DataFrame(rows)
    df = df[df["value"] != "."]
    if df.empty:
        raise MacroUnavailable(f"{series_id}: all observations missing")
    out = pd.DataFrame(
        {
            "obs_date": pd.to_datetime(df["date"], utc=True),
            "value": pd.to_numeric(df["value"], errors="coerce"),
            "published": pd.to_datetime(df["realtime_start"], utc=True),
        }
    ).dropna()
    return out.sort_values("published").reset_index(drop=True)


def current_vintage(series_id: str, start: str = "2010-01-01") -> pd.Series:
    """The series as it stands TODAY, every revision included.

    This is the number a naive backtest uses, and using it as a feature is the
    defect `release_history` exists to prevent. It has exactly one legitimate
    job here: as the answer key. Comparing a point-in-time reading against the
    fully revised series is how you measure what revision risk actually costs —
    see `ace/macro/revisions.py`.

    Never feed this to a model. It is hindsight by construction.
    """
    payload = _get(
        "series/observations",
        {"series_id": series_id, "observation_start": start},
    )
    rows = payload.get("observations") or []
    if not rows:
        raise MacroUnavailable(f"{series_id}: no observations")
    df = pd.DataFrame(rows)
    df = df[df["value"] != "."]
    if df.empty:
        raise MacroUnavailable(f"{series_id}: all observations missing")
    out = pd.Series(
        pd.to_numeric(df["value"], errors="coerce").values,
        index=pd.to_datetime(df["date"], utc=True),
        name=series_id,
    ).dropna()
    return out.sort_index()


def unrevised_history(
    series_id: str, start: str = "1980-01-01", *, publication_lag_days: int = 1
) -> pd.DataFrame:
    """A NEVER-REVISED series in the same shape `release_history` returns.

    ALFRED has no vintage archive for a market quote, because there is nothing
    to archive: the S&P 500 close on a given day is the same number forever.
    FRED returns `output_type=4` as a 400 for exactly these series, which is
    why the vintage sweep could not reach VIX, the Treasury curve, the Moody's
    spreads or the overnight repo facility.

    For that class — and ONLY that class — the standard endpoint loses nothing,
    because the observation IS the first release. So `published` is synthesised
    as the observation date plus `publication_lag_days`, defaulting to one day:
    a same-day close is treated as knowable the following morning rather than
    at the instant it printed. Conservative by a day in the only direction that
    cannot manufacture a backtest.

    DO NOT USE THIS FOR A REVISED SERIES. Payrolls, CPI, industrial production
    and every other statistical release get revised for months or years, so
    `published = obs_date + 1` would hand a model the FINAL value one day after
    the reference period — the precise lookahead this module exists to prevent.
    `ace.state.panel.SeriesSpec.revised` is the switch that keeps the two
    routes apart, and it defaults to True so a new series must argue its way
    onto this path rather than fall onto it.
    """
    payload = _get(
        "series/observations",
        {"series_id": series_id, "observation_start": start},
    )
    rows = payload.get("observations") or []
    if not rows:
        raise MacroUnavailable(f"{series_id}: no observations")
    df = pd.DataFrame(rows)
    df = df[df["value"] != "."]
    if df.empty:
        raise MacroUnavailable(f"{series_id}: all observations missing")
    obs = pd.to_datetime(df["date"], utc=True)
    out = pd.DataFrame(
        {
            "obs_date": obs,
            "value": pd.to_numeric(df["value"], errors="coerce"),
            "published": obs + pd.Timedelta(days=int(publication_lag_days)),
        }
    ).dropna()
    return out.sort_values("published").reset_index(drop=True)


def as_of(series_id: str, when: pd.Timestamp, start: str = "2010-01-01") -> pd.DataFrame:
    """The series exactly as it was publicly known at `when`.

    Filters on the publication timestamp, so nothing released later can leak in.
    """
    hist = release_history(series_id, start)
    when = pd.Timestamp(when).tz_convert("UTC") if pd.Timestamp(when).tzinfo else pd.Timestamp(when, tz="UTC")
    return hist[hist["published"] <= when].reset_index(drop=True)


def latest_as_of(series_id: str, when: pd.Timestamp, start: str = "2010-01-01") -> float | None:
    """Most recently published value of a series at `when`, or None."""
    v = as_of(series_id, when, start)
    return None if v.empty else float(v.iloc[-1]["value"])
