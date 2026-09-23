"""Out-of-sample edge validation (§11 + §37 applied to a network).

An edge estimated on a sample is not a finding. The question is whether it
still holds on data the estimate never saw. This splits the panel in time,
estimates edges on the earlier half, and reports how many survive on the later
half — sign, significance, and lag.

An edge that flips sign out of sample is worse than no edge, because the app
would draw an arrow pointing the wrong way.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.config import REPORTS
from ace.data.fred_market import market_panel
from ace.ripple.transmission import Edge, build_edges, impulse_responses, to_returns


def _key(e: Edge) -> tuple[str, str]:
    return (e.source, e.dest)


def validate(split: str = "2020-01-01", granger_alpha: float = 0.01) -> dict:
    panel = market_panel("2010-01-01")
    rets = to_returns(panel)
    cut = pd.Timestamp(split, tz="UTC")
    train, test = rets[rets.index < cut], rets[rets.index >= cut]
    print(f"train {train.index.min().date()}..{train.index.max().date()} n={len(train)}")
    print(f"test  {test.index.min().date()}..{test.index.max().date()} n={len(test)}")

    tr_edges = {_key(e): e for e in build_edges(train, granger_alpha=granger_alpha)}
    te_edges = {_key(e): e for e in build_edges(test, granger_alpha=granger_alpha)}
    print(f"\nestimated {len(tr_edges)} ordered pairs on train, {len(te_edges)} on test")

    tr_sig = {k: e for k, e in tr_edges.items() if e.lead_lag_significant}
    survived, flipped, faded = [], [], []
    for k, e in tr_sig.items():
        t = te_edges.get(k)
        if t is None:
            continue
        same_sign = np.sign(e.lead_lag_corr) == np.sign(t.lead_lag_corr)
        if t.lead_lag_significant and same_sign:
            survived.append((k, e, t))
        elif t.lead_lag_significant and not same_sign:
            flipped.append((k, e, t))
        else:
            faded.append((k, e, t))

    n = len(tr_sig)
    print(f"\nof {n} edges significant in train:")
    print(f"  survived (significant, same sign) : {len(survived)}  ({len(survived)/max(n,1):.1%})")
    print(f"  faded    (no longer significant)  : {len(faded)}  ({len(faded)/max(n,1):.1%})")
    print(f"  FLIPPED  (significant, opposite)  : {len(flipped)}  ({len(flipped)/max(n,1):.1%})")

    tr_gr = {k: e for k, e in tr_edges.items() if e.granger_predictive}
    gr_survived = [k for k in tr_gr if te_edges.get(k) and te_edges[k].granger_predictive]
    print(f"\nGranger-predictive in train: {len(tr_gr)}; still predictive in test: {len(gr_survived)}")

    print("\nstrongest surviving edges (train -> test lead-lag corr, lag):")
    survived.sort(key=lambda t: -abs(t[2].lead_lag_corr))
    for (s, d), e, t in survived[:12]:
        print(f"  {s:>12} -> {d:<12} {e.lead_lag_corr:+.3f} -> {t.lead_lag_corr:+.3f}  lag {e.best_lag}->{t.best_lag}  n={t.n_obs}")

    if flipped:
        print("\nedges that FLIPPED SIGN out of sample (would draw a wrong arrow):")
        for (s, d), e, t in flipped[:8]:
            print(f"  {s:>12} -> {d:<12} {e.lead_lag_corr:+.3f} -> {t.lead_lag_corr:+.3f}")

    core = [c for c in ("SP500", "UST10Y", "WTI", "USD_BROAD", "VIX") if c in rets.columns]
    irf = impulse_responses(rets, channels=core, horizon=10)
    if irf.get("available"):
        print(f"\nVAR({irf['lags']}) on {', '.join(core)} — stable, n={irf['n_obs']}")
        print("  1-unit orthogonalized shock, cumulative response over 5 days:")
        for shock in core:
            parts = []
            for resp in core:
                cum = float(np.sum(irf["responses"][shock][resp][:5]))
                parts.append(f"{resp}={cum:+.4f}")
            print(f"    shock {shock:<10} " + "  ".join(parts))
    else:
        print(f"\nVAR unavailable: {irf.get('reason')}")

    report = {
        "split": split,
        "train": {"start": str(train.index.min().date()), "end": str(train.index.max().date()), "n": len(train)},
        "test": {"start": str(test.index.min().date()), "end": str(test.index.max().date()), "n": len(test)},
        "edges_significant_train": n,
        "survived": len(survived),
        "faded": len(faded),
        "flipped": len(flipped),
        "survival_rate": round(len(survived) / max(n, 1), 4),
        "granger_train": len(tr_gr),
        "granger_survived": len(gr_survived),
        "surviving_edges": [
            {"source": s, "dest": d, "train_corr": e.lead_lag_corr, "test_corr": t.lead_lag_corr,
             "train_lag": e.best_lag, "test_lag": t.best_lag, "n_test": t.n_obs}
            for (s, d), e, t in survived
        ],
        "flipped_edges": [
            {"source": s, "dest": d, "train_corr": e.lead_lag_corr, "test_corr": t.lead_lag_corr}
            for (s, d), e, t in flipped
        ],
        "impulse_responses": irf,
    }
    out = REPORTS / "ripple_edge_validation.json"
    out.write_text(json.dumps(report, indent=2, default=str))
    print(f"\nreport {out}")
    return report


if __name__ == "__main__":
    validate()
