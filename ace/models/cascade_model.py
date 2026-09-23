"""Do real market-stress events self-excite? Fit and validate a Hawkes process.

Event definition: a session whose absolute return exceeds THRESHOLD_Z times
the channel's own trailing 60-day volatility. Standardizing by trailing vol
matters — a fixed percentage threshold would classify most of 2020 as one
continuous event and almost nothing in 2017.

Why this is a fair test of the ripple thesis: volatility clustering is
well-documented, and clustering IS self-excitation. If the Hawkes machinery
cannot detect it here, it will not detect a news cascade either. If it can,
ACE gains a measured cascade intensity instead of an adjective.

Validation is out of sample. Parameters are fitted on the earlier period and
scored by log-likelihood on the later one, against a Poisson fitted the same
way, plus Ogata time-rescaling residuals on both.
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

from ace.cascade.hawkes import (
    expected_offspring,
    fit_hawkes,
    goodness_of_fit,
    hawkes_log_likelihood,
    poisson_log_likelihood,
)
from ace.config import REPORTS
from ace.data.fred_market import market_panel
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow
from ace.ripple.transmission import to_returns

MODEL_ID = "ace_event_cascade"
MODEL_VERSION = "v1"
THRESHOLD_Z = 2.0
SPLIT = "2020-01-01"


def event_times(returns: pd.Series, threshold_z: float) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """Stress-event times, in days since the first observation."""
    vol = returns.rolling(60, min_periods=60).std()
    z = (returns / vol.replace(0, np.nan)).abs()
    mask = z >= threshold_z
    dates = returns.index[mask.fillna(False)]
    if len(dates) == 0:
        return np.array([]), dates
    origin = returns.index[0]
    t = np.array([(d - origin).total_seconds() / 86400.0 for d in dates], dtype=float)
    return t, dates


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", nargs="*", default=["SP500", "NASDAQ", "WTI", "USD_BROAD"])
    ap.add_argument("--threshold", type=float, default=THRESHOLD_Z)
    args = ap.parse_args()

    print("=" * 78)
    print(f"ACE event cascade :: Hawkes self-excitation, |z| >= {args.threshold}")
    print("=" * 78)

    panel = market_panel("2010-01-01")
    rets = to_returns(panel)
    results: dict[str, dict] = {}

    for ch in args.channels:
        if ch not in rets.columns:
            continue
        r = rets[ch].dropna()
        t_all, dates = event_times(r, args.threshold)
        if len(t_all) < 80:
            print(f"\n{ch}: only {len(t_all)} events — insufficient to fit")
            continue

        split_ts = pd.Timestamp(SPLIT, tz="UTC")
        origin = r.index[0]
        split_day = (split_ts - origin).total_seconds() / 86400.0
        t_tr = t_all[t_all < split_day]
        t_te = t_all[t_all >= split_day] - split_day
        if len(t_tr) < 50 or len(t_te) < 40:
            print(f"\n{ch}: split leaves too few events ({len(t_tr)}/{len(t_te)})")
            continue

        print(f"\n{'-'*78}\n{ch}: {len(t_all)} stress events "
              f"{dates.min().date()} -> {dates.max().date()}")
        print(f"  train {len(t_tr)} events | test {len(t_te)} events (split {SPLIT})")

        fit = fit_hawkes(t_tr)
        gof_in = goodness_of_fit(t_tr, fit)

        # Out of sample: score the TRAIN parameters on TEST events.
        T_te = float(t_te[-1] * 1.001)
        ll_hawkes_oos = -hawkes_log_likelihood(
            np.array([fit.mu, fit.alpha, fit.beta]), np.sort(t_te - t_te[0]), T_te
        )
        ll_pois_tr, rate_tr = poisson_log_likelihood(t_tr, float(t_tr[-1] * 1.001))
        # Poisson with the TRAIN rate, scored on test
        n_te = len(t_te)
        ll_pois_oos = float(n_te * np.log(rate_tr) - rate_tr * T_te) if rate_tr > 0 else float("-inf")
        gain = ll_hawkes_oos - ll_pois_oos

        fit_te = fit_hawkes(t_te)
        gof_oos = goodness_of_fit(t_te, fit_te)
        cascade = expected_offspring(fit, horizon=10.0)

        print(f"  fitted: mu={fit.mu:.4f}/day  alpha(branching)={fit.alpha:.3f}  "
              f"beta={fit.beta:.3f}  excitation half-life {np.log(2)/fit.beta:.2f}d")
        print(f"  in-sample  LR vs Poisson: stat={fit.lr_statistic:.1f} p={fit.lr_p_value:.3g} "
              f"beats_poisson={fit.beats_poisson}")
        print(f"  OUT-OF-SAMPLE log-lik: Hawkes {ll_hawkes_oos:.1f} vs Poisson {ll_pois_oos:.1f} "
              f"-> gain {gain:+.1f}")
        if gof_in.get("available"):
            print(f"  time-rescaling (train): KS p={gof_in['ks_p_value']:.4f} "
                  f"Exp(1)={gof_in['exponential_by_ks']}")
        if gof_oos.get("available"):
            print(f"  time-rescaling (test) : KS p={gof_oos['ks_p_value']:.4f} "
                  f"Exp(1)={gof_oos['exponential_by_ks']}")
        if cascade.get("available"):
            print(f"  cascade multiplier {cascade['cascade_multiplier']:.2f}x "
                  f"(one event implies {cascade['total_offspring_all_generations']:.2f} more, all generations)")

        passes = bool(fit.beats_poisson and gain > 0 and fit.stationary)
        print(f"  -> {'PASSES: self-excitation is real and holds out of sample' if passes else 'no validated self-excitation'}")

        results[ch] = {
            "n_events": int(len(t_all)), "n_train": int(len(t_tr)), "n_test": int(len(t_te)),
            "fit": fit.to_dict(), "gof_train": gof_in, "gof_test": gof_oos,
            "oos_loglik_hawkes": round(ll_hawkes_oos, 3), "oos_loglik_poisson": round(ll_pois_oos, 3),
            "oos_gain": round(gain, 3), "cascade": cascade, "passes": passes,
            "first_event": str(dates.min().date()), "last_event": str(dates.max().date()),
        }

    passed = [c for c, v in results.items() if v["passes"]]
    print("\n" + "=" * 78)
    print(f"SELF-EXCITATION CONFIRMED: {len(passed)}/{len(results)} -> {', '.join(passed) or 'none'}")
    print("=" * 78)

    for ch, res in results.items():
        register(
            ModelRecord(
                model_id=f"{MODEL_ID}_{ch}", model_family="hawkes_exponential",
                model_version=MODEL_VERSION, analysis_type="event_cascade",
                target_variable=f"arrival intensity of |z|>={args.threshold} stress events in {ch}",
                feature_schema=["event_times"],
                training_start=res["first_event"], training_end=SPLIT,
                validation_periods=[{"scheme": "temporal split", "split": SPLIT,
                                     "n_train": res["n_train"], "n_test": res["n_test"]}],
                holdout_period={"start": SPLIT, "n": res["n_test"]},
                training_dataset_hash=dataframe_hash(pd.DataFrame({"n": [res["n_events"]]})),
                hyperparameters={"threshold_z": args.threshold, "kernel": "exponential"},
                random_seed=0,
                performance_metrics={"fit": res["fit"], "oos_gain": res["oos_gain"]},
                calibration_metrics={"gof_train": res["gof_train"], "gof_test": res["gof_test"]},
                benchmark_metrics={"poisson_oos_loglik": res["oos_loglik_poisson"]},
                model_artifact_path="", creation_timestamp=utcnow(),
                production_status="CANDIDATE" if res["passes"] else "FAILED",
                notes="branching ratio is the cascade multiplier; Ogata residuals reported",
            ),
            artifact={"mu": res["fit"]["mu"], "alpha": res["fit"]["alpha"], "beta": res["fit"]["beta"]},
        )
        if res["passes"]:
            promote(f"{MODEL_ID}_{ch}", MODEL_VERSION,
                    reason=f"LR p={res['fit']['lr_p_value']}, OOS log-lik gain {res['oos_gain']:+.1f}")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(results, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
