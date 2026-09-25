"""Export the quad classification for the app, with its verdict attached.

The app cannot run Python on the request path, so the classification is
exported as data. What matters is that the export carries the SAME caveat the
validation run produced: `ace/models/quad_model.py` tested whether knowing the
quad beats simply being long the same asset out of sample, and it did not —
0/6 channels, and only 11 of 23 usable quad cells kept their sign.

So this artifact carries `positioning_validated: false` alongside the readings.
The generator that turns it into TypeScript refuses to emit positioning
guidance while that flag is false, which is the mechanism that keeps a failed
claim from quietly becoming a product feature.

What IS exported without caveat: the regime label itself, and the data lag
behind it. The classification is honest point-in-time work — every reading uses
only ALFRED first-release vintages published by its own date — and a label with
its lag stated is useful even when it does not position.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings("ignore")

from ace.config import REPORTS
from ace.macro.quads import (
    GROWTH_SERIES,
    INFLATION_SERIES,
    QUAD_DESCRIPTION,
    QUAD_NAMES,
    ROC_LOOKBACK_MONTHS,
    reading_at,
    transitions,
    vintage_frame,
)

MODEL_ID = "ace_macro_quad"
MODEL_VERSION = "v1"
#: Month-ends shown in the app. Longer history feeds the transition matrix.
DISPLAY_MONTHS = 60


def publication_lags(vintages: dict[str, pd.DataFrame]) -> dict[str, dict]:
    """How late each input publishes — the reason a nowcast is not an almanac."""
    out = {}
    for sid, hist in vintages.items():
        lag = (hist["published"] - hist["obs_date"]).dt.days
        out[sid] = {
            "median_days": float(lag.median()),
            "p90_days": float(lag.quantile(0.90)),
            "n": int(len(hist)),
            "first_obs": str(hist["obs_date"].min().date()),
            "last_obs": str(hist["obs_date"].max().date()),
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2000-01-01")
    ap.add_argument("--vintage-start", default="1998-01-01")
    ap.add_argument("--display-months", type=int, default=DISPLAY_MONTHS)
    args = ap.parse_args()

    series = (*GROWTH_SERIES, *INFLATION_SERIES)
    vintages = {sid: vintage_frame(sid, args.vintage_start) for sid in series}

    month_ends = pd.date_range(
        pd.Timestamp(args.start, tz="UTC"), pd.Timestamp.now(tz="UTC"), freq="ME"
    )
    rows = [reading_at(d, vintages).to_dict() for d in month_ends]
    hist = pd.DataFrame(rows)
    hist.index = pd.DatetimeIndex(month_ends)
    labelled = hist[hist["quad"].notna()]
    if labelled.empty:
        print("export_quads: nothing classified — refusing to write", file=sys.stderr)
        return 1

    # The live reading: today, from what is published today. This is the one
    # the app shows as "now", and it is the same code path as every historical
    # row, so it cannot accidentally see a revision the others could not.
    live = reading_at(pd.Timestamp.now(tz="UTC"), vintages).to_dict()

    tmat = transitions(hist)

    verdict_path = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    validation: dict = {"available": False}
    if verdict_path.exists():
        sc = json.loads(verdict_path.read_text())
        ran = {c: o for c, o in (sc.get("channels") or {}).items() if not o.get("skipped")}
        validation = {
            "available": True,
            "positioning_validated": bool(sc.get("passes")),
            "baseline": "always long the same asset",
            "horizon_months": sc.get("horizon_months"),
            "sign_stability": sc.get("sign_stability"),
            "channels_tested": sorted(ran),
            "channels_beating_long_only": sc.get("channels_beating_long_only") or [],
            "channel_edges": {
                c: {
                    "edge_pct_per_month": o.get("edge_over_long_only"),
                    "edge_ci": o.get("edge_ci"),
                    "signs_held": o.get("signs_held"),
                    "usable_cells": o.get("usable_cells"),
                    "holdout_months": o.get("n_holdout"),
                }
                for c, o in ran.items()
            },
        }

    display = labelled.tail(args.display_months)
    artifact = {
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "framework": {
            "quads": {
                str(q): {"name": QUAD_NAMES[q], "description": QUAD_DESCRIPTION[q]}
                for q in (1, 2, 3, 4)
            },
            "roc_lookback_months": ROC_LOOKBACK_MONTHS,
            "growth_series": list(GROWTH_SERIES),
            "inflation_series": list(INFLATION_SERIES),
            "gdp_excluded_reason":
                "real GDP publishes ~119 days after the quarter it describes; a "
                "nowcast that waits for it is reading an almanac",
        },
        "publication_lags": publication_lags(vintages),
        "current": live,
        "history": [
            {k: (None if pd.isna(v) else v) for k, v in r.items()}
            for r in display.to_dict("records")
        ],
        "coverage": {
            "n_classified": int(len(labelled)),
            "first": str(labelled["as_of"].iloc[0]),
            "last": str(labelled["as_of"].iloc[-1]),
            "median_data_lag_days": float(labelled["data_lag_days"].median()),
            "max_data_lag_days": int(labelled["data_lag_days"].max()),
            "distribution": {
                str(int(q)): int(n)
                for q, n in labelled["quad"].astype(int).value_counts().sort_index().items()
            },
        },
        "transitions": {str(q): {str(c): float(tmat.loc[q, c]) for c in tmat.columns}
                        for q in tmat.index},
        "validation": validation,
    }

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_panel.json"
    out.write_text(json.dumps(artifact, indent=2, default=str))

    cur = artifact["current"]
    label = f"Q{cur['quad']} {cur['name']}" if cur["quad"] else "unclassified"
    print(f"live reading {cur['as_of']}: {label}")
    if cur["quad"]:
        print(f"  growth yoy {cur['growth_yoy']:+.2f}% (roc {cur['growth_roc']:+.2f})")
        print(f"  inflation yoy {cur['inflation_yoy']:+.2f}% (roc {cur['inflation_roc']:+.2f})")
        print(f"  data through {cur['growth_through']} / {cur['inflation_through']}"
              f" — {cur['data_lag_days']} days behind")
    print(f"{artifact['coverage']['n_classified']} month-ends classified "
          f"{artifact['coverage']['first']} to {artifact['coverage']['last']}")
    if validation.get("available"):
        print(f"positioning validated: {validation['positioning_validated']} "
              f"({len(validation['channels_beating_long_only'])}"
              f"/{len(validation['channels_tested'])} channels beat always-long)")
    print(f"\nartifact {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
