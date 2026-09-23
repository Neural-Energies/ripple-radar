"""Measured cross-market transmission (§11, §12, §13).

What this replaces: the app's causal graph currently assigns every edge a
confidence of `clamp(0.8 - depth*0.08, 0.42, 0.9)` — a function of how deep the
node sits in a hand-drawn tree. That is a layout property presented as a
mechanism strength. Nothing about it was measured.

This module estimates edges from data instead:

  contemporaneous  correlation of same-day returns
  lead-lag         cross-correlation at lags 1..K, with the lag that maximises
                   |rho| and an approximate significance bound
  granger          F-test that lagged X improves a forecast of Y beyond Y's own
                   lags — reported as PREDICTIVE, never as causal (§13)
  var / irf        vector autoregression and orthogonalized impulse responses,
                   so "a 1-sigma shock to crude moves X by Y over Z days" is a
                   number the data produced

Everything runs on stationary transforms: log differences for price levels,
first differences for yields and spreads. Fitting a VAR to raw levels is the
standard way to manufacture a spurious relationship, so `to_returns` is not
optional.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import adfuller, grangercausalitytests

from ace.data.fred_market import LEVEL_SERIES


def to_returns(panel: pd.DataFrame) -> pd.DataFrame:
    """Stationary transform: log-diff prices, first-diff yields and spreads."""
    out = {}
    for col in panel.columns:
        s = panel[col].dropna()
        if col in LEVEL_SERIES:
            out[col] = s.diff()           # a yield's "return" is a change in level
        else:
            out[col] = np.log(s).diff()
    return pd.DataFrame(out).dropna(how="all")


def stationarity(series: pd.Series, *, alpha: float = 0.05) -> dict:
    """Augmented Dickey-Fuller. Reported, not silently assumed."""
    s = pd.Series(series).dropna()
    if len(s) < 50:
        return {"n": len(s), "stationary": None, "p_value": None, "note": "too few observations"}
    stat, p, *_ = adfuller(s.values, autolag="AIC", result_object=False)
    return {"n": int(len(s)), "adf_stat": round(float(stat), 4), "p_value": round(float(p), 6),
            "stationary": bool(p < alpha)}


@dataclass(frozen=True)
class Edge:
    source: str
    dest: str
    contemporaneous_corr: float
    best_lag: int
    lead_lag_corr: float
    lead_lag_significant: bool
    granger_p_value: float | None
    granger_predictive: bool
    n_obs: int

    def to_dict(self) -> dict:
        return asdict(self)


def _significance_bound(n: int, *, z: float = 1.96) -> float:
    """Approximate |rho| threshold for a correlation to differ from zero."""
    return float(z / np.sqrt(max(n, 2)))


def lead_lag(x: pd.Series, y: pd.Series, *, max_lag: int = 5) -> tuple[int, float, float]:
    """Best lag of x leading y, its correlation, and the same-day correlation.

    A positive lag means x moves first. Correlations are computed on the
    overlapping, non-null sample at each lag.
    """
    df = pd.concat([x.rename("x"), y.rename("y")], axis=1).dropna()
    if len(df) < 60:
        return 0, float("nan"), float("nan")
    contemporaneous = float(df["x"].corr(df["y"]))
    best_lag, best_rho = 0, contemporaneous
    for lag in range(1, max_lag + 1):
        shifted = pd.concat([df["x"].shift(lag).rename("x"), df["y"]], axis=1).dropna()
        if len(shifted) < 60:
            continue
        rho = float(shifted["x"].corr(shifted["y"]))
        if np.isfinite(rho) and abs(rho) > abs(best_rho):
            best_lag, best_rho = lag, rho
    return best_lag, best_rho, contemporaneous


def granger_p(x: pd.Series, y: pd.Series, *, max_lag: int = 5) -> float | None:
    """Smallest p-value that lagged x improves a forecast of y.

    This tests PREDICTIVE precedence only. Granger's own caveat applies: a
    third variable driving both produces the same result, so nothing here is
    labelled causal (§13).
    """
    df = pd.concat([y.rename("y"), x.rename("x")], axis=1).dropna()
    if len(df) < 120:
        return None
    try:
        res = grangercausalitytests(df[["y", "x"]].values, maxlag=max_lag)
    except Exception:
        return None
    ps = [res[l][0]["ssr_ftest"][1] for l in res]
    return float(min(ps)) if ps else None


def build_edges(
    returns: pd.DataFrame, *, max_lag: int = 5, granger_alpha: float = 0.01
) -> list[Edge]:
    """All ordered pairs, with measured strengths.

    `granger_alpha` is deliberately tight: with ~16 channels there are 240
    ordered pairs, so a 0.05 threshold would return a dozen edges by chance
    alone. This is a multiple-comparison control, not a preference for fewer
    edges.
    """
    cols = list(returns.columns)
    edges: list[Edge] = []
    bound_cache: dict[int, float] = {}
    for src in cols:
        for dst in cols:
            if src == dst:
                continue
            x, y = returns[src].dropna(), returns[dst].dropna()
            n = len(pd.concat([x, y], axis=1).dropna())
            if n < 120:
                continue
            lag, rho, contemp = lead_lag(x, y, max_lag=max_lag)
            if not np.isfinite(rho):
                continue
            bound = bound_cache.setdefault(n, _significance_bound(n))
            gp = granger_p(x, y, max_lag=max_lag) if abs(rho) >= bound else None
            edges.append(
                Edge(
                    source=src,
                    dest=dst,
                    contemporaneous_corr=round(float(contemp), 4),
                    best_lag=int(lag),
                    lead_lag_corr=round(float(rho), 4),
                    lead_lag_significant=bool(abs(rho) >= bound),
                    granger_p_value=None if gp is None else round(gp, 6),
                    granger_predictive=bool(gp is not None and gp < granger_alpha),
                    n_obs=int(n),
                )
            )
    return edges


def impulse_responses(
    returns: pd.DataFrame, *, channels: list[str], lags: int | None = None, horizon: int = 10
) -> dict:
    """VAR impulse responses: what a 1-sigma shock to each channel does.

    Lag order is selected by AIC rather than chosen by hand, stability is
    checked, and an unstable system is reported as unusable rather than having
    its responses read anyway.
    """
    from statsmodels.tsa.api import VAR

    data = returns[channels].dropna()
    if len(data) < 250:
        return {"available": False, "reason": f"only {len(data)} aligned observations"}
    model = VAR(data.values)
    if lags is None:
        try:
            lags = int(model.select_order(maxlags=10).aic) or 1
        except Exception:
            lags = 2
    lags = max(1, min(lags, 10))
    fitted = model.fit(lags)
    roots = np.abs(fitted.roots)
    stable = bool(np.all(roots > 1.0))  # statsmodels reports inverse roots
    if not stable:
        return {"available": False, "reason": "VAR is not stable; responses would not decay",
                "lags": lags, "max_inverse_root": round(float(roots.min()), 4)}
    irf = fitted.irf(horizon)
    sigma = data.std().values
    out: dict[str, dict[str, list[float]]] = {}
    for i, shock in enumerate(channels):
        out[shock] = {}
        for j, resp in enumerate(channels):
            # scale the unit shock to one standard deviation of the shocked series
            path = irf.orth_irfs[:, j, i] * sigma[i] / max(sigma[i], 1e-12)
            out[shock][resp] = [round(float(v), 8) for v in (irf.orth_irfs[:, j, i])]
    return {"available": True, "lags": int(lags), "horizon": horizon, "channels": channels,
            "n_obs": int(len(data)), "stable": stable, "responses": out}
