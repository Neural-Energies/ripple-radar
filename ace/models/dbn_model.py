"""Does the Dynamic Bayesian Network earn its structure?

The DBN's claim is that tomorrow's probability of a material event depends on
today's state ACROSS variables — volatility, implied vol, news attention, the
curve — not only on whether an event happened today. So the baseline it must
beat is a first-order Markov chain on the target alone. Beating the base rate
would prove nothing, since persistence alone does that.

Nested comparison, every table fitted on the training window only:

  base_rate   marginal P(stress)
  markov      P(stress_t1 | stress_t0)                    <- the real baseline
  dbn_core    P(stress_t1 | stress_t0, vol, implied)
  dbn_full    P(stress_t1 | stress_t0, vol, implied, news, curve)

Two things this run does that a naive comparison would not.

CALIBRATION, applied to every arm including the baseline. A first pass scored
raw CPT output and found dbn_core carrying real rank signal (AUC 0.586) while
losing on Brier — the signature of a model that orders days correctly and
states the wrong number. Refusing it on that basis alone would have been a
verdict about the output scale, not about the structure. So each arm gets a
calibrator fitted on walk-forward out-of-fold predictions from the training
window and applied to the sealed holdout. The baseline gets the same
treatment; handing the transform only to the challenger would rig the test.

SIX CHANNELS, not one. A structure that helps on a single index is a fluke.
The gate is the pooled holdout across channels, with the per-channel count
reported beside it so a result driven by one outlier is visible.
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

from ace.bayesnet.dbn import DBNSpec, fit_dbn, flatten, predict_proba
from ace.bayesnet.states import build_state_frame, to_two_slice
from ace.calibration.calibrate import fit_calibrator
from ace.config import RANDOM_SEED, REPORTS
from ace.data.fred_market import market_panel
from ace.metrics.classification import evaluate, reliability_table
from ace.news.indices import news_features, news_panel
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow
from ace.ripple.transmission import to_returns
from ace.validation.leakage import assert_probabilities, assert_split_is_chronological
from ace.validation.walkforward import walk_forward_folds

MODEL_ID = "ace_dbn_event"
MODEL_VERSION = "v1"
HOLDOUT_FRAC = 0.25
LABEL_HORIZON_DAYS = 1   # the label is tomorrow's state
EMBARGO_DAYS = 2
CHANNELS = ["SP500", "NASDAQ", "DJIA", "WTI", "UST10Y", "USD_BROAD"]

SPECS: dict[str, list[str]] = {
    "base_rate": [],
    "markov": ["stress"],
    "dbn_core": ["stress", "vol", "implied"],
    "dbn_full": ["stress", "vol", "implied", "news", "curve"],
}
STRUCTURED = ("dbn_core", "dbn_full")
# A ~5% base rate never lands in the default 50%+ buckets, so the whole holdout
# collapses into one row that says nothing. These edges straddle the base rate.
RARE_EVENT_EDGES = [0.0, 0.02, 0.04, 0.06, 0.08, 0.12, 0.20, 1.0]


def _gap_ci(y, pa, pb, base_rate, seed, n_boot=800, block=30):
    """Block-bootstrap CI for BSS(a) - BSS(b).

    Blocks rather than rows: stress days cluster, and resampling rows
    independently would treat a volatility cluster as 30 independent
    confirmations and shrink the interval to nothing.
    """
    rng = np.random.default_rng(seed)
    n = len(y)
    gaps = []
    for _ in range(n_boot):
        starts = rng.integers(0, max(1, n - block + 1), size=int(np.ceil(n / block)))
        idx = np.concatenate([np.arange(s, min(s + block, n)) for s in starts])[:n]
        yy = y[idx]
        denom = np.mean((base_rate - yy) ** 2)
        if denom <= 0:
            continue
        bss_a = 1 - np.mean((pa[idx] - yy) ** 2) / denom
        bss_b = 1 - np.mean((pb[idx] - yy) ** 2) / denom
        gaps.append(bss_a - bss_b)
    if not gaps:
        return float("nan"), float("nan")
    return float(np.quantile(gaps, 0.025)), float(np.quantile(gaps, 0.975))


def _oof(tr_two: pd.DataFrame, tr_flat: pd.DataFrame, parents: list[str], folds) -> np.ndarray:
    """Out-of-fold P(stress tomorrow) over the training window.

    Every prediction comes from tables fitted without that row, which is what
    makes the calibrator that consumes these honest.
    """
    oof = np.full(len(tr_flat), np.nan)
    for f in folds:
        cpts = fit_dbn(tr_two.iloc[f.train_idx], DBNSpec({"stress": parents}))
        oof[f.valid_idx] = predict_proba(cpts["stress"], tr_flat.iloc[f.valid_idx], "yes")
    return oof


def run_channel(panel: pd.DataFrame, channel: str, seed: int) -> dict:
    """Fit, calibrate and score every arm on one channel."""
    rets = to_returns(panel)
    r = rets[channel].dropna()
    nf = news_features(news_panel("2010-01-01", include_monthly=False), r.index)

    state = build_state_frame(
        r, vix=panel["VIX"], news_z=nf["news_equity_uncertainty_z"], curve=panel["CURVE_10_2"]
    )
    variables = ["vol", "implied", "news", "curve", "stress"]
    two = to_two_slice(state, variables)
    flat = flatten(two)

    cut = int(len(flat) * (1 - HOLDOUT_FRAC))
    boundary = flat.index[cut]
    # Purge the boundary. The last training row's label resolves the next day,
    # so a contiguous split would let the training window see a day the holdout
    # is about to be scored on.
    keep = flat.index[:cut] < boundary - pd.Timedelta(days=LABEL_HORIZON_DAYS + EMBARGO_DAYS)
    tr_two, tr_flat = two.iloc[:cut][keep], flat.iloc[:cut][keep]
    te_flat = flat.iloc[cut:]
    assert_split_is_chronological(
        tr_flat.index.to_series(), te_flat.index.to_series(),
        label_horizon_days=LABEL_HORIZON_DAYS, embargo_days=EMBARGO_DAYS,
    )

    y_tr = (tr_flat["stress_t1"] == "yes").to_numpy(dtype=float)
    y_te = (te_flat["stress_t1"] == "yes").to_numpy(dtype=float)
    base_rate = float(y_tr.mean())

    folds = walk_forward_folds(
        tr_flat.index.to_series(), n_folds=5,
        label_horizon_days=LABEL_HORIZON_DAYS, embargo_days=EMBARGO_DAYS, min_train=500
    )

    preds, reports, tables, methods = {}, {}, {}, {}
    for name, parents in SPECS.items():
        oof = _oof(tr_two, tr_flat, parents, folds)
        seen = np.isfinite(oof)
        cal, note = fit_calibrator(y_tr[seen], oof[seen], base_rate=base_rate)
        cpt = fit_dbn(tr_two, DBNSpec({"stress": parents}))["stress"]
        p = cal.transform(predict_proba(cpt, te_flat, "yes"))
        assert_probabilities(p)
        preds[name] = p
        reports[name] = evaluate(y_te, p, base_rate=base_rate).to_dict()
        tables[name] = cpt.summary()
        methods[name] = {"calibrator": cal.method, "note": note, "n_oof": int(seen.sum())}

    best = max(STRUCTURED, key=lambda n: reports[n]["brier_skill_score"])
    lift = reports[best]["brier_skill_score"] - reports["markov"]["brier_skill_score"]
    lo, hi = _gap_ci(y_te, preds[best], preds["markov"], base_rate, seed)

    return {
        "channel": channel, "n_labelled": len(flat), "n_train": len(tr_flat), "n_holdout": len(te_flat),
        "start": str(flat.index.min().date()), "end": str(flat.index.max().date()),
        "boundary": str(boundary.date()), "base_rate": base_rate, "realized": float(y_te.mean()),
        "reports": reports, "tables": tables, "calibration": methods,
        "best": best, "lift_over_markov": lift, "lift_ci": [lo, hi],
        "passes": bool(lift > 0 and lo > 0 and reports[best]["brier_skill_score"] > 0),
        "variables": variables,
        "_y": y_te, "_preds": preds, "_index": flat.index, "_hash": dataframe_hash(flat),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", nargs="*", default=CHANNELS)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 84)
    print("ACE Dynamic Bayesian Network :: P(material event tomorrow | world state today)")
    print("=" * 84)

    panel = market_panel("2010-01-01")
    results = []
    for channel in args.channels:
        if channel not in panel.columns:
            print(f"\n{channel}: not in the panel — skipped")
            continue
        try:
            results.append(run_channel(panel, channel, args.seed))
        except Exception as e:  # a channel too short to label is a fact, not a crash
            print(f"\n{channel}: {type(e).__name__}: {str(e)[:90]}")
    if not results:
        print("no channel produced a labelled state frame")
        return 1

    first = results[0]
    # FRED licenses the index series for a rolling 10 years, so each channel
    # has its own usable window; a single header line would misreport five of
    # the six.
    print(f"\n{'channel':<12}{'labelled':>9}{'train':>7}{'holdout':>9}   window")
    for res in results:
        print(f"{res['channel']:<12}{res['n_labelled']:>9}{res['n_train']:>7}{res['n_holdout']:>9}"
              f"   {res['start']} -> {res['end']}  (sealed from {res['boundary']})")
    print("\nevery arm calibrated on walk-forward out-of-fold predictions from the training window\n")

    for res in results:
        print(f"--- {res['channel']}  base rate {res['base_rate']:.4f}  "
              f"holdout realized {res['realized']:.4f}")
        print(f"{'  model':<14}{'parents':>8}{'configs':>9}{'unseen':>8}{'calib':>10}"
              f"{'BSS':>10}{'logloss':>10}{'AUC':>9}")
        for name in SPECS:
            rep, t = res["reports"][name], res["tables"][name]
            auc = f"{rep['roc_auc']:.4f}" if rep["roc_auc"] is not None else "   n/a"
            print(f"  {name:<12}{len(SPECS[name]):>8}{t['n_configurations']:>9}{t['n_unseen']:>8}"
                  f"{res['calibration'][name]['calibrator']:>10}"
                  f"{rep['brier_skill_score']:>+10.4f}{rep['log_loss']:>10.4f}{auc:>9}")
        lo, hi = res["lift_ci"]
        print(f"  best {res['best']} — BSS lift over Markov {res['lift_over_markov']:+.4f} "
              f"95% CI [{lo:+.4f}, {hi:+.4f}]   {'PASS' if res['passes'] else 'no'}\n")

    # Pooled holdout: one structure judged on every channel's rows at once.
    y_pool = np.concatenate([r["_y"] for r in results])
    base_pool = float(np.mean([r["base_rate"] for r in results]))
    pooled = {}
    for name in SPECS:
        p = np.concatenate([r["_preds"][name] for r in results])
        pooled[name] = evaluate(y_pool, p, base_rate=base_pool).to_dict()
    best_pool = max(STRUCTURED, key=lambda n: pooled[n]["brier_skill_score"])
    pa = np.concatenate([r["_preds"][best_pool] for r in results])
    pb = np.concatenate([r["_preds"]["markov"] for r in results])
    lift_pool = pooled[best_pool]["brier_skill_score"] - pooled["markov"]["brier_skill_score"]
    lo_p, hi_p = _gap_ci(y_pool, pa, pb, base_pool, args.seed)

    n_pass = sum(r["passes"] for r in results)
    print(f"pooled holdout: {len(y_pool)} rows across {len(results)} channels")
    print(f"{'  model':<14}{'BSS':>10}{'logloss':>10}{'AUC':>9}")
    for name in SPECS:
        auc = f"{pooled[name]['roc_auc']:.4f}" if pooled[name]["roc_auc"] is not None else "   n/a"
        print(f"  {name:<12}{pooled[name]['brier_skill_score']:>+10.4f}"
              f"{pooled[name]['log_loss']:>10.4f}{auc:>9}")
    print(f"\nbest structured model: {best_pool}")
    print(f"pooled BSS lift over Markov: {lift_pool:+.4f}  95% CI [{lo_p:+.4f}, {hi_p:+.4f}]")
    print(f"channels where the DBN beats Markov with a CI excluding zero: {n_pass}/{len(results)}")
    print(f"(Markov itself beats the base rate: {pooled['markov']['brier_skill_score'] > 0} — "
          f"BSS {pooled['markov']['brier_skill_score']:+.4f})")

    rel = reliability_table(y_pool, pa, RARE_EVENT_EDGES)
    if rel:
        print(f"\npooled reliability — {best_pool}")
        for row in rel:
            print(f"  {row['bucket']:<9} n={row['n']:<5} forecast={row['mean_forecast']:.3f}"
                  f"  realized={row['realized_frequency']:.3f}")

    passes = bool(
        lift_pool > 0 and lo_p > 0
        and pooled[best_pool]["brier_skill_score"] > 0
        and n_pass * 2 >= len(results)
    )
    print("\n" + "=" * 84)
    if passes:
        print("VERDICT: PASSES — cross-variable state improves on a Markov chain of the")
        print("         target alone, pooled CI excluding zero, on a majority of channels")
    else:
        print("VERDICT: FAILS — the DBN structure does not beat a first-order Markov chain")
        print("         on the target alone. Calibrated, on six channels, pooled.")
    print("=" * 84)

    status = "CANDIDATE" if passes else "FAILED"
    scorecard = {
        "channels": [{k: v for k, v in r.items() if not k.startswith("_")} for r in results],
        "pooled": pooled, "best": best_pool, "lift_over_markov": lift_pool,
        "lift_ci": [lo_p, hi_p], "channels_passing": n_pass, "reliability": rel, "passes": passes,
    }
    register(
        ModelRecord(
            model_id=MODEL_ID, model_family="two_slice_dbn", model_version=MODEL_VERSION,
            analysis_type="event_probability",
            target_variable="P(|return| >= 2 sigma tomorrow) per channel",
            feature_schema=first["variables"],
            training_start=min(r["start"] for r in results),
            training_end=max(r["boundary"] for r in results),
            validation_periods=[{"scheme": "5-fold purged walk-forward on the training window",
                                 "channel": r["channel"], "n_train": r["n_train"],
                                 "window": f"{r['start']}..{r['boundary']}"} for r in results],
            holdout_period={"n_pooled": int(len(y_pool)),
                            "per_channel": {r["channel"]: {"start": r["boundary"],
                                                           "n": r["n_holdout"]} for r in results}},
            training_dataset_hash=first["_hash"],
            hyperparameters={"prior_strength": 4.0, "structures": SPECS,
                             "holdout_frac": HOLDOUT_FRAC},
            random_seed=args.seed,
            performance_metrics={"pooled": pooled,
                                 "per_channel": {r["channel"]: r["reports"] for r in results}},
            calibration_metrics={"reliability": rel,
                                 "selected": {r["channel"]: r["calibration"] for r in results}},
            benchmark_metrics={"best": best_pool, "bss_lift_over_markov": round(lift_pool, 4),
                               "lift_ci": [round(lo_p, 4), round(hi_p, 4)],
                               "channels_passing": n_pass, "n_channels": len(results)},
            model_artifact_path="", creation_timestamp=utcnow(), production_status=status,
            notes="Dirichlet-smoothed CPTs; expanding-window state thresholds; "
                  "every arm calibrated on out-of-fold training predictions",
        ),
        artifact={"structures": SPECS},
    )
    if passes:
        promote(MODEL_ID, MODEL_VERSION,
                reason=f"pooled BSS lift {lift_pool:+.4f} over Markov, CI [{lo_p:+.4f},{hi_p:+.4f}]")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(scorecard, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
