"""Does the unrevised fetch route actually return first releases?

`SeriesSpec.revised=False` sends a series to FRED's standard endpoint, which
returns the CURRENT value — every later revision included. The panel takes that
route for a dozen daily market series on the argument that a market close is
never revised, so the current value IS the first release.

That is an argument. This module turns it into a measurement, and the
measurement has already overruled the argument once: the broad trade-weighted
dollar index looks exactly like a quote and disagrees with its own archive on
91% of overlapping days, because the H.10 basket weights are re-estimated
annually and applied backwards. It is now read from the archive.

TWO CHECKS, BECAUSE NEITHER COVERS EVERYTHING

`archive_agreement` compares the standard endpoint against ALFRED's
first-release archive, observation date by observation date. It is the direct
comparison, and it only runs where ALFRED serves an archive at all — which for
most of this route it does not.

`asof_agreement` asks ALFRED a different question that the same series DO
answer: `realtime_start=realtime_end=<past date>` returns the series as it stood
on that date. If a value is the same then as now, nothing was revised in
between. Two snapshots, years apart, so a revision anywhere in the window shows.

Both write to artifacts/reports/, and `ace/tests/test_state.py` reads the
as-of report back: a series may not sit on the unrevised route without a record
there showing it below `MAX_UNREVISED_DIVERGENCE`, or a written reason in
`UNVERIFIABLE_ROUTE` for why no check can run.

Run: `python -m ace.state.route_check`
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from ace.config import ROOT
from ace.data.alfred import MacroUnavailable, _get, release_history, unrevised_history
from ace.state.panel import PANEL, PANEL_BY_ID, UNVERIFIABLE_ROUTE

#: Series the panel reads via the unrevised route that ALFRED also archives, so
#: the direct comparison is available. Small by construction: where ALFRED has
#: an archive, the panel normally just uses it.
ARCHIVE_COMPARABLE: tuple[str, ...] = ("BAMLH0A0HYM2",)

#: Revised series at the same daily or weekly frequency. The control group: if
#: these agreed too, the route distinction would be decoration rather than a
#: guard, and the whole exercise would prove nothing.
REVISED_CONTROLS: tuple[str, ...] = (
    "ICSA", "CCSA", "WALCL", "MORTGAGE30US", "TOTCI", "STLFSI4", "DTWEXBGS",
)

#: How far back to take the as-of snapshots. Two of them, years apart, so a
#: revision anywhere in the window is caught rather than only a recent one.
ASOF_DATES: tuple[str, ...] = ("2023-01-03", "2025-01-02")

#: Observation window for the as-of comparison. Recent enough that every series
#: on this route covers it, including the ones under a rolling licence.
ASOF_OBSERVATION_START = "2015-01-01"

REPORTS = ROOT / "artifacts" / "reports"


def _first_release(series_id: str, start: str) -> pd.Series:
    """First published value per observation date, from the vintage archive."""
    hist = release_history(series_id, start).set_index("obs_date")["value"]
    return hist.groupby(level=0).first().astype(float)


def _current(series_id: str, start: str) -> pd.Series:
    """The series as the standard endpoint returns it today."""
    plain = unrevised_history(series_id, start).set_index("obs_date")["value"]
    return plain.groupby(level=0).first().astype(float)


def _snapshot(series_id: str, as_of: str | None, start: str) -> pd.Series:
    """The series as it stood on `as_of`, or today when `as_of` is None.

    Goes through `_get` rather than `release_history` deliberately: the archive
    request (`output_type=4`) is exactly what 400s for these series, while the
    as-of request is a different query that they answer.
    """
    params = {"series_id": series_id, "observation_start": start}
    if as_of is not None:
        params["realtime_start"] = as_of
        params["realtime_end"] = as_of
    payload = _get("series/observations", params)
    rows = [r for r in (payload.get("observations") or []) if r.get("value") != "."]
    if not rows:
        raise MacroUnavailable(f"{series_id}: nothing returned for as_of={as_of}")
    frame = pd.DataFrame(rows)
    out = pd.Series(
        pd.to_numeric(frame["value"], errors="coerce").values,
        index=pd.to_datetime(frame["date"], utc=True),
    ).dropna()
    return out.groupby(level=0).first().astype(float)


def _compare(reference: pd.Series, candidate: pd.Series) -> dict:
    """How far apart two readings of the same series are, on shared dates."""
    common = reference.index.intersection(candidate.index)
    if len(common) == 0:
        return {"status": "no overlapping observation dates"}
    a, b = reference.loc[common], candidate.loc[common]
    diff = (b - a).abs()
    # Relative as well as absolute, so a spread in basis points and an index in
    # thousands are comparable. The zero denominator is masked rather than
    # dropped, so a genuinely-zero reference does not silently vanish.
    denom = a.abs().where(a.abs() > 1e-12, np.nan)
    rel = (diff / denom).dropna()
    changed = int((diff > 1e-9).sum())
    return {
        "n_overlapping": int(len(common)),
        "first_overlap": str(pd.Timestamp(common.min()).date()),
        "last_overlap": str(pd.Timestamp(common.max()).date()),
        "n_values_differing": changed,
        "share_differing": round(changed / len(common), 6),
        "max_abs_diff": float(diff.max()),
        "median_abs_diff_of_changed": (
            float(diff[diff > 1e-9].median()) if changed else 0.0
        ),
        "max_rel_diff": float(rel.max()) if len(rel) else None,
    }


def archive_agreement(start: str = "1980-01-01") -> dict:
    """Standard endpoint vs first-release archive, where both exist."""
    results = []
    for series_id in ARCHIVE_COMPARABLE + REVISED_CONTROLS:
        spec = PANEL_BY_ID.get(series_id)
        expected_identical = series_id in ARCHIVE_COMPARABLE
        try:
            row = _compare(_first_release(series_id, start), _current(series_id, start))
        except Exception as exc:  # noqa: BLE001 — an unreachable series is data
            row = {"status": f"unavailable: {type(exc).__name__}: {exc}"}
        row.update({
            "series": series_id,
            "label": spec.label if spec else series_id,
            "frequency": spec.frequency if spec else "unknown",
            "panel_route": (
                "unrevised_observation" if spec and not spec.revised
                else "alfred_first_release"
            ),
            "expected_identical": expected_identical,
        })
        identical = row.get("n_values_differing") == 0
        if "status" in row:
            row["verdict"] = row["status"]
        elif identical and expected_identical:
            row["verdict"] = "identical, as the unrevised route assumes"
        elif identical:
            row["verdict"] = (
                "identical although read from the archive — the safer route "
                "costs nothing here, so it stays"
            )
        elif expected_identical:
            row["verdict"] = "DIFFERS — the unrevised route would have leaked here"
        else:
            row["verdict"] = "differs, as expected: revised=True is load-bearing"
        results.append(row)
    return {
        "generated": str(pd.Timestamp.now(tz="UTC").date()),
        "question": (
            "Does FRED's standard endpoint return the first release for a "
            "never-revised series, and does it fail to for a revised one?"
        ),
        "unrevised_route_series": list(ARCHIVE_COMPARABLE),
        "revised_control_series": list(REVISED_CONTROLS),
        "results": results,
    }


def asof_agreement(
    as_of_dates: tuple[str, ...] = ASOF_DATES,
    observation_start: str = ASOF_OBSERVATION_START,
) -> dict:
    """Today's values vs the same series as it stood at each past snapshot."""
    results = []
    for spec in PANEL:
        if spec.revised:
            continue
        series_id = spec.series_id
        row: dict = {"series": series_id, "label": spec.label, "checks": []}
        try:
            now = _snapshot(series_id, None, observation_start)
        except Exception as exc:  # noqa: BLE001
            row["status"] = f"current fetch failed: {type(exc).__name__}: {exc}"
            row["verdict"] = row["status"]
            results.append(row)
            continue
        for as_of in as_of_dates:
            try:
                then = _snapshot(series_id, as_of, observation_start)
            except Exception as exc:  # noqa: BLE001
                row["checks"].append(
                    {"as_of": as_of, "status": f"unavailable: {type(exc).__name__}: {exc}"}
                )
                continue
            check = _compare(then, now)
            check["as_of"] = as_of
            row["checks"].append(check)
        measured = [c for c in row["checks"] if "share_differing" in c]
        if not measured:
            row["verdict"] = (
                "unverifiable from this API"
                + (f": {UNVERIFIABLE_ROUTE[series_id]}" if series_id in UNVERIFIABLE_ROUTE else "")
            )
        elif any(c["n_values_differing"] for c in measured):
            worst = max(c["share_differing"] for c in measured)
            row["verdict"] = f"revised on {worst:.3%} of observations"
        else:
            row["verdict"] = "unrevised across every snapshot checked"
        results.append(row)
    return {
        "generated": str(pd.Timestamp.now(tz="UTC").date()),
        "method": (
            "ALFRED as-of query (realtime_start=realtime_end=<date>) compared "
            "against the current standard endpoint, on observation dates "
            "present in both. Any difference is a revision in between."
        ),
        "as_of_dates": list(as_of_dates),
        "observation_start": observation_start,
        "results": results,
    }


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)

    archive = archive_agreement()
    path = REPORTS / "macro_route_verification.json"
    path.write_text(json.dumps(archive, indent=2, sort_keys=True))
    print(f"ARCHIVE COMPARISON -> {path}")
    for row in archive["results"]:
        print(f"  {row['series']:<16} {row['verdict']}")

    asof = asof_agreement()
    path = REPORTS / "macro_route_asof_check.json"
    path.write_text(json.dumps(asof, indent=2, sort_keys=True))
    print(f"\nAS-OF SNAPSHOTS -> {path}")
    for row in asof["results"]:
        print(f"  {row['series']:<16} {row['verdict']}")


if __name__ == "__main__":
    main()
