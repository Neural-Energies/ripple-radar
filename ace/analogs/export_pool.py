"""Export the historical-analog pool, and the answers a port must reproduce.

The retrieval itself is validated Python: Mahalanobis distance over a rolling
multi-channel state, candidates restricted to dates whose own forward window
has already closed, and a covariance estimated from the candidate window only
so the present cannot influence the metric used to find its own analogs.

The application cannot call Python on the request path, so the retrieval is
reimplemented in TypeScript. Reimplementation is where a validated method
quietly stops being the validated method, so this exporter also writes a set of
REFERENCE QUERIES with Python's exact answers. The TypeScript port is tested
against them; if the two ever diverge, the test says so rather than the product
shipping a second, subtly different metric under the same name.
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

from ace.analogs.historical import _state_matrix, default_channels, find_analogs
from ace.config import REPORTS
from ace.data.fred_market import market_panel
from ace.ripple.transmission import to_returns

WINDOW = 20
FORWARD = 20
TARGET = "NASDAQ"
# Dates spread across regimes, so a port that only works in calm tape fails.
REFERENCE_QUERIES = [
    "2013-06-20", "2015-08-24", "2018-02-05", "2018-12-24",
    "2020-03-16", "2021-11-22", "2022-09-13", "2024-08-05", "2025-04-07",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--k", type=int, default=20)
    args = ap.parse_args()

    panel = market_panel("2010-01-01")
    rets = to_returns(panel)
    channels = default_channels(rets)
    state = _state_matrix(rets, channels, WINDOW)

    # Forward outcome per state date, reversed so the window at t covers
    # t+1..t+forward and never t itself.
    fwd = rets[TARGET][::-1].rolling(FORWARD).sum()[::-1].shift(-1)

    print("=" * 78)
    print("Historical analog pool")
    print("=" * 78)
    print(f"channels  {channels}")
    print(f"state     {len(state)} days  {state.index.min().date()} -> {state.index.max().date()}")
    print(f"features  {list(state.columns)}")

    rows = []
    for ts, row in state.iterrows():
        f = fwd.get(ts, np.nan)
        rows.append({
            "d": str(ts.date()),
            "f": None if not np.isfinite(f) else round(float(f), 6),
            "x": [round(float(v), 6) for v in row.to_numpy()],
        })

    references = []
    for q in REFERENCE_QUERIES:
        ts = pd.Timestamp(q, tz="UTC")
        if ts < state.index.min() or ts > state.index.max():
            continue
        out = find_analogs(rets, as_of=ts, target_channel=TARGET, channels=channels,
                           window=WINDOW, forward=FORWARD, k=args.k)
        if not out.get("available"):
            print(f"  reference {q}: unavailable — {out.get('reason')}")
            continue
        references.append({
            "query": q,
            "as_of": out["as_of"],
            "analogs": [{"date": a["date"], "distance": a["distance"],
                         "forward_return": a["forward_return"]} for a in out["analogs"]],
            "outcome_distribution": out["outcome_distribution"],
            "agreement": out["agreement"],
        })
        od = out["outcome_distribution"]
        print(f"  reference {q} -> {len(out['analogs'])} analogs, "
              f"median {od['median']:+.4f}, agreement {out['agreement']:.2f}")

    artifact = {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "target_channel": TARGET,
        "channels": channels,
        "features": list(state.columns),
        "window_days": WINDOW,
        "forward_days": FORWARD,
        "k": args.k,
        "method": "mahalanobis over rolling momentum/volatility state; candidates "
                  "restricted to dates whose forward window has closed; covariance "
                  "estimated on the candidate window only",
        "rows": rows,
        "references": references,
    }
    out_path = Path(args.out) if args.out else REPORTS / "analog_pool.json"
    out_path.write_text(json.dumps(artifact, separators=(",", ":")))
    kb = out_path.stat().st_size / 1024
    print(f"\n{len(rows)} pool rows, {len(references)} reference queries")
    print(f"artifact {out_path}  ({kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
