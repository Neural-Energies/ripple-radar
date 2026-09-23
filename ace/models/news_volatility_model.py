"""Does news add to a volatility forecast beyond what the tape already says?

News uncertainty indices correlate ~0.29 with forward volatility, which looks
promising until you remember VIX is also a forecast of forward volatility and
that news uncertainty and implied vol both rise in the same weeks. The only
question worth asking is INCREMENTAL: given HAR components and VIX, does news
text explain anything left over?

Nested specifications, each fitted walk-forward with backward-only
coefficients, then a single read of a sealed holdout:

  HAR                     realized-vol components only
  HAR + VIX               the validated champion
  HAR + news              news instead of implied vol
  HAR + VIX + news        the question

The gate is the same as everywhere else: the block-bootstrap CI on the R2 gap
must exclude zero. A positive point estimate is not enough.
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
from ace.news.indices import news_features, news_panel
from ace.registry.registry import ModelRecord, dataframe_hash, register, utcnow
from ace.ripple.transmission import to_returns
from ace.volatility.har import EPS, forward_vol, har_features, score

MODEL_ID = "ace_news_volatility"
MODEL_VERSION = "v1"
MIN_TRAIN = 500
HOLDOUT_FRAC = 0.25


def _expanding_ols(X: np.ndarray, y: np.ndarray, start: int) -> np.ndarray:
    pred = np.full(len(y), np.nan)
    for t in range(start, len(y)):
        try:
            coef = np.linalg.lstsq(X[:t], y[:t], rcond=None)[0]
        except np.linalg.LinAlgError:
            continue
        pred[t] = float(X[t] @ coef)
    return pred


def _gap_ci(y, pa, pb, seed, n_boot=800, block=40):
    """Block-bootstrap CI for R2(a) - R2(b)."""
    rng = np.random.default_rng(seed)
    n = len(y)
    gaps = []
    for _ in range(n_boot):
        starts = rng.integers(0, max(1, n - block + 1), size=int(np.ceil(n / block)))
        idx = np.concatenate([np.arange(s, min(s + block, n)) for s in starts])[:n]
        yy = y[idx]
        sst = np.sum((yy - yy.mean()) ** 2)
        if sst <= 0:
            continue
        ra = 1 - np.sum((yy - pa[idx]) ** 2) / sst
        rb = 1 - np.sum((yy - pb[idx]) ** 2) / sst
        gaps.append(ra - rb)
    if not gaps:
        return float("nan"), float("nan")
    return float(np.quantile(gaps, 0.025)), float(np.quantile(gaps, 0.975))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="SP500")
    ap.add_argument("--horizon", type=int, default=20)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 76)
    print(f"Does news text add to a volatility forecast? ({args.channel}, {args.horizon}d)")
    print("=" * 76)

    panel = market_panel("2010-01-01")
    rets = to_returns(panel)
    r = rets[args.channel].dropna()

    har = har_features(r)
    news = news_features(news_panel("2010-01-01"), r.index)
    vix = np.log(np.maximum(panel["VIX"].reindex(r.index).ffill() / 100.0 / np.sqrt(252), EPS)).rename("log_vix")
    y = np.log(np.maximum(forward_vol(r, args.horizon), EPS)).rename("y")

    d = pd.concat([har, vix, news, y], axis=1).dropna()
    har_cols = list(har.columns)
    news_cols = [c for c in news.columns if c in d.columns]
    print(f"\ndataset {len(d)} rows  {d.index.min().date()} -> {d.index.max().date()}")
    print(f"HAR features {len(har_cols)} | news features {len(news_cols)}")

    yv = d["y"].to_numpy()
    ones = np.ones(len(d))

    def mat(cols):
        return np.column_stack([ones] + [d[c].to_numpy() for c in cols])

    specs = {
        "har": mat(har_cols),
        "har_vix": mat(har_cols + ["log_vix"]),
        "har_news": mat(har_cols + news_cols),
        "har_vix_news": mat(har_cols + ["log_vix"] + news_cols),
    }
    preds = {k: _expanding_ols(X, yv, MIN_TRAIN) for k, X in specs.items()}

    valid = np.ones(len(d), dtype=bool)
    for p in preds.values():
        valid &= np.isfinite(p)
    cut = int(len(d) * (1 - HOLDOUT_FRAC))
    hold = valid.copy(); hold[:cut] = False
    dev = valid.copy(); dev[cut:] = False
    print(f"dev {int(dev.sum())} | sealed holdout {int(hold.sum())} from {d.index[cut].date()}")

    print("\n" + "-" * 76)
    print(f"{'spec':<16}{'dev R2':>10}{'holdout R2':>13}{'QLIKE':>10}")
    reports = {}
    for k, p in preds.items():
        rd = score(k, yv[dev], p[dev])
        rh = score(k, yv[hold], p[hold])
        reports[k] = {"dev": rd.to_dict(), "holdout": rh.to_dict()}
        print(f"{k:<16}{rd.r2_log:>+10.4f}{rh.r2_log:>+13.4f}{rh.qlike:>10.4f}")

    yh = yv[hold]
    comparisons = {
        "news over har (no VIX)": ("har_news", "har"),
        "news over har+VIX": ("har_vix_news", "har_vix"),
        "VIX over har": ("har_vix", "har"),
    }
    print("\n" + "-" * 76)
    print("incremental value, block-bootstrap 95% CI on the R2 gap:")
    results = {}
    for label, (a, b) in comparisons.items():
        gap = reports[a]["holdout"]["r2_log"] - reports[b]["holdout"]["r2_log"]
        lo, hi = _gap_ci(yh, preds[a][hold], preds[b][hold], args.seed)
        sig = lo > 0
        results[label] = {"gap": round(gap, 4), "ci": [round(lo, 4), round(hi, 4)], "significant": bool(sig)}
        mark = "PASSES" if sig else "not significant"
        print(f"  {label:<26} {gap:+.4f}  CI [{lo:+.4f}, {hi:+.4f}]  {mark}")

    news_adds = results["news over har+VIX"]["significant"]
    print("\n" + "=" * 76)
    if news_adds:
        print("VERDICT: news text adds to the forecast beyond implied volatility")
    else:
        print("VERDICT: news text does NOT add beyond implied volatility")
        print("  The correlation is real, but VIX already contains it. Options markets")
        print("  price the same uncertainty the newspapers are describing.")
    print("=" * 76)

    register(
        ModelRecord(
            model_id=MODEL_ID, model_family="ols nested specifications", model_version=MODEL_VERSION,
            analysis_type="news_volatility_increment",
            target_variable=f"log realized vol of {args.channel} over {args.horizon} sessions",
            feature_schema=har_cols + ["log_vix"] + news_cols,
            training_start=str(d.index.min().date()), training_end=str(d.index[cut].date()),
            validation_periods=[{"scheme": "expanding walk-forward", "min_train": MIN_TRAIN}],
            holdout_period={"start": str(d.index[cut].date()), "n": int(hold.sum())},
            training_dataset_hash=dataframe_hash(d),
            hyperparameters={"horizon": args.horizon}, random_seed=args.seed,
            performance_metrics=reports, calibration_metrics={},
            benchmark_metrics=results, model_artifact_path="",
            creation_timestamp=utcnow(),
            production_status="CANDIDATE" if news_adds else "FAILED",
            notes="news = FRED news-text uncertainty indices (Baker/Bloom/Davis)",
        ),
        artifact={"specs": list(specs)},
    )

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_{args.channel}_scorecard.json"
    out.write_text(json.dumps({"reports": reports, "comparisons": results,
                               "news_features": news_cols, "n": len(d)}, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
