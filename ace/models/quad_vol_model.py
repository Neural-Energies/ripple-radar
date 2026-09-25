"""Does the regime tell you anything about RISK that last month's risk doesn't?

`quad_model.py` asked whether the quad tells you which way an asset goes. It
does not — zero of six channels beat simply being long. This asks a different
and much more answerable question: whether the quad tells you how VOLATILE the
next month will be.

WHY IT DESERVES ITS OWN TEST

Direction and dispersion are not the same claim. Conditional means in returns
are tiny and drown in noise; conditional variances are large, persistent and
routinely detectable. A framework can be useless for positioning and still be
useful for sizing. Refusing to test the second because the first failed would
throw away the more likely result.

THE BASELINE THAT MATTERS, AGAIN

Not the unconditional average volatility. Volatility is the most persistent
quantity in finance — last month's realised vol explains most of next month's
all by itself — so the honest baseline is an autoregression on lagged log
volatility. A quad that merely recovers "vol was high recently" has discovered
nothing.

So the test is INCREMENTAL. Fit, on a training window:

    baseline   log_rv[t+1] = a + b * log_rv[t]
    augmented  log_rv[t+1] = a + b * log_rv[t] + (quad effects)

and compare their errors on a sealed chronological holdout. If the augmented
model does not beat the baseline out of sample, the quad adds nothing to what
the tape already said, and this reports that.

LOGS, BECAUSE VOLATILITY IS MULTIPLICATIVE

Realised vol is right-skewed and strictly positive. Fitting the level lets one
crisis month dominate the loss; fitting the log asks the proportional question
that actually matters for sizing, and makes the residuals roughly symmetric.

MULTIPLICITY

Six channels are tested, so a 5% threshold applied six times finds something
about a quarter of the time on noise alone. The gate is a Holm-Bonferroni
correction over the per-channel bootstrap p-values, and a channel passes only
if its corrected threshold still excludes zero.
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
from ace.data.fred_market import LEVEL_SERIES, market_panel
from ace.macro.quads import (
    DEFAULT_SPEC,
    QUAD_NAMES,
    SPECS,
    load_vintages,
    month_ends,
    quad_history,
)
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, retire, utcnow

MODEL_ID = "ace_macro_quad_vol"
MODEL_VERSION = "v1"
HOLDOUT_FRAC = 0.30
#: Trading days a month must contain before its realised vol is trusted.
MIN_DAYS_IN_MONTH = 15
#: Months a channel needs before it is fitted at all.
MIN_MONTHS = 90
N_BOOT = 2000
BLOCK = 3
CHANNELS = ("SP500", "NASDAQ", "DJIA", "UST10Y", "WTI", "USD_BROAD")


def realised_vol(panel: pd.DataFrame, channel: str) -> pd.Series:
    """Monthly realised volatility from daily moves, in percent.

    Level-quoted series (yields, spreads) are differenced rather than
    log-differenced: a "return" on a yield that touches zero is meaningless.
    """
    if channel not in panel.columns:
        return pd.Series(dtype=float)
    s = panel[channel].dropna()
    if s.empty:
        return pd.Series(dtype=float)
    d = s.diff() if channel in LEVEL_SERIES else np.log(s).diff() * 100.0
    d = d.dropna()
    if d.empty:
        return pd.Series(dtype=float)
    grouped = d.groupby(pd.Grouper(freq="ME"))
    vol = grouped.std()
    count = grouped.count()
    # A month with four quotes is not a month. Blank it rather than letting a
    # holiday stretch produce a confident-looking outlier.
    vol = vol.where(count >= MIN_DAYS_IN_MONTH)
    return vol.dropna()


def _ols(X: np.ndarray, y: np.ndarray) -> np.ndarray | None:
    """Least squares with an explicit rank check.

    A rank-deficient design happens whenever the training window is missing a
    quad entirely, and `lstsq` would silently return a minimum-norm solution
    that looks like a fit. Returning None makes the caller skip instead.
    """
    if X.shape[0] <= X.shape[1] or np.linalg.matrix_rank(X) < X.shape[1]:
        return None
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    return beta


def _design(lag: np.ndarray, quads: np.ndarray, with_quads: bool) -> np.ndarray:
    """Intercept + lagged log vol, optionally plus quad dummies.

    Q1 is the omitted category, so the intercept carries it and the dummies are
    differences from it. Including all four alongside an intercept would be
    collinear by construction.
    """
    cols = [np.ones_like(lag), lag]
    if with_quads:
        for q in (2, 3, 4):
            cols.append((quads == q).astype(float))
    return np.column_stack(cols)


def _block_ci(x: np.ndarray, seed: int, alpha: float) -> tuple[float, float, float]:
    """Block-bootstrap CI for a mean, plus a two-sided p against zero.

    Months cluster, so blocks and not rows. The p-value is the bootstrap's own
    two-sided tail — the share of resamples on the wrong side of zero, doubled
    — which is what a Holm correction downstream needs.
    """
    n = len(x)
    if n < BLOCK * 3:
        return float("nan"), float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    means = np.empty(N_BOOT)
    starts_n = int(np.ceil(n / BLOCK))
    for i in range(N_BOOT):
        starts = rng.integers(0, max(1, n - BLOCK + 1), size=starts_n)
        idx = np.concatenate([np.arange(s, min(s + BLOCK, n)) for s in starts])[:n]
        means[i] = float(np.mean(x[idx]))
    lo, hi = float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))
    share = float(np.mean(means > 0))
    p = 2.0 * min(share, 1.0 - share)
    return lo, hi, min(1.0, max(p, 1.0 / N_BOOT))


def holm(pvalues: dict[str, float], alpha: float = 0.05) -> dict[str, bool]:
    """Holm-Bonferroni: which channels survive testing six of them at once."""
    live = {k: v for k, v in pvalues.items() if np.isfinite(v)}
    out = {k: False for k in pvalues}
    m = len(live)
    for i, (k, p) in enumerate(sorted(live.items(), key=lambda kv: kv[1])):
        if p <= alpha / (m - i):
            out[k] = True
        else:
            break
    return out


def evaluate_channel(df: pd.DataFrame, seed: int) -> dict:
    """Incremental value of the quad over an autoregression on log vol."""
    d = df.dropna().copy()
    n = len(d)
    if n < MIN_MONTHS:
        return {"skipped": f"only {n} usable months (needs {MIN_MONTHS})"}

    cut = int(n * (1 - HOLDOUT_FRAC))
    y = d["y"].to_numpy(float)
    lag = d["lag"].to_numpy(float)
    quads = d["quad"].to_numpy(int)

    tr = slice(0, cut)
    ho = slice(cut, n)
    if len(set(quads[tr])) < 4:
        return {"skipped": "the training window is missing a quad entirely"}

    b_base = _ols(_design(lag[tr], quads[tr], False), y[tr])
    b_aug = _ols(_design(lag[tr], quads[tr], True), y[tr])
    if b_base is None or b_aug is None:
        return {"skipped": "rank-deficient training design"}

    e_base = y[ho] - _design(lag[ho], quads[ho], False) @ b_base
    e_aug = y[ho] - _design(lag[ho], quads[ho], True) @ b_aug
    # Positive = the quad reduced squared error. Per-observation, so a block
    # bootstrap over it is a bootstrap over the thing being claimed.
    gain = e_base**2 - e_aug**2
    lo, hi, p = _block_ci(gain, seed, 0.05)

    mse_base = float(np.mean(e_base**2))
    mse_aug = float(np.mean(e_aug**2))
    # Also report against the far weaker unconditional baseline, purely to show
    # how much of any apparent skill is just volatility persistence.
    e_uncond = y[ho] - float(np.mean(y[tr]))
    mse_uncond = float(np.mean(e_uncond**2))

    # Per-quad mean log-vol relative to the training mean, and whether that
    # relationship held out of sample. Descriptive either way.
    cells = {}
    for q in (1, 2, 3, 4):
        m_tr = quads[tr] == q
        m_ho = quads[ho] == q
        tr_rel = float(np.mean(y[tr][m_tr]) - np.mean(y[tr])) if m_tr.sum() >= 6 else None
        ho_rel = float(np.mean(y[ho][m_ho]) - np.mean(y[tr])) if m_ho.sum() >= 6 else None
        cells[q] = {
            "quad": q,
            "name": QUAD_NAMES[q],
            "train_n": int(m_tr.sum()),
            "holdout_n": int(m_ho.sum()),
            # exp(log difference) is the multiplicative vol ratio, which is the
            # form a reader can act on: "1.3x the average month".
            "train_vol_ratio": None if tr_rel is None else round(float(np.exp(tr_rel)), 4),
            "holdout_vol_ratio": None if ho_rel is None else round(float(np.exp(ho_rel)), 4),
            "sign_held": None if (tr_rel is None or ho_rel is None) else bool(
                (tr_rel >= 0) == (ho_rel >= 0)
            ),
        }
    usable = [c for c in cells.values() if c["sign_held"] is not None]

    return {
        "skipped": None,
        "n": n,
        "n_train": cut,
        "n_holdout": n - cut,
        "mse_unconditional": round(mse_uncond, 6),
        "mse_baseline_ar": round(mse_base, 6),
        "mse_with_quad": round(mse_aug, 6),
        # How much of the AR model's advantage is pure persistence — context
        # for reading the incremental number, never the headline.
        "ar_gain_over_unconditional": round(1 - mse_base / mse_uncond, 4) if mse_uncond else None,
        "quad_gain_over_ar": round(1 - mse_aug / mse_base, 4) if mse_base else None,
        "mean_sq_error_reduction": round(float(np.mean(gain)), 6),
        "reduction_ci": [round(lo, 6), round(hi, 6)],
        "p_value": round(p, 6),
        "cells": {str(k): v for k, v in cells.items()},
        "signs_held": int(sum(bool(c["sign_held"]) for c in usable)),
        "usable_cells": len(usable),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=DEFAULT_SPEC, choices=sorted(SPECS))
    ap.add_argument("--start", default="2000-01-01")
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    spec = SPECS[args.spec]
    dates = month_ends(args.start)
    hist = quad_history(dates, spec=spec, vintages=load_vintages(spec))
    labelled = hist[hist["quad"].notna()]
    if labelled.empty:
        print("no classified months", file=sys.stderr)
        return 1
    quad_by_month = pd.Series(
        labelled["quad"].astype(int).values,
        index=pd.DatetimeIndex(labelled.index).tz_convert("UTC"),
    )

    panel = market_panel(args.start)
    print(f"spec '{spec.name}' — {len(labelled)} classified month-ends "
          f"{labelled['as_of'].iloc[0]} to {labelled['as_of'].iloc[-1]}")
    print(f"testing whether the quad improves on an autoregression in log realised vol\n")

    results: dict[str, dict] = {}
    for ch in CHANNELS:
        rv = realised_vol(panel, ch)
        if rv.empty:
            results[ch] = {"skipped": "no usable daily series"}
            continue
        rv = rv[rv > 0]
        logv = np.log(rv)
        logv.index = pd.DatetimeIndex(logv.index).tz_convert("UTC")
        # The quad known at month-end t predicts month t+1's volatility. Any
        # other alignment would use a label built from data published after the
        # month it is supposed to forecast.
        frame = pd.DataFrame({
            "y": logv.shift(-1),
            "lag": logv,
            "quad": quad_by_month.reindex(logv.index),
        })
        results[ch] = evaluate_channel(frame, args.seed)

    ran = {c: r for c, r in results.items() if not r.get("skipped")}
    for c, r in results.items():
        if r.get("skipped"):
            print(f"--- {c}   skipped: {r['skipped']}")
            continue
        print(f"--- {c}   {r['n']} months ({r['n_train']} train / {r['n_holdout']} holdout)")
        print(f"    {'quad':<16}{'train n':>8}{'vol x':>8}{'hold n':>8}{'vol x':>8}  sign")
        for q in ("1", "2", "3", "4"):
            cell = r["cells"][q]
            tv = f"{cell['train_vol_ratio']:.2f}" if cell["train_vol_ratio"] else "—"
            hv = f"{cell['holdout_vol_ratio']:.2f}" if cell["holdout_vol_ratio"] else "—"
            mark = "" if cell["sign_held"] is None else ("held" if cell["sign_held"] else "FLIPPED")
            print(f"    Q{q} {QUAD_NAMES[int(q)]:<13}{cell['train_n']:>8}{tv:>8}"
                  f"{cell['holdout_n']:>8}{hv:>8}  {mark}")
        lo, hi = r["reduction_ci"]
        print(f"    persistence alone explains {r['ar_gain_over_unconditional']:+.1%} "
              f"of the unconditional error")
        print(f"    quad on top of that: {r['quad_gain_over_ar']:+.1%} of remaining MSE, "
              f"p={r['p_value']:.4f}")
        print(f"    error reduction {r['mean_sq_error_reduction']:+.4f}  95% CI [{lo:+.4f}, {hi:+.4f}]")

    passed = holm({c: r["p_value"] for c, r in ran.items()})
    # Holm alone is not enough: a corrected p can clear while the effect is
    # negative. Require the reduction to be positive too.
    winners = [c for c in ran if passed.get(c) and ran[c]["mean_sq_error_reduction"] > 0]

    print("\n" + "-" * 88)
    print("Holm-Bonferroni across " + f"{len(ran)} channels:")
    for c in sorted(ran, key=lambda k: ran[k]["p_value"]):
        print(f"  {c:<11} p={ran[c]['p_value']:.4f}  "
              f"{'SURVIVES correction' if passed.get(c) else 'does not survive'}"
              f"{'' if ran[c]['mean_sq_error_reduction'] > 0 else '  (and the effect is negative)'}")

    total_cells = sum(ran[c]["usable_cells"] for c in ran)
    total_held = sum(ran[c]["signs_held"] for c in ran)
    print(f"\nvol-by-quad sign stability: {total_held}/{total_cells} cells kept their sign "
          f"({total_held / max(total_cells, 1):.0%})")

    passes = bool(winners)
    print("\n" + "=" * 88)
    if passes:
        print(f"VERDICT: PASSES on {len(winners)}/{len(ran)} channels — the quad improves a")
        print("         volatility forecast that already knows last month's volatility,")
        print(f"         and survives correcting for {len(ran)} simultaneous tests.")
        print(f"         Channels: {', '.join(sorted(winners))}")
    else:
        print("VERDICT: FAILED — volatility is persistent, and once a forecast knows last")
        print("         month's volatility the quad adds nothing that survives multiplicity")
        print("         correction. The vol ratios below are descriptive, not usable.")
    print("=" * 88)

    scorecard = {
        "spec": spec.to_dict(),
        "horizon_months": 1,
        "target": "log realised volatility, next month",
        "baseline": "AR(1) in log realised volatility",
        "channels": results,
        "holm": passed,
        "winners": winners,
        "sign_stability": {"held": total_held, "usable": total_cells},
        "passes": passes,
    }
    register(
        ModelRecord(
            model_id=MODEL_ID, model_family="growth_inflation_quad", model_version=MODEL_VERSION,
            analysis_type="volatility_regime",
            target_variable="log realised volatility, one month ahead",
            feature_schema=["lagged log realised vol", "quad dummies"],
            training_start=str(labelled["as_of"].iloc[0]),
            training_end=str(labelled["as_of"].iloc[-1]),
            validation_periods=[{"scheme": "chronological holdout", "frac": HOLDOUT_FRAC}],
            holdout_period={"frac": HOLDOUT_FRAC},
            training_dataset_hash=dataframe_hash(labelled[["quad"]]),
            hyperparameters={"spec": spec.name, "lookback_months": spec.lookback,
                             "min_days_in_month": MIN_DAYS_IN_MONTH, "block": BLOCK},
            random_seed=args.seed,
            performance_metrics={c: {k: v for k, v in ran[c].items() if k != "cells"} for c in ran},
            calibration_metrics={"sign_stability": total_held / max(total_cells, 1)},
            benchmark_metrics={"baseline": "AR(1) log realised vol", "winners": winners},
            model_artifact_path="", creation_timestamp=utcnow(),
            production_status="CANDIDATE" if passes else "FAILED",
            notes="Incremental test against volatility persistence, Holm-corrected across "
                  f"{len(ran)} channels. Quad labels are point-in-time under spec "
                  f"'{spec.name}'.",
        ),
        artifact={"quad_names": QUAD_NAMES},
    )
    if passes:
        promote(MODEL_ID, MODEL_VERSION,
                reason=f"{len(winners)}/{len(ran)} channels beat an AR(1) in log vol "
                       "after Holm correction")
    else:
        try:
            retire(MODEL_ID, MODEL_VERSION, reason="no channel survives multiplicity correction")
        except Exception:
            pass

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(scorecard, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
