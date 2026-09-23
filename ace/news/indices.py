"""News-text-derived indices (§25 applied with real data).

ACE is a news platform, so its features should describe the news, not just the
tape. These series are exactly that: each one is constructed by text-mining
newspaper archives and counting articles matching defined criteria. They are
peer-reviewed (Baker, Bloom & Davis), daily, and run back to 1985.

  USEPUINDXD          Economic Policy Uncertainty — share of articles about
                      economic policy uncertainty across major US newspapers
  WLEMUINDXD          Equity-market-related Economic Uncertainty
  INFECTDISEMVTRACKD  Infectious-disease equity-market volatility tracker
  EMVOVERALLEMV       Equity Market Volatility tracker, overall (monthly)
  EMVMACROBUS         EMV attributable to macroeconomic news (monthly)

Why these rather than a sentiment score computed here: they have four decades
of consistent methodology behind them, which the app's own RSS archive cannot
match — it is a rolling window that started weeks ago. A model needs history
to be validated, and inventing a sentiment series from a keyword list would be
the pseudo-analytics this project is removing.

The app's live RSS tape remains the real-time signal; these are the historical
counterpart that makes a news model testable at all.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ace.data.alfred import MacroUnavailable
from ace.data.fred_market import series

DAILY_NEWS_SERIES: dict[str, str] = {
    "policy_uncertainty": "USEPUINDXD",
    "equity_uncertainty": "WLEMUINDXD",
    "infectious_disease_emv": "INFECTDISEMVTRACKD",
}

MONTHLY_NEWS_SERIES: dict[str, str] = {
    "emv_overall": "EMVOVERALLEMV",
    "emv_macro_news": "EMVMACROBUS",
}


def news_panel(start: str = "2010-01-01", *, include_monthly: bool = True) -> pd.DataFrame:
    """Daily news-index panel. Monthly series are forward-filled.

    Forward-filling a monthly series is point-in-time safe ONLY because the
    filled value is the last one published; it never reaches forward from a
    future release. Series that cannot be retrieved are excluded and reported,
    never imputed.
    """
    cols: dict[str, pd.Series] = {}
    missing: list[str] = []
    for name, sid in DAILY_NEWS_SERIES.items():
        try:
            cols[name] = series(sid, start)
        except MacroUnavailable:
            missing.append(f"{name}({sid})")
    if include_monthly:
        for name, sid in MONTHLY_NEWS_SERIES.items():
            try:
                cols[name] = series(sid, start)
            except MacroUnavailable:
                missing.append(f"{name}({sid})")
    if not cols:
        raise MacroUnavailable("no news indices retrievable")
    if missing:
        print(f"[news] unavailable, excluded: {', '.join(missing)}")
    panel = pd.DataFrame(cols).sort_index()
    panel.index.name = "date"
    return panel


def news_features(panel: pd.DataFrame, market_index: pd.DatetimeIndex) -> pd.DataFrame:
    """Point-in-time news features aligned to trading days.

    Levels are logged (these indices are right-skewed and strictly positive),
    and each carries a short-horizon change and a deviation-from-trend term —
    what matters for an event desk is not the level of news attention but
    whether it is unusually elevated RIGHT NOW.
    """
    aligned = panel.reindex(panel.index.union(market_index)).ffill().reindex(market_index)
    out = pd.DataFrame(index=market_index)
    for col in panel.columns:
        s = aligned[col]
        if s.notna().sum() < 250:
            continue
        log_s = np.log(np.maximum(s, 1e-9))
        out[f"news_{col}_log"] = log_s
        out[f"news_{col}_chg5"] = log_s.diff(5)
        out[f"news_{col}_chg20"] = log_s.diff(20)
        # elevation vs its own trailing year, in trailing-year standard
        # deviations: "is attention unusual", not "is attention high"
        mu = log_s.rolling(252, min_periods=252).mean()
        sd = log_s.rolling(252, min_periods=252).std()
        out[f"news_{col}_z"] = (log_s - mu) / sd.replace(0, np.nan)
    return out.replace([np.inf, -np.inf], np.nan)
