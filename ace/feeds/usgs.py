"""USGS earthquake catalog — a real, timestamped event database.

Free, no key, decades of history, and every record carries an exact origin
time, magnitude and location. For ACE this serves two purposes:

1. It is a genuine natural-disaster event feed, the kind of physical shock the
   desk reasons about.

2. It is the best available VALIDATION set for the cascade engine.
   Aftershock sequences are the canonical self-exciting point process — the
   ETAS model was built for them — so fitting a Hawkes process to earthquake
   data tests the implementation against the domain it was invented for. A
   Hawkes engine that cannot find self-excitation in aftershocks is broken,
   whatever it reports about markets.

The API caps a single query at 20,000 events, so long windows are fetched in
yearly slices and concatenated.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

from ace.config import CACHE

_BASE = "https://earthquake.usgs.gov/fdsnws/event/1/query"
_UA = "AlphaRecon-Research/1.0 (research@neuralenergies.com)"


class FeedUnavailable(RuntimeError):
    """The feed could not be retrieved. Callers surface it rather than fake it."""


def _get(params: dict) -> dict:
    q = dict(params)
    q.update({"format": "geojson"})
    key = urllib.parse.urlencode(sorted(q.items()))
    import hashlib

    path = CACHE / f"usgs_{hashlib.sha256(key.encode()).hexdigest()[:16]}.json"
    if path.exists():
        return json.loads(path.read_text())
    url = f"{_BASE}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    last: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = json.loads(r.read().decode())
            path.write_text(json.dumps(payload))
            return payload
        except Exception as e:
            last = e
            time.sleep(2 ** attempt)
    raise FeedUnavailable(f"USGS: {last}")


def earthquakes(
    start: str = "1990-01-01",
    end: str = "2026-01-01",
    *,
    min_magnitude: float = 5.5,
    region: dict | None = None,
) -> pd.DataFrame:
    """Earthquake catalog as a tidy event table.

    Columns: time (UTC), magnitude, place, longitude, latitude, depth_km, id.
    Fetched in yearly slices because the API caps one query at 20,000 events.
    """
    years = pd.date_range(start, end, freq="YS")
    if len(years) == 0:
        years = pd.DatetimeIndex([pd.Timestamp(start)])
    bounds = list(years) + [pd.Timestamp(end)]
    frames: list[pd.DataFrame] = []

    for a, b in zip(bounds[:-1], bounds[1:]):
        params = {
            "starttime": a.strftime("%Y-%m-%d"),
            "endtime": b.strftime("%Y-%m-%d"),
            "minmagnitude": min_magnitude,
            "orderby": "time-asc",
        }
        if region:
            params.update(region)
        payload = _get(params)
        feats = payload.get("features") or []
        if not feats:
            continue
        rows = []
        for f in feats:
            p = f.get("properties") or {}
            g = (f.get("geometry") or {}).get("coordinates") or [None, None, None]
            if p.get("time") is None or p.get("mag") is None:
                continue
            rows.append({
                "id": f.get("id"),
                "time": pd.to_datetime(p["time"], unit="ms", utc=True),
                "magnitude": float(p["mag"]),
                "place": p.get("place") or "",
                "longitude": g[0], "latitude": g[1],
                "depth_km": g[2],
            })
        if rows:
            frames.append(pd.DataFrame(rows))

    if not frames:
        raise FeedUnavailable(f"USGS returned no events for {start}..{end} M>={min_magnitude}")
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset=["id"]).sort_values("time").reset_index(drop=True)
    return df


def event_times_days(df: pd.DataFrame) -> tuple:
    """Event times as days since the first event, for point-process fitting."""
    t0 = df["time"].iloc[0]
    t = ((df["time"] - t0).dt.total_seconds() / 86400.0).to_numpy(dtype=float)
    return t, t0
