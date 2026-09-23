"""Resumable, paced GDELT backfill.

Resumable by construction: every day is cached under its own filter tag, so a
re-run skips what it already has and the job can be stopped and restarted
freely. Paced at GDELT's requested one request per five seconds.

Filtered at ingest rather than after. An unfiltered day is ~8MB and ~100,000
events, most of them low-mention routine coverage. Keeping only events above a
mention threshold stores the material ones — which are also the ones a cascade
or competing-risks model is about.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.config import ARTIFACTS
from ace.feeds.gdelt import FeedUnavailable, fetch_daily

OUT = ARTIFACTS / "gdelt"
OUT.mkdir(parents=True, exist_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill GDELT daily events")
    ap.add_argument("--start", default="2022-01-01")
    ap.add_argument("--end", default="2026-09-01")
    ap.add_argument("--min-mentions", type=int, default=10,
                    help="keep events with at least this many mentions")
    ap.add_argument("--quad", nargs="*", type=int, default=[3, 4],
                    help="CAMEO QuadClass: 1 verbal coop, 2 material coop, 3 verbal conflict, 4 material conflict")
    args = ap.parse_args()

    days = pd.date_range(args.start, args.end, freq="D")
    quad = tuple(args.quad) if args.quad else None
    print(f"GDELT backfill: {len(days)} days {args.start}..{args.end}")
    print(f"  filter: >={args.min_mentions} mentions, quad_class={quad or 'all'}")
    print(f"  pacing: 5s/request -> ~{len(days) * 5 / 3600:.1f}h if none are cached\n", flush=True)

    kept, failed, cached_hits = 0, 0, 0
    t0 = time.monotonic()
    for i, d in enumerate(days, 1):
        tag = d.strftime("%Y%m%d")
        before = time.monotonic()
        try:
            df = fetch_daily(tag, min_mentions=args.min_mentions, quad_classes=quad)
            kept += len(df)
            if time.monotonic() - before < 1.0:
                cached_hits += 1
        except FeedUnavailable as e:
            failed += 1
            print(f"  [{i}/{len(days)}] {tag} FAILED {str(e)[:70]}", flush=True)
            continue
        if i % 25 == 0 or i == len(days):
            rate = (time.monotonic() - t0) / i
            eta = rate * (len(days) - i) / 60
            print(f"  [{i}/{len(days)}] {tag}  kept {kept:,} events  "
                  f"cached {cached_hits}  failed {failed}  eta {eta:.0f}m", flush=True)

    print(f"\nbackfill complete: {kept:,} events kept, {failed} days failed")
    print(f"cache: {OUT.parent / 'cache'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
