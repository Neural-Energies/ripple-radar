"""Train / validate / calibrate / register the shock-persistence model.

Pipeline, in the order the directive requires:
  dataset -> sealed holdout split -> purged walk-forward on development only
  -> baselines on identical folds -> out-of-fold calibration -> refit on all
  development data -> single evaluation on the sealed holdout -> registry.

The holdout is touched exactly once, at the end. Nothing is tuned after it is
read; if it disappoints, the honest move is a new forward test, not another
pass over the same rows.
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
from ace.datasets.shock_persistence import (
    HORIZON,
    LABEL_HORIZON_CALENDAR_DAYS,
    SHOCK_Z,
    build,
    feature_columns,
)
from ace.features.pit import FEATURE_PROVENANCE
from ace.metrics.bootstrap import block_bootstrap_ci
from ace.metrics.classification import ClassificationReport, evaluate, reliability_table
from ace.models.baselines import BaseRate, MomentumPersistence, logistic_baseline
from ace.registry.registry import ModelRecord, dataframe_hash, register, utcnow
from ace.validation.leakage import (
    assert_labels_follow_prediction,
    assert_no_duplicate_keys,
    assert_probabilities,
    assert_split_is_chronological,
)
from ace.validation.walkforward import sealed_split, walk_forward_folds

MODEL_ID = "ace_shock_persistence"
MODEL_VERSION = "v1"
EMBARGO_DAYS = 3


def _lightgbm(seed: int):
    import lightgbm as lgb

    # Deliberately small. 4k rows with a ~50% base rate will happily overfit a
    # deep forest; the constraint is what keeps walk-forward honest.
    return lgb.LGBMClassifier(
        objective="binary",
        n_estimators=300,
        learning_rate=0.03,
        num_leaves=7,
        max_depth=3,
        min_child_samples=60,
        subsample=0.8,
        subsample_freq=1,
        colsample_bytree=0.7,
        reg_alpha=0.5,
        reg_lambda=5.0,
        random_state=seed,
        n_jobs=2,
        verbose=-1,
    )


def _fit_predict(name: str, X_tr, y_tr, X_va, feats: list[str], seed: int) -> np.ndarray:
    if name == "base_rate":
        m = BaseRate()
    elif name == "momentum":
        m = MomentumPersistence(feats)
    elif name == "logistic":
        m = logistic_baseline(seed)
    elif name == "lightgbm":
        m = _lightgbm(seed)
    else:
        raise ValueError(name)
    m.fit(X_tr, y_tr)
    return m.predict_proba(X_va)[:, 1]


def main() -> int:
    ap = argparse.ArgumentParser(description="Train the ACE shock-persistence model")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--holdout-frac", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 78)
    print(f"ACE model training :: {MODEL_ID} {MODEL_VERSION}")
    print("=" * 78)

    df = build()
    feats = feature_columns(df)
    assert_no_duplicate_keys(df, ["date", "channel"])
    assert_labels_follow_prediction(df["date"], df["label_date"])
    print(f"\ndataset     {len(df)} shock events | {len(feats)} features")
    print(f"            {df.date.min().date()} -> {df.date.max().date()}")
    print(f"            target: |shock_z|>={SHOCK_Z}, extends over next {HORIZON} sessions")
    print(f"            base rate: {df.label.mean():.4f}")

    X_all = df[feats].to_numpy(dtype=float)
    y_all = df["label"].to_numpy(dtype=float)

    dev_idx, hold_idx, boundary = sealed_split(
        df["date"], holdout_frac=args.holdout_frac,
        label_horizon_days=LABEL_HORIZON_CALENDAR_DAYS, embargo_days=EMBARGO_DAYS,
    )
    print(f"\nsealed split: dev n={len(dev_idx)} | holdout n={len(hold_idx)} from {boundary.date()}")
    dev = df.iloc[dev_idx].reset_index(drop=True)
    X_dev, y_dev = X_all[dev_idx], y_all[dev_idx]

    folds = walk_forward_folds(
        dev["date"], n_folds=args.folds,
        label_horizon_days=LABEL_HORIZON_CALENDAR_DAYS, embargo_days=EMBARGO_DAYS, min_train=400,
    )
    names = ["base_rate", "momentum", "logistic", "lightgbm"]
    oof: dict[str, list[np.ndarray]] = {n: [] for n in names}
    oof_y: list[np.ndarray] = []
    train_rates: list[float] = []

    print(f"\nwalk-forward ({len(folds)} folds, purged, {EMBARGO_DAYS}d embargo)")
    for f in folds:
        assert_split_is_chronological(
            dev["date"].iloc[f.train_idx], dev["date"].iloc[f.valid_idx],
            label_horizon_days=LABEL_HORIZON_CALENDAR_DAYS, embargo_days=EMBARGO_DAYS,
        )
        Xtr, ytr = X_dev[f.train_idx], y_dev[f.train_idx]
        Xva, yva = X_dev[f.valid_idx], y_dev[f.valid_idx]
        train_rates.append(float(ytr.mean()))
        oof_y.append(yva)
        line = [f.describe()]
        for n in names:
            p = _fit_predict(n, Xtr, ytr, Xva, feats, args.seed)
            assert_probabilities(p)
            oof[n].append(p)
            line.append(f"{n}={evaluate(yva, p, base_rate=ytr.mean()).brier_skill_score:+.4f}")
        print("  " + line[0])
        print("     BSS " + "  ".join(line[1:]))

    y_oof = np.concatenate(oof_y)
    base_rate_dev = float(np.mean(train_rates))
    print(f"\nout-of-fold aggregate (n={len(y_oof)}, baseline rate {base_rate_dev:.4f})")
    wf: dict[str, ClassificationReport] = {}
    for n in names:
        p = np.concatenate(oof[n])
        wf[n] = evaluate(y_oof, p, base_rate=base_rate_dev)
        r = wf[n]
        auc = f"{r.roc_auc:.4f}" if r.roc_auc is not None else "  n/a "
        print(f"  {n:<10} BSS={r.brier_skill_score:+.4f}  logloss={r.log_loss:.4f}  AUC={auc}  ECE={r.ece:.4f}  acc={r.accuracy:.4f}")

    # --- pick the challenger, calibrate it on out-of-fold predictions --------
    challenger = max(
        (n for n in names if n not in ("base_rate",)),
        key=lambda n: wf[n].brier_skill_score,
    )
    p_oof_best = np.concatenate(oof[challenger])
    calibrator, cal_note = fit_calibrator(y_oof, p_oof_best, base_rate=base_rate_dev)
    print(f"\nchallenger: {challenger}")
    print(f"calibration {cal_note}")

    # --- refit on all development data, then read the holdout ONCE ----------
    final = (
        BaseRate() if challenger == "base_rate"
        else MomentumPersistence(feats) if challenger == "momentum"
        else logistic_baseline(args.seed) if challenger == "logistic"
        else _lightgbm(args.seed)
    )
    final.fit(X_dev, y_dev)
    X_hold, y_hold = X_all[hold_idx], y_all[hold_idx]
    p_hold_raw = final.predict_proba(X_hold)[:, 1]
    p_hold = calibrator.transform(p_hold_raw)
    assert_probabilities(p_hold)

    hold_rep = evaluate(y_hold, p_hold, base_rate=float(y_dev.mean()))
    hold_raw = evaluate(y_hold, p_hold_raw, base_rate=float(y_dev.mean()))
    base_hold = evaluate(y_hold, np.full(len(y_hold), float(y_dev.mean())), base_rate=float(y_dev.mean()))

    print("\n" + "=" * 78)
    print("SEALED HOLDOUT (read once)")
    print("=" * 78)
    print(f"  n={hold_rep.n}  realized base rate={y_hold.mean():.4f}  (dev rate {y_dev.mean():.4f})")
    print(f"  {'calibrated':<12} BSS={hold_rep.brier_skill_score:+.4f}  logloss={hold_rep.log_loss:.4f}  "
          f"AUC={hold_rep.roc_auc if hold_rep.roc_auc is None else round(hold_rep.roc_auc,4)}  ECE={hold_rep.ece:.4f}  acc={hold_rep.accuracy:.4f}")
    print(f"  {'raw':<12} BSS={hold_raw.brier_skill_score:+.4f}  logloss={hold_raw.log_loss:.4f}  ECE={hold_raw.ece:.4f}")
    print(f"  {'base rate':<12} BSS={base_hold.brier_skill_score:+.4f}  logloss={base_hold.log_loss:.4f}")

    auc_ci = block_bootstrap_ci(
        y_hold, p_hold,
        lambda a, b: __import__("sklearn.metrics", fromlist=["roc_auc_score"]).roc_auc_score(a, b),
        n_boot=600, block=20, seed=args.seed,
    )
    bss_ci = block_bootstrap_ci(
        y_hold, p_hold,
        lambda a, b: 1 - np.mean((b - a) ** 2) / np.mean((float(y_dev.mean()) - a) ** 2),
        n_boot=600, block=20, seed=args.seed,
    )
    print(f"  AUC 95% CI  [{auc_ci['lo']:.4f}, {auc_ci['hi']:.4f}]  (point {auc_ci['point']:.4f})")
    print(f"  BSS 95% CI  [{bss_ci['lo']:+.4f}, {bss_ci['hi']:+.4f}]  (point {bss_ci['point']:+.4f})")

    rel = reliability_table(y_hold, p_hold)
    if rel:
        print("\n  reliability (holdout)")
        for row in rel:
            print(f"    {row['bucket']:<9} n={row['n']:<5} forecast={row['mean_forecast']:.3f}  realized={row['realized_frequency']:.3f}")

    # --- verdict ------------------------------------------------------------
    passes = hold_rep.beats_baseline() and bss_ci["lo"] > 0
    verdict = "CANDIDATE" if passes else "FAILED"
    print("\n" + "=" * 78)
    if passes:
        print("VERDICT: beats the base rate out of sample, CI excludes zero -> CANDIDATE")
    else:
        print("VERDICT: NO VALIDATED PREDICTIVE EDGE FOUND (§61)")
        print("  This is a legitimate research result, not a failure to report.")
        print("  The model is registered as FAILED and must not serve forecasts.")
    print("=" * 78)

    record = ModelRecord(
        model_id=MODEL_ID,
        model_family=challenger,
        model_version=MODEL_VERSION,
        analysis_type="scenario_materialization",
        target_variable=f"P(shock extends over {HORIZON} sessions | |shock_z|>={SHOCK_Z})",
        feature_schema=feats,
        training_start=str(dev["date"].min().date()),
        training_end=str(dev["date"].max().date()),
        validation_periods=[
            {"fold": f.index, "train_end": str(f.train_end.date()),
             "valid_start": str(f.valid_start.date()), "valid_end": str(f.valid_end.date()),
             "n_purged": f.n_purged}
            for f in folds
        ],
        holdout_period={"start": str(boundary.date()), "n": int(len(hold_idx))},
        training_dataset_hash=dataframe_hash(df[feats + ["label"]]),
        hyperparameters=getattr(final, "get_params", lambda: {})(),
        random_seed=args.seed,
        performance_metrics={"walk_forward": {n: wf[n].to_dict() for n in names},
                             "holdout": hold_rep.to_dict(), "holdout_raw": hold_raw.to_dict()},
        calibration_metrics={"method": calibrator.method, "note": cal_note,
                             "reliability_holdout": rel, "ece_holdout": hold_rep.ece},
        benchmark_metrics={"holdout_base_rate": base_hold.to_dict(),
                           "auc_ci": auc_ci, "bss_ci": bss_ci},
        model_artifact_path="",
        creation_timestamp=utcnow(),
        production_status=verdict,
        notes=f"features: {len(feats)}; horizon {HORIZON} sessions; embargo {EMBARGO_DAYS}d",
    )
    register(record, artifact={"model": final, "calibrator": calibrator, "features": feats})

    report = {
        "model_id": MODEL_ID, "version": MODEL_VERSION, "status": verdict,
        "dataset": {"n": len(df), "span": [str(df.date.min().date()), str(df.date.max().date())],
                    "base_rate": round(float(df.label.mean()), 4), "features": feats},
        "feature_provenance": {f: FEATURE_PROVENANCE.get(f, "cross-asset context at t") for f in feats},
        "walk_forward": {n: wf[n].to_dict() for n in names},
        "holdout": hold_rep.to_dict(), "reliability": rel,
        "confidence_intervals": {"auc": auc_ci, "bss": bss_ci},
        "calibration": {"method": calibrator.method, "note": cal_note},
    }
    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(report, indent=2, default=str))
    print(f"\nscorecard  {out}")
    print(f"registry   status={verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
