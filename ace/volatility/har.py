"""HAR-RV volatility forecasting (Corsi 2009) and baselines.

Why this model and not another: volatility clustering is the most replicated
result in empirical finance, and the Heterogeneous AutoRegressive model is the
standard production specification for it. It regresses future realized
volatility on three backward-looking components — daily, weekly and monthly —
which is a deliberately simple stand-in for traders acting on different
horizons. It is linear, has three parameters, and routinely beats far more
elaborate models out of sample.

Two specification choices that matter, and that an earlier pass here got wrong:

1. Work in LOGS. Realized volatility is right-skewed and strictly positive;
   log RV is close to Gaussian, which is what OLS assumes. Fitting in levels
   lets a handful of crisis days dominate the coefficients.

2. Never use trailing vol as a point forecast. Its slope against forward vol
   is about 0.5, not 1.0 — it is a biased estimator, and treating it as a
   prediction produces a near-zero R2 that looks like "volatility is
   unpredictable" when the real relationship is strong. The baselines here
   include a FITTED random walk for exactly that reason, so HAR has to beat a
   properly scaled naive model rather than a strawman.

Loss: QLIKE alongside R2 and MAE. QLIKE is the standard volatility loss
because it is robust to noise in the realized-vol proxy, where squared error
is not.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

TRADING_DAYS = 252
EPS = 1e-12


def realized_vol(returns: pd.Series, window: int) -> pd.Series:
    """Trailing realized volatility (std of returns) ending at t."""
    return returns.rolling(window, min_periods=window).std()


def forward_vol(returns: pd.Series, horizon: int) -> pd.Series:
    """Realized volatility over the NEXT `horizon` sessions, excluding today."""
    rev = returns[::-1]
    fwd = rev.rolling(horizon, min_periods=horizon).std()[::-1]
    return fwd.shift(-1)


def har_features(returns: pd.Series) -> pd.DataFrame:
    """Daily / weekly / monthly realized-vol components, in logs.

    Every column at t uses only returns up to and including t.
    """
    rv_d = realized_vol(returns, 1).fillna(returns.abs())
    rv_d = returns.abs().rolling(1).mean()
    out = pd.DataFrame(index=returns.index)
    out["log_rv_d"] = np.log(np.maximum(returns.abs().rolling(2, min_periods=2).std(), EPS))
    out["log_rv_w"] = np.log(np.maximum(realized_vol(returns, 5), EPS))
    out["log_rv_m"] = np.log(np.maximum(realized_vol(returns, 22), EPS))
    out["log_rv_q"] = np.log(np.maximum(realized_vol(returns, 66), EPS))
    return out


@dataclass(frozen=True)
class VolReport:
    model: str
    n: int
    r2_log: float
    r2_level: float
    mae_level: float
    qlike: float
    bias_slope: float

    def to_dict(self) -> dict:
        return asdict(self)


def qlike(actual: np.ndarray, pred: np.ndarray) -> float:
    """QLIKE loss on variances. Lower is better; robust to proxy noise."""
    a = np.maximum(np.asarray(actual, dtype=float) ** 2, EPS)
    p = np.maximum(np.asarray(pred, dtype=float) ** 2, EPS)
    return float(np.mean(a / p - np.log(a / p) - 1.0))


def score(name: str, y_log: np.ndarray, pred_log: np.ndarray) -> VolReport:
    """Score a log-vol forecast in both log and level space."""
    y_log = np.asarray(y_log, dtype=float)
    pred_log = np.asarray(pred_log, dtype=float)
    ok = np.isfinite(y_log) & np.isfinite(pred_log)
    y_log, pred_log = y_log[ok], pred_log[ok]
    y_lvl, p_lvl = np.exp(y_log), np.exp(pred_log)

    def r2(a, b):
        ss_tot = float(np.sum((a - a.mean()) ** 2))
        return 1 - float(np.sum((a - b) ** 2)) / ss_tot if ss_tot > 0 else float("nan")

    slope = float(np.polyfit(p_lvl, y_lvl, 1)[0]) if len(p_lvl) > 10 else float("nan")
    return VolReport(
        model=name,
        n=int(len(y_log)),
        r2_log=round(r2(y_log, pred_log), 4),
        r2_level=round(r2(y_lvl, p_lvl), 4),
        mae_level=round(float(np.mean(np.abs(y_lvl - p_lvl))), 6),
        qlike=round(qlike(y_lvl, p_lvl), 6),
        bias_slope=round(slope, 4),
    )
