"""Discretized world state for the Dynamic Bayesian Network (§3 Engine 1).

A Bayesian network reasons over discrete variables, so the continuous tape has
to become states. The whole correctness question is WHERE the thresholds come
from.

Cutting a series into terciles using the full sample is the standard way to
leak the future into a state label: the boundary that says "volatility is high
today" was computed partly from volatility that had not happened yet. Every
threshold here is computed on an EXPANDING window — the state at day t is
labelled only against the distribution observed up to t — and the first
`min_history` rows are left unlabelled rather than guessed.

States are deliberately coarse (2-3 levels). A DBN's conditional probability
table grows as the product of its parents' cardinalities; with 4 parents at 3
levels each that is 81 rows to estimate per variable, and finer states would
leave most of them empty.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MIN_HISTORY = 500


def expanding_tercile(s: pd.Series, *, min_history: int = MIN_HISTORY,
                      labels: tuple[str, str, str] = ("low", "mid", "high")) -> pd.Series:
    """Label each value against the distribution observed strictly before it."""
    v = s.to_numpy(dtype=float)
    out = np.full(len(v), None, dtype=object)
    for t in range(min_history, len(v)):
        past = v[:t]
        past = past[np.isfinite(past)]
        if len(past) < min_history or not np.isfinite(v[t]):
            continue
        lo, hi = np.quantile(past, [1 / 3, 2 / 3])
        out[t] = labels[0] if v[t] <= lo else (labels[2] if v[t] > hi else labels[1])
    return pd.Series(out, index=s.index, dtype=object)


def expanding_median_split(s: pd.Series, *, min_history: int = MIN_HISTORY,
                           labels: tuple[str, str] = ("low", "high")) -> pd.Series:
    v = s.to_numpy(dtype=float)
    out = np.full(len(v), None, dtype=object)
    for t in range(min_history, len(v)):
        past = v[:t]
        past = past[np.isfinite(past)]
        if len(past) < min_history or not np.isfinite(v[t]):
            continue
        out[t] = labels[1] if v[t] > np.median(past) else labels[0]
    return pd.Series(out, index=s.index, dtype=object)


def build_state_frame(
    returns: pd.Series,
    *,
    vix: pd.Series | None = None,
    news_z: pd.Series | None = None,
    curve: pd.Series | None = None,
    stress_z: float = 2.0,
) -> pd.DataFrame:
    """Daily discrete world state.

    Columns:
      vol       low / mid / high   trailing 20d realized volatility
      implied   low / high         VIX level, when available
      news      low / mid / high   news-uncertainty z-score
      curve     low / high         20d change in the yield curve
      stress    no / yes           a |return| >= stress_z * trailing vol day

    `stress` is the event ACE cares about: a material move, standardized by
    the instrument's own recent volatility so the definition means the same
    thing in 2017 and 2020.
    """
    vol20 = returns.rolling(20, min_periods=20).std()
    vol60 = returns.rolling(60, min_periods=60).std()
    z = (returns / vol60.replace(0, np.nan)).abs()

    frame = pd.DataFrame(index=returns.index)
    frame["vol"] = expanding_tercile(vol20)
    frame["stress"] = np.where(z >= stress_z, "yes", "no")
    frame.loc[z.isna(), "stress"] = None
    if vix is not None:
        frame["implied"] = expanding_median_split(vix.reindex(returns.index).ffill())
    if news_z is not None:
        frame["news"] = expanding_tercile(news_z.reindex(returns.index).ffill())
    if curve is not None:
        frame["curve"] = expanding_median_split(curve.reindex(returns.index).ffill().diff(20))
    return frame


def to_two_slice(frame: pd.DataFrame, variables: list[str]) -> pd.DataFrame:
    """Stack adjacent sessions into (variable, slice) columns for a 2-TBN.

    Row i holds session i in slice 0 and the NEXT session of the frame's own
    calendar in slice 1, which is the form a two-slice temporal network is
    estimated from. A pair is kept only when both sessions are fully labelled.

    Pairs are formed BEFORE incomplete sessions are dropped. Dropping first and
    pairing what remains (as this did until PR #5 A14) pairs session 99 with
    session 101 when session 100 is incomplete, and a two-session transition
    is then estimated as if it were one — the model's horizon silently depends
    on where the gaps fall. "Next session" means the next row of `frame`; a
    session missing from the underlying price series entirely is not visible
    here and has to be handled where the calendar is built.
    """
    sub = frame[variables]
    complete = sub.notna().all(axis=1).to_numpy()
    ok = complete[:-1] & complete[1:]
    if int(ok.sum()) < 200:
        raise ValueError(f"only {int(ok.sum())} complete adjacent-session pairs; need >=200")
    cur = sub.iloc[:-1][ok]
    nxt = sub.iloc[1:][ok]
    data = {}
    for v in variables:
        data[(v, 0)] = cur[v].to_numpy()
        data[(v, 1)] = nxt[v].to_numpy()
    out = pd.DataFrame(data)
    out.index = cur.index
    return out
