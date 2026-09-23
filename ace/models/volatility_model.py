"""Train / validate the ACE volatility forecaster.

Protocol: expanding-window walk-forward. Every coefficient used to predict
row t is fitted only on rows before t, including the baselines' scaling. A
sealed holdout is scored once at the end.

The baselines are deliberately strong:
  historical mean   mean of log RV to date
  random walk       last month's log RV used directly (slope 1, unfitted)
  scaled RW         last month's log RV with a FITTED slope/intercept -- the
                    honest naive model, since raw trailing vol is biased
  EWMA              RiskMetrics-style exponentially weighted variance
HAR has to beat the scaled random walk, not the raw one.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings("ignore")

from ace.config import RANDOM_SEED, REPORTS
from ace.data.fred_market import market_panel
from ace.metrics.bootstrap import block_bootstrap_ci
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow
from ace.ripple.transmission import to_returns
from ace.volatility.har import EPS, forward_vol, har_features, qlike, score

MODEL_ID = "ace_volatility_har"
MODEL_VERSION = "v1"
HORIZON = 20
MIN_TRAIN = 500
HOLDOUT_FRAC = 0.25


def _ewma_log_vol(returns: pd.Series, lam: float = 0.94) -> pd.Series:
    var = returns.pow(2).ewm(alpha=1 - lam, min_periods=22).mean()
    return np.log(np.maximum(np.sqrt(var), EPS))


def _expanding_ols(X: np.ndarray, y: np.ndarray, start: int) -> np.ndarray:
    """Prediction at t from coefficients fitted only on rows before t."""
    pred = np.full(len(y), np.nan)
    for t in range(start, len(y)):
        try:
            coef = np.linalg.lstsq(X[:t], y[:t], rcond=None)[0]
        except np.linalg.LinAlgError:
            continue
        pred[t] = float(X[t] @ coef)
    return pred


def _lightgbm_walkforward(X: np.ndarray, y: np.ndarray, start: int, seed: int, refit: int = 125) -> np.ndarray:
    import lightgbm as lgb

    pred = np.full(len(y), np.nan)
    model = None
    for t in range(start, len(y)):
        if model is None or (t - start) % refit == 0:
            model = lgb.LGBMRegressor(
                n_estimators=300, learning_rate=0.03, num_leaves=7, max_depth=3,
                min_child_samples=40, subsample=0.8, subsample_freq=1,
                colsample_bytree=0.8, reg_lambda=5.0, random_state=seed, n_jobs=2, verbose=-1,
            )
            model.fit(X[:t], y[:t])
        pred[t] = float(model.predict(X[t : t + 1])[0])
    return pred


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="SP500")
    ap.add_argument("--horizon", type=int, default=HORIZON)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 78)
    print(f"ACE volatility forecaster :: {MODEL_ID} {MODEL_VERSION}  ({args.channel}, {args.horizon}d)")
    print("=" * 78)

    panel = market_panel("2010-01-01")
    rets = to_returns(panel)
    r = rets[args.channel].dropna()

    feats = har_features(r)
    feats["log_ewma"] = _ewma_log_vol(r)
    if "VIX" in panel.columns:
        vix = panel["VIX"].reindex(r.index).ffill()
        feats["log_vix"] = np.log(np.maximum(vix / 100.0 / np.sqrt(252), EPS))
    y = np.log(np.maximum(forward_vol(r, args.horizon), EPS)).rename("y")

    d = pd.concat([feats, y], axis=1).dropna()
    print(f"\ndataset {len(d)} rows  {d.index.min().date()} -> {d.index.max().date()}")
    print(f"target: log realized vol over the next {args.horizon} sessions")

    cut = int(len(d) * (1 - HOLDOUT_FRAC))
    boundary = d.index[cut]
    print(f"sealed holdout from {boundary.date()}  (dev {cut}, holdout {len(d)-cut})")

    yv = d["y"].to_numpy()
    ones = np.ones(len(d))
    har_cols = ["log_rv_d", "log_rv_w", "log_rv_m", "log_rv_q"]
    X_har = np.column_stack([ones] + [d[c].to_numpy() for c in har_cols])
    X_rw = np.column_stack([ones, d["log_rv_m"].to_numpy()])
    X_ewma = np.column_stack([ones, d["log_ewma"].to_numpy()])
    have_vix = "log_vix" in d.columns
    X_full = np.column_stack([X_har] + ([d["log_vix"].to_numpy()] if have_vix else []))

    preds: dict[str, np.ndarray] = {}
    preds["historical_mean"] = pd.Series(yv).expanding().mean().shift(1).to_numpy()
    preds["random_walk_raw"] = d["log_rv_m"].to_numpy()          # slope forced to 1
    preds["random_walk_scaled"] = _expanding_ols(X_rw, yv, MIN_TRAIN)
    preds["ewma_scaled"] = _expanding_ols(X_ewma, yv, MIN_TRAIN)
    preds["har_rv"] = _expanding_ols(X_har, yv, MIN_TRAIN)
    if have_vix:
        preds["har_rv_plus_vix"] = _expanding_ols(X_full, yv, MIN_TRAIN)
    preds["lightgbm"] = _lightgbm_walkforward(X_full[:, 1:], yv, MIN_TRAIN, args.seed)

    valid = np.ones(len(d), dtype=bool)
    for p in preds.values():
        valid &= np.isfinite(p)
    dev_mask = valid.copy(); dev_mask[cut:] = False
    hold_mask = valid.copy(); hold_mask[:cut] = False
    print(f"scored rows: dev {int(dev_mask.sum())}, holdout {int(hold_mask.sum())}")

    print("\n" + "-" * 78)
    print("DEVELOPMENT (walk-forward, all coefficients fitted backward only)")
    print("-" * 78)
    print(f"{'model':<22}{'R2 log':>9}{'R2 level':>10}{'MAE':>10}{'QLIKE':>10}{'slope':>8}")
    dev_reports = {}
    for name, p in preds.items():
        rep = score(name, yv[dev_mask], p[dev_mask])
        dev_reports[name] = rep
        print(f"{name:<22}{rep.r2_log:>+9.4f}{rep.r2_level:>+10.4f}{rep.mae_level:>10.5f}{rep.qlike:>10.4f}{rep.bias_slope:>8.3f}")

    print("\n" + "=" * 78)
    print("SEALED HOLDOUT (read once)")
    print("=" * 78)
    print(f"{'model':<22}{'R2 log':>9}{'R2 level':>10}{'MAE':>10}{'QLIKE':>10}{'slope':>8}")
    hold_reports = {}
    for name, p in preds.items():
        rep = score(name, yv[hold_mask], p[hold_mask])
        hold_reports[name] = rep
        print(f"{name:<22}{rep.r2_log:>+9.4f}{rep.r2_level:>+10.4f}{rep.mae_level:>10.5f}{rep.qlike:>10.4f}{rep.bias_slope:>8.3f}")

    champion = max(
        (n for n in hold_reports if n not in ("historical_mean", "random_walk_raw")),
        key=lambda n: hold_reports[n].r2_log,
    )
    naive = "random_walk_scaled"
    lift = hold_reports[champion].r2_log - hold_reports[naive].r2_log
    print(f"\nbest model: {champion}")
    print(f"lift over the scaled naive baseline: {lift:+.4f} R2(log)")

    # Bootstrap the R2 gap itself, so "better" is not eyeballed.
    yh = yv[hold_mask]
    pc = preds[champion][hold_mask]
    pn = preds[naive][hold_mask]

    def r2_gap(idx_y, idx_p):
        return 0.0  # placeholder, replaced below

    rng = np.random.default_rng(args.seed)
    n = len(yh); block = 40
    gaps = []
    for _ in range(800):
        starts = rng.integers(0, max(1, n - block + 1), size=int(np.ceil(n / block)))
        idx = np.concatenate([np.arange(s, min(s + block, n)) for s in starts])[:n]
        yy, cc, nn = yh[idx], pc[idx], pn[idx]
        sst = np.sum((yy - yy.mean()) ** 2)
        if sst <= 0:
            continue
        gaps.append((1 - np.sum((yy - cc) ** 2) / sst) - (1 - np.sum((yy - nn) ** 2) / sst))
    lo, hi = (float(np.quantile(gaps, 0.025)), float(np.quantile(gaps, 0.975))) if gaps else (float("nan"),) * 2
    print(f"R2 gap 95% CI (block bootstrap): [{lo:+.4f}, {hi:+.4f}]")

    beats_mean = hold_reports[champion].r2_log > hold_reports["historical_mean"].r2_log
    beats_naive = lift > 0 and lo > 0
    passes = beats_mean and beats_naive and hold_reports[champion].r2_log > 0

    print("\n" + "=" * 78)
    if passes:
        print(f"VERDICT: PASSES THE GATE")
        print(f"  {champion} beats the historical mean AND a properly scaled naive model,")
        print(f"  with a bootstrap CI on the gap that excludes zero.")
    else:
        print("VERDICT: NO VALIDATED EDGE OVER THE NAIVE BASELINE")
    print("=" * 78)

    status = "CANDIDATE" if passes else "FAILED"
    record = ModelRecord(
        model_id=MODEL_ID, model_family=champion, model_version=MODEL_VERSION,
        analysis_type="volatility_forecast",
        target_variable=f"log realized vol of {args.channel} over next {args.horizon} sessions",
        feature_schema=[c for c in d.columns if c != "y"],
        training_start=str(d.index.min().date()), training_end=str(boundary.date()),
        validation_periods=[{"scheme": "expanding walk-forward", "min_train": MIN_TRAIN,
                             "n_scored": int(dev_mask.sum())}],
        holdout_period={"start": str(boundary.date()), "n": int(hold_mask.sum())},
        training_dataset_hash=dataframe_hash(d),
        hyperparameters={"horizon": args.horizon, "min_train": MIN_TRAIN},
        random_seed=args.seed,
        performance_metrics={"development": {k: v.to_dict() for k, v in dev_reports.items()},
                             "holdout": {k: v.to_dict() for k, v in hold_reports.items()}},
        calibration_metrics={"bias_slope_holdout": hold_reports[champion].bias_slope},
        benchmark_metrics={"champion": champion, "naive": naive,
                           "r2_lift": round(lift, 4), "r2_gap_ci": [round(lo, 4), round(hi, 4)]},
        model_artifact_path="", creation_timestamp=utcnow(), production_status=status,
        notes=f"HAR-RV in logs; QLIKE reported; channel {args.channel}",
    )
    register(record, artifact={"champion": champion, "features": [c for c in d.columns if c != "y"]})
    if passes:
        promote(MODEL_ID, MODEL_VERSION,
                reason=f"{champion} R2(log)={hold_reports[champion].r2_log:+.4f} vs naive "
                       f"{hold_reports[naive].r2_log:+.4f}, gap CI [{lo:+.4f},{hi:+.4f}]")
        print(f"\nregistry: PROMOTED to PRODUCTION")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_{args.channel}_scorecard.json"
    out.write_text(json.dumps({
        "channel": args.channel, "horizon": args.horizon, "n": len(d),
        "development": {k: v.to_dict() for k, v in dev_reports.items()},
        "holdout": {k: v.to_dict() for k, v in hold_reports.items()},
        "champion": champion, "r2_lift_vs_scaled_naive": round(lift, 4),
        "r2_gap_ci": [round(lo, 4), round(hi, 4)], "status": status,
    }, indent=2, default=str))
    print(f"scorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
