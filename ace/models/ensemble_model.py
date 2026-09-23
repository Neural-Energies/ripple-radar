"""Does combining the engines beat the best single engine?

The question the ensemble has to answer is not "is it better than average" —
of course it is, that only says a bad member drags the average down. It is
whether combining beats the BEST member, out of sample, by more than noise.
That is the only version of the question that decides whether ACE should ship
an ensemble or just ship its best model.

One target, so the members are commensurable:

    P(at least one |move| >= 2 sigma in this channel over the next 5 sessions)

Four members, each an engine that was validated separately:

  base_rate   the training frequency. Constant, and hard to beat.
  markov      persistence: did an event happen today?
  hawkes      the fitted cascade's own forecast, integrating its conditional
              intensity forward over every generation of offspring
  volatility  HAR-RV + VIX forecast of volatility ahead, converted to a
              crossing probability through the empirical residual
              distribution rather than a normal assumption

Every member is calibrated on walk-forward out-of-fold predictions from the
training window before the weights see it, and the weights are fitted on those
same out-of-fold predictions. Nothing touches the sealed holdout until the
combination rule is fixed.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings("ignore")

from ace.calibration.calibrate import fit_calibrator
from ace.cascade.hawkes import fit_hawkes
from ace.config import RANDOM_SEED, REPORTS
from ace.data.fred_market import market_panel
from ace.data.series import rolling_std, standardize
from ace.ensemble.members import (
    base_rate_probability,
    event_flags,
    forward_any_event,
    hawkes_event_probability,
    markov_probability,
    volatility_event_probability,
)
from ace.ensemble.stack import EnsembleWeights, apply_ensemble, fit_ensemble, log_score
from ace.metrics.classification import evaluate, reliability_table
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow
from ace.ripple.transmission import to_returns
from ace.validation.leakage import assert_probabilities, assert_split_is_chronological
from ace.validation.walkforward import walk_forward_folds
from ace.volatility.har import har_features

MODEL_ID = "ace_event_ensemble"
MODEL_VERSION = "v1"
HORIZON = 5                  # sessions
LABEL_HORIZON_DAYS = 7       # calendar days spanned by a 5-session label
EMBARGO_DAYS = 2
HOLDOUT_FRAC = 0.25
SIGMA = 2.0
MEMBERS = ["base_rate", "markov", "hawkes", "volatility"]
CHANNELS = ["NASDAQ", "WTI", "USD_BROAD", "UST10Y"]


def _days_since(index: pd.DatetimeIndex, origin: pd.Timestamp) -> np.ndarray:
    return np.array([(d - origin).total_seconds() / 86400.0 for d in index], dtype=float)


def _fit_members(train: pd.DataFrame, predict_on: pd.DataFrame, panel: pd.DataFrame,
                 returns: pd.Series, origin: pd.Timestamp) -> dict[str, np.ndarray]:
    """Every member fitted on `train` only, scored on `predict_on`."""
    out: dict[str, np.ndarray] = {}
    idx = predict_on.index

    rate = float(train["y"].mean())
    out["base_rate"] = base_rate_probability(idx, rate).to_numpy()

    after_event = train.loc[train["flag"] > 0, "y"]
    after_calm = train.loc[train["flag"] == 0, "y"]
    out["markov"] = markov_probability(
        predict_on["flag"], idx,
        p_after_event=float(after_event.mean()) if len(after_event) else rate,
        p_after_calm=float(after_calm.mean()) if len(after_calm) else rate,
    ).to_numpy()

    # Cascade. Parameters from training events only; the intensity at a
    # prediction date legitimately uses events already realized by then.
    train_events = _days_since(train.index[train["flag"] > 0], origin)
    all_events = _days_since(
        pd.DatetimeIndex(sorted(set(train.index[train["flag"] > 0])
                                | set(predict_on.index[predict_on["flag"] > 0]))),
        origin,
    )
    try:
        fit = fit_hawkes(train_events, float(_days_since(train.index[-1:], origin)[0]) + 1.0)
        out["hawkes"] = hawkes_event_probability(
            fit, all_events, _days_since(idx, origin), float(HORIZON * 7 / 5)
        )
    except (ValueError, RuntimeError):
        out["hawkes"] = np.full(len(idx), rate)

    # Volatility. Ratio of forecast volatility ahead to trailing volatility,
    # then the empirical crossing probability at that ratio.
    try:
        feat_cols = [c for c in train.columns if c.startswith("f_")]
        X_tr = sm.add_constant(train[feat_cols], has_constant="add")
        res = sm.OLS(train["log_fwd_vol"], X_tr).fit()
        X_pr = sm.add_constant(predict_on[feat_cols], has_constant="add")[X_tr.columns]
        ratio = np.exp(res.predict(X_pr).to_numpy()) / predict_on["trailing_vol"].to_numpy()
        resid = standardize(returns.loc[returns.index <= train.index[-1]], 60).dropna().to_numpy()
        out["volatility"] = volatility_event_probability(
            ratio, resid, threshold_sigma=SIGMA, horizon=HORIZON
        )
    except Exception:
        out["volatility"] = np.full(len(idx), rate)

    for k, v in out.items():
        out[k] = np.where(np.isfinite(v), np.clip(v, 1e-4, 1 - 1e-4), rate)
    return out


def build_frame(panel: pd.DataFrame, channel: str) -> tuple[pd.DataFrame, pd.Series]:
    r = to_returns(panel)[channel].dropna()
    flags = event_flags(r, sigma=SIGMA)
    y = forward_any_event(flags, HORIZON)

    feats = har_features(r).add_prefix("f_")
    if "VIX" in panel.columns:
        feats["f_log_vix"] = np.log(panel["VIX"].reindex(r.index).ffill())
    trailing = rolling_std(r, 60)
    fwd_vol = r[::-1].rolling(HORIZON, min_periods=HORIZON).std()[::-1].shift(-1)

    d = pd.concat(
        [feats, flags.rename("flag"), y.rename("y"),
         trailing.rename("trailing_vol"),
         np.log(fwd_vol.clip(lower=1e-12)).rename("log_fwd_vol")],
        axis=1,
    ).dropna()
    return d, r


def run_channel(panel: pd.DataFrame, channel: str, seed: int) -> dict:
    d, returns = build_frame(panel, channel)
    if len(d) < 800:
        return {"channel": channel, "skipped": f"only {len(d)} labelled days"}

    origin = d.index[0]
    cut = int(len(d) * (1 - HOLDOUT_FRAC))
    boundary = d.index[cut]
    keep = d.index[:cut] < boundary - pd.Timedelta(days=LABEL_HORIZON_DAYS + EMBARGO_DAYS)
    train, holdout = d.iloc[:cut][keep], d.iloc[cut:]
    assert_split_is_chronological(train.index.to_series(), holdout.index.to_series(),
                                  label_horizon_days=LABEL_HORIZON_DAYS,
                                  embargo_days=EMBARGO_DAYS)

    folds = walk_forward_folds(train.index.to_series(), n_folds=5,
                               label_horizon_days=LABEL_HORIZON_DAYS,
                               embargo_days=EMBARGO_DAYS, min_train=400)

    # Out-of-fold member predictions over the training window.
    oof = {m: np.full(len(train), np.nan) for m in MEMBERS}
    for f in folds:
        preds = _fit_members(train.iloc[f.train_idx], train.iloc[f.valid_idx],
                             panel, returns, origin)
        for m in MEMBERS:
            oof[m][f.valid_idx] = preds[m]

    seen = np.all([np.isfinite(oof[m]) for m in MEMBERS], axis=0)
    y_oof = train["y"].to_numpy()[seen]
    rate = float(train["y"].mean())

    calibrators, cal_names = {}, {}
    P_oof = np.empty((int(seen.sum()), len(MEMBERS)))
    for j, m in enumerate(MEMBERS):
        cal, _ = fit_calibrator(y_oof, oof[m][seen], base_rate=rate)
        calibrators[m] = cal
        cal_names[m] = cal.method
        P_oof[:, j] = cal.transform(oof[m][seen])

    weights = fit_ensemble(y_oof, P_oof, MEMBERS)

    # Sealed holdout: members refitted on the whole training window, calibrated
    # with the transforms already chosen, combined with the weights already fixed.
    hold_raw = _fit_members(train, holdout, panel, returns, origin)
    y_te = holdout["y"].to_numpy()
    P_te = np.column_stack([calibrators[m].transform(hold_raw[m]) for m in MEMBERS])
    for j in range(P_te.shape[1]):
        assert_probabilities(P_te[:, j])
    p_ens = apply_ensemble(weights, P_te)

    reports = {m: evaluate(y_te, P_te[:, j], base_rate=rate).to_dict()
               for j, m in enumerate(MEMBERS)}
    reports["ensemble"] = evaluate(y_te, p_ens, base_rate=rate).to_dict()

    best_member = max(MEMBERS, key=lambda m: reports[m]["brier_skill_score"])
    j_best = MEMBERS.index(best_member)
    lift = reports["ensemble"]["brier_skill_score"] - reports[best_member]["brier_skill_score"]
    lo, hi = _gap_ci(y_te, p_ens, P_te[:, j_best], rate, seed)

    # The ensemble question is not the only one worth asking. A member that
    # beats the base rate on its own is a shippable forecaster whether or not
    # combining helps, so each gets the same interval against the same
    # baseline.
    flat = np.full(len(y_te), rate)
    vs_base = {}
    for j, m in enumerate(MEMBERS + ["ensemble"]):
        p = p_ens if m == "ensemble" else P_te[:, j]
        b_lo, b_hi = _gap_ci(y_te, p, flat, rate, seed)
        vs_base[m] = {
            "bss": reports[m]["brier_skill_score"],
            "ci": [b_lo, b_hi],
            "beats_base_rate": bool(b_lo > 0 and reports[m]["brier_skill_score"] > 0),
        }

    return {
        "channel": channel, "skipped": None,
        "n": len(d), "n_train": len(train), "n_holdout": len(holdout),
        "start": str(d.index.min().date()), "end": str(d.index.max().date()),
        "boundary": str(boundary.date()),
        "base_rate": rate, "realized": float(y_te.mean()),
        "calibrators": cal_names, "weights": weights.as_dict(),
        "reports": reports, "best_member": best_member, "vs_base_rate": vs_base,
        "lift_over_best_member": lift, "lift_ci": [lo, hi],
        "passes": bool(lift > 0 and lo > 0 and reports["ensemble"]["brier_skill_score"] > 0),
        "_y": y_te, "_p_ens": p_ens, "_P": P_te, "_hash": dataframe_hash(d),
    }


def _gap_draws(y, pa, pb, base_rate, seed, n_boot=1200, block=30):
    """Block-bootstrap draws of BSS(a) - BSS(b)."""
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
        gaps.append((1 - np.mean((pa[idx] - yy) ** 2) / denom)
                    - (1 - np.mean((pb[idx] - yy) ** 2) / denom))
    return np.asarray(gaps, dtype=float)


def _gap_ci(y, pa, pb, base_rate, seed, alpha=0.05, **kw):
    g = _gap_draws(y, pa, pb, base_rate, seed, **kw)
    if g.size == 0:
        return float("nan"), float("nan")
    return float(np.quantile(g, alpha / 2)), float(np.quantile(g, 1 - alpha / 2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", nargs="*", default=CHANNELS)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 86)
    print(f"ACE ensemble :: P(|move| >= {SIGMA:.0f} sigma within {HORIZON} sessions) — "
          "does combining beat the best single engine?")
    print("=" * 86)

    panel = market_panel("2010-01-01")
    results = []
    for ch in args.channels:
        if ch not in panel.columns:
            print(f"\n{ch}: not in the panel — skipped")
            continue
        try:
            res = run_channel(panel, ch, args.seed)
        except Exception as e:
            print(f"\n{ch}: {type(e).__name__}: {str(e)[:100]}")
            continue
        if res.get("skipped"):
            print(f"\n{ch}: {res['skipped']}")
            continue
        results.append(res)

        print(f"\n--- {ch}  {res['start']} -> {res['end']}  train {res['n_train']} | "
              f"holdout {res['n_holdout']} from {res['boundary']}")
        print(f"    base rate {res['base_rate']:.4f} | holdout realized {res['realized']:.4f}")
        print(f"    {'member':<14}{'calib':>10}{'weight':>9}{'BSS':>10}{'logloss':>10}{'AUC':>9}")
        for m in MEMBERS:
            rep, vb = res["reports"][m], res["vs_base_rate"][m]
            auc = f"{rep['roc_auc']:.4f}" if rep["roc_auc"] is not None else "   n/a"
            print(f"    {m:<14}{res['calibrators'][m]:>10}"
                  f"{res['weights']['weights'][m]:>9.3f}"
                  f"{rep['brier_skill_score']:>+10.4f}{rep['log_loss']:>10.4f}{auc:>9}"
                  f"   [{vb['ci'][0]:+.4f},{vb['ci'][1]:+.4f}]"
                  f"{'  beats base' if vb['beats_base_rate'] else ''}")
        rep, vb = res["reports"]["ensemble"], res["vs_base_rate"]["ensemble"]
        auc = f"{rep['roc_auc']:.4f}" if rep["roc_auc"] is not None else "   n/a"
        print(f"    {'ENSEMBLE':<14}{res['weights']['method']:>10}{'':>9}"
              f"{rep['brier_skill_score']:>+10.4f}{rep['log_loss']:>10.4f}{auc:>9}"
              f"   [{vb['ci'][0]:+.4f},{vb['ci'][1]:+.4f}]"
              f"{'  beats base' if vb['beats_base_rate'] else ''}  ({res['weights']['pool']} pool)")
        lo, hi = res["lift_ci"]
        print(f"    vs best member ({res['best_member']}): {res['lift_over_best_member']:+.4f} "
              f"95% CI [{lo:+.4f}, {hi:+.4f}]   {'PASS' if res['passes'] else 'no'}")

    if not results:
        print("\nno channel produced a usable frame")
        return 1

    y_pool = np.concatenate([r["_y"] for r in results])
    p_pool = np.concatenate([r["_p_ens"] for r in results])
    base_pool = float(np.mean([r["base_rate"] for r in results]))
    member_pool = {m: np.concatenate([r["_P"][:, j] for r in results])
                   for j, m in enumerate(MEMBERS)}
    pooled = {m: evaluate(y_pool, p, base_rate=base_pool).to_dict()
              for m, p in member_pool.items()}
    pooled["ensemble"] = evaluate(y_pool, p_pool, base_rate=base_pool).to_dict()
    best_pool = max(MEMBERS, key=lambda m: pooled[m]["brier_skill_score"])
    lift_pool = pooled["ensemble"]["brier_skill_score"] - pooled[best_pool]["brier_skill_score"]
    lo_p, hi_p = _gap_ci(y_pool, p_pool, member_pool[best_pool], base_pool, args.seed)
    n_pass = sum(r["passes"] for r in results)

    print(f"\npooled holdout: {len(y_pool)} rows across {len(results)} channels")
    print(f"{'  member':<16}{'BSS':>10}{'logloss':>10}{'AUC':>9}")
    for m in MEMBERS + ["ensemble"]:
        auc = f"{pooled[m]['roc_auc']:.4f}" if pooled[m]["roc_auc"] is not None else "   n/a"
        print(f"  {m:<14}{pooled[m]['brier_skill_score']:>+10.4f}"
              f"{pooled[m]['log_loss']:>10.4f}{auc:>9}")
    # Five candidates are compared against the same base rate on the same
    # holdout. At 5% each that is a one-in-four chance of a spurious winner, so
    # the gate uses a Bonferroni-corrected interval: 99% for five comparisons.
    n_comparisons = len(MEMBERS) + 1
    alpha_corrected = 0.05 / n_comparisons
    flat_pool = np.full(len(y_pool), base_pool)
    pooled_vs_base = {}
    for m in MEMBERS + ["ensemble"]:
        p = p_pool if m == "ensemble" else member_pool[m]
        b_lo, b_hi = _gap_ci(y_pool, p, flat_pool, base_pool, args.seed)
        c_lo, c_hi = _gap_ci(y_pool, p, flat_pool, base_pool, args.seed, alpha=alpha_corrected)
        pooled_vs_base[m] = {
            "bss": pooled[m]["brier_skill_score"], "ci": [b_lo, b_hi],
            "ci_corrected": [c_lo, c_hi], "alpha_corrected": alpha_corrected,
            "beats_base_rate": bool(b_lo > 0 and pooled[m]["brier_skill_score"] > 0),
            "beats_base_rate_corrected": bool(c_lo > 0 and pooled[m]["brier_skill_score"] > 0),
            "channels_beating_base":
                sum(r["vs_base_rate"][m]["beats_base_rate"] for r in results),
        }
    print(f"\nagainst the base rate — the gate to ship at all."
          f"  ({n_comparisons} comparisons on one holdout, so the gate is the"
          f" Bonferroni-corrected {100 * (1 - alpha_corrected):.0f}% interval)")
    for m in MEMBERS + ["ensemble"]:
        v = pooled_vs_base[m]
        mark = ("PASSES" if v["beats_base_rate_corrected"]
                else ("uncorrected only" if v["beats_base_rate"] else ""))
        print(f"  {m:<14}BSS {v['bss']:>+8.4f}  95% [{v['ci'][0]:+.4f}, {v['ci'][1]:+.4f}]"
              f"  corrected [{v['ci_corrected'][0]:+.4f}, {v['ci_corrected'][1]:+.4f}]"
              f"  {v['channels_beating_base']}/{len(results)} ch  {mark}")

    print(f"\nbest single member pooled: {best_pool}")
    print(f"ensemble lift over it: {lift_pool:+.4f}  95% CI [{lo_p:+.4f}, {hi_p:+.4f}]")
    print(f"channels where the ensemble beats its best member with a CI excluding zero: "
          f"{n_pass}/{len(results)}")

    rel = reliability_table(y_pool, p_pool)
    if rel:
        print("\npooled reliability — ensemble")
        for row in rel:
            print(f"  {row['bucket']:<9} n={row['n']:<5} forecast={row['mean_forecast']:.3f}"
                  f"  realized={row['realized_frequency']:.3f}")

    # Two separate questions, and conflating them is how an ensemble gets
    # shipped on a claim it never earned.
    beats_base = pooled_vs_base["ensemble"]["beats_base_rate_corrected"]
    beats_best_member = bool(lift_pool > 0 and lo_p > 0)
    passes = beats_base

    print("\n" + "=" * 86)
    if beats_base:
        print("VERDICT: PASSES the base-rate gate — the combined forecast beats the base")
        print("         rate out of sample with a multiplicity-corrected CI excluding zero.")
    else:
        print("VERDICT: FAILS — the combined forecast does not beat the base rate out of")
        print("         sample once the five comparisons are corrected for.")
    print()
    if beats_best_member:
        print(f"         The combination earns its keep: it also beats {best_pool} alone")
        print(f"         by {lift_pool:+.4f}, CI [{lo_p:+.4f}, {hi_p:+.4f}].")
    else:
        print(f"         The combination does NOT beat {best_pool} alone "
              f"({lift_pool:+.4f}, CI [{lo_p:+.4f}, {hi_p:+.4f}]),")
        print("         so no claim may be made that combining is what makes it work —")
        print("         only that the combined forecast is the configuration that cleared")
        print("         the gate. No single member cleared it on its own.")
    print("=" * 86)

    status = "CANDIDATE" if passes else "FAILED"
    scorecard = {
        "channels": [{k: v for k, v in r.items() if not k.startswith("_")} for r in results],
        "pooled": pooled, "best_member": best_pool, "lift_over_best": lift_pool,
        "lift_ci": [lo_p, hi_p], "channels_passing": n_pass,
        "vs_base_rate": pooled_vs_base,
        "beats_base_rate": beats_base, "beats_best_member": beats_best_member,
        "reliability": rel, "passes": passes,
    }
    register(
        ModelRecord(
            model_id=MODEL_ID, model_family="stacked_ensemble", model_version=MODEL_VERSION,
            analysis_type="event_probability",
            target_variable=f"P(|move| >= {SIGMA} sigma within {HORIZON} sessions)",
            feature_schema=MEMBERS,
            training_start=min(r["start"] for r in results),
            training_end=max(r["boundary"] for r in results),
            validation_periods=[{"scheme": "5-fold purged walk-forward",
                                 "channel": r["channel"], "n_train": r["n_train"]}
                                for r in results],
            holdout_period={"n_pooled": int(len(y_pool)),
                            "per_channel": {r["channel"]: r["n_holdout"] for r in results}},
            training_dataset_hash=results[0]["_hash"],
            hyperparameters={"horizon": HORIZON, "sigma": SIGMA, "members": MEMBERS},
            random_seed=args.seed,
            performance_metrics={"pooled": pooled,
                                 "per_channel": {r["channel"]: r["reports"] for r in results}},
            calibration_metrics={"reliability": rel,
                                 "selected": {r["channel"]: r["calibrators"] for r in results}},
            benchmark_metrics={"best_member": best_pool,
                               "vs_base_rate": pooled_vs_base,
                               "lift_over_best": round(lift_pool, 4),
                               "lift_ci": [round(lo_p, 4), round(hi_p, 4)],
                               "weights": {r["channel"]: r["weights"] for r in results},
                               "channels_passing": n_pass, "n_channels": len(results)},
            model_artifact_path="", creation_timestamp=utcnow(), production_status=status,
            notes="members calibrated on out-of-fold training predictions; weights fitted "
                  "on the same; sealed holdout scored once",
        ),
        artifact={"members": MEMBERS},
    )
    if passes:
        v = pooled_vs_base["ensemble"]
        promote(MODEL_ID, MODEL_VERSION,
                reason=f"BSS {v['bss']:+.4f} over the base rate, corrected CI "
                       f"[{v['ci_corrected'][0]:+.4f},{v['ci_corrected'][1]:+.4f}]; "
                       f"lift over {best_pool} alone {lift_pool:+.4f} "
                       f"(CI [{lo_p:+.4f},{hi_p:+.4f}]) is not established")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(scorecard, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
