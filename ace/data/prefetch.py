"""One-shot universe download into the local cache, politely paced."""
from __future__ import annotations

import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2]))

from ace.config import UNIVERSE
from ace.data.yahoo import DataUnavailable, bars


def main() -> int:
    ok, bad = [], []
    for i, t in enumerate(UNIVERSE, 1):
        try:
            df = bars(t, "10y")
            ok.append(t)
            print(f"[{i:>2}/{len(UNIVERSE)}] {t:<6} {len(df):>5} bars  {df.index.min().date()} -> {df.index.max().date()}", flush=True)
        except DataUnavailable as e:
            bad.append(t)
            print(f"[{i:>2}/{len(UNIVERSE)}] {t:<6} UNAVAILABLE: {str(e)[:60]}", flush=True)
        time.sleep(1.5)
    print(f"\ncached {len(ok)}/{len(UNIVERSE)}; unavailable: {bad or 'none'}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
