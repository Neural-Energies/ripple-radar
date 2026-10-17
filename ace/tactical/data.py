"""Daily futures, cash proxies, and the 10-year real yield.

Prices come from Yahoo's public chart endpoint (continuous front month for
NQ, ES, GC, CL; cash index or GLD as the roll reference). The real yield is
the Treasury H.15 10-year inflation-indexed series, which is the series FRED
publishes as DFII10. FRED's own graph endpoint did not answer from the
research environment, so the book records the Treasury source rather than
pretending a FRED pull happened.

The committed file `ace/tactical/data/daily.csv` is the panel the backtest
and the tests read. `--fetch` rebuilds it.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ace.tactical.spec import CONTRACTS, PROXIES, ROLL_CLIP

DATA_DIR = Path(__file__).resolve().parent / "data"
DAILY_PATH = DATA_DIR / "daily.csv"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
_MIN_GAP_S = 1.2
_last_call = 0.0


class MarketDataError(RuntimeError):
    """The panel is missing, short, or not the series the model asked for."""


def _throttle() -> None:
    global _last_call
    wait = _MIN_GAP_S - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def _cache_dir() -> Path:
    from ace.config import CACHE

    path = CACHE / "tactical"
    path.mkdir(parents=True, exist_ok=True)
    return path


def fetch_yahoo(ticker: str, start: str = "2004-01-01", *, refresh: bool = False) -> pd.Series:
    """Daily closes for one Yahoo symbol. Cached as the raw chart payload."""
    safe = ticker.replace("=", "_").replace("^", "")
    cache = _cache_dir() / f"{safe}.json"
    if cache.exists() and not refresh:
        payload = json.loads(cache.read_text())
    else:
        start_ts = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp())
        end_ts = int(datetime.now(timezone.utc).timestamp()) + 86_400
        url = (
            "https://query1.finance.yahoo.com/v8/finance/chart/"
            f"{urllib.parse.quote(ticker)}?period1={start_ts}&period2={end_ts}&interval=1d"
        )
        req = urllib.request.Request(
            url,
            headers={"User-Agent": _UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/"},
        )
        payload = None
        last: Exception | None = None
        for attempt in range(6):
            try:
                _throttle()
                with urllib.request.urlopen(req, timeout=40) as response:
                    payload = json.loads(response.read().decode())
                cache.write_text(json.dumps(payload))
                break
            except urllib.error.HTTPError as exc:
                last = exc
                time.sleep(8 * (attempt + 1) if exc.code == 429 else 2 ** attempt)
            except Exception as exc:
                last = exc
                time.sleep(2 ** attempt)
        if payload is None:
            raise MarketDataError(f"{ticker}: {last}")
    result = (payload.get("chart") or {}).get("result") or []
    if not result or not result[0].get("timestamp"):
        raise MarketDataError(f"{ticker}: empty chart")
    res = result[0]
    if res.get("meta", {}).get("dataGranularity") not in (None, "1d"):
        raise MarketDataError(f"{ticker}: expected daily bars, got {res['meta'].get('dataGranularity')}")
    stamps = res["timestamp"]
    closes = (res.get("indicators") or {}).get("quote", [{}])[0].get("close")
    idx = pd.to_datetime(pd.Series(stamps, dtype="int64"), unit="s", utc=True).dt.tz_convert(None).dt.normalize()
    series = pd.Series(pd.to_numeric(closes, errors="coerce"), index=idx, name=ticker)
    series = series[~series.index.duplicated(keep="last")].sort_index().dropna()
    if len(series) < 1000:
        raise MarketDataError(f"{ticker}: only {len(series)} daily closes")
    return series


def fetch_real_yield(start_year: int = 2004, *, refresh: bool = False) -> pd.Series:
    """10-year real Treasury yield, percent, from Treasury.gov H.15.

    This is the upstream of FRED series DFII10. Blank auction days are dropped.
    """
    frames: list[pd.Series] = []
    end_year = datetime.now(timezone.utc).year
    cache_root = _cache_dir()
    for year in range(start_year, end_year + 1):
        cache = cache_root / f"real_yield_{year}.csv"
        if not cache.exists() or refresh:
            url = (
                "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
                f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_real_yield_curve"
                f"&field_tdr_date_value={year}&page&_format=csv"
            )
            req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "text/csv"})
            try:
                with urllib.request.urlopen(req, timeout=40) as response:
                    cache.write_bytes(response.read())
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    continue
                raise MarketDataError(f"real yield {year}: {exc}") from exc
            time.sleep(0.2)
        frame = pd.read_csv(cache)
        if "Date" not in frame.columns or "10 YR" not in frame.columns:
            raise MarketDataError(f"real yield {year}: unexpected columns {list(frame.columns)}")
        dates = pd.to_datetime(frame["Date"], format="%m/%d/%Y")
        values = pd.to_numeric(frame["10 YR"], errors="coerce")
        frames.append(pd.Series(values.to_numpy(), index=dates, name="REAL10"))
    if not frames:
        raise MarketDataError("no real-yield files")
    series = pd.concat(frames).sort_index()
    series = series[~series.index.duplicated(keep="last")].dropna()
    series.index = pd.to_datetime(series.index).tz_localize(None).normalize()
    return series


def build_panel(*, refresh: bool = False) -> pd.DataFrame:
    """Download the panel and return it indexed by session date."""
    columns: dict[str, pd.Series] = {}
    for symbol, contract in CONTRACTS.items():
        columns[symbol] = fetch_yahoo(contract.yahoo, refresh=refresh).rename(symbol)
    for name, ticker in PROXIES.items():
        columns[name] = fetch_yahoo(ticker, refresh=refresh).rename(name)
    columns["REAL10"] = fetch_real_yield(refresh=refresh)
    panel = pd.concat(columns, axis=1).sort_index()
    panel.index.name = "date"
    _assert_panel(panel)
    return panel


def write_panel(panel: pd.DataFrame, path: Path = DAILY_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = panel.copy()
    out.index = pd.to_datetime(out.index).strftime("%Y-%m-%d")
    out.to_csv(path, index_label="date", float_format="%.10g")
    return path


def load_panel(path: Path = DAILY_PATH) -> pd.DataFrame:
    if not path.exists():
        raise MarketDataError(f"missing {path}. Run python -m ace.tactical --fetch")
    frame = pd.read_csv(path, parse_dates=["date"])
    frame = frame.set_index("date").sort_index()
    frame.index = pd.to_datetime(frame.index).tz_localize(None).normalize()
    _assert_panel(frame)
    return frame


def _assert_panel(frame: pd.DataFrame) -> None:
    needed = list(CONTRACTS) + list(PROXIES) + ["REAL10"]
    missing = [col for col in needed if col not in frame.columns]
    if missing:
        raise MarketDataError(f"panel missing columns: {missing}")
    if frame.index.min() > pd.Timestamp("2006-01-01"):
        raise MarketDataError("history starts too late for a five-year value signal before 2015")
    if frame.index.max() < pd.Timestamp("2023-01-01"):
        raise MarketDataError("history does not reach the out-of-sample window")
    if float(frame["CL"].min()) >= 0:
        raise MarketDataError("CL never prints negative; the April 2020 prompt settlement is missing")
    for symbol in CONTRACTS:
        closes = frame[symbol].dropna()
        if len(closes) < 3000:
            raise MarketDataError(f"{symbol}: only {len(closes)} closes")


def third_friday(year: int, month: int) -> pd.Timestamp:
    first = pd.Timestamp(year=year, month=month, day=1)
    offset = (4 - first.weekday()) % 7
    return first + pd.Timedelta(days=int(offset + 14))


def quarterly_expiries(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Equity-index expiry sessions: the trading day on or just after the third Friday."""
    hits: list[pd.Timestamp] = []
    years = range(int(index.min().year), int(index.max().year) + 1)
    for year in years:
        for month in (3, 6, 9, 12):
            expiry = third_friday(year, month)
            loc = index.searchsorted(expiry)
            if loc < len(index) and (index[loc] - expiry).days <= 4:
                hits.append(index[loc])
    return pd.DatetimeIndex(hits)


def gold_notice_sessions(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """First-notice approximation: last weekday of the month before a delivery month.

    Delivery months are Feb, Apr, Jun, Aug, Oct, Dec, so notice falls at the
    end of Jan, Mar, May, Jul, Sep, Nov.
    """
    hits: list[pd.Timestamp] = []
    months = index.to_series().groupby(index.to_period("M")).tail(1).index
    for stamp in months:
        if stamp.month in (1, 3, 5, 7, 9, 11):
            hits.append(pd.Timestamp(stamp))
    return pd.DatetimeIndex(hits)


def roll_sessions(symbol: str, index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    roll = CONTRACTS[symbol].roll
    if roll == "quarterly":
        return quarterly_expiries(index)
    if roll == "bimonthly":
        return gold_notice_sessions(index)
    return pd.DatetimeIndex([])


def price_haircut(close: pd.Series, proxy: pd.Series | None, rolls: pd.DatetimeIndex) -> pd.Series:
    """Price points to remove on roll sessions so the splice is not P&L.

    The removal is capped at ROLL_CLIP times the previous close. A wider
    futures-versus-cash gap is kept, because it is too large to be the
    ordinary roll.
    """
    haircut = pd.Series(0.0, index=close.index)
    if proxy is None or len(rolls) == 0:
        return haircut
    prev = close.shift(1)
    ret = close / prev - 1
    proxy_ret = proxy.reindex(close.index).pct_change()
    on_roll = close.index.isin(rolls)
    usable = on_roll & ret.notna() & proxy_ret.notna() & (prev > 0) & (close > 0)
    excess = (ret - proxy_ret).where(usable)
    haircut.loc[usable] = (excess.clip(-ROLL_CLIP, ROLL_CLIP) * prev).loc[usable]
    return haircut.fillna(0.0)


def execution_frame(panel: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Per-asset frame: raw close, adjusted close, dollar change, vol.

    Dollar change on day t is the adjusted close-to-close move times the
    multiplier. It is the variation margin of a one-lot that was already on.
    """
    out: dict[str, pd.DataFrame] = {}
    for symbol, contract in CONTRACTS.items():
        close = panel[symbol].dropna().astype(float)
        close = close[~close.index.duplicated(keep="last")].sort_index()
        proxy = None
        if contract.proxy is not None:
            proxy = panel[contract.proxy].dropna().astype(float)
        rolls = roll_sessions(symbol, close.index)
        haircut = price_haircut(close, proxy, rolls)
        change = close.diff().fillna(0.0) - haircut
        dollar = change * contract.multiplier
        prev = close.shift(1)
        adj_ret = (change / prev).where(prev > 0)
        # Realized vol uses only positive-price windows. The April 2020 crude
        # print is inside a window that fails that test, so the size goes to
        # flat instead of exploding on a percentage of a negative price.
        positive = close > 0
        window_ok = positive.rolling(21).sum() == 21
        rv = adj_ret.rolling(21).std(ddof=1) * np.sqrt(252)
        rv = rv.where(window_ok)
        dollar_vol = rv * close * contract.multiplier
        adj_close = float(close.iloc[0]) + change.cumsum()
        frame = pd.DataFrame(
            {
                "close": close,
                "adj_close": adj_close,
                "dollar_change": dollar,
                "ret": adj_ret,
                "rv": rv,
                "dollar_vol": dollar_vol,
                "haircut": haircut,
            }
        )
        if proxy is not None:
            frame["proxy"] = proxy.reindex(close.index)
        out[symbol] = frame
    return out


def align_real_yield(panel: pd.DataFrame, index: pd.DatetimeIndex) -> pd.Series:
    """Last published real yield on or before the session, at most five days stale."""
    real = panel["REAL10"].dropna().astype(float).sort_index()
    real = real[~real.index.duplicated(keep="last")]
    left = pd.DataFrame({"date": pd.to_datetime(index)})
    right = real.rename("REAL10").reset_index()
    if right.columns[0] != "date":
        right = right.rename(columns={right.columns[0]: "date"})
    right["date"] = pd.to_datetime(right["date"])
    merged = pd.merge_asof(
        left.sort_values("date"),
        right.sort_values("date"),
        on="date",
        direction="backward",
        tolerance=pd.Timedelta("5D"),
    )
    return merged.set_index("date")["REAL10"].reindex(pd.DatetimeIndex(index))
