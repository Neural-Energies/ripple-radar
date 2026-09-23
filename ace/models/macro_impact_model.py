"""Train / validate the macro-release impact model.

Two targets, because they are different questions and a single "does the
market go up" framing conflates them:

  direction  P(SP500 up over h days | signed surprise, pre-release state)
  magnitude  P(|SP500 move| exceeds its own recent typical size | ...)

The prior on direction is poor — if a public macro release predicted market
direction the trade would be arbitraged away. Magnitude is more defensible:
volatility expansion around scheduled events is well documented. Testing both
and reporting each on its merits is the point; expecting one to fail is not a
reason to skip it.
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

from ace.calibration.calibrate import fit_calibrator
from ace.config import RANDOM_SEED, REPORTS
from ace.datasets.macro_event_impact import HORIZONS, build
from ace.metrics.bootstrap import block_bootstrap_ci
from ace.metrics.classification import evaluate, reliability_table
from ace.models.baselines import BaseRate, logistic_baseline
from ace.registry.registry import ModelRecord, dataframe_hash, register, utcnow
from ace.validation.leakage import assert_probabilities
from ace.validation.walkforward import sealed_split, walk_forward_folds

MODEL_ID = "ace_macro_impact"
MODEL_VERSION = "v1"
CHANNEL = "SP500"
LABEL_HORIZON_DAYS = 8
EMBARGO_DAYS = 3


def _features(df: pd.DataFrame) -> list[str]:
    cols = ["surprise_z", "abs_surprise_z"]
    cols += [c for c in df.columns if c.endswith("_vol20_pre") or c.endswith("_mom20_pre")]
    return [c for c in cols if c in df.columns]


def _lightgbm(seed: int):
    import lightgbm as lgb

    return lgb.LGBMClassifier(
        objective="binary", n_estimators=200, learning_rate=0.03, num_leaves=5,
        max_depth=3, min_child_samples=40, subsample=0.8, subsample_freq=1,
        colsample_bytree=0.8, reg_alpha=0.5, reg_lambda=5.0,
        random_state=seed, n_jobs=2, verbose=-1,
    )


def _run_target(df: pd.DataFrame, feats: list[str], y: np.ndarray, label: str, seed: int) -> dict:
    print(f"\n{'=' * 74}\nTARGET: {label}   (base rate {y.mean():.4f}, n={len(y)})\n{'=' * 74}")
    X = df[feats].to_numpy(dtype=float)

    dev_idx, hold_idx, boundary = sealed_split(
        df["published"], holdout_frac=0.2,
        label_horizon_days=LABEL_HORIZON_DAYS, embargo_days=EMBARGO_DAYS,
    )
    dev = df.iloc[dev_idx].reset_index(drop=True)
    X_dev, y_dev = X[dev_idx], y[dev_idx]
    print(f"dev n={len(dev_idx)} | holdout n={len(hold_idx)} from {boundary.date()}")

    folds = walk_forward_folds(
        dev["published"], n_folds=4,
        label_horizon_days=LABEL_HORIZON_DAYS, embargo_days=EMBARGO_DAYS, min_train=150,
    )
    names = ["base_rate", "logistic", "lightgbm"]
    oof = {n: [] for n in names}
    oof_y, rates = [], []
    for f in folds:
        Xtr, ytr = X_dev[f.train_idx], y_dev[f.train_idx]
        Xva, yva = X_dev[f.valid_idx], y_dev[f.valid_idx]
        rates.append(float(ytr.mean()))
        oof_y.append(yva)
        for n in names:
            m = BaseRate() if n == "base_rate" else logistic_baseline(seed) if n == "logistic" else _lightgbm(seed)
            m.fit(Xtr, ytr)
            p = m.predict_proba(Xva)[:, 1]
            assert_probabilities(p)
            oof[n].append(p)

    y_oof = np.concatenate(oof_y)
    br = float(np.mean(rates))
    print(f"\nout-of-fold (n={len(y_oof)}, baseline {br:.4f})")
    wf = {}
    for n in names:
        r = evaluate(y_oof, np.concatenate(oof[n]), base_rate=br)
        wf[n] = r
        auc = f"{r.roc_auc:.4f}" if r.roc_auc is not None else "  n/a "
        print(f"  {n:<10} BSS={r.brier_skill_score:+.4f}  logloss={r.log_loss:.4f}  AUC={auc}  ECE={r.ece:.4f}")

    challenger = max((n for n in names if n != "base_rate"), key=lambda n: wf[n].brier_skill_score)
    cal, note = fit_calibrator(y_oof, np.concatenate(oof[challenger]), base_rate=br)
    print(f"challenger: {challenger} | calibration: {note}")

    final = logistic_baseline(seed) if challenger == "logistic" else _lightgbm(seed)
    final.fit(X_dev, y_dev)
    p_hold = cal.transform(final.predict_proba(X[hold_idx])[:, 1])
    assert_probabilities(p_hold)
    y_hold = y[hold_idx]
    hold = evaluate(y_hold, p_hold, base_rate=float(y_dev.mean()))

    bss_ci = block_bootstrap_ci(
        y_hold, p_hold,
        lambda a, b: 1 - np.mean((b - a) ** 2) / np.mean((float(y_dev.mean()) - a) ** 2),
        n_boot=600, block=10, seed=seed,
    )
    auc_ci = block_bootstrap_ci(
        y_hold, p_hold,
        lambda a, b: __import__("sklearn.metrics", fromlist=["roc_auc_score"]).roc_auc_score(a, b),
        n_boot=600, block=10, seed=seed,
    )
    print(f"\nSEALED HOLDOUT n={hold.n} (realized base rate {y_hold.mean():.4f})")
    print(f"  BSS={hold.brier_skill_score:+.4f}  logloss={hold.log_loss:.4f}  "
          f"AUC={hold.roc_auc if hold.roc_auc is None else round(hold.roc_auc,4)}  ECE={hold.ece:.4f}")
    print(f"  BSS 95% CI [{bss_ci['lo']:+.4f}, {bss_ci['hi']:+.4f}]")
    print(f"  AUC 95% CI [{auc_ci['lo']:.4f}, {auc_ci['hi']:.4f}]")

    passes = hold.beats_baseline() and bss_ci["lo"] > 0
    print(f"\n  -> {'CANDIDATE: beats baseline, CI excludes zero' if passes else 'NO VALIDATED EDGE (§61)'}")

    return {
        "label": label, "status": "CANDIDATE" if passes else "FAILED",
        "walk_forward": {n: wf[n].to_dict() for n in names},
        "holdout": hold.to_dict(), "bss_ci": bss_ci, "auc_ci": auc_ci,
        "challenger": challenger, "calibration": note,
        "reliability": reliability_table(y_hold, p_hold),
        "n_dev": int(len(dev_idx)), "n_holdout": int(len(hold_idx)),
        "boundary": str(boundary.date()),
        "_artifact": {"model": final, "calibrator": cal, "features": feats},
        "_folds": folds,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    df = build()
    feats = _features(df)
    print(f"macro release events: {len(df)} | features: {len(feats)}")
    print(f"span {df.published.min().date()} -> {df.published.max().date()}")

    h = HORIZONS[0]
    fwd = df[f"{CHANNEL}_fwd{h}"].to_numpy(dtype=float)
    pre_vol = df[f"{CHANNEL}_vol20_pre"].to_numpy(dtype=float)

    results = {}
    results["direction"] = _run_target(df, feats, (fwd > 0).astype(float), f"{CHANNEL} direction over {h}d", args.seed)
    # "Big move" = absolute move larger than the instrument's own recent daily
    # typical size, so the threshold adapts to the vol regime instead of being
    # a fixed percentage that means different things in 2017 and 2020.
    big = (np.abs(fwd) > pre_vol).astype(float)
    results["magnitude"] = _run_target(df, feats, big, f"{CHANNEL} |move| > trailing daily vol over {h}d", args.seed)

    for key, res in results.items():
        art = res.pop("_artifact")
        folds = res.pop("_folds")
        register(
            ModelRecord(
                model_id=f"{MODEL_ID}_{key}", model_family=res["challenger"], model_version=MODEL_VERSION,
                analysis_type="macro_event_impact", target_variable=res["label"],
                feature_schema=feats, training_start=str(df.published.min().date()),
                training_end=res["boundary"],
                validation_periods=[{"fold": f.index, "valid_start": str(f.valid_start.date()),
                                     "valid_end": str(f.valid_end.date()), "n_purged": f.n_purged} for f in folds],
                holdout_period={"start": res["boundary"], "n": res["n_holdout"]},
                training_dataset_hash=dataframe_hash(df[feats]),
                hyperparameters=getattr(art["model"], "get_params", lambda: {})(),
                random_seed=args.seed,
                performance_metrics={"walk_forward": res["walk_forward"], "holdout": res["holdout"]},
                calibration_metrics={"note": res["calibration"], "reliability": res["reliability"]},
                benchmark_metrics={"bss_ci": res["bss_ci"], "auc_ci": res["auc_ci"]},
                model_artifact_path="", creation_timestamp=utcnow(),
                production_status=res["status"],
                notes="AR-residual surprise proxy, not survey consensus",
            ),
            artifact=art,
        )

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps({"dataset_n": len(df), "features": feats, "results": results}, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
