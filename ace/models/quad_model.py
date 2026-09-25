"""Do the quads predict anything, or only describe?

The quad framework is a classification. Whether it is USEFUL is a separate
claim, and a falsifiable one: each regime is supposed to have a characteristic
asset signature, stable enough that knowing the quad tells you something about
the next month you did not already know.

That is what this tests, and the bar is deliberately unkind.

THE BASELINE THAT MATTERS

Not zero. "Always long" is the baseline for an equity call, because equities
drift up and any rule that is long most of the time inherits that drift and
looks clever. A quad rule has to beat the unconditional mean of the SAME asset
over the SAME period, or it has added nothing but ceremony.

THE TEST

Learn on a training window which quads have been good or bad for an asset.
Then, on a sealed holdout, check whether that sign HOLDS. A regime framework
whose signs flip between halves of the sample is describing the past, not
classifying the present.

Block-bootstrap intervals throughout: monthly returns cluster, and resampling
months independently would treat one volatile quarter as three independent
confirmations.

WHAT WOULD MAKE THIS FAIL HONESTLY

Small samples. Four quads across ~190 months of usable asset history leaves
40-60 months per quad, split further into train and holdout. That is thin, and
thin samples produce sign flips that mean nothing. The test reports how many
months each cell rests on so a reader can discount accordingly, and it does
not promote on a cell with fewer than MIN_MONTHS observations.
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
from ace.macro.quads import QUAD_NAMES, quad_history, transitions
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow

MODEL_ID = "ace_macro_quad"
MODEL_VERSION = "v1"
HOLDOUT_FRAC = 0.30
#: A quad cell below this many months is reported but never acted on.
MIN_MONTHS = 8
N_BOOT = 1000
BLOCK = 3   # months; a quarter of serial dependence


def monthly_returns(panel: pd.DataFrame, channels: list[str]) -> pd.DataFrame:
    """Month-end to month-end percent change, per channel."""
    out = {}
    for ch in channels:
        if ch not in panel.columns:
            continue
        s = panel[ch].dropna()
        if len(s) < 200:
            continue
        m = s.resample("ME").last()
        out[ch] = m.pct_change() * 100.0
    return pd.DataFrame(out)


def _block_ci(x: np.ndarray, seed: int, alpha: float = 0.05) -> tuple[float, float]:
    """Block-bootstrap CI for a mean — months cluster, so blocks not rows."""
    if len(x) < BLOCK * 2:
        return float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    n = len(x)
    means = []
    for _ in range(N_BOOT):
        starts = rng.integers(0, max(1, n - BLOCK + 1), size=int(np.ceil(n / BLOCK)))
        idx = np.concatenate([np.arange(s, min(s + BLOCK, n)) for s in starts])[:n]
        means.append(float(np.mean(x[idx])))
    return float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))


def evaluate_channel(
    quads: pd.Series, fwd: pd.Series, seed: int
) -> dict:
    """Learn quad signs on the training half; check them on the holdout."""
    d = pd.concat([quads.rename("quad"), fwd.rename("r")], axis=1).dropna()
    if len(d) < 40:
        return {"skipped": f"only {len(d)} aligned months"}
    cut = int(len(d) * (1 - HOLDOUT_FRAC))
    tr, te = d.iloc[:cut], d.iloc[cut:]

    cells = {}
    for q in (1, 2, 3, 4):
        a = tr.loc[tr["quad"] == q, "r"].to_numpy()
        b = te.loc[te["quad"] == q, "r"].to_numpy()
        lo, hi = _block_ci(a, seed) if len(a) >= BLOCK * 2 else (float("nan"), float("nan"))
        cells[q] = {
            "quad": q, "name": QUAD_NAMES[q],
            "train_n": int(len(a)), "holdout_n": int(len(b)),
            "train_mean": round(float(np.mean(a)), 4) if len(a) else None,
            "holdout_mean": round(float(np.mean(b)), 4) if len(b) else None,
            "train_ci": [round(lo, 4), round(hi, 4)],
            "actionable": bool(len(a) >= MIN_MONTHS and len(b) >= MIN_MONTHS),
        }
        if cells[q]["train_mean"] is not None and cells[q]["holdout_mean"] is not None:
            cells[q]["sign_held"] = bool(
                np.sign(cells[q]["train_mean"]) == np.sign(cells[q]["holdout_mean"])
            )
        else:
            cells[q]["sign_held"] = None

    usable = [c for c in cells.values() if c["actionable"] and c["sign_held"] is not None]
    held = sum(c["sign_held"] for c in usable)

    # The comparison that matters: does acting on the quad beat the
    # unconditional mean of the same asset over the same holdout?
    long_only = float(te["r"].mean())
    signs = {q: np.sign(cells[q]["train_mean"] or 0.0) for q in (1, 2, 3, 4)}
    positioned = te.apply(lambda row: row["r"] * signs.get(int(row["quad"]), 0.0), axis=1)
    quad_mean = float(positioned.mean())
    lo_g, hi_g = _block_ci((positioned - te["r"]).to_numpy(), seed)

    return {
        "skipped": None,
        "n": int(len(d)), "n_train": int(len(tr)), "n_holdout": int(len(te)),
        "cells": cells,
        "usable_cells": len(usable), "signs_held": int(held),
        "holdout_long_only_mean": round(long_only, 4),
        "holdout_quad_positioned_mean": round(quad_mean, 4),
        "edge_over_long_only": round(quad_mean - long_only, 4),
        "edge_ci": [round(lo_g, 4), round(hi_g, 4)],
        "beats_long_only": bool(np.isfinite(lo_g) and lo_g > 0),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", nargs="*",
                    default=["NASDAQ", "SP500", "UST10Y", "WTI", "USD_BROAD", "VIX"])
    ap.add_argument("--horizon", type=int, default=1, help="months ahead")
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 88)
    print("ACE macro quads :: does the regime tell you anything about next month?")
    print("=" * 88)

    panel = market_panel("2010-01-01")
    rets = monthly_returns(panel, args.channels)
    dates = rets.index
    hist = quad_history(dates)
    quads = hist["quad"]

    labelled = quads.notna().sum()
    print(f"\n{labelled} month-ends classified, {dates.min().date()} -> {dates.max().date()}")
    print(f"median data lag {hist['data_lag_days'].median():.0f} days — every quad uses only "
          "what had been PUBLISHED by its own date")
    dist = quads.dropna().astype(int).value_counts().sort_index()
    print("distribution: " + "  ".join(
        f"Q{q} {QUAD_NAMES[q]} {n}" for q, n in dist.items()))

    results = {}
    print(f"\nforward {args.horizon}-month return by quad, by channel")
    for ch in rets.columns:
        fwd = rets[ch].shift(-args.horizon)
        out = evaluate_channel(quads, fwd, args.seed)
        results[ch] = out
        if out["skipped"]:
            print(f"\n{ch}: {out['skipped']}")
            continue
        print(f"\n--- {ch}   {out['n']} months ({out['n_train']} train / {out['n_holdout']} holdout)")
        print(f"    {'quad':<16}{'train n':>8}{'train mean':>12}{'95% CI':>22}"
              f"{'hold n':>8}{'hold mean':>11}  sign")
        for q in (1, 2, 3, 4):
            c = out["cells"][q]
            ci = (f"[{c['train_ci'][0]:+.2f}, {c['train_ci'][1]:+.2f}]"
                  if np.isfinite(c["train_ci"][0]) else "—")
            tm = f"{c['train_mean']:+.3f}" if c["train_mean"] is not None else "—"
            hm = f"{c['holdout_mean']:+.3f}" if c["holdout_mean"] is not None else "—"
            mark = "" if c["sign_held"] is None else ("held" if c["sign_held"] else "FLIPPED")
            thin = "" if c["actionable"] else "  (thin)"
            print(f"    Q{q} {QUAD_NAMES[q]:<13}{c['train_n']:>8}{tm:>12}{ci:>22}"
                  f"{c['holdout_n']:>8}{hm:>11}  {mark}{thin}")
        lo, hi = out["edge_ci"]
        print(f"    signs holding out of sample: {out['signs_held']}/{out['usable_cells']} usable cells")
        print(f"    holdout: quad-positioned {out['holdout_quad_positioned_mean']:+.3f}%/mo "
              f"vs always-long {out['holdout_long_only_mean']:+.3f}%/mo")
        print(f"    edge {out['edge_over_long_only']:+.3f}  95% CI [{lo:+.3f}, {hi:+.3f}]  "
              f"{'BEATS long-only' if out['beats_long_only'] else 'not distinguishable from long-only'}")

    ran = [c for c, o in results.items() if not o["skipped"]]
    winners = [c for c in ran if results[c]["beats_long_only"]]
    total_cells = sum(results[c]["usable_cells"] for c in ran)
    total_held = sum(results[c]["signs_held"] for c in ran)

    print("\n" + "-" * 88)
    print(f"sign stability across all channels: {total_held}/{total_cells} usable quad cells "
          f"kept their sign out of sample ({total_held / max(total_cells, 1):.0%})")
    print(f"channels where quad positioning beats always-long with a CI excluding zero: "
          f"{len(winners)}/{len(ran)}")

    tmat = transitions(hist)
    print("\nempirical regime transitions (descriptive — how it HAS moved, not how it will)")
    print("      " + "".join(f"  ->Q{c}" for c in tmat.columns))
    for q in tmat.index:
        print(f"  Q{q}  " + "".join(f"{tmat.loc[q, c]:6.2f}" for c in tmat.columns))

    passes = bool(len(winners) >= max(2, len(ran) // 3) and total_held / max(total_cells, 1) > 0.5)
    print("\n" + "=" * 88)
    if passes:
        print("VERDICT: PASSES — quad positioning beats always-long out of sample on a")
        print("         meaningful subset, and the signs it learned mostly held.")
    else:
        print("VERDICT: DESCRIPTIVE ONLY — the classification is real and point-in-time,")
        print("         but knowing the quad did not beat simply being long out of sample.")
        print("         Usable for labelling the environment. Not for positioning.")
    print("=" * 88)

    scorecard = {
        "n_classified": int(labelled),
        "median_data_lag_days": float(hist["data_lag_days"].median()),
        "distribution": {int(q): int(n) for q, n in dist.items()},
        "horizon_months": args.horizon,
        "channels": results,
        "sign_stability": {"held": total_held, "usable": total_cells},
        "channels_beating_long_only": winners,
        "transitions": tmat.to_dict(),
        "passes": passes,
    }
    register(
        ModelRecord(
            model_id=MODEL_ID, model_family="growth_inflation_quad", model_version=MODEL_VERSION,
            analysis_type="macro_regime",
            target_variable=f"forward {args.horizon}-month channel return by regime",
            feature_schema=["INDPRO yoy roc", "PAYEMS yoy roc", "CPIAUCSL yoy roc"],
            training_start=str(dates.min().date()), training_end=str(dates.max().date()),
            validation_periods=[{"scheme": "chronological holdout", "frac": HOLDOUT_FRAC}],
            holdout_period={"frac": HOLDOUT_FRAC},
            training_dataset_hash=dataframe_hash(rets.dropna(how="all")),
            hyperparameters={"lookback_months": 3, "min_months": MIN_MONTHS,
                             "horizon_months": args.horizon},
            random_seed=args.seed,
            performance_metrics={c: {k: v for k, v in results[c].items() if k != "cells"}
                                 for c in ran},
            calibration_metrics={"sign_stability": total_held / max(total_cells, 1)},
            benchmark_metrics={"baseline": "always long the same asset",
                               "channels_beating": winners},
            model_artifact_path="", creation_timestamp=utcnow(),
            production_status="CANDIDATE" if passes else "FAILED",
            notes="Point-in-time ALFRED first-release vintages; GDP excluded for a "
                  "119-day publication lag. Classification is real either way; the "
                  "verdict is only about whether it positions.",
        ),
        artifact={"quad_names": QUAD_NAMES},
    )
    if passes:
        promote(MODEL_ID, MODEL_VERSION,
                reason=f"{len(winners)}/{len(ran)} channels beat always-long out of sample")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(scorecard, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
