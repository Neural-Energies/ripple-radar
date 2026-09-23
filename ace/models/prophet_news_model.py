"""Evaluate Prophet on the news-attention time series.

Prophet is a trend + seasonality decomposer built for business series with
strong calendar structure. Applying it to financial RETURNS would be
misapplication — returns have no trend or weekly cycle to decompose. The news
attention series is a fairer test: newspaper article counts genuinely do have
day-of-week structure and slow-moving trend, which is Prophet's home ground.

So the question is narrow and answerable: can Prophet forecast the level of
news-based uncertainty better than the naive alternatives? If it can, ACE gains
a forward view of attention; if it cannot, that is recorded and Prophet is not
used.

Baselines: random walk (last value), seasonal naive (same weekday last week),
and a trailing mean.
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
import logging

logging.getLogger("prophet").setLevel(logging.ERROR)
logging.getLogger("cmdstanpy").setLevel(logging.ERROR)

from ace.config import REPORTS
from ace.news.indices import news_panel
from ace.registry.registry import ModelRecord, dataframe_hash, register, utcnow

HORIZON = 5
N_ORIGINS = 24
STEP = 30


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--series", default="equity_uncertainty")
    ap.add_argument("--horizon", type=int, default=HORIZON)
    args = ap.parse_args()

    from prophet import Prophet

    print("=" * 74)
    print(f"Prophet vs naive baselines on news attention :: {args.series}")
    print("=" * 74)

    panel = news_panel("2012-01-01", include_monthly=False)
    s = panel[args.series].dropna()
    s = np.log(np.maximum(s, 1e-9))
    print(f"series: {len(s)} daily observations {s.index.min().date()} -> {s.index.max().date()}")
    print(f"target: log level, {args.horizon} days ahead\n")

    rows = []
    origins = list(range(len(s) - STEP * N_ORIGINS, len(s) - args.horizon, STEP))
    origins = [o for o in origins if o > 800]
    print(f"rolling-origin evaluation: {len(origins)} origins, refit at each")

    for oi, cut in enumerate(origins):
        train = s.iloc[:cut]
        actual = float(s.iloc[cut + args.horizon - 1])

        df = pd.DataFrame({"ds": train.index.tz_localize(None), "y": train.to_numpy()})
        try:
            m = Prophet(daily_seasonality=False, weekly_seasonality=True,
                        yearly_seasonality=True, changepoint_prior_scale=0.05)
            m.fit(df)
            fut = m.make_future_dataframe(periods=args.horizon, freq="D")
            fc = float(m.predict(fut)["yhat"].iloc[-1])
        except Exception:
            continue

        rw = float(train.iloc[-1])
        seasonal = float(train.iloc[-7]) if len(train) > 7 else rw
        trailing = float(train.iloc[-20:].mean())
        rows.append({"origin": str(train.index[-1].date()), "actual": actual,
                     "prophet": fc, "random_walk": rw, "seasonal_naive": seasonal,
                     "trailing_mean": trailing})
        if (oi + 1) % 8 == 0:
            print(f"  ...{oi+1}/{len(origins)} origins")

    d = pd.DataFrame(rows)
    if len(d) < 10:
        print("insufficient successful fits")
        return 1

    y = d["actual"].to_numpy()
    print(f"\nevaluated on {len(d)} out-of-sample forecasts\n")
    print(f"{'model':<18}{'MAE':>10}{'RMSE':>10}{'R2':>10}")
    metrics = {}
    for name in ("prophet", "random_walk", "seasonal_naive", "trailing_mean"):
        p = d[name].to_numpy()
        mae = float(np.mean(np.abs(y - p)))
        rmse = float(np.sqrt(np.mean((y - p) ** 2)))
        sst = float(np.sum((y - y.mean()) ** 2))
        r2 = 1 - float(np.sum((y - p) ** 2)) / sst if sst > 0 else float("nan")
        metrics[name] = {"mae": round(mae, 5), "rmse": round(rmse, 5), "r2": round(r2, 4), "n": len(d)}
        print(f"{name:<18}{mae:>10.4f}{rmse:>10.4f}{r2:>+10.4f}")

    best_naive = min(("random_walk", "seasonal_naive", "trailing_mean"), key=lambda k: metrics[k]["mae"])
    beats = metrics["prophet"]["mae"] < metrics[best_naive]["mae"]

    # Paired bootstrap on the MAE difference: is the gap real at this n?
    rng = np.random.default_rng(17)
    diffs = np.abs(y - d["prophet"].to_numpy()) - np.abs(y - d[best_naive].to_numpy())
    boot = [float(np.mean(rng.choice(diffs, size=len(diffs), replace=True))) for _ in range(2000)]
    lo, hi = float(np.quantile(boot, 0.025)), float(np.quantile(boot, 0.975))
    print(f"\nbest naive: {best_naive}")
    print(f"MAE difference (prophet - naive): {float(np.mean(diffs)):+.4f}  95% CI [{lo:+.4f}, {hi:+.4f}]")

    passes = bool(beats and hi < 0)
    print("\n" + "=" * 74)
    if passes:
        print("VERDICT: Prophet beats the naive baselines on news attention")
    else:
        print("VERDICT: Prophet does NOT beat naive forecasting of news attention")
        print("  Recorded and not used. Weekly/yearly structure exists in the series,")
        print("  but not enough of it to outperform simply carrying the last value.")
    print("=" * 74)

    register(
        ModelRecord(
            model_id=f"ace_prophet_news_{args.series}", model_family="prophet",
            model_version="v1", analysis_type="news_attention_forecast",
            target_variable=f"log {args.series}, {args.horizon}d ahead",
            feature_schema=["ds", "y"], training_start=str(s.index.min().date()),
            training_end=str(s.index.max().date()),
            validation_periods=[{"scheme": "rolling origin", "n_origins": len(d), "step": STEP}],
            holdout_period={"n": len(d)}, training_dataset_hash=dataframe_hash(d),
            hyperparameters={"changepoint_prior_scale": 0.05, "weekly": True, "yearly": True},
            random_seed=17, performance_metrics=metrics,
            calibration_metrics={}, benchmark_metrics={"best_naive": best_naive,
                                                       "mae_diff_ci": [round(lo, 5), round(hi, 5)]},
            model_artifact_path="", creation_timestamp=utcnow(),
            production_status="CANDIDATE" if passes else "FAILED",
            notes="Prophet evaluated on its home ground (calendar-structured series), not on returns",
        ),
        artifact={"series": args.series},
    )
    out = REPORTS / f"prophet_news_{args.series}_scorecard.json"
    out.write_text(json.dumps({"metrics": metrics, "n": len(d), "best_naive": best_naive,
                               "mae_diff_ci": [lo, hi], "passes": passes}, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
