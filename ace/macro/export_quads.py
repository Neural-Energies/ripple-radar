"""Export the quad engine for the app, with every caveat attached to its number.

The app cannot run Python on the request path, so this writes one artifact that
a generator turns into a typed module. What matters is that the artifact does
not carry a bare label. Each of the following is measured here and travels with
the reading:

  the SPEC          which series and lookback, chosen by revision survival on a
                    training window rather than by convention
  the MARGIN        how far the rates of change sat from a boundary, plus the
                    measured share of past readings that close which survived
                    revision
  the AGREEMENT     how many of the candidate specifications say the same thing
                    right now — an ensemble disagreeing is uncertainty a single
                    chosen spec cannot express
  the REVISION      where real-time labels historically ended up once the data
                    settled, as a confusion matrix
  the DURATION      how long spells last, with the current one right-censored
  the VERDICTS      what the two forecasting claims did against their baselines
                    (returns: failed; volatility: failed incrementally, though
                    the signature itself is sign-stable)

A generator downstream refuses to emit positioning guidance while those
verdicts say what they currently say. That is the mechanism; this file supplies
the evidence for it.
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
from ace.macro.durations import duration_report
from ace.macro.quads import (
    DEFAULT_SPEC,
    QUAD_DESCRIPTION,
    QUAD_NAMES,
    SERIES,
    SERIES_BY_ID,
    SPECS,
    load_all_finals,
    load_all_vintages,
    month_ends,
    occupancy,
    quad_history,
    reading_at,
    runs,
    transitions,
)
from ace.macro.revisions import (
    MARGIN_BINS,
    SETTLING_MONTHS,
    confusion,
    margin_calibration,
    select_spec,
    settled,
    survival_for,
)

MODEL_ID = "ace_macro_quad"
MODEL_VERSION = "v1"
#: Month-ends shown in the app's timeline. The full history still feeds the
#: transition matrix, the duration curves and the revision calibration.
DISPLAY_MONTHS = 120


def publication_lags(vintages: dict[str, pd.DataFrame]) -> dict[str, dict]:
    """How late each input publishes — the reason a nowcast is not an almanac."""
    out = {}
    for sid, hist in vintages.items():
        lag = (hist["published"] - hist["obs_date"]).dt.days
        meta = SERIES_BY_ID.get(sid)
        out[sid] = {
            "label": meta.label if meta else sid,
            "axis": meta.axis if meta else None,
            "note": meta.note if meta else "",
            "median_days": float(lag.median()),
            "p90_days": float(lag.quantile(0.90)),
            "n": int(len(hist)),
            "first_obs": str(hist["obs_date"].min().date()),
            "last_obs": str(hist["obs_date"].max().date()),
        }
    return out


def spec_agreement(
    when: pd.Timestamp, vintages: dict[str, pd.DataFrame]
) -> dict:
    """What every candidate specification says right now.

    A single chosen spec gives one answer and no sense of how contingent it is.
    Running all of them costs nothing at export time and turns "Q1" into "Q1,
    and five of eight ways of measuring it agree" — which is a different and
    more honest claim.
    """
    readings = {}
    for name, spec in SPECS.items():
        r = reading_at(when, vintages, spec=spec)
        readings[name] = {
            "spec": name,
            "quad": r.quad,
            "name": r.name,
            "growth_roc": r.growth_roc,
            "inflation_roc": r.inflation_roc,
            "margin": r.margin,
            "months_behind": r.months_behind,
            "data_lag_days": r.data_lag_days,
            "rationale": spec.rationale,
        }
    quads = [v["quad"] for v in readings.values() if v["quad"] is not None]
    counts = {str(q): int(quads.count(q)) for q in (1, 2, 3, 4) if quads.count(q)}
    modal = max(counts, key=lambda k: counts[k]) if counts else None
    return {
        "readings": readings,
        "n_specs": len(SPECS),
        "n_classified": len(quads),
        "counts": counts,
        "modal_quad": None if modal is None else int(modal),
        "modal_share": round(counts[modal] / len(quads), 4) if modal else None,
    }


def agreement_history(
    dates: pd.DatetimeIndex, vintages: dict[str, pd.DataFrame]
) -> pd.DataFrame:
    """Per-date spec agreement, so the live number has a distribution to sit in.

    Without this, "5 of 8 agree" is unreadable: it could be unusually firm or
    unusually split. With it, the export can say which.
    """
    per_spec = {}
    for name, spec in SPECS.items():
        h = quad_history(dates, spec=spec, vintages=vintages)
        per_spec[name] = h["quad"]
    frame = pd.DataFrame(per_spec)
    rows = []
    for d, row in frame.iterrows():
        vals = [int(v) for v in row.dropna().tolist()]
        if not vals:
            rows.append({"as_of": str(pd.Timestamp(d).date()), "n": 0,
                         "modal": None, "share": None})
            continue
        counts = {q: vals.count(q) for q in set(vals)}
        modal = max(counts, key=lambda k: counts[k])
        rows.append({
            "as_of": str(pd.Timestamp(d).date()),
            "n": len(vals),
            "modal": int(modal),
            "share": round(counts[modal] / len(vals), 4),
        })
    out = pd.DataFrame(rows)
    out.index = pd.DatetimeIndex(dates)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2000-01-01")
    ap.add_argument("--vintage-start", default="1998-01-01")
    ap.add_argument("--display-months", type=int, default=DISPLAY_MONTHS)
    ap.add_argument("--spec", default=None,
                    help="force a specification instead of selecting one")
    ap.add_argument("--train-frac", type=float, default=0.70)
    args = ap.parse_args()

    print("fetching vintage archives and revised series…")
    vintages = load_all_vintages(args.vintage_start)
    finals = load_all_finals(args.vintage_start)
    dates = month_ends(args.start)
    now = pd.Timestamp.now(tz="UTC")

    # --- which specification, and why -----------------------------------
    if args.spec:
        chosen = args.spec
        selection = {"chosen": chosen, "criterion": "forced on the command line",
                     "scores": {}, "train_frac": args.train_frac,
                     "chosen_holdout_rank": None, "n_candidates_ranked": 0}
        comparisons = {}
        print(f"specification forced to '{chosen}'")
    else:
        print(f"selecting a specification over {len(dates)} month-ends × {len(SPECS)} candidates…")
        sel = select_spec(dates, vintages, finals, train_frac=args.train_frac, now=now)
        comparisons = sel.pop("comparisons")
        selection = sel
        chosen = sel["chosen"]
        print(f"chosen: '{chosen}' — holdout rank {sel['chosen_holdout_rank']}"
              f"/{sel['n_candidates_ranked']}")

    spec = SPECS[chosen]
    cmp = comparisons.get(chosen)

    # --- the classification itself --------------------------------------
    hist = quad_history(dates, spec=spec, vintages=vintages)
    labelled = hist[hist["quad"].notna()]
    if labelled.empty:
        print("export_quads: nothing classified — refusing to write", file=sys.stderr)
        return 1

    # The live reading: today, from what is published today, through exactly
    # the same code path as every historical row — so it cannot accidentally
    # see a revision the others could not.
    live = reading_at(now, vintages, spec=spec).to_dict()
    spell_table = runs(hist)
    durations = duration_report(spell_table)
    tmat = transitions(hist)
    # Windowed occupancy, because the point reading flips every couple of
    # months and a reader deserves the stable answer alongside the fresh one.
    occ = {str(w): occupancy(hist, w) for w in (3, 6, 12, 24)}

    # --- revision risk ---------------------------------------------------
    if cmp is not None:
        calibration = margin_calibration(cmp, now=now)
        conf = confusion(cmp, now=now)
        # The SAME sample the per-bin rates use. Pooling over every comparison
        # instead would include months the revised data has not had time to
        # revise, which score as survivors by default and flatter the number.
        sample = settled(cmp, now)
        revision = {
            "available": True,
            "measured_over": {
                "first": str(sample.index.min().date()) if len(sample) else None,
                "last": str(sample.index.max().date()) if len(sample) else None,
                "n": int(len(sample)),
                "settling_months": SETTLING_MONTHS,
                "excluded_as_unsettled": int(cmp["survived"].notna().sum() - len(sample)),
            },
            "pooled_survival": round(float(sample["survived"].mean()), 4) if len(sample) else None,
            "bins": [{"label": b[2], "lo": b[0], "hi": None if not np.isfinite(b[1]) else b[1]}
                     for b in MARGIN_BINS],
            "calibration": calibration,
            "confusion": conf,
            "live": survival_for(live.get("margin"), calibration),
        }
        # Which axis revision actually damages. Q1<->Q4 and Q2<->Q3 hold
        # inflation fixed and flip growth; Q1<->Q2 and Q3<->Q4 do the reverse.
        growth_flip = {(1, 4), (4, 1), (2, 3), (3, 2)}
        infl_flip = {(1, 2), (2, 1), (3, 4), (4, 3)}
        g = i = both = 0
        for _, r in sample.iterrows():
            if bool(r["survived"]):
                continue
            pair = (int(r["realtime"]), int(r["final"]))
            if pair in growth_flip:
                g += 1
            elif pair in infl_flip:
                i += 1
            else:
                both += 1
        total_flips = g + i + both
        revision["flip_axis"] = {
            "growth": g, "inflation": i, "both": both, "total": total_flips,
            "growth_share": round(g / total_flips, 4) if total_flips else None,
        }
    else:
        revision = {"available": False,
                    "reason": "the specification was forced, so no comparison was run"}

    # --- how contingent the label is ------------------------------------
    print("running every candidate specification for agreement…")
    agree_now = spec_agreement(now, vintages)
    agree_hist = agreement_history(dates, vintages)
    settled_shares = agree_hist["share"].dropna()
    agree_now["historical_share"] = {
        "median": round(float(settled_shares.median()), 4) if len(settled_shares) else None,
        "p25": round(float(settled_shares.quantile(0.25)), 4) if len(settled_shares) else None,
        "p75": round(float(settled_shares.quantile(0.75)), 4) if len(settled_shares) else None,
        "n": int(len(settled_shares)),
    }
    if agree_now["modal_share"] is not None and len(settled_shares):
        agree_now["percentile_today"] = round(
            float((settled_shares <= agree_now["modal_share"]).mean()), 4
        )

    # --- what the forecasting claims did --------------------------------
    ret_path = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    vol_path = REPORTS / f"{MODEL_ID}_vol_{MODEL_VERSION}_scorecard.json"
    validation: dict = {}

    if ret_path.exists():
        sc = json.loads(ret_path.read_text())
        ran = {c: o for c, o in (sc.get("channels") or {}).items() if not o.get("skipped")}
        validation["returns"] = {
            "available": True,
            "claim": "knowing the quad tells you which way an asset goes",
            "baseline": "always long the same asset",
            "passes": bool(sc.get("passes")),
            "horizon_months": sc.get("horizon_months"),
            "sign_stability": sc.get("sign_stability"),
            "channels_tested": sorted(ran),
            "channels_beating_baseline": sc.get("channels_beating_long_only") or [],
            "channel_results": {
                c: {"edge_pct_per_month": o.get("edge_over_long_only"),
                    "edge_ci": o.get("edge_ci"),
                    "signs_held": o.get("signs_held"),
                    "usable_cells": o.get("usable_cells"),
                    "holdout_months": o.get("n_holdout")}
                for c, o in ran.items()
            },
        }
    else:
        validation["returns"] = {"available": False,
                                 "reason": "quad_model.py has not been run"}

    if vol_path.exists():
        sc = json.loads(vol_path.read_text())
        ran = {c: o for c, o in (sc.get("channels") or {}).items() if not o.get("skipped")}
        validation["volatility"] = {
            "available": True,
            "claim": "knowing the quad improves a volatility forecast that already "
                     "knows last month's volatility",
            "baseline": sc.get("baseline"),
            "passes": bool(sc.get("passes")),
            "spec": (sc.get("spec") or {}).get("name"),
            "sign_stability": sc.get("sign_stability"),
            "channels_tested": sorted(ran),
            "channels_beating_baseline": sc.get("winners") or [],
            "channel_results": {
                c: {"quad_gain_over_ar": o.get("quad_gain_over_ar"),
                    "ar_gain_over_unconditional": o.get("ar_gain_over_unconditional"),
                    "p_value": o.get("p_value"),
                    "reduction_ci": o.get("reduction_ci"),
                    "signs_held": o.get("signs_held"),
                    "usable_cells": o.get("usable_cells"),
                    "holdout_months": o.get("n_holdout"),
                    "cells": o.get("cells")}
                for c, o in ran.items()
            },
        }
    else:
        validation["volatility"] = {"available": False,
                                    "reason": "quad_vol_model.py has not been run"}

    display = labelled.tail(args.display_months)
    def clean(rec: dict) -> dict:
        return {k: (None if isinstance(v, float) and pd.isna(v) else v) for k, v in rec.items()}

    artifact = {
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "generated_at": now.isoformat(),
        "framework": {
            "quads": {str(q): {"name": QUAD_NAMES[q], "description": QUAD_DESCRIPTION[q]}
                      for q in (1, 2, 3, 4)},
            "gdp_excluded_reason":
                "real GDP publishes ~119 days after the quarter it describes; a "
                "nowcast that waits for it is reading an almanac",
        },
        "series": [
            {"id": s.series_id, "label": s.label, "axis": s.axis,
             "typical_lag_days": s.typical_lag_days, "vintage_from": s.vintage_from,
             "note": s.note}
            for s in SERIES
        ],
        "specs": {n: s.to_dict() for n, s in SPECS.items()},
        "selection": selection,
        "spec": spec.to_dict(),
        "publication_lags": publication_lags(
            {sid: vintages[sid] for sid in spec.series_ids if sid in vintages}
        ),
        "all_publication_lags": publication_lags(vintages),
        "current": live,
        "agreement": agree_now,
        "agreement_history": [clean(r) for r in agree_hist.to_dict("records")][-args.display_months:],
        "history": [clean(r) for r in display.to_dict("records")],
        "coverage": {
            "n_classified": int(len(labelled)),
            "first": str(labelled["as_of"].iloc[0]),
            "last": str(labelled["as_of"].iloc[-1]),
            "median_data_lag_days": float(labelled["data_lag_days"].median()),
            "max_data_lag_days": int(labelled["data_lag_days"].max()),
            "median_months_behind": float(labelled["months_behind"].median()),
            "distribution": {str(int(q)): int(n) for q, n
                             in labelled["quad"].astype(int).value_counts().sort_index().items()},
        },
        "transitions": {str(q): {str(c): float(tmat.loc[q, c]) for c in tmat.columns}
                        for q in tmat.index},
        "durations": durations,
        "occupancy": occ,
        "spells": [
            {"quad": int(r["quad"]), "start": str(pd.Timestamp(r["start"]).date()),
             "end": str(pd.Timestamp(r["end"]).date()), "months": int(r["months"]),
             "censored": bool(r["censored"])}
            for _, r in spell_table.iterrows()
        ],
        "revision": revision,
        "validation": validation,
    }

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_panel.json"
    out.write_text(json.dumps(artifact, indent=2, default=str))

    cur = artifact["current"]
    label = f"Q{cur['quad']} {cur['name']}" if cur["quad"] else "unclassified"
    print(f"\nlive reading {cur['as_of']} under '{chosen}': {label}")
    if cur["quad"]:
        print(f"  growth {cur['growth_yoy']:+.2f}% yoy, roc {cur['growth_roc']:+.3f}")
        print(f"  inflation {cur['inflation_yoy']:+.2f}% yoy, roc {cur['inflation_roc']:+.3f}")
        print(f"  margin {cur['margin']:.3f} → {revision.get('live', {}).get('bin')}"
              f" (survived {revision.get('live', {}).get('survival')} of the time,"
              f" n={revision.get('live', {}).get('n')})")
        print(f"  data through {cur['growth_through']} / {cur['inflation_through']}"
              f" — {cur['months_behind']} month(s) behind")
    a = artifact["agreement"]
    print(f"  {a['counts'].get(str(a['modal_quad']), 0)}/{a['n_classified']} specifications agree"
          f" (historical median {a['historical_share']['median']})")
    o12 = occ["12"]
    print(f"  last 12 months: Q{o12['dominant']} {o12['dominant_share']:.0%} of the time, "
          f"{o12['distinct_quads']} distinct quads, {o12['switches']} switches")
    d = durations.get("current", {})
    if d:
        print(f"  spell: Q{d['quad']} for {d['elapsed_months']:.0f} months since {d['start']};"
              f" exit within 3 ≈ {d['exit_within'].get('3')} ({d['basis']})")
    print(f"\n{artifact['coverage']['n_classified']} month-ends classified "
          f"{artifact['coverage']['first']} → {artifact['coverage']['last']}")
    if revision.get("available"):
        print(f"revision: {revision['pooled_survival']:.1%} of real-time labels survived; "
              f"{revision['flip_axis']['growth_share']:.0%} of the failures were growth-axis flips")
    for k in ("returns", "volatility"):
        v = validation[k]
        if v.get("available"):
            print(f"{k}: passes={v['passes']} "
                  f"({len(v['channels_beating_baseline'])}/{len(v['channels_tested'])} channels)")
    print(f"\nartifact {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
