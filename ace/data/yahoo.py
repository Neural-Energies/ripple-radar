"""Daily OHLCV bars from Yahoo's public chart endpoint, cached to disk.

Why daily bars rather than a vendor feed: they are free, they cover the whole
universe, and — the part that matters for §32 — a settled daily bar is not
revised. Macro series are revised, which is why those need ALFRED vintages and
are deliberately NOT used as features until a FRED key exists.

The cache is content-addressed by (ticker, range, interval) and holds raw JSON,
so a rebuilt dataset is reproducible from the same bytes.
"""
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from ace.config import CACHE

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"


class DataUnavailable(RuntimeError):
    """Raised when required market data cannot be obtained.

    §51: callers surface this rather than substituting an invented number.
    """


_MIN_GAP_S = 1.2
_last_call = 0.0


def _throttle() -> None:
    """Be a good citizen on a free public endpoint."""
    global _last_call
    wait = _MIN_GAP_S - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def _cache_path(ticker: str, rng: str, interval: str) -> Path:
    return CACHE / f"{ticker.upper()}_{rng}_{interval}.json"


def fetch_raw(ticker: str, rng: str = "10y", interval: str = "1d", *, refresh: bool = False) -> dict:
    path = _cache_path(ticker, rng, interval)
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    url = f"{_BASE}{ticker}?range={rng}&interval={interval}"
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/json"})
    last_err: Exception | None = None
    for attempt in range(5):
        try:
            _throttle()
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = json.loads(r.read().decode())
            path.write_text(json.dumps(payload))
            return payload
        except urllib.error.HTTPError as e:
            last_err = e
            # 429 is the public endpoint asking us to slow down; anything else
            # is unlikely to fix itself, so do not hammer it.
            time.sleep(6 * (attempt + 1) if e.code == 429 else 2 ** attempt)
        except Exception as e:
            last_err = e
            time.sleep(2 ** attempt)
    raise DataUnavailable(f"{ticker}: {last_err}")


def bars(ticker: str, rng: str = "10y", interval: str = "1d", *, refresh: bool = False) -> pd.DataFrame:
    """Daily bars indexed by UTC date, ascending, with rows containing NaN dropped.

    Returns columns: open, high, low, close, volume.
    """
    payload = fetch_raw(ticker, rng, interval, refresh=refresh)
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        raise DataUnavailable(f"{ticker}: empty chart result")
    res = result[0]
    stamps = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    if not stamps or not quote:
        raise DataUnavailable(f"{ticker}: no quote series")
    df = pd.DataFrame(
        {
            "open": quote.get("open"),
            "high": quote.get("high"),
            "low": quote.get("low"),
            "close": quote.get("close"),
            "volume": quote.get("volume"),
        },
        index=pd.to_datetime(pd.Series(stamps, dtype="int64"), unit="s", utc=True).dt.normalize(),
    )
    df.index.name = "date"
    df = df.astype({c: "float64" for c in ("open", "high", "low", "close", "volume")})
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df = df.dropna(subset=["open", "high", "low", "close"])
    if len(df) < 100:
        raise DataUnavailable(f"{ticker}: only {len(df)} usable bars")
    return df


def panel(tickers: list[str], rng: str = "10y", *, refresh: bool = False) -> dict[str, pd.DataFrame]:
    """Bars for each ticker that resolves. Missing tickers are reported, not faked."""
    out: dict[str, pd.DataFrame] = {}
    failed: list[str] = []
    for t in tickers:
        try:
            out[t] = bars(t, rng, refresh=refresh)
        except DataUnavailable:
            failed.append(t)
    if not out:
        raise DataUnavailable(f"no tickers resolved (tried {len(tickers)})")
    if failed:
        print(f"[yahoo] unavailable, excluded from the universe: {', '.join(failed)}")
    return out


def trading_day_index(frames: dict[str, pd.DataFrame]) -> pd.DatetimeIndex:
    """Union of observed session dates — the calendar the panel actually trades."""
    idx = pd.DatetimeIndex([])
    for df in frames.values():
        idx = idx.union(df.index)
    return idx.sort_values()
