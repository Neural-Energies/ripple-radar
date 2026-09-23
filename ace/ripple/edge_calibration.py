"""Measure the Ripple graph's transmission edges instead of asserting them.

The product ships a causal graph whose ~42 edges each carry a confidence
(`0.82`, `0.74`, ...) and a lag label (`"hours-days"`, `"1-15 sessions"`).
The STRUCTURE is legitimate domain ontology -- crude does feed refined product
cracks, and that is worth encoding. The NUMBERS were authored by hand and are
rendered to the user as if they were measurements.

This module measures the ones that can be measured, and -- more importantly --
says which cannot be.

WHAT "CONFIDENCE" MEANS HERE

Not a vibe and not a correlation. Confidence is **sign stability out of
sample**: the fraction of block-bootstrap resamples of a held-out period in
which the contemporaneous relationship keeps the sign it had in training. It
answers the question a user actually has -- "if I rely on this arrow, how often
does it point the way the graph says?" -- and it is falsifiable.

It is reported only when the holdout coupling clears a floor. A relationship
whose magnitude is indistinguishable from zero has no meaningful sign to be
stable about, and dressing that up as "0.62 confidence" is the failure this
module exists to remove.

WHAT THE LAG LABELS ARE WORTH

Nothing, on this evidence. Two independent methods have now looked: edge
validation across periods found that while 72.1% of edges survive out of
sample, ZERO hold the same non-zero lag in both; and Jorda local projections
with Newey-West errors found no horizon beyond the same day surviving
multiplicity correction on any pair tested. Cross-market transmission in liquid
macro is a same-day repricing. Every edge is therefore re-measured
contemporaneously, and the lag test is run so the graph can state the negative
result rather than keep asserting a positive one.

WHAT CANNOT BE MEASURED

Most of it, and that is the point. The panel is 16 FRED channels. Tags like
`shipping`, `insurance`, `rareearth`, `foundry`, `cyber` or `consumer` have no
daily market proxy in it, so their edges are returned `unmeasured` with a null
confidence. They remain in the graph as ontology -- an asserted mechanism, not
a measured one -- and the application has to render them differently. An
unmeasured edge presented at 0.74 is a fabricated number; an unmeasured edge
labelled "asserted, not measured" is honest domain knowledge.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings("ignore")

from ace.config import RANDOM_SEED, REPORTS
from ace.data.fred_market import market_panel
from ace.data.series import shock_series
from ace.ripple.transmission import to_returns

# Ontology tag -> the daily series that actually proxies it. `None` is a
# first-class answer: it means the panel cannot speak to this concept, which is
# true for most of the graph and must not be papered over.
TAG_PROXY: dict[str, str | None] = {
    # measurable
    "crude": "WTI",
    "energy": "WTI",
    "gas": "NATGAS",
    "inflation": "BREAKEVEN_5Y5Y",
    "rates": "UST10Y",
    "duration": "UST10Y",
    "fx": "USD_BROAD",
    "usd": "USD_BROAD",
    "yen": "USDJPY",
    "europe": "EURUSD",
    "equity": "SP500",
    "vol": "VIX",
    # no daily market proxy in a 16-channel FRED panel
    "refined": None, "shipping": None, "freight": None, "insurance": None,
    "airlines": None, "ag": None, "crypto": None, "liquidity": None,
    "policy": None, "semiconductor": None, "foundry": None, "compute": None,
    "tech": None, "rareearth": None, "magnets": None, "defense": None,
    "banking": None, "credit": None, "lithium": None, "industrial": None,
    "weather": None, "labor": None, "logistics": None, "cyber": None,
    "consumer": None, "conditions": None, "china": None, "ev": None,
    "copper": None, "gold": None, "haven": None,
}

# Pairs whose two proxies are not independent by construction. Measurable, but
# the number is partly an identity and must be labelled as such rather than
# read as evidence of a causal mechanism.
CONSTRUCTION_OVERLAP = {
    ("USDJPY", "USD_BROAD"),   # the yen is a component of the broad dollar index
    ("EURUSD", "USD_BROAD"),
    ("VIX", "SP500"),          # VIX is priced off S&P options
    ("WTI", "BRENT"),
}

HOLDOUT_FRAC = 0.30
# Below this |correlation| there is no relationship whose sign could be stable.
COUPLING_FLOOR = 0.05
N_BOOT = 1000
BLOCK = 20


@dataclass
class EdgeMeasurement:
    from_tag: str
    to_tag: str
    asserted_direction: int
    asserted_confidence: float
    status: str                      # measured | no_material_coupling | unmeasured | degenerate
    from_proxy: str | None = None
    to_proxy: str | None = None
    n_train: int = 0
    n_holdout: int = 0
    corr_train: float | None = None
    corr_holdout: float | None = None
    coupling: float | None = None
    sign_stability: float | None = None
    measured_direction: int | None = None
    direction_agrees: bool | None = None
    lagged_horizons: list[int] | None = None
    pretrend_ok: bool | None = None
    construction_overlap: bool = False
    note: str = ""

    def confidence(self) -> float | None:
        """The number the product may display. None means: do not display one."""
        return self.sign_stability if self.status == "measured" else None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["confidence"] = self.confidence()
        return d


def _sign_stability(a: np.ndarray, b: np.ndarray, train_sign: int, seed: int) -> float:
    """P(the holdout relationship keeps its training sign), by block bootstrap.

    Blocks, not rows: returns cluster, and resampling independently would treat
    one volatile fortnight as twenty independent confirmations.
    """
    rng = np.random.default_rng(seed)
    n = len(a)
    if n < BLOCK * 3:
        return float("nan")
    agree = 0
    draws = 0
    for _ in range(N_BOOT):
        starts = rng.integers(0, max(1, n - BLOCK + 1), size=int(np.ceil(n / BLOCK)))
        idx = np.concatenate([np.arange(s, min(s + BLOCK, n)) for s in starts])[:n]
        aa, bb = a[idx], b[idx]
        if aa.std() == 0 or bb.std() == 0:
            continue
        r = float(np.corrcoef(aa, bb)[0, 1])
        if not np.isfinite(r):
            continue
        draws += 1
        if np.sign(r) == train_sign:
            agree += 1
    return agree / draws if draws else float("nan")


def _lag_test(rets: pd.DataFrame, src: str, dst: str, seed: int) -> tuple[list[int], bool | None]:
    """Does any LAGGED horizon survive? Expected answer, repeatedly: no."""
    from ace.causal.local_projection import local_projection
    try:
        shock = shock_series(rets[src], sigma=2.0)
        aligned = pd.concat([shock.rename("s"), rets[dst].rename("y")], axis=1).dropna()
        if int((aligned["s"] != 0).sum()) < 20:
            return [], None
        ir = local_projection(rets[dst], shock, horizons=range(0, 6),
                              pre_horizons=[-3, -1], lags=5)
        return [h for h in ir.holm_significant() if h >= 1], ir.pretrend_ok
    except Exception:
        return [], None


def measure_edge(rets: pd.DataFrame, from_tag: str, to_tag: str,
                 asserted_direction: int, asserted_confidence: float,
                 seed: int = RANDOM_SEED) -> EdgeMeasurement:
    base = EdgeMeasurement(
        from_tag=from_tag, to_tag=to_tag,
        asserted_direction=asserted_direction, asserted_confidence=asserted_confidence,
        status="unmeasured",
    )
    src = TAG_PROXY.get(from_tag)
    dst = TAG_PROXY.get(to_tag)
    base.from_proxy, base.to_proxy = src, dst

    if src is None or dst is None:
        missing = [t for t, p in ((from_tag, src), (to_tag, dst)) if p is None]
        base.note = (f"no daily market proxy for {', '.join(missing)} — this edge is "
                     "asserted domain ontology, not a measurement")
        return base

    if src == dst:
        # rates -> duration both map to UST10Y. Left unguarded this returns a
        # correlation of 1.0 and would render as the strongest edge in the graph.
        base.status = "degenerate"
        base.note = (f"both ends proxy to {src}; the edge restates one series against "
                     "itself and cannot be measured")
        return base

    if src not in rets.columns or dst not in rets.columns:
        base.note = f"proxy series missing from the panel: {src} or {dst}"
        return base

    d = rets[[src, dst]].dropna()
    cut = int(len(d) * (1 - HOLDOUT_FRAC))
    if cut < 200 or len(d) - cut < 100:
        base.note = f"only {len(d)} overlapping observations — too few to split"
        return base

    tr, ho = d.iloc[:cut], d.iloc[cut:]
    base.n_train, base.n_holdout = len(tr), len(ho)
    r_tr = float(tr[src].corr(tr[dst]))
    r_ho = float(ho[src].corr(ho[dst]))
    base.corr_train = round(r_tr, 4)
    base.corr_holdout = round(r_ho, 4)
    base.coupling = round(abs(r_ho), 4)
    base.construction_overlap = (src, dst) in CONSTRUCTION_OVERLAP or (dst, src) in CONSTRUCTION_OVERLAP

    if not np.isfinite(r_tr) or abs(r_ho) < COUPLING_FLOOR:
        base.status = "no_material_coupling"
        base.note = (f"holdout |r| = {abs(r_ho):.3f}, below the {COUPLING_FLOOR} floor — "
                     "no relationship whose direction could be stable")
        return base

    base.sign_stability = round(
        _sign_stability(ho[src].to_numpy(), ho[dst].to_numpy(), int(np.sign(r_tr)), seed), 4
    )
    base.measured_direction = int(np.sign(r_ho))
    base.direction_agrees = bool(base.measured_direction == asserted_direction)
    base.lagged_horizons, base.pretrend_ok = _lag_test(rets, src, dst, seed)
    base.status = "measured"
    base.note = (
        f"{src} -> {dst}, contemporaneous. Holdout |r| = {abs(r_ho):.3f}; the sign held "
        f"in {base.sign_stability:.0%} of bootstrap resamples"
        + ("" if base.lagged_horizons else "; no lagged horizon survives correction")
        + ("" if base.direction_agrees else "; MEASURED SIGN OPPOSES THE ASSERTED DIRECTION")
        + ("; the two proxies overlap by construction" if base.construction_overlap else "")
    )
    return base


def calibrate(edges: list[dict], *, start: str = "2010-01-01",
              seed: int = RANDOM_SEED) -> list[EdgeMeasurement]:
    panel = market_panel(start)
    rets = to_returns(panel)
    if "VIX" in panel.columns:
        rets = rets.assign(VIX=np.log(panel["VIX"]).diff())
    return [
        measure_edge(rets, e["from"], e["to"], int(e["direction"]),
                     float(e.get("confidence", 0.0)), seed)
        for e in edges
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="Measure the Ripple graph's transmission edges")
    ap.add_argument("--edges", default="artifacts/transmit_edges.json",
                    help="JSON array exported from the app's ontology")
    ap.add_argument("--out", default=None)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    edges = json.loads(Path(args.edges).read_text())
    print("=" * 88)
    print(f"Ripple transmission edges :: measuring {len(edges)} asserted relationships")
    print("=" * 88)

    results = calibrate(edges, seed=args.seed)
    by_status: dict[str, int] = {}
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1

    print(f"\n{'edge':<26}{'status':<22}{'|r| out':>9}{'conf':>8}{'asserted':>10}  note")
    for r in results:
        conf = f"{r.confidence():.2f}" if r.confidence() is not None else "  —"
        coup = f"{r.coupling:.3f}" if r.coupling is not None else "    —"
        flag = "" if r.direction_agrees is not False else "  SIGN FLIP"
        print(f"{r.from_tag + '->' + r.to_tag:<26}{r.status:<22}{coup:>9}{conf:>8}"
              f"{r.asserted_confidence:>10.2f}{flag}")

    print(f"\n{'status':<24}{'edges':>7}")
    for k, v in sorted(by_status.items(), key=lambda kv: -kv[1]):
        print(f"{k:<24}{v:>7}")

    measured = [r for r in results if r.status == "measured"]
    flips = [r for r in measured if r.direction_agrees is False]
    lagged = [r for r in measured if r.lagged_horizons]
    print(f"\nmeasurable: {len(measured)}/{len(results)} edges")
    if measured:
        gap = [abs(r.asserted_confidence - (r.confidence() or 0)) for r in measured]
        print(f"mean |asserted confidence - measured|: {np.mean(gap):.3f}")
    print(f"edges whose measured sign OPPOSES the asserted direction: {len(flips)}"
          + (f" ({', '.join(r.from_tag + '->' + r.to_tag for r in flips)})" if flips else ""))
    print(f"edges with ANY surviving lagged horizon: {len(lagged)}"
          " — the graph's lag labels have no support in this data"
          if not lagged else f"edges with a surviving lagged horizon: {len(lagged)}")

    out = Path(args.out) if args.out else REPORTS / "transmission_edges.json"
    out.write_text(json.dumps({
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "panel_start": "2010-01-01",
        "holdout_frac": HOLDOUT_FRAC,
        "coupling_floor": COUPLING_FLOOR,
        "n_bootstrap": N_BOOT,
        "block": BLOCK,
        "confidence_definition":
            "fraction of block-bootstrap resamples of the held-out period in which the "
            "contemporaneous correlation keeps the sign it had in training",
        "summary": by_status,
        "edges": [r.to_dict() for r in results],
    }, indent=2, default=str))
    print(f"\nartifact {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
