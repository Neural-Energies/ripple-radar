"""Dataset: does a market shock EXTEND or FADE? (ACE's materialization axis)

This is the first ACE production target because it is exactly the question the
scenario engine asks — every family's scenarios are ordered materialization →
fade — and it is answerable from price history alone, so it can be trained and
validated today rather than waiting for a forecast ledger to accumulate.

Definition
----------
Event      a session where |standardized return| >= SHOCK_Z on a channel,
           standardized by that channel's own trailing 60-day volatility.
Label      1 if the following HORIZON sessions extend the shock's direction,
           0 if they give it back.
           label = 1 iff sign(shock) * log(close[t+H] / close[t]) > 0
Features   point-in-time state of the shocked channel at t, plus cross-asset
           context at t (vol, curve, credit, dollar).

Nothing in the feature set uses a bar after t; the label uses only bars after
t. The two never overlap, and `ace.validation.leakage` asserts it.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ace.data.fred_market import LEVEL_SERIES, market_panel
from ace.features.pit import CLOSE_FEATURE_COLUMNS, build_close_features

SHOCK_Z = 1.5
HORIZON = 5
LABEL_HORIZON_CALENDAR_DAYS = 9  # 5 sessions spans ~7-9 calendar days incl. a weekend

# Channels that are price levels, so a shock and its continuation are well
# defined. Yields and spreads move for different reasons and are used as
# CONTEXT rather than as shock subjects.
PRICE_CHANNELS: tuple[str, ...] = (
    "SP500", "NASDAQ", "DJIA", "USD_BROAD", "EURUSD", "USDJPY", "WTI", "BRENT", "NATGAS",
)

CONTEXT_COLUMNS: tuple[str, ...] = (
    "ctx_vix", "ctx_vix_chg_5d", "ctx_curve_10_2", "ctx_curve_chg_20d",
    "ctx_usd_mom_20d", "ctx_ust10y_chg_20d", "ctx_breakeven_5y5y",
)


def _context(panel: pd.DataFrame) -> pd.DataFrame:
    """Cross-asset state at t. Level series are differenced, not pct-changed."""
    ctx = pd.DataFrame(index=panel.index)
    if "VIX" in panel:
        ctx["ctx_vix"] = panel["VIX"]
        ctx["ctx_vix_chg_5d"] = panel["VIX"].diff(5)
    if "CURVE_10_2" in panel:
        ctx["ctx_curve_10_2"] = panel["CURVE_10_2"]
        ctx["ctx_curve_chg_20d"] = panel["CURVE_10_2"].diff(20)
    if "BREAKEVEN_5Y5Y" in panel:
        ctx["ctx_breakeven_5y5y"] = panel["BREAKEVEN_5Y5Y"]
    if "USD_BROAD" in panel:
        ctx["ctx_usd_mom_20d"] = panel["USD_BROAD"].pct_change(20)
    if "UST10Y" in panel:
        ctx["ctx_ust10y_chg_20d"] = panel["UST10Y"].diff(20)
    return ctx


def build(start: str = "2010-01-01") -> pd.DataFrame:
    """One row per shock event across the price channels.

    Columns: date, channel, features..., context..., label, plus the diagnostic
    fields the leakage tests and the audit trail need.
    """
    panel = market_panel(start)
    ctx = _context(panel)
    rows: list[pd.DataFrame] = []

    for ch in PRICE_CHANNELS:
        if ch not in panel.columns or ch in LEVEL_SERIES:
            continue
        close = panel[ch].dropna()
        if len(close) < 400:
            continue
        feats = build_close_features(close)

        # Forward return over the next HORIZON sessions of THIS channel.
        fwd = np.log(close.shift(-HORIZON) / close)
        direction = np.sign(feats["shock_z"])
        signed_fwd = direction * fwd

        df = feats.join(ctx, how="left")
        df["date"] = df.index
        df["channel"] = ch
        df["label_date"] = close.index.to_series().shift(-HORIZON).values
        df["fwd_ret_signed"] = signed_fwd
        df["label"] = (signed_fwd > 0).astype(float)

        is_shock = feats["shock_z"].abs() >= SHOCK_Z
        needed = list(CLOSE_FEATURE_COLUMNS) + [c for c in CONTEXT_COLUMNS if c in df.columns]
        df = df[is_shock & df[needed].notna().all(axis=1) & signed_fwd.notna() & df["label_date"].notna()]
        rows.append(df.reset_index(drop=True))

    if not rows:
        raise RuntimeError("no shock events produced — check the panel and thresholds")

    out = pd.concat(rows, ignore_index=True)
    out["date"] = pd.to_datetime(out["date"], utc=True)
    out["label_date"] = pd.to_datetime(out["label_date"], utc=True)
    return out.sort_values("date").reset_index(drop=True)


def feature_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in (*CLOSE_FEATURE_COLUMNS, *CONTEXT_COLUMNS) if c in df.columns]
