"""Dataset: does a macro release surprise move the market? (§9, §10)

Event study on real releases, with real publication timestamps.

The surprise definition, stated honestly: ACE has no survey consensus feed, so
this is NOT the Bloomberg-style actual-minus-consensus surprise. It is the
deviation of the released value from an AR forecast fitted ONLY on vintages
published before that release — "how different was this print from what its
own recent history implied". That is a recognised econometric surprise proxy
and it is point-in-time clean, but it is a weaker signal than true consensus
surprise, and the model's performance should be read with that in mind.

Point-in-time discipline:
  * every input value carries its ALFRED publication timestamp
  * the AR forecast for release k uses only releases 1..k-1
  * the market reaction window starts on the release date, never before
  * surprises are standardized WITHIN a series, because a CPI surprise and a
    payrolls surprise are not on comparable scales (§10)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ace.data.alfred import release_history
from ace.data.fred_market import market_panel
from ace.ripple.transmission import to_returns

# Monthly macro releases with long, clean vintage histories on ALFRED.
EVENT_SERIES: dict[str, str] = {
    "CPI": "CPIAUCSL",
    "CORE_CPI": "CPILFESL",
    "PAYROLLS": "PAYEMS",
    "UNEMPLOYMENT": "UNRATE",
    "INDUSTRIAL_PRODUCTION": "INDPRO",
    "RETAIL_SALES": "RSAFS",
    "PPI": "PPIACO",
    "HOUSING_STARTS": "HOUST",
}

AR_LAGS = 6
MIN_HISTORY = 24          # releases needed before a surprise can be computed
REACTION_CHANNELS = ("SP500", "UST10Y", "USD_BROAD", "VIX")
HORIZONS = (1, 3, 5)


def _ar_surprise(values: np.ndarray, lags: int = AR_LAGS) -> float:
    """Deviation of the last value from an AR forecast fit on everything before it."""
    if len(values) < lags + 8:
        return float("nan")
    y = values[:-1]
    # growth rates, so a trending level series does not make every print a surprise
    g = np.diff(np.log(np.maximum(y, 1e-9))) if np.all(y > 0) else np.diff(y)
    if len(g) < lags + 4:
        return float("nan")
    X = np.column_stack([g[i : len(g) - lags + i] for i in range(lags)])
    target = g[lags:]
    if len(target) < 8:
        return float("nan")
    X = np.column_stack([np.ones(len(target)), X])
    try:
        coef = np.linalg.lstsq(X, target, rcond=None)[0]
    except np.linalg.LinAlgError:
        return float("nan")
    last_row = np.concatenate([[1.0], g[-lags:]])
    predicted = float(last_row @ coef)
    actual = float(np.log(values[-1] / values[-2])) if np.all(values[-2:] > 0) else float(values[-1] - values[-2])
    resid = target - X @ coef
    sd = float(np.std(resid))
    return (actual - predicted) / sd if sd > 1e-12 else float("nan")


def build(start: str = "2010-01-01") -> pd.DataFrame:
    """One row per macro release, with the surprise and forward market moves."""
    panel = market_panel(start)
    rets = to_returns(panel)
    rows: list[dict] = []

    for name, sid in EVENT_SERIES.items():
        try:
            hist = release_history(sid, start)
        except Exception:
            continue
        if len(hist) < MIN_HISTORY + AR_LAGS:
            continue
        vals = hist["value"].to_numpy(dtype=float)

        for k in range(MIN_HISTORY, len(hist)):
            pub = hist["published"].iloc[k]
            z = _ar_surprise(vals[: k + 1])
            if not np.isfinite(z):
                continue
            row: dict = {
                "series": name,
                "published": pub,
                "obs_date": hist["obs_date"].iloc[k],
                "value": float(vals[k]),
                "surprise_z": float(z),
                "abs_surprise_z": abs(float(z)),
            }
            # Market reaction strictly ON or AFTER the publication timestamp.
            ok = True
            for ch in REACTION_CHANNELS:
                if ch not in rets.columns:
                    continue
                fwd = rets[ch][rets.index >= pub]
                if len(fwd) < max(HORIZONS) + 1:
                    ok = False
                    break
                for h in HORIZONS:
                    row[f"{ch}_fwd{h}"] = float(fwd.iloc[:h].sum())
                # pre-release state, strictly before publication
                prior = rets[ch][rets.index < pub]
                if len(prior) >= 20:
                    row[f"{ch}_vol20_pre"] = float(prior.iloc[-20:].std())
                    row[f"{ch}_mom20_pre"] = float(prior.iloc[-20:].sum())
                else:
                    ok = False
                    break
            if ok:
                rows.append(row)

    if not rows:
        raise RuntimeError("no macro events built")
    df = pd.DataFrame(rows).sort_values("published").reset_index(drop=True)
    # Standardize the surprise within each series (§10).
    df["surprise_z"] = df.groupby("series")["surprise_z"].transform(
        lambda s: (s - s.mean()) / s.std(ddof=0) if s.std(ddof=0) > 1e-12 else s * 0
    )
    df["abs_surprise_z"] = df["surprise_z"].abs()
    return df.dropna().reset_index(drop=True)
