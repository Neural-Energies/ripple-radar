"""Daily cross-asset market series from FRED.

Yahoo's public chart endpoint rate-limits a bulk historical pull hard enough
that it is not a dependable training source. FRED serves the same daily closes
for the instruments ACE reasons about, under an authenticated key, with a
decade-plus of history and no throttling — so it is the primary market source
for model training here.

Trade-off, stated plainly: FRED daily series are CLOSE ONLY. There is no open,
high, low or volume, so features that need intraday structure (gap share, true
range, where the close sat in the range, participation) are unavailable on this
panel and are simply not built, rather than approximated from closes.
"""
from __future__ import annotations

import pandas as pd

from ace.data.alfred import MacroUnavailable, _get

# Channel -> FRED series. Chosen for daily frequency and long, unbroken history.
MARKET_SERIES: dict[str, str] = {
    "SP500": "SP500",                    # S&P 500 index
    "NASDAQ": "NASDAQCOM",               # Nasdaq Composite
    "DJIA": "DJIA",                      # Dow Jones Industrial Average
    "VIX": "VIXCLS",                     # equity implied vol
    "UST2Y": "DGS2",                     # 2y Treasury yield
    "UST10Y": "DGS10",                   # 10y Treasury yield
    "CURVE_10_2": "T10Y2Y",              # 10y-2y slope
    # NOTE: ICE BofA credit spreads (BAMLH0A0HYM2 / BAMLC0A0CM) are excluded.
    # FRED's license only exposes a rolling 2-year window for them, and
    # requiring them as context truncated the whole training set from 16 years
    # to 3. Thirteen extra years of history is worth far more than two
    # features; revisit if a longer credit series becomes available.
    "USD_BROAD": "DTWEXBGS",             # broad trade-weighted dollar
    "EURUSD": "DEXUSEU",                 # USD per EUR
    "USDJPY": "DEXJPUS",                 # JPY per USD
    "WTI": "DCOILWTICO",                 # WTI crude
    "BRENT": "DCOILBRENTEU",             # Brent crude
    "NATGAS": "DHHNGSP",                 # Henry Hub natural gas
    "BREAKEVEN_5Y5Y": "T5YIFR",          # 5y5y forward inflation expectation
}

# Series quoted as a yield/spread in percent rather than a price level. A
# "return" on these is a change in level, not a percentage change, so they are
# handled separately and never log-differenced.
LEVEL_SERIES: frozenset[str] = frozenset(
    {"VIX", "UST2Y", "UST10Y", "CURVE_10_2", "BREAKEVEN_5Y5Y"}
)


def series(series_id: str, start: str = "2010-01-01") -> pd.Series:
    """One daily FRED series, indexed by observation date, missing days dropped."""
    payload = _get(
        "series/observations",
        {"series_id": series_id, "observation_start": start, "frequency": "d"},
    )
    rows = payload.get("observations") or []
    if not rows:
        raise MacroUnavailable(f"{series_id}: no observations")
    df = pd.DataFrame(rows)
    df = df[df["value"] != "."]
    s = pd.Series(
        pd.to_numeric(df["value"], errors="coerce").values,
        index=pd.to_datetime(df["date"], utc=True),
        name=series_id,
    ).dropna()
    if len(s) < 250:
        raise MacroUnavailable(f"{series_id}: only {len(s)} observations")
    return s.sort_index()


def market_panel(start: str = "2010-01-01") -> pd.DataFrame:
    """Wide frame of every reachable market series, one column per channel.

    Series that cannot be retrieved are reported and excluded — never
    forward-filled from nothing or replaced with a placeholder.
    """
    cols: dict[str, pd.Series] = {}
    missing: list[str] = []
    for name, sid in MARKET_SERIES.items():
        try:
            cols[name] = series(sid, start)
        except MacroUnavailable:
            missing.append(f"{name}({sid})")
    if not cols:
        raise MacroUnavailable("no market series retrievable")
    if missing:
        print(f"[fred] unavailable, excluded: {', '.join(missing)}")
    panel = pd.DataFrame(cols).sort_index()
    panel.index.name = "date"
    return panel
