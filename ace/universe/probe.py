"""Measure what each candidate series actually is, before anything relies on it.

The registry's promise — "the system should be able to explain exactly where
every input came from" — cannot be met by writing metadata down from memory.
FRED knows a series' title, frequency, units, seasonal adjustment, observation
range and last update; ALFRED knows whether a first-release archive exists and
how deep it goes. This asks both, per series, and records the answer including
the failures.

WHY THE FAILURES MATTER AS MUCH AS THE SUCCESSES

An earlier sweep of this codebase recorded sixteen series as unavailable. Two
were misspelled FRED-MD internal names, eleven were daily market quotes for
which ALFRED correctly returns 400 because there is nothing to archive, two were
a server-side timeout that a narrower request walks around, and exactly one was
genuinely absent. "Unavailable" had been doing four different jobs. So this
probe distinguishes them:

  `no_such_series`      FRED has no metadata under that id at all
  `metadata_only`       the series exists but neither route returns observations
  `vintage`             ALFRED serves a first-release archive
  `observation_only`    only the standard endpoint answers
  `licence_limited`     it answers, with a rolling window too short to use

THE MEASURED PUBLICATION LAG

`release_lag` is computed from the archive — median and 90th percentile days
between an observation's reference date and the date it was first published —
rather than taken from a release calendar. A calendar says when a release is
scheduled; the archive says when the number actually appeared, which is what a
point-in-time panel has to key off.

Run: `python -m ace.universe.probe`            (all uncovered candidates)
     `python -m ace.universe.probe --all`      (every candidate, including held)
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from ace.config import ROOT
from ace.data.alfred import _get
from ace.universe.families import UNIVERSE, concepts_for

#: Observation start for every probe. Deep enough to see whether a series has
#: real history, shallow enough that the archive requests come back.
PROBE_START = "1980-01-01"

#: Below this many first-release observations a series cannot carry a transform
#: plus a usable sample, so it is flagged rather than silently admitted.
#: Matches `ace.state.panel.MIN_USABLE_OBS`.
MIN_USABLE = 36


@dataclass
class ProbeResult:
    """Everything the APIs will say about one candidate series."""

    series_id: str
    status: str
    # --- metadata, from FRED's `series` endpoint ----------------------------
    title: str = ""
    frequency: str = ""
    frequency_short: str = ""
    units: str = ""
    units_short: str = ""
    seasonal_adjustment: str = ""
    observation_start: str = ""
    observation_end: str = ""
    last_updated: str = ""
    popularity: int | None = None
    notes_excerpt: str = ""
    # --- what the routes returned ------------------------------------------
    vintage_available: bool = False
    vintage_n: int | None = None
    vintage_first_obs: str = ""
    vintage_last_obs: str = ""
    vintage_first_published: str = ""
    observation_available: bool = False
    observation_n: int | None = None
    observation_first: str = ""
    observation_last: str = ""
    # --- measured, not looked up -------------------------------------------
    release_lag_median_days: float | None = None
    release_lag_p90_days: float | None = None
    #: Distinct first-publication dates per observation. A series revised in
    #: place shows fewer publication dates than observations.
    n_publication_dates: int | None = None
    errors: dict[str, str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.errors is None:
            self.errors = {}


def _metadata(series_id: str, result: ProbeResult) -> bool:
    try:
        payload = _get("series", {"series_id": series_id})
    except Exception as exc:  # noqa: BLE001
        result.errors["metadata"] = f"{type(exc).__name__}: {str(exc)[:120]}"
        return False
    rows = payload.get("seriess") or []
    if not rows:
        result.errors["metadata"] = "no series returned"
        return False
    meta = rows[0]
    result.title = meta.get("title", "")
    result.frequency = meta.get("frequency", "")
    result.frequency_short = meta.get("frequency_short", "")
    result.units = meta.get("units", "")
    result.units_short = meta.get("units_short", "")
    result.seasonal_adjustment = meta.get("seasonal_adjustment", "")
    result.observation_start = meta.get("observation_start", "")
    result.observation_end = meta.get("observation_end", "")
    result.last_updated = (meta.get("last_updated", "") or "")[:19]
    try:
        result.popularity = int(meta.get("popularity"))
    except (TypeError, ValueError):
        result.popularity = None
    result.notes_excerpt = (meta.get("notes", "") or "")[:280]
    return True


def _vintage(series_id: str, result: ProbeResult) -> None:
    try:
        payload = _get("series/observations", {
            "series_id": series_id,
            "observation_start": PROBE_START,
            "realtime_start": PROBE_START,
            "realtime_end": "9999-12-31",
            "output_type": "4",  # first release only
        })
    except Exception as exc:  # noqa: BLE001
        result.errors["vintage"] = f"{type(exc).__name__}: {str(exc)[:120]}"
        return
    rows = [r for r in (payload.get("observations") or []) if r.get("value") != "."]
    if not rows:
        result.errors["vintage"] = "empty archive"
        return
    frame = pd.DataFrame(rows)
    obs = pd.to_datetime(frame["date"], utc=True)
    pub = pd.to_datetime(frame["realtime_start"], utc=True)
    lag = (pub - obs).dt.days
    result.vintage_available = True
    result.vintage_n = int(len(rows))
    result.vintage_first_obs = str(obs.min().date())
    result.vintage_last_obs = str(obs.max().date())
    result.vintage_first_published = str(pub.min().date())
    result.release_lag_median_days = float(np.median(lag))
    result.release_lag_p90_days = float(np.percentile(lag, 90))
    result.n_publication_dates = int(pub.nunique())


def _observations(series_id: str, result: ProbeResult) -> None:
    try:
        payload = _get("series/observations", {
            "series_id": series_id, "observation_start": PROBE_START,
        })
    except Exception as exc:  # noqa: BLE001
        result.errors["observations"] = f"{type(exc).__name__}: {str(exc)[:120]}"
        return
    rows = [r for r in (payload.get("observations") or []) if r.get("value") != "."]
    if not rows:
        result.errors["observations"] = "no observations"
        return
    result.observation_available = True
    result.observation_n = int(len(rows))
    result.observation_first = rows[0]["date"]
    result.observation_last = rows[-1]["date"]


def _classify(result: ProbeResult, had_metadata: bool) -> str:
    """One status per series, so "unavailable" stops doing several jobs at once."""
    if not had_metadata:
        return "no_such_series"
    if result.vintage_available:
        if (result.vintage_n or 0) < MIN_USABLE:
            return "licence_limited"
        return "vintage"
    if result.observation_available:
        if (result.observation_n or 0) < MIN_USABLE:
            return "licence_limited"
        return "observation_only"
    return "metadata_only"


def probe_one(series_id: str) -> ProbeResult:
    result = ProbeResult(series_id=series_id, status="unknown")
    had_metadata = _metadata(series_id, result)
    if had_metadata:
        _vintage(series_id, result)
        if not result.vintage_available:
            _observations(series_id, result)
    result.status = _classify(result, had_metadata)
    return result


def targets(include_held: bool = False) -> list[str]:
    """Candidate ids worth probing, in a stable order.

    By default only the candidates for concepts nothing already serves — the
    held series have been exercised by the existing panel and re-probing them
    costs API calls for an answer already in the repository.
    """
    from ace.universe.coverage import assess

    coverage, _ = assess()
    out: list[str] = []
    for entry in coverage:
        if entry.covered and not include_held:
            continue
        for series_id in entry.concept.candidates:
            if series_id not in out:
                out.append(series_id)
    return out


def main() -> None:
    include_held = "--all" in sys.argv
    ids = targets(include_held=include_held)
    print(f"probing {len(ids)} candidate series "
          f"({'every candidate' if include_held else 'uncovered concepts only'})\n")

    results: list[ProbeResult] = []
    for n, series_id in enumerate(ids, 1):
        result = probe_one(series_id)
        results.append(result)
        detail = (
            f"n={result.vintage_n} {result.vintage_first_obs}.. "
            f"lag={result.release_lag_median_days:.0f}d"
            if result.vintage_available else
            f"n={result.observation_n} {result.observation_first}.."
            if result.observation_available else
            "; ".join(result.errors.values())[:80]
        )
        print(f"[{n:>3}/{len(ids)}] {series_id:<22} {result.status:<18} "
              f"{result.frequency_short:<3} {detail}", flush=True)

    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    print("\nby status:")
    for status, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {status:<20} {count:>4}")

    report = ROOT / "artifacts" / "reports" / "macro_universe_probe.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({
        "probe_start": PROBE_START,
        "min_usable_observations": MIN_USABLE,
        "include_held": include_held,
        "n_probed": len(results),
        "by_status": counts,
        "results": [
            {**asdict(r),
             "serves_concepts": [c.concept for c in concepts_for(r.series_id)]}
            for r in results
        ],
    }, indent=2, sort_keys=True, default=str))
    print(f"\nwrote {report}")


if __name__ == "__main__":
    main()
