"""Rolling statistics over gappy panels.

A cross-asset panel is a union of calendars. SP500 has no value on a US market
holiday, WTI has none when the NYMEX is shut, and FRED licenses some series for
only the last ten years, so the panel is dense nowhere and every column has its
own holes.

`series.rolling(60, min_periods=60)` over that panel silently returns NaN for
every window containing a hole. It does not warn. It does not error. The column
simply comes back mostly empty and whatever consumed it gets a much smaller
sample than it thinks it has.

The damage this caused, measured on the real panel: SP500's 60-day volatility
produced **21** usable values instead of 2,452, and the count of 2-sigma days
went from 142 to **zero**. A model reading that column would have concluded
the S&P has no stress days at all, from a series that has one every eighteen
sessions.

So rolling windows are computed on the dates a series was actually observed,
then put back on the panel's index. "The last 60 observations" is what a
volatility window means; "the last 60 calendar slots, if none was a holiday"
is not.
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd


def on_observed(s: pd.Series, fn: Callable[[pd.Series], pd.Series]) -> pd.Series:
    """Apply `fn` to the series' observed values, then reindex to the original.

    `fn` receives a gap-free series and must return one aligned to its input.
    """
    s = pd.Series(s)
    dense = s.dropna()
    if dense.empty:
        return pd.Series(np.nan, index=s.index, dtype=float)
    return fn(dense).reindex(s.index)


def rolling_std(s: pd.Series, window: int) -> pd.Series:
    """Trailing standard deviation of the last `window` OBSERVATIONS."""
    return on_observed(s, lambda d: d.rolling(window, min_periods=window).std())


def rolling_sum(s: pd.Series, window: int) -> pd.Series:
    return on_observed(s, lambda d: d.rolling(window, min_periods=window).sum())


def rolling_mean(s: pd.Series, window: int) -> pd.Series:
    return on_observed(s, lambda d: d.rolling(window, min_periods=window).mean())


def standardize(s: pd.Series, window: int) -> pd.Series:
    """z = value / trailing volatility, both on the observed calendar."""
    return s / rolling_std(s, window).replace(0, np.nan)


def shock_series(s: pd.Series, *, window: int = 60, sigma: float = 2.0,
                 signed: bool = True) -> pd.Series:
    """Signed standardized move on shock days, zero elsewhere.

    Standardized by *trailing* volatility so "a 2-sigma day" means the same
    thing in 2013 and in 2020 and uses nothing from the future.
    """
    z = standardize(s, window)
    out = z.where(z.abs() >= sigma, 0.0)
    if not signed:
        out = out.abs()
    return out.fillna(0.0)
