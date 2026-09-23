"""Point-in-time feature construction from daily bars (§32, §33).

The rule every function here obeys: a feature stamped at date t may only use
bars up to and including t. No centred windows, no forward fills from the
future, no indicator that silently peeks at the next bar.

Features are grouped and named by family so provenance is legible downstream
and SHAP output reads as economics rather than column indices.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def _log_returns(close: pd.Series) -> pd.Series:
    return np.log(close).diff()


def realized_vol(close: pd.Series, window: int) -> pd.Series:
    """Annualized realized volatility over a trailing window, ending at t."""
    return _log_returns(close).rolling(window, min_periods=window).std() * np.sqrt(TRADING_DAYS)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Per-bar feature frame for one instrument.

    Every column is computed from information available at that bar's close.
    Rows without a full lookback are left NaN and dropped by the caller rather
    than filled, because an imputed history is an invented history.
    """
    out = pd.DataFrame(index=df.index)
    close, high, low, vol = df["close"], df["high"], df["low"], df["volume"]
    r = _log_returns(close)

    # --- shock magnitude, in units of the instrument's own recent vol -------
    v20 = realized_vol(close, 20)
    v60 = realized_vol(close, 60)
    daily_v60 = v60 / np.sqrt(TRADING_DAYS)
    out["ret_1d"] = r
    out["shock_z"] = r / daily_v60.replace(0, np.nan)

    # --- volatility state ---------------------------------------------------
    out["vol_20d"] = v20
    out["vol_60d"] = v60
    out["vol_ratio_20_60"] = v20 / v60.replace(0, np.nan)
    out["vol_of_vol"] = v20.rolling(60, min_periods=60).std()

    # --- trend / momentum ---------------------------------------------------
    for w in (5, 20, 60, 120):
        out[f"mom_{w}d"] = close.pct_change(w)
    ma50 = close.rolling(50, min_periods=50).mean()
    ma200 = close.rolling(200, min_periods=200).mean()
    out["px_vs_ma50_z"] = (close / ma50 - 1) / daily_v60.replace(0, np.nan)
    out["px_vs_ma200_z"] = (close / ma200 - 1) / daily_v60.replace(0, np.nan)
    out["ma50_vs_ma200"] = ma50 / ma200 - 1

    # --- drawdown / stress --------------------------------------------------
    roll_max = close.rolling(60, min_periods=60).max()
    out["drawdown_60d"] = close / roll_max - 1

    # --- intraday structure of the move -------------------------------------
    # How much of the day was gap vs traded range: a gap-driven shock is news
    # arriving overnight, a range-driven one is intraday repricing.
    prev_close = close.shift(1)
    out["gap_share"] = (df["open"] - prev_close) / (close - prev_close).replace(0, np.nan)
    out["true_range_z"] = ((high - low) / prev_close) / daily_v60.replace(0, np.nan)
    out["close_loc_in_range"] = (close - low) / (high - low).replace(0, np.nan)

    # --- participation ------------------------------------------------------
    out["volume_ratio_20d"] = vol / vol.rolling(20, min_periods=20).mean().replace(0, np.nan)

    # --- persistence of recent shocks --------------------------------------
    absz = out["shock_z"].abs()
    out["shocks_20d"] = (absz > 1.5).rolling(20, min_periods=20).sum()
    out["autocorr_20d"] = r.rolling(20, min_periods=20).apply(
        lambda x: pd.Series(x).autocorr(lag=1) if pd.Series(x).std() > 0 else np.nan, raw=False
    )

    return out.replace([np.inf, -np.inf], np.nan)


FEATURE_COLUMNS: tuple[str, ...] = (
    "shock_z",
    "vol_20d",
    "vol_60d",
    "vol_ratio_20_60",
    "vol_of_vol",
    "mom_5d",
    "mom_20d",
    "mom_60d",
    "mom_120d",
    "px_vs_ma50_z",
    "px_vs_ma200_z",
    "ma50_vs_ma200",
    "drawdown_60d",
    "gap_share",
    "true_range_z",
    "close_loc_in_range",
    "volume_ratio_20d",
    "shocks_20d",
    "autocorr_20d",
)

FEATURE_PROVENANCE: dict[str, str] = {
    "shock_z": "day's log return / trailing 60d daily vol; the standardized shock itself",
    "vol_20d": "annualized realized vol, 20 sessions to t",
    "vol_60d": "annualized realized vol, 60 sessions to t",
    "vol_ratio_20_60": "short vs long realized vol; >1 is vol expansion",
    "vol_of_vol": "60d std of the 20d vol series; instability of the vol regime",
    "mom_5d": "5-session price change to t",
    "mom_20d": "20-session price change to t",
    "mom_60d": "60-session price change to t",
    "mom_120d": "120-session price change to t",
    "px_vs_ma50_z": "distance from 50d mean in daily-vol units",
    "px_vs_ma200_z": "distance from 200d mean in daily-vol units",
    "ma50_vs_ma200": "50d/200d mean ratio minus 1; trend regime",
    "drawdown_60d": "close vs 60d high",
    "gap_share": "overnight gap as a share of the day's total move",
    "true_range_z": "high-low range in daily-vol units",
    "close_loc_in_range": "where the close sat inside the day's range, 0=low 1=high",
    "volume_ratio_20d": "volume vs its own 20d mean",
    "shocks_20d": "count of |shock_z|>1.5 days in the trailing 20",
    "autocorr_20d": "lag-1 autocorrelation of returns over the trailing 20",
}


def build_close_features(close: pd.Series) -> pd.DataFrame:
    """Point-in-time features from a close-only price series.

    Used for the FRED market panel, which has no OHLCV. Same discipline: every
    column at date t uses only observations up to and including t.
    """
    out = pd.DataFrame(index=close.index)
    r = _log_returns(close)
    v20 = realized_vol(close, 20)
    v60 = realized_vol(close, 60)
    daily_v60 = (v60 / np.sqrt(TRADING_DAYS)).replace(0, np.nan)

    out["ret_1d"] = r
    out["shock_z"] = r / daily_v60
    out["vol_20d"] = v20
    out["vol_60d"] = v60
    out["vol_ratio_20_60"] = v20 / v60.replace(0, np.nan)
    out["vol_of_vol"] = v20.rolling(60, min_periods=60).std()
    for w in (5, 20, 60, 120):
        out[f"mom_{w}d"] = close.pct_change(w)
    ma50 = close.rolling(50, min_periods=50).mean()
    ma200 = close.rolling(200, min_periods=200).mean()
    out["px_vs_ma50_z"] = (close / ma50 - 1) / daily_v60
    out["px_vs_ma200_z"] = (close / ma200 - 1) / daily_v60
    out["ma50_vs_ma200"] = ma50 / ma200 - 1
    out["drawdown_60d"] = close / close.rolling(60, min_periods=60).max() - 1
    out["shocks_20d"] = (out["shock_z"].abs() > 1.5).rolling(20, min_periods=20).sum()
    out["autocorr_20d"] = r.rolling(20, min_periods=20).apply(
        lambda x: pd.Series(x).autocorr(lag=1) if pd.Series(x).std() > 0 else np.nan, raw=False
    )
    return out.replace([np.inf, -np.inf], np.nan)


CLOSE_FEATURE_COLUMNS: tuple[str, ...] = (
    "shock_z",
    "vol_20d",
    "vol_60d",
    "vol_ratio_20_60",
    "vol_of_vol",
    "mom_5d",
    "mom_20d",
    "mom_60d",
    "mom_120d",
    "px_vs_ma50_z",
    "px_vs_ma200_z",
    "ma50_vs_ma200",
    "drawdown_60d",
    "shocks_20d",
    "autocorr_20d",
)
