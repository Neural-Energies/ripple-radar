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
import hashlib
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
from ace.jsonutil import to_json_safe
from ace.registry.registry import ModelRecord, dataframe_hash, evidence_for, register, try_promote, utcnow
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
MODEL_VERSION = "v2"
MIN_TRAIN = 500
TAIL_REFIT_EVERY = 125


def realization_dates(r: pd.Series, dates: pd.Index, horizon: int) -> pd.DatetimeIndex:
    """Session on which each row's forward label is fully observed.

    Both labels at origin D — the realized volatility and the summed move over
    the next `horizon` sessions of `r` — cover `r`'s positions after D up to
    D's position + `horizon`, so they become known on that session's date.
    Measured in sessions of `r` itself, never in rows of a filtered frame: a
    row dropped for a missing feature does not shorten anyone's horizon.
    """
    sessions = pd.Series(r.index, index=r.index).shift(-horizon)
    return pd.DatetimeIndex(sessions.reindex(dates))


def walk_forward(
    r: pd.Series,
    feats: pd.DataFrame,
    horizon: int,
    *,
    min_train: int = MIN_TRAIN,
    refit_every: int = TAIL_REFIT_EVERY,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Point-in-time volatility, drift and tail forecasts at every origin.

    A forecast made at the close of origin D may use a training label only if
    that label's own window had closed by D (`realization_dates`). An earlier
    version fitted `lstsq(X[:t], y[:t])`, which includes the previous
    `horizon - 1` labels whose windows end AFTER t: on a synthetic
    850-session panel, multiplying only returns after the origin by ten moved
    that origin's forecast volatility from 0.04534 to 0.05904. With mature
    labels only it is 0.04653 either way. The tail parameter is held to the
    same rule, and so is the drift, which reads returns through D by date.

    Returns (forecasts, design): forecasts is indexed by origin with columns
    sigma_h, drift, df, move, realized_at; design is the feature frame.
    """
    y_vol = np.log(np.maximum(forward_vol(r, horizon), EPS)).rename("log_fwd_vol")
    # realized move over the same forward window the vol refers to
    fwd_move = r.shift(-1).rolling(horizon).sum().shift(-(horizon - 1)).rename("fwd_move")

    d = pd.concat([feats, y_vol, fwd_move], axis=1).dropna()
    cols = list(feats.columns)
    X = np.column_stack([np.ones(len(d))] + [d[c].to_numpy() for c in cols])
    yv = d["log_fwd_vol"].to_numpy()
    moves = d["fwd_move"].to_numpy()

    realized_at = realization_dates(r, d.index, horizon)
    # Rows whose label had closed by each origin. `realized_at` rises with the
    # row, so the mature set is a prefix; a label closing ON the origin session
    # is known at that close and counts.
    n_mature = realized_at.searchsorted(d.index, side="right")
    n_returns = r.index.searchsorted(d.index, side="right")
    cum_ret = np.concatenate([[0.0], np.cumsum(r.to_numpy(dtype=float))])

    sigma_pred = np.full(len(d), np.nan)
    df_used = np.full(len(d), np.nan)
    # Expected move over the horizon, estimated from past returns only.
    # Centring every scenario band on zero ignores drift, which showed up as a
    # 50% interval covering ~41%: the centre was in the wrong place even though
    # the tails were right.
    drift_pred = np.full(len(d), np.nan)
    tail_df: float | None = None
    fitted = 0
    for t in range(len(d)):
        m = int(n_mature[t])
        if m < min_train:
            continue
        try:
            coef = np.linalg.lstsq(X[:m], yv[:m], rcond=None)[0]
        except np.linalg.LinAlgError:
            continue
        sigma_pred[t] = float(np.exp(X[t] @ coef) * np.sqrt(horizon))
        k = int(n_returns[t])
        drift_pred[t] = float(cum_ret[k] / k * horizon) if k > 250 else 0.0
        # tail parameter from matured standardized moves only, refit periodically
        if tail_df is None or fitted % refit_every == 0:
            # Standardize by the FORECAST volatility, not the realized one.
            # Dividing a move by the volatility actually realized over its own
            # window gives a near-unit-variance series by construction, which
            # drove the fitted df straight to its ceiling and made the
            # distribution look Gaussian. What the tail parameter must describe
            # is how far moves land relative to what was FORECAST.
            hist = np.isfinite(sigma_pred[:m])
            if hist.sum() >= 150:
                z_past = (moves[:m][hist] - drift_pred[:m][hist]) / np.maximum(sigma_pred[:m][hist], 1e-12)
                tail_df = fit_tail_df(z_past)
            else:
                tail_df = 5.0
        df_used[t] = tail_df
        fitted += 1

    forecasts = pd.DataFrame(
        {"sigma_h": sigma_pred, "drift": drift_pred, "df": df_used,
         "move": moves, "realized_at": realized_at},
        index=d.index,
    )
    return forecasts, d[cols]


def non_overlapping(origins: pd.Index, realized_at: pd.DatetimeIndex) -> np.ndarray:
    """Positions of forecast windows that share no session with each other.

    Each next window starts at the first origin on or after the previous
    window's closing session — by date, so a gap in the rows cannot let two
    windows overlap the way a fixed row stride would.
    """
    keep: list[int] = []
    closed = None
    for i, origin in enumerate(origins):
        if closed is None or origin >= closed:
            keep.append(i)
            closed = realized_at[i]
    return np.asarray(keep, dtype=int)


def residual_history(z: np.ndarray, realized_at: pd.DatetimeIndex, origin: pd.Timestamp) -> np.ndarray:
    """Standardized residuals whose own outcome was known at `origin`."""
    return z[: int(realized_at.searchsorted(origin, side="right"))]


STUDENT_T = "student_t"
FHS = "filtered_historical_simulation"
FAMILIES = (STUDENT_T, FHS)

#: Share of the non-overlapping windows, oldest first, on which the family is
#: CHOSEN. The rest are held back untouched and are the only rows that decide
#: promotion — choosing and confirming on the same rows would grade the choice
#: on the data that made it.
SELECTION_SHARE = 0.5
GATE_WORST_MISS = 0.07


def evaluate_family(
    family: str,
    mv: np.ndarray,
    sig: np.ndarray,
    dr: np.ndarray,
    dfs: np.ndarray,
    residual_sets: list[np.ndarray],
) -> dict:
    """PIT and interval coverage of one family on the rows it is handed.

    Student-t rows use each origin's OWN tail parameter (`dfs[i]`, fitted on
    what was known then). An earlier version applied the median df over the
    whole evaluation period to every row, so a later window's fit could
    rewrite an earlier window's PIT.
    """
    if family == STUDENT_T:
        pit = pit_values(mv, sig, dfs, dr)
        cov = coverage(mv, sig, dfs, dr)
        n = len(mv)
    elif family == FHS:
        usable = [i for i, z in enumerate(residual_sets) if len(z) >= 50]
        if not usable:
            return {"available": False, "reason": "no residual history", "worst_miss": 1.0, "n": 0}
        u = np.asarray(usable)
        sets = [residual_sets[i] for i in usable]
        pit = fhs_pit(mv[u], sig[u], dr[u], sets)
        cov = fhs_coverage(mv[u], sig[u], dr[u], sets)
        n = len(usable)
    else:
        raise ValueError(f"unknown family {family!r}")
    diag = pit_diagnostics(pit[np.isfinite(pit)])
    worst = max((abs(c["miss"]) for c in cov), default=1.0)
    return {"available": bool(diag.get("available")), "pit": diag, "coverage": cov,
            "worst_miss": round(float(worst), 4), "n": int(n)}


def select_and_confirm(
    mv: np.ndarray,
    sig: np.ndarray,
    dr: np.ndarray,
    dfs: np.ndarray,
    residual_sets: list[np.ndarray],
    *,
    selection_share: float = SELECTION_SHARE,
) -> dict:
    """Choose the family on the older windows, then gate it on the newer ones.

    The confirmation rows play no part in the choice, and the choice is
    final before they are scored. A PIT that does not reject on confirmation
    is evidence the distribution is not badly misspecified there — not proof
    that every threshold probability read off it is right.
    """
    n_sel = int(len(mv) * selection_share)
    sel = slice(0, n_sel)
    conf = slice(n_sel, len(mv))

    selection = {
        f: evaluate_family(f, mv[sel], sig[sel], dr[sel], dfs[sel], residual_sets[sel])
        for f in FAMILIES
    }
    use_fhs = selection[FHS]["available"] and selection[FHS]["worst_miss"] < selection[STUDENT_T]["worst_miss"]
    chosen = FHS if use_fhs else STUDENT_T

    confirmation = evaluate_family(chosen, mv[conf], sig[conf], dr[conf], dfs[conf], residual_sets[conf])
    passes = bool(
        confirmation["available"]
        and confirmation["pit"].get("uniform_by_ks")
        and confirmation["worst_miss"] <= GATE_WORST_MISS
    )
    return {
        "chosen": chosen, "passes": passes,
        "n_selection": n_sel, "n_confirmation": len(mv) - n_sel,
        "selection": selection, "confirmation": confirmation,
    }


def emit_bands(
    family: str,
    *,
    sigma_h: float,
    drift: float,
    df: float,
    residuals: np.ndarray,
    horizon: int,
) -> dict:
    """The live scenario read, from the family that was actually evaluated.

    An earlier version always emitted Student-t bands, so a channel whose
    Filtered Historical Simulation won the evaluation shipped probabilities
    from a distribution that had not.
    """
    if family == STUDENT_T:
        out = scenario_bands(sigma_h / np.sqrt(horizon), horizon_days=horizon, df=df, drift=drift).to_dict()
        out["family"] = STUDENT_T
        return out
    if family == FHS:
        z = np.asarray(residuals, dtype=float)
        z = z[np.isfinite(z)]
        return {
            "family": FHS,
            "horizon_days": int(horizon),
            "forecast_vol_horizon": round(float(sigma_h), 8),
            "drift": round(float(drift), 8),
            "n_residuals": int(len(z)),
            "residual_hash": hashlib.sha256(np.round(z, 12).tobytes()).hexdigest()[:16],
            "quantiles": fhs_quantiles(z, sigma_h, drift=drift),
            "probabilities": fhs_probabilities(z, sigma_h, drift=drift),
        }
    raise ValueError(f"unknown family {family!r}")


def run(channel: str, horizon: int, seed: int) -> dict:
    panel = market_panel("2010-01-01")
    rets = to_returns(panel)
    r = rets[channel].dropna()

    feats = har_features(r)
    if "VIX" in panel.columns:
        vix = panel["VIX"].reindex(r.index).ffill()
        feats["log_vix"] = np.log(np.maximum(vix / 100.0 / np.sqrt(252), EPS))

    wf, design = walk_forward(r, feats, horizon)
    print(f"{channel}: {len(wf)} rows  {wf.index.min().date()} -> {wf.index.max().date()}  horizon {horizon}d")

    ok = wf.dropna(subset=["sigma_h", "drift", "df", "move"])
    sig_all = ok["sigma_h"].to_numpy()
    dfs_all = ok["df"].to_numpy()
    mv_all = ok["move"].to_numpy()
    dr_all = ok["drift"].to_numpy()
    dates_all = ok.index
    realized_all = pd.DatetimeIndex(ok["realized_at"])

    # Calibration tests assume independent observations. A 20-session forward
    # window sampled every day overlaps 19/20 with its neighbour, so KS on the
    # daily series tests a sample roughly 20x smaller than it looks and reports
    # spurious rejection. Score calibration on NON-OVERLAPPING windows.
    idx_ind = non_overlapping(dates_all, realized_all)
    sig, dfs, mv, dr = sig_all[idx_ind], dfs_all[idx_ind], mv_all[idx_ind], dr_all[idx_ind]
    dates = dates_all[idx_ind]
    print(f"scored {len(mv_all)} overlapping windows -> {len(mv)} non-overlapping for calibration")
    print(f"fitted df range {dfs.min():.2f}-{dfs.max():.2f}")

    # Expanding standardized-residual history: residual_sets[i] holds only
    # residuals whose own outcome was known at observation i's origin.
    z_all = (mv_all - dr_all) / np.maximum(sig_all, 1e-12)
    residual_sets = [residual_history(z_all, realized_all, origin) for origin in dates]

    result = select_and_confirm(mv, sig, dr, dfs, residual_sets)
    chosen, passes = result["chosen"], result["passes"]
    conf = result["confirmation"]

    # Gaussian comparison on the same confirmation rows: what a normal
    # assumption would have claimed.
    n_sel = result["n_selection"]
    gauss = evaluate_family(STUDENT_T, mv[n_sel:], sig[n_sel:], dr[n_sel:],
                            np.full(len(mv) - n_sel, 1e6), residual_sets[n_sel:])

    print(f"\nwindows: {n_sel} for selection (oldest), {result['n_confirmation']} held back for confirmation")
    for f in FAMILIES:
        s = result["selection"][f]
        print(f"  selection  {f:<31} worst miss {s['worst_miss']:.1%}  n={s['n']}")
    print(f"  chosen: {chosen}")
    if conf["available"]:
        print(f"  confirmation PIT: KS p={conf['pit']['ks_p_value']:.4f} uniform={conf['pit']['uniform_by_ks']}"
              f"  worst miss {conf['worst_miss']:.1%}  n={conf['n']}")
        for c in conf["coverage"]:
            print(f"    {c['nominal']:>5.0%} -> {c['empirical']:.1%}")
    if gauss["available"]:
        print(f"  gaussian on confirmation: KS p={gauss['pit']['ks_p_value']:.4f}  worst miss {gauss['worst_miss']:.1%}")

    print("\n" + "=" * 74)
    if passes:
        print(f"VERDICT: PASSES — {chosen} is calibrated on held-back windows it was not chosen on")
    else:
        print(f"VERDICT: not adequately calibrated on confirmation (chosen: {chosen})")
    print("=" * 74)

    # The live read, from the family that was evaluated, on what is known now.
    residuals_now = residual_history(z_all, realized_all, dates_all[-1])
    bands = emit_bands(chosen, sigma_h=float(sig_all[-1]), drift=float(dr_all[-1]),
                       df=float(dfs_all[-1]), residuals=residuals_now, horizon=horizon)
    print(f"\nlive scenario read for {channel} as of {dates_all[-1].date()} ({horizon} sessions, {chosen}):")
    for k in ("p05", "p25", "p50", "p75", "p95"):
        print(f"    {k}: {bands['quantiles'][k]*100:+.2f}%")
    for k, v in bands["probabilities"].items():
        if k.startswith("P(|"):
            print(f"    {k} = {v:.1%}")

    return {
        "channel": channel, "horizon": horizon, "as_of": str(dates_all[-1].date()),
        "n_scored": int(len(mv)),
        "chosen_family": chosen, "passes": passes,
        "n_selection": n_sel, "n_confirmation": result["n_confirmation"],
        "selection": result["selection"], "confirmation": conf,
        "gaussian_confirmation": gauss,
        "worst_interval_miss": conf["worst_miss"],
        "tail_df_latest": round(float(dfs_all[-1]), 3),
        "tail_df_range": [round(float(dfs.min()), 3), round(float(dfs.max()), 3)],
        "example_bands": bands,
        "_hash_frame": design,
        "_residuals": residuals_now,
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
        residuals = res.pop("_residuals")
        family = res["chosen_family"]
        conf = res["confirmation"]
        # The artifact carries exactly the state the emitted bands were read
        # from: the tail parameter for Student-t, the residual set for FHS.
        artifact = {"family": family, "horizon": args.horizon, "as_of": res["as_of"]}
        if family == FHS:
            artifact.update(residuals=np.asarray(residuals, dtype=float),
                            residual_hash=res["example_bands"]["residual_hash"])
        else:
            artifact["tail_df"] = res["tail_df_latest"]
        rec = register(
            ModelRecord(
                model_id=f"{MODEL_ID}_{ch}", model_family=f"har_vol + {family}",
                model_version=MODEL_VERSION, analysis_type="scenario_probability",
                target_variable=f"distribution of {ch} move over {args.horizon} sessions",
                feature_schema=list(frame.columns),
                training_start="2010-01-01", training_end=res["as_of"],
                validation_periods=[{"scheme": "expanding walk-forward, mature labels only",
                                     "min_train": MIN_TRAIN,
                                     "selection_windows": res["n_selection"],
                                     "confirmation_windows": res["n_confirmation"]}],
                holdout_period={"confirmation_windows": res["n_confirmation"]},
                training_dataset_hash=dataframe_hash(frame),
                hyperparameters={"horizon": args.horizon, "family": family,
                                 "selection_share": SELECTION_SHARE},
                random_seed=args.seed,
                performance_metrics={"selection": res["selection"], "confirmation": conf},
                calibration_metrics={"ks_p": conf.get("pit", {}).get("ks_p_value"),
                                     "worst_interval_miss": res["worst_interval_miss"]},
                benchmark_metrics={"gaussian_confirmation": res["gaussian_confirmation"]},
                model_artifact_path="", creation_timestamp=utcnow(),
                production_status="CANDIDATE" if res["passes"] else "FAILED",
                notes="family chosen on older windows, gated on held-back newer ones",
            ),
            artifact=artifact,
        )
        if res["passes"]:
            ok, why = try_promote(f"{MODEL_ID}_{ch}", MODEL_VERSION,
                    reason=f"{family} on {res['n_confirmation']} held-back windows: "
                           f"PIT KS p={conf['pit']['ks_p_value']}, worst interval miss {res['worst_interval_miss']:.1%}",
                evidence=evidence_for(
                    rec,
                    target=rec.target_variable,
                    horizon=f"{args.horizon} sessions",
                    metric="PIT KS p-value on held-back windows",
                    baseline="Gaussian bands",
                    value=conf["pit"]["ks_p_value"],
                    n_scored=res["n_confirmation"],
                    passed=res["passes"],
                    criteria="family chosen on older windows; PIT uniform and interval misses within tolerance on newer ones",
                ),
            )
            if not ok:
                print("registry: not promoted — " + "; ".join(why))

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(to_json_safe(results), indent=2, default=str, allow_nan=False))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
