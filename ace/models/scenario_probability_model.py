"""Validate ACE scenario probabilities end to end.

Everything is walk-forward: the volatility coefficients, the tail parameter,
and therefore every probability. A row at t is scored with a distribution
built only from data before t.

The gate is calibration, not R2. If the forecast distribution is right then
PIT values are uniform, stated intervals cover at their nominal rate, and
every threshold probability read off that distribution is trustworthy.
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
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow
from ace.ripple.transmission import to_returns
from ace.scenarios.distribution import (
    coverage,
    fhs_coverage,
    fhs_pit,
    fhs_probabilities,
    fhs_quantiles,
    fit_tail_df,
    pit_diagnostics,
    pit_values,
    scenario_bands,
)
from ace.volatility.har import EPS, forward_vol, har_features

MODEL_ID = "ace_scenario_distribution"
MODEL_VERSION = "v1"
MIN_TRAIN = 500


def run(channel: str, horizon: int, seed: int) -> dict:
    panel = market_panel("2010-01-01")
    rets = to_returns(panel)
    r = rets[channel].dropna()

    feats = har_features(r)
    if "VIX" in panel.columns:
        vix = panel["VIX"].reindex(r.index).ffill()
        feats["log_vix"] = np.log(np.maximum(vix / 100.0 / np.sqrt(252), EPS))
    y_vol = np.log(np.maximum(forward_vol(r, horizon), EPS)).rename("log_fwd_vol")
    # realized move over the same forward window the vol refers to
    fwd_move = np.log(r.index.to_series().map(lambda _: 1.0))  # placeholder replaced below
    px_ret = r.shift(-1).rolling(horizon).sum().shift(-(horizon - 1))
    fwd_move = px_ret.rename("fwd_move")

    d = pd.concat([feats, y_vol, fwd_move], axis=1).dropna()
    cols = [c for c in feats.columns]
    X = np.column_stack([np.ones(len(d))] + [d[c].to_numpy() for c in cols])
    yv = d["log_fwd_vol"].to_numpy()
    moves = d["fwd_move"].to_numpy()
    print(f"{channel}: {len(d)} rows  {d.index.min().date()} -> {d.index.max().date()}  horizon {horizon}d")

    sigma_pred = np.full(len(d), np.nan)
    df_used = np.full(len(d), np.nan)
    # Expected move over the horizon, estimated from past returns only.
    # Centring every scenario band on zero ignores drift, which showed up as a
    # 50% interval covering ~41%: the centre was in the wrong place even though
    # the tails were right.
    drift_pred = np.full(len(d), np.nan)
    for t in range(MIN_TRAIN, len(d)):
        try:
            coef = np.linalg.lstsq(X[:t], yv[:t], rcond=None)[0]
        except np.linalg.LinAlgError:
            continue
        sigma_h = float(np.exp(X[t] @ coef) * np.sqrt(horizon))
        sigma_pred[t] = sigma_h
        drift_pred[t] = float(np.mean(r.to_numpy()[:t]) * horizon) if t > 250 else 0.0
        # tail parameter from PAST standardized moves only, refit periodically
        if t == MIN_TRAIN or (t - MIN_TRAIN) % 125 == 0:
            # Standardize by the FORECAST volatility, not the realized one.
            # Dividing a move by the volatility actually realized over its own
            # window gives a near-unit-variance series by construction, which
            # drove the fitted df straight to its ceiling and made the
            # distribution look Gaussian. What the tail parameter must describe
            # is how far moves land relative to what was FORECAST.
            hist = np.isfinite(sigma_pred[:t])
            if hist.sum() >= 150:
                z_past = (moves[:t][hist] - drift_pred[:t][hist]) / np.maximum(sigma_pred[:t][hist], 1e-12)
                df_used[t] = fit_tail_df(z_past)
            else:
                df_used[t] = 5.0
        else:
            df_used[t] = df_used[t - 1]

    ok = np.isfinite(sigma_pred) & np.isfinite(df_used) & np.isfinite(moves) & np.isfinite(drift_pred)
    sig_all, dfs_all, mv_all, dr_all = sigma_pred[ok], df_used[ok], moves[ok], drift_pred[ok]
    dates_all = d.index[ok]

    # Calibration tests assume independent observations. A 20-session forward
    # window sampled every day overlaps 19/20 with its neighbour, so KS on the
    # daily series tests a sample roughly 20x smaller than it looks and reports
    # spurious rejection. Score calibration on NON-OVERLAPPING windows.
    step = horizon
    idx_ind = np.arange(0, len(mv_all), step)
    sig, dfs, mv, dr = sig_all[idx_ind], dfs_all[idx_ind], mv_all[idx_ind], dr_all[idx_ind]
    dates = dates_all[idx_ind]
    print(f"scored {len(mv_all)} overlapping windows -> {len(mv)} non-overlapping for calibration")
    print(f"fitted df range {dfs.min():.2f}-{dfs.max():.2f}")

    # Expanding standardized-residual history: residual_sets[i] holds only
    # residuals whose own outcome was known before observation i.
    z_all = (mv_all - dr_all) / np.maximum(sig_all, 1e-12)
    residual_sets = []
    for pos in idx_ind:
        usable = max(0, pos - horizon)          # drop overlapping neighbours
        residual_sets.append(z_all[:usable])
    fhs_ok = [i for i, z in enumerate(residual_sets) if len(z) >= 50]
    if fhs_ok:
        fi = np.array(fhs_ok)
        fhs_p = fhs_pit(mv[fi], sig[fi], dr[fi], [residual_sets[i] for i in fi])
        fhs_diag = pit_diagnostics(fhs_p[np.isfinite(fhs_p)])
        fhs_cov = fhs_coverage(mv[fi], sig[fi], dr[fi], [residual_sets[i] for i in fi])
    else:
        fhs_diag, fhs_cov = {"available": False, "reason": "no residual history"}, []

    df_star = float(np.median(dfs))
    pit = pit_values(mv, sig, df_star, dr)
    diag = pit_diagnostics(pit)
    cov = coverage(mv, sig, df_star, dr)

    # Gaussian comparison: what a normal assumption would have claimed.
    pit_norm = pit_values(mv, sig, 1e6, dr)
    diag_norm = pit_diagnostics(pit_norm)
    cov_norm = coverage(mv, sig, 1e6, dr)

    print(f"\nfitted tail df (median): {df_star:.2f}   (Gaussian would be infinite)")
    print("\nPIT uniformity — is the forecast distribution correctly specified?")
    print(f"  Student-t : KS p={diag['ks_p_value']:.4f} uniform={diag['uniform_by_ks']} | chi2 p={diag['chi2_p_value']:.4f}")
    print(f"  Gaussian  : KS p={diag_norm['ks_p_value']:.4f} uniform={diag_norm['uniform_by_ks']} | chi2 p={diag_norm['chi2_p_value']:.4f}")

    print("\ninterval coverage (nominal vs realized):")
    print(f"  {'level':>7}{'t-dist':>10}{'gaussian':>11}")
    for a, b in zip(cov, cov_norm):
        print(f"  {a['nominal']:>7.0%}{a['empirical']:>10.1%}{b['empirical']:>11.1%}")

    worst = max(abs(c["miss"]) for c in cov)
    fhs_worst = max((abs(c["miss"]) for c in fhs_cov), default=1.0)

    print("\nFILTERED HISTORICAL SIMULATION (non-parametric)")
    if fhs_diag.get("available"):
        print(f"  PIT: KS p={fhs_diag['ks_p_value']:.4f} uniform={fhs_diag['uniform_by_ks']} | chi2 p={fhs_diag['chi2_p_value']:.4f}")
    print(f"  {'level':>7}{'FHS':>10}{'t-dist':>10}")
    for a, b in zip(fhs_cov, cov):
        print(f"  {a['nominal']:>7.0%}{a['empirical']:>10.1%}{b['empirical']:>10.1%}")
    print(f"  worst interval miss: FHS {fhs_worst:.1%} vs t-dist {worst:.1%}")

    use_fhs = bool(fhs_diag.get("available") and fhs_worst < worst)
    best_name = "filtered_historical_simulation" if use_fhs else "student_t"
    best_diag = fhs_diag if use_fhs else diag
    best_worst = fhs_worst if use_fhs else worst
    passes = bool(best_diag.get("available") and best_diag.get("uniform_by_ks") and best_worst <= 0.07)

    print("\n" + "=" * 74)
    if passes:
        print(f"VERDICT: PASSES — {best_name} is calibrated out of sample")
        print(f"  PIT uniform (KS p={best_diag['ks_p_value']:.3f}); worst interval miss {best_worst:.1%}")
    else:
        print(f"VERDICT: not adequately calibrated (best: {best_name})")
        print(f"  PIT uniform={best_diag.get('uniform_by_ks')}; worst interval miss {best_worst:.1%}")
    print("=" * 74)

    # A worked example on the latest state.
    bands = scenario_bands(float(sig_all[-1] / np.sqrt(horizon)), horizon_days=horizon, df=df_star, drift=float(dr_all[-1]))
    print(f"\nlive scenario read for {channel} as of {dates_all[-1].date()} ({horizon} sessions):")
    print(f"  forecast vol over horizon: {bands.forecast_vol_horizon*100:.2f}%")
    for k in ("p05", "p25", "p50", "p75", "p95"):
        print(f"    {k}: {bands.quantiles[k]*100:+.2f}%")
    for k, v in bands.probabilities.items():
        if k.startswith("P(|"):
            print(f"    {k} = {v:.1%}")

    return {
        "channel": channel, "horizon": horizon, "n_scored": int(len(mv)),
        "tail_df_median": round(df_star, 3),
        "pit_student_t": diag, "pit_gaussian": diag_norm,
        "coverage_student_t": cov, "coverage_gaussian": cov_norm,
        "worst_interval_miss": round(best_worst, 4), "passes": passes,
        "best_method": best_name, "fhs_pit": fhs_diag, "fhs_coverage": fhs_cov,
        "student_t_worst_miss": round(worst, 4),
        "example_bands": bands.to_dict(),
        "_hash_frame": d[cols],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", nargs="*", default=["SP500", "NASDAQ", "WTI", "USD_BROAD"])
    ap.add_argument("--horizon", type=int, default=20)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 74)
    print(f"ACE scenario distribution :: calibration gate ({args.horizon}d)")
    print("=" * 74)

    results = {}
    for ch in args.channels:
        print()
        try:
            results[ch] = run(ch, args.horizon, args.seed)
        except Exception as e:
            print(f"{ch}: unavailable — {e}")

    passed = [c for c, r in results.items() if r["passes"]]
    print("\n" + "=" * 74)
    print(f"CALIBRATED CHANNELS: {len(passed)}/{len(results)} -> {', '.join(passed) or 'none'}")
    print("=" * 74)

    for ch, res in results.items():
        frame = res.pop("_hash_frame")
        register(
            ModelRecord(
                model_id=f"{MODEL_ID}_{ch}", model_family="har_vol + student_t",
                model_version=MODEL_VERSION, analysis_type="scenario_probability",
                target_variable=f"distribution of {ch} move over {args.horizon} sessions",
                feature_schema=list(frame.columns),
                training_start="2010-01-01", training_end=str(res["n_scored"]),
                validation_periods=[{"scheme": "expanding walk-forward", "min_train": MIN_TRAIN}],
                holdout_period={"n_scored_oos": res["n_scored"]},
                training_dataset_hash=dataframe_hash(frame),
                hyperparameters={"horizon": args.horizon, "tail_df_median": res["tail_df_median"]},
                random_seed=args.seed,
                performance_metrics={"pit": res["pit_student_t"], "coverage": res["coverage_student_t"]},
                calibration_metrics={"ks_p": res["pit_student_t"]["ks_p_value"],
                                     "worst_interval_miss": res["worst_interval_miss"]},
                benchmark_metrics={"gaussian_pit": res["pit_gaussian"], "gaussian_coverage": res["coverage_gaussian"]},
                model_artifact_path="", creation_timestamp=utcnow(),
                production_status="CANDIDATE" if res["passes"] else "FAILED",
                notes="calibration-gated; probabilities read off a fitted conditional distribution",
            ),
            artifact={"tail_df": res["tail_df_median"], "horizon": args.horizon},
        )
        if res["passes"]:
            promote(f"{MODEL_ID}_{ch}", MODEL_VERSION,
                    reason=f"PIT uniform KS p={res['pit_student_t']['ks_p_value']}, "
                           f"worst interval miss {res['worst_interval_miss']:.1%}")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(results, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
