"""Historical analog retrieval (§26).

This is retrieval, not forecasting, and the distinction is the whole point.
It answers "when did the cross-asset state last look like this, and what
happened next" — a factual query over history. It does NOT claim the future
will rhyme; it reports the DISTRIBUTION of what followed, including how wide
and how conflicted that distribution is.

Mahalanobis distance is used rather than Euclidean because the state features
are correlated (equity vol and credit-ish channels move together). Euclidean
distance over correlated axes double-counts whatever they share, so the
nearest neighbours drift toward whichever direction has the most redundant
columns.

Point-in-time: an analog for date t may only be drawn from dates before t,
and the outcome window of a candidate must close before t as well — otherwise
the "what happened next" of a recent analog overlaps the present.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from ace.data.series import rolling_std, rolling_sum


@dataclass(frozen=True)
class Analog:
    date: str
    distance: float
    forward_return: float

    def to_dict(self) -> dict:
        return asdict(self)


def _state_matrix(returns: pd.DataFrame, channels: list[str], window: int = 20) -> pd.DataFrame:
    """Rolling state description: recent move and recent volatility per channel."""
    parts: dict[str, pd.Series] = {}
    for ch in channels:
        # Each channel has its own trading calendar; rolling over the panel's
        # union index would return NaN for every window spanning another
        # market's holiday. See ace/data/series.py.
        s = returns[ch]
        parts[f"{ch}_mom"] = rolling_sum(s, window)
        parts[f"{ch}_vol"] = rolling_std(s, window)
    return pd.DataFrame(parts).dropna()


# FRED licenses SP500 and DJIA for a rolling ten years; NASDAQ goes back to
# 2010. For an engine whose whole product is "what happened after states like
# this one", that is the difference between an analog pool that contains 2011
# and 2015 and one that does not — 4,060 usable states against 2,450. The
# equity leg therefore prefers whichever index carries the most history.
EQUITY_PREFERENCE = ("NASDAQ", "SP500", "DJIA")
OTHER_LEGS = ("UST10Y", "WTI", "USD_BROAD", "VIX")


def default_channels(returns: pd.DataFrame) -> list[str]:
    """Longest-history equity leg available, plus the macro legs."""
    equity = max(
        (c for c in EQUITY_PREFERENCE if c in returns.columns),
        key=lambda c: int(returns[c].notna().sum()),
        default=None,
    )
    legs = [c for c in OTHER_LEGS if c in returns.columns]
    return ([equity] if equity else []) + legs


def find_analogs(
    returns: pd.DataFrame,
    *,
    as_of: pd.Timestamp,
    target_channel: str,
    channels: list[str] | None = None,
    window: int = 20,
    forward: int = 20,
    k: int = 20,
) -> dict:
    """K nearest historical states before `as_of`, and what followed each.

    Returns the analog list plus the distribution of their forward outcomes —
    never a single "expected" number, because the spread is the information.
    """
    channels = channels or default_channels(returns)
    as_of = pd.Timestamp(as_of)
    if as_of.tzinfo is None:
        as_of = as_of.tz_localize("UTC")

    state = _state_matrix(returns, channels, window)
    if as_of not in state.index:
        prior = state.index[state.index <= as_of]
        if len(prior) == 0:
            return {"available": False, "reason": "no state history before as_of"}
        as_of = prior[-1]

    # Forward window, computed by reversing the series so the sum at t covers
    # t+1..t+forward and never t itself.
    fwd = returns[target_channel][::-1].rolling(forward).sum()[::-1].shift(-1)

    # Candidates: strictly before as_of, and whose own forward window has closed.
    cutoff = as_of - pd.Timedelta(days=int(forward * 1.6))
    cand = state.index[(state.index < cutoff)]
    if len(cand) < k * 3:
        return {"available": False, "reason": f"only {len(cand)} eligible historical states"}

    hist = state.loc[cand]
    current = state.loc[as_of]

    # Covariance from the candidate window only -- using the full sample would
    # let the present influence the metric used to retrieve its own analogs.
    cov = np.cov(hist.to_numpy(dtype=float), rowvar=False)
    try:
        inv = np.linalg.pinv(cov)
    except np.linalg.LinAlgError:
        return {"available": False, "reason": "state covariance is singular"}

    delta = hist.to_numpy(dtype=float) - current.to_numpy(dtype=float)
    d2 = np.einsum("ij,jk,ik->i", delta, inv, delta)
    d = np.sqrt(np.maximum(d2, 0.0))

    order = np.argsort(d)[: k * 3]
    analogs: list[Analog] = []
    for i in order:
        dt = hist.index[i]
        f = fwd.get(dt, np.nan)
        if not np.isfinite(f):
            continue
        analogs.append(Analog(date=str(dt.date()), distance=round(float(d[i]), 4), forward_return=round(float(f), 6)))
        if len(analogs) >= k:
            break

    if len(analogs) < max(5, k // 3):
        return {"available": False, "reason": f"only {len(analogs)} analogs with a closed forward window"}

    outcomes = np.array([a.forward_return for a in analogs])
    share_up = float(np.mean(outcomes > 0))
    return {
        "available": True,
        "as_of": str(as_of.date()),
        "target_channel": target_channel,
        "state_channels": channels,
        "window": window,
        "forward_days": forward,
        "n_analogs": len(analogs),
        "analogs": [a.to_dict() for a in analogs],
        "outcome_distribution": {
            "share_positive": round(share_up, 4),
            "mean": round(float(np.mean(outcomes)), 6),
            "median": round(float(np.median(outcomes)), 6),
            "p10": round(float(np.quantile(outcomes, 0.10)), 6),
            "p25": round(float(np.quantile(outcomes, 0.25)), 6),
            "p75": round(float(np.quantile(outcomes, 0.75)), 6),
            "p90": round(float(np.quantile(outcomes, 0.90)), 6),
            "std": round(float(np.std(outcomes)), 6),
        },
        # An honest read of how much the analog set actually agrees. Near 0.5
        # means history is split and the retrieval says nothing directional.
        "agreement": round(float(abs(share_up - 0.5) * 2), 4),
        "basis": "retrieval over past states only; distribution reported, not a point forecast",
    }
