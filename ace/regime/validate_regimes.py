"""Does a real-time regime estimate carry information the tape doesn't already give?

A regime model is a state estimator, not a forecaster, so "accuracy" is the
wrong frame. The question that decides whether it may drive anything user-
facing is narrower and harder:

    Knowing only what was knowable at t, does the filtered regime probability
    improve a forecast of FORWARD realized volatility beyond what trailing
    realized volatility already tells you?

Trailing vol is a strong, nearly free baseline — volatility clusters, so
yesterday's vol predicts tomorrow's. A regime model earns its place only by
adding to that, not by beating a straw man.

Protocol: expanding window, periodic refits (as production would), filtered
probabilities only, forward window strictly after the fit window.
"""
from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings("ignore")

from ace.config import REPORTS
from ace.data.fred_market import market_panel
from ace.metrics.bootstrap import block_bootstrap_ci
from ace.regime.markov import fit_regimes, filtered_probabilities
from ace.ripple.transmission import to_returns

FORWARD = 20          # sessions of forward realized vol being explained
REFIT_EVERY = 125     # ~6 months; refitting daily is neither realistic nor affordable
MIN_TRAIN = 750


def run(channel: str = "SP500") -> dict:
    panel = market_panel("2010-01-01")
    rets = to_returns(panel)[channel].dropna()
    n = len(rets)
    print(f"{channel}: {n} returns {rets.index.min().date()} -> {rets.index.max().date()}")

    rows: list[dict] = []
    fits = 0
    for end in range(MIN_TRAIN, n - FORWARD, REFIT_EVERY):
        train = rets.iloc[:end]
        try:
            res, fit = fit_regimes(train, n_regimes=2)
        except Exception:
            continue
        if not fit.converged:
            continue
        fits += 1
        probs = filtered_probabilities(res)
        probs = probs if probs.ndim == 2 and probs.shape[0] == len(train) else np.asarray(probs).T
        stressed_idx = int(np.argmax(fit.regime_variance))

        # Apply this fit forward until the next refit, using only filtered
        # probabilities from within the fit window for the first point and
        # trailing vol thereafter -- i.e. no future data enters the feature.
        block_end = min(end + REFIT_EVERY, n - FORWARD)
        for t in range(end, block_end):
            p_stressed = float(probs[min(t, len(probs)) - 1][stressed_idx])
            trail20 = float(rets.iloc[max(0, t - 20):t].std())
            fwd = float(rets.iloc[t:t + FORWARD].std())
            if not np.isfinite(trail20) or not np.isfinite(fwd) or trail20 <= 0:
                continue
            rows.append({"date": rets.index[t], "p_stressed": p_stressed,
                         "trailing_vol_20d": trail20, "forward_vol_20d": fwd})

    df = pd.DataFrame(rows)
    print(f"refits: {fits} | evaluation points: {len(df)}")
    if len(df) < 200:
        return {"available": False, "reason": f"only {len(df)} points"}

    y = df["forward_vol_20d"].to_numpy()
    trail = df["trailing_vol_20d"].to_numpy()
    p = df["p_stressed"].to_numpy()

    def _r2(y, pred: np.ndarray) -> float:
        ss_res = float(np.sum((y - pred) ** 2))
        ss_tot = float(np.sum((y - np.mean(y)) ** 2))
        return 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")

    def _mae(y, pred: np.ndarray) -> float:
        return float(np.mean(np.abs(y - pred)))

    r2 = lambda pred: _r2(y, pred)
    mae = lambda pred: _mae(y, pred)

    # Every mapping below is fit STRICTLY BACKWARD. An earlier draft fit the
    # regime->vol coefficients on the whole evaluation set and reported R2 from
    # it; that is in-sample and inflates the result, which is exactly the kind
    # of number this project exists to not publish. `expanding_ols` refits on
    # the history available at each point instead.
    def expanding_ols(X: np.ndarray, *, min_fit: int = 250) -> np.ndarray:
        """Prediction at t from coefficients fit only on rows before t."""
        pred = np.full(len(y), np.nan)
        for t in range(min_fit, len(y)):
            Xt, yt = X[:t], y[:t]
            try:
                coef = np.linalg.lstsq(Xt, yt, rcond=None)[0]
            except np.linalg.LinAlgError:
                continue
            pred[t] = float(X[t] @ coef)
        return pred

    ones = np.ones_like(p)
    X_regime = np.column_stack([ones, p])
    X_comb = np.column_stack([ones, trail, p])

    pred_trail_full = trail
    pred_mean_full = pd.Series(y).expanding().mean().shift(1).bfill().to_numpy()
    pred_regime_full = expanding_ols(X_regime)
    pred_comb_full = expanding_ols(X_comb)

    # Score every method on the SAME rows -- the ones where the out-of-sample
    # mappings exist -- so the comparison is like for like.
    valid = ~np.isnan(pred_comb_full) & ~np.isnan(pred_regime_full)
    n_drop = int((~valid).sum())
    y = y[valid]
    trail = trail[valid]
    p = p[valid]
    df = df.loc[valid].reset_index(drop=True)
    pred_trail = pred_trail_full[valid]
    pred_mean = pred_mean_full[valid]
    pred_regime = pred_regime_full[valid]
    pred_comb = pred_comb_full[valid]
    print(f"scored on {len(y)} points (dropped {n_drop} warm-up rows for the backward fits)")

    results = {
        "historical_mean": {"r2": round(r2(pred_mean), 4), "mae": round(mae(pred_mean), 6)},
        "trailing_vol": {"r2": round(r2(pred_trail), 4), "mae": round(mae(pred_trail), 6)},
        "regime_only": {"r2": round(r2(pred_regime), 4), "mae": round(mae(pred_regime), 6)},
        "trailing_plus_regime": {"r2": round(r2(pred_comb), 4), "mae": round(mae(pred_comb), 6)},
    }
    print("\nforward 20d realized vol, explained:")
    for k, v in results.items():
        print(f"  {k:<22} R2={v['r2']:+.4f}  MAE={v['mae']:.6f}")

    incr = results["trailing_plus_regime"]["r2"] - results["trailing_vol"]["r2"]
    print(f"\nincremental R2 from adding the regime probability: {incr:+.4f}")

    ci = block_bootstrap_ci(
        y, pred_comb,
        lambda a, b: 1 - np.sum((a - b) ** 2) / np.sum((a - np.mean(a)) ** 2),
        n_boot=500, block=40, seed=17,
    )
    print(f"combined R2 95% CI [{ci['lo']:+.4f}, {ci['hi']:+.4f}]")

    # Does a high-stress reading actually correspond to higher realized vol?
    hi = df[df.p_stressed > 0.5]["forward_vol_20d"]
    lo = df[df.p_stressed <= 0.5]["forward_vol_20d"]
    sep = {"n_stressed": int(len(hi)), "n_calm": int(len(lo)),
           "fwd_vol_when_stressed": round(float(hi.mean()), 6) if len(hi) else None,
           "fwd_vol_when_calm": round(float(lo.mean()), 6) if len(lo) else None}
    if len(hi) and len(lo):
        ratio = hi.mean() / lo.mean()
        sep["ratio"] = round(float(ratio), 3)
        print(f"\nforward vol when flagged stressed: {hi.mean()*100:.3f}%/day (n={len(hi)})")
        print(f"forward vol when flagged calm    : {lo.mean()*100:.3f}%/day (n={len(lo)})")
        print(f"ratio: {ratio:.2f}x")

    adds_value = incr > 0.01 and ci["lo"] > results["trailing_vol"]["r2"]
    print("\n" + "=" * 70)
    if adds_value:
        print("VERDICT: regime probability adds information beyond trailing vol -> usable")
    else:
        print("VERDICT: regime state is DESCRIPTIVE, not incrementally predictive")
        print("  It may label the current environment; it may not be sold as a vol forecast.")
    print("=" * 70)

    report = {"channel": channel, "forward_days": FORWARD, "n_eval": len(df), "refits": fits,
              "results": results, "incremental_r2": round(incr, 4), "combined_r2_ci": ci,
              "separation": sep, "adds_value_beyond_trailing_vol": bool(adds_value),
              "basis": "filtered probabilities only; expanding window; forward window after fit"}
    out = REPORTS / f"regime_validation_{channel}.json"
    out.write_text(json.dumps(report, indent=2, default=str))
    print(f"\nreport {out}")
    return report


if __name__ == "__main__":
    run("SP500")
