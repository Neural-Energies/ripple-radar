"""Competing risks on real events: what develops next, and when?

ACE framing applied to the earthquake catalog, which is the only complete
event database available today. After a material event (an M6.0+ mainshock),
three mutually exclusive developments race each other within the same region:

  ESCALATION    a LARGER event follows          -> the thesis materializes
  CONTINUATION  a significant but smaller event -> partial / ongoing
  QUIESCENCE    nothing material follows        -> fade

That is exactly ACE's materialization -> fade scenario axis, and it is the
question the desk actually asks: not "will something happen" but "which of
these happens first, and how soon".

Censoring is handled rather than dropped. A mainshock near the end of the
catalog, or one followed by nothing inside the window, is censored — that is
the real and common outcome, and discarding those rows would bias every
incidence estimate upward.

Validation is out of sample: the incidence functions are estimated on
pre-2020 mainshocks and scored against what actually followed post-2020
mainshocks, at fixed horizons.
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

from ace.config import REPORTS
from ace.feeds.usgs import earthquakes
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow
from ace.survival.competing import calibration_by_horizon, fit_competing_risks

MODEL_ID = "ace_competing_risks"
MODEL_VERSION = "v1"

CAUSES = {1: "escalation", 2: "continuation"}   # 0 = quiescence (censored)
MAIN_MIN_MAG = 6.0
FOLLOW_MIN_MAG = 5.5
RADIUS_KM = 500.0
WINDOW_DAYS = 30.0
HORIZONS = (1.0, 3.0, 7.0, 14.0, 30.0)


def _haversine_km(lat1, lon1, lat2, lon2) -> np.ndarray:
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def build(start: str, end: str) -> pd.DataFrame:
    """One row per mainshock: time to the first following event, and its type."""
    cat = earthquakes(start, end, min_magnitude=FOLLOW_MIN_MAG)
    cat = cat.dropna(subset=["latitude", "longitude"]).reset_index(drop=True)
    times = cat["time"].to_numpy()
    lat = cat["latitude"].to_numpy(dtype=float)
    lon = cat["longitude"].to_numpy(dtype=float)
    mag = cat["magnitude"].to_numpy(dtype=float)
    catalog_end = cat["time"].max()

    rows: list[dict] = []
    main_idx = np.flatnonzero(mag >= MAIN_MIN_MAG)
    for i in main_idx:
        t0 = times[i]
        # Follow-ups strictly AFTER the mainshock, inside the window and radius.
        horizon_end = t0 + np.timedelta64(int(WINDOW_DAYS * 86400), "s")
        j0, j1 = i + 1, np.searchsorted(times, horizon_end, side="right")
        if j1 <= j0:
            follow_days, cause = WINDOW_DAYS, 0
        else:
            sl = slice(j0, j1)
            dist = _haversine_km(lat[i], lon[i], lat[sl], lon[sl])
            near = dist <= RADIUS_KM
            if not near.any():
                follow_days, cause = WINDOW_DAYS, 0
            else:
                k = np.flatnonzero(near)[0] + j0          # first nearby follower
                dt = (times[k] - t0) / np.timedelta64(1, "s") / 86400.0
                follow_days = float(dt)
                cause = 1 if mag[k] > mag[i] else 2
        # Right-censor mainshocks whose window extends past the catalog.
        observable = (catalog_end - t0) / np.timedelta64(1, "s") / 86400.0
        if cause == 0 and observable < WINDOW_DAYS:
            follow_days = max(float(observable), 1e-6)
        rows.append({
            "mainshock_time": cat["time"].iloc[i],
            "magnitude": float(mag[i]),
            "latitude": lat[i], "longitude": lon[i],
            "place": cat["place"].iloc[i],
            "duration_days": max(float(follow_days), 1e-6),
            "cause": int(cause),
        })

    df = pd.DataFrame(rows)
    return df[df["duration_days"] > 0].reset_index(drop=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="1995-01-01")
    ap.add_argument("--end", default="2026-01-01")
    ap.add_argument("--split", default="2020-01-01")
    args = ap.parse_args()

    print("=" * 76)
    print(f"ACE competing risks :: what develops after an M{MAIN_MIN_MAG}+ event?")
    print("=" * 76)
    print(f"  causes: escalation (larger follows) | continuation (smaller follows) | quiescence")
    print(f"  window {WINDOW_DAYS:.0f}d, radius {RADIUS_KM:.0f}km, followers M{FOLLOW_MIN_MAG}+\n")

    df = build(args.start, args.end)
    split = pd.Timestamp(args.split, tz="UTC")
    tr = df[df.mainshock_time < split]
    te = df[df.mainshock_time >= split]
    print(f"mainshocks: {len(df)}  {df.mainshock_time.min().date()} -> {df.mainshock_time.max().date()}")
    print(f"  train {len(tr)} | test {len(te)} (split {args.split})")
    counts = df.cause.value_counts().sort_index()
    labels = {0: "quiescence", 1: "escalation", 2: "continuation"}
    print("  outcomes: " + ", ".join(f"{labels[k]} {v}" for k, v in counts.items()))

    fit = fit_competing_risks(
        tr["duration_days"].to_numpy(), tr["cause"].to_numpy(), CAUSES
    )
    print(f"\nfitted on {fit.n_subjects} mainshocks ({fit.n_censored} quiescent)")
    print("\ncumulative incidence — probability each develops FIRST by horizon:")
    print(f"  {'horizon':>8}{'escalation':>13}{'continuation':>15}{'quiescence':>13}")
    for h in HORIZONS:
        p = fit.probabilities_at(h)
        print(f"  {h:>7.0f}d{p['escalation']:>13.1%}{p['continuation']:>15.1%}{p['no_event']:>13.1%}")

    print("\nOUT-OF-SAMPLE calibration (predicted from train, realized on test):")
    cal = calibration_by_horizon(fit, te["duration_days"].to_numpy(), te["cause"].to_numpy(),
                                 CAUSES, HORIZONS)
    print(f"  {'horizon':>8}{'cause':>15}{'predicted':>11}{'realized':>10}{'error':>9}")
    worst = 0.0
    for row in cal:
        print(f"  {row['horizon']:>7.0f}d{row['cause']:>15}{row['predicted']:>11.1%}"
              f"{row['realized']:>10.1%}{row['error']:>+9.1%}")
        worst = max(worst, abs(row["error"]))

    # Baseline: ignore timing entirely, predict each cause's marginal share.
    marg = {CAUSES[k]: float(np.mean(tr["cause"] == k)) for k in CAUSES}
    base_err = 0.0
    for row in cal:
        base_err = max(base_err, abs(marg[row["cause"]] - row["realized"]))

    print(f"\n  worst absolute error, competing-risks model : {worst:.1%}")
    print(f"  worst absolute error, marginal-share baseline: {base_err:.1%}")

    passes = bool(worst <= 0.10 and worst < base_err)
    print("\n" + "=" * 76)
    if passes:
        print("VERDICT: PASSES — incidence is calibrated out of sample and beats")
        print("         a timing-blind marginal baseline")
    else:
        print("VERDICT: not adequately calibrated out of sample")
    print("=" * 76)

    status = "CANDIDATE" if passes else "FAILED"
    register(
        ModelRecord(
            model_id=MODEL_ID, model_family="aalen_johansen", model_version=MODEL_VERSION,
            analysis_type="competing_risks_next_event",
            target_variable=f"first development within {WINDOW_DAYS:.0f}d of an M{MAIN_MIN_MAG}+ event",
            feature_schema=["duration_days", "cause"],
            training_start=str(tr.mainshock_time.min().date()),
            training_end=str(tr.mainshock_time.max().date()),
            validation_periods=[{"scheme": "temporal split", "split": args.split,
                                 "n_train": len(tr), "n_test": len(te)}],
            holdout_period={"start": args.split, "n": len(te)},
            training_dataset_hash=dataframe_hash(df[["duration_days", "cause"]]),
            hyperparameters={"window_days": WINDOW_DAYS, "radius_km": RADIUS_KM,
                             "main_min_mag": MAIN_MIN_MAG, "follow_min_mag": FOLLOW_MIN_MAG},
            random_seed=0,
            performance_metrics={"cif": fit.to_dict(), "calibration": cal},
            calibration_metrics={"worst_abs_error": round(worst, 4)},
            benchmark_metrics={"marginal_baseline_worst_error": round(base_err, 4),
                               "marginal_shares": marg},
            model_artifact_path="", creation_timestamp=utcnow(), production_status=status,
            notes="Aalen-Johansen; censoring retained as the quiescence outcome",
        ),
        artifact={"cif": fit.to_dict()},
    )
    if passes:
        promote(MODEL_ID, MODEL_VERSION, reason=f"worst OOS calibration error {worst:.1%}")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps({"n_mainshocks": len(df), "n_train": len(tr), "n_test": len(te),
                               "cif": fit.to_dict(), "calibration": cal,
                               "worst_error": worst, "baseline_worst_error": base_err,
                               "passes": passes}, indent=2, default=str))
    print(f"\nscorecard {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
