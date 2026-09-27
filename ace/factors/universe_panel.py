"""The comprehensive panel: every registry-eligible series, not a curated 89.

`ace.state.panel.PANEL` is a hand-picked 89-series basket, and it stays exactly
what it is — the production panel `ace.state.factors` fits today, unmodified by
anything in this module. What this module answers is the brief's actual
question: if the data is allowed to speak for itself rather than being chosen
in advance, how much LARGER is the panel, and does the extra breadth change
anything?

`ace.universe.registry.eligible_for_panel()` already applies the same safety
filters `ace.state.panel` argues for by hand — factor eligibility, a usable
route, enough vintage history, measured (not merely assumed) revision safety —
to every series in the 256-concept universe. This module's only job is to turn
those records into `SeriesSpec` objects and hand them to the SAME `load_vintages`
/ `build_asof` machinery the production panel uses. No parallel point-in-time
logic, no parallel mixed-frequency logic — reusing `ace.state.panel` is the
point, not a shortcut around building it properly.

DUPLICATE HANDLING

The registry records some series as `redundant_with` others. A factor model
fit on a correlation matrix cannot receive the same concept twice at full
weight without the first component turning into a description of the panel's
composition rather than of the economy. So this module picks ONE
representative per redundancy group for the DEFAULT comprehensive panel:

  1. prefer a series already validated in the production panel (`ace.state.panel`)
  2. else prefer the point-in-time route over the standard-observation route
  3. else prefer the deeper vintage history

The rule is applied, not assumed: `default_panel()` returns the choice made and
`WHY_CHOSEN` on each dropped duplicate, and `research_panel()` returns every
member so a PCA run can test whether the choice mattered.

Run: `python -m ace.factors.universe_panel`
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from ace.state.panel import SeriesSpec
from ace.universe.registry import SeriesRecord, eligible_for_panel, load


def _to_spec(record: SeriesRecord) -> SeriesSpec:
    """One registry record, in the shape `ace.state.panel.build_asof` reads.

    `SeriesSpec.group` takes the registry's `economic_category` — the target
    universe's family labels — rather than `ace.state.panel.GROUPS`, because a
    series like `FGCE` (fiscal) has no home in the five-to-nine block names the
    production panel was built around. `ace.state.factors._block_map` already
    reads block membership from `PanelBuild.groups`, which `build_asof` derives
    from whatever specs it is handed — so a wider set of block names here needs
    no change downstream.
    """
    return SeriesSpec(
        series_id=record.series_id,
        label=record.canonical_name,
        group=record.economic_category,
        code=record.transformation,
        typical_lag_days=int(round(record.release_lag_median_days or 0)),
        note=record.note or f"registry concept: {record.concept}",
        revised=record.route == "alfred_first_release",
        frequency=record.frequency,
        vintage_start=record.fetch_start_override or None,
    )


@dataclass(frozen=True)
class DuplicateChoice:
    group: str
    chosen: str
    dropped: tuple[str, ...]
    reason: str


#: A candidate whose newest observation is this many days behind "now" is
#: treated as discontinued for duplicate-resolution purposes, regardless of how
#: much HISTORY it has. Found by running the comprehensive panel through static
#: PCA: `PPIITM` (stopped 2015) and `IOER` (stopped 2021, superseded by `IORB`
#: the day after) were both chosen over their live successors because "deepest
#: vintage history" measures total observation COUNT, which a long-dead series
#: can still win on. A frozen column does not just fail to help a live factor
#: reading — at this panel's breadth it is exactly the kind of gap that crushed
#: static PCA's balanced-matrix requirement to zero usable rows (see
#: `ace.factors.pca`). 550 days is generous enough for an annual-cadence series
#: revised late without flagging normal lag as discontinuation.
STALE_AFTER_DAYS = 550


def _is_fresh(record: SeriesRecord, *, now: str | None = None) -> bool:
    """Best-effort freshness check from the registry's own `observation_end`.

    Returns True (assume fresh) when the field is blank — a production-panel
    series was never probed for it, and absence of evidence should not read as
    evidence of staleness for the one class of record that is already
    validated by its own membership in the panel.
    """
    if not record.observation_end:
        return True
    try:
        end = pd.Timestamp(record.observation_end)
    except (ValueError, TypeError):
        return True
    reference = pd.Timestamp(now) if now else pd.Timestamp.now()
    return bool((reference - end).days <= STALE_AFTER_DAYS)


def _pick_representative(
    members: tuple[str, ...], by_id: dict[str, SeriesRecord], *, now: str | None = None
) -> DuplicateChoice:
    """Rule 0-1-2-3 from the module docstring, applied and recorded."""
    fresh = [m for m in members if _is_fresh(by_id[m], now=now)]
    pool = fresh or list(members)  # if EVERY candidate is stale, don't return nothing
    stale_dropped = set(members) - set(pool)

    in_production = [m for m in pool if by_id[m].in_production_panel]
    if in_production:
        chosen = in_production[0]
        reason = "already validated in the production panel"
    else:
        vintage = [m for m in pool if by_id[m].route == "alfred_first_release"]
        candidates = vintage or pool
        chosen = max(candidates, key=lambda m: by_id[m].n_vintage_observations or 0)
        reason = (
            "point-in-time route, deepest vintage history"
            if vintage else "deepest observation history (no point-in-time route in this group)"
        )
    if stale_dropped:
        reason += f"; excluded as discontinued: {sorted(stale_dropped)}"
    dropped = tuple(m for m in members if m != chosen)
    label = by_id[chosen].redundancy_group or chosen
    return DuplicateChoice(group=label, chosen=chosen, dropped=dropped, reason=reason)


def resolve_duplicates(
    records: tuple[SeriesRecord, ...],
) -> tuple[tuple[SeriesRecord, ...], tuple[DuplicateChoice, ...]]:
    """One representative per redundancy group; everything else passes through."""
    by_id = {r.series_id: r for r in records}
    groups: dict[str, list[str]] = {}
    for r in records:
        if r.redundancy_group:
            groups.setdefault(r.redundancy_group, []).append(r.series_id)

    choices = tuple(
        _pick_representative(tuple(members), by_id)
        for members in groups.values()
        if len(members) > 1
    )
    drop = {sid for choice in choices for sid in choice.dropped}
    kept = tuple(r for r in records if r.series_id not in drop)
    return kept, choices


def default_panel() -> tuple[tuple[SeriesSpec, ...], tuple[DuplicateChoice, ...]]:
    """The comprehensive panel: registry-eligible, one series per concept-group."""
    eligible = eligible_for_panel(load())
    kept, choices = resolve_duplicates(eligible)
    return tuple(_to_spec(r) for r in kept), choices


def research_panel() -> tuple[SeriesSpec, ...]:
    """Every panel-eligible series, duplicates included — for PCA to test."""
    return tuple(_to_spec(r) for r in eligible_for_panel(load()))


def main() -> None:
    """Print the duplicate-resolution summary, then fetch and build the
    comprehensive panel live and write `macro_comprehensive_panel_build.json`.

    This is the reproducible entry point for that artifact — following
    `ace.state.panel.main()` and `ace.universe.registry.main()`'s own
    convention of a real module `main()` rather than a one-off scratch script,
    so the committed artifact cannot drift from what the current code actually
    produces the way an earlier version of it did (still showing `PPIITM` and
    `IOER` chosen over their live successors after the duplicate-resolution
    freshness fix landed, because nothing had re-run it).

    Run: `python -m ace.factors.universe_panel`
    """
    import json

    import pandas as pd

    from ace.config import ROOT
    from ace.state.panel import PANEL as PRODUCTION_PANEL, build_asof, load_vintages

    specs, choices = default_panel()
    research = research_panel()
    print(f"default panel:  {len(specs)} series")
    print(f"research panel: {len(research)} series (duplicates kept)")
    print(f"{len(choices)} duplicate groups resolved:\n")
    for c in choices:
        print(f"  {c.group:<40} kept {c.chosen:<16} dropped {c.dropped}  ({c.reason})")

    production_ids = {s.series_id for s in PRODUCTION_PANEL}
    new_ids = {s.series_id for s in specs} - production_ids
    print(f"\n{len(production_ids)} in the production panel today")
    print(f"{len(new_ids)} would be NEW if the comprehensive panel replaced it:")
    by_group: dict[str, list[str]] = {}
    for spec in specs:
        if spec.series_id in new_ids:
            by_group.setdefault(spec.group, []).append(spec.series_id)
    for group in sorted(by_group):
        print(f"  {group:<24} {len(by_group[group]):>3}  {' '.join(sorted(by_group[group]))}")

    print("\nfetching and building the comprehensive panel live...")
    vintages = load_vintages(specs)
    from ace.state.panel import LOAD_ERRORS
    if LOAD_ERRORS:
        print(f"{len(LOAD_ERRORS)} fetch failures:")
        for sid, why in sorted(LOAD_ERRORS.items()):
            print(f"  FAIL {sid:<20} {why[:100]}")

    now = pd.Timestamp.now(tz="UTC")
    build = build_asof(now, vintages, specs=specs)
    print(build.describe())
    if build.dropped:
        print(f"{len(build.dropped)} DROPPED:")
        for sid, why in sorted(build.dropped.items()):
            print(f"  {sid:<20} {why[:100]}")

    report = {
        "as_of": build.as_of,
        "n_panel": len(specs),
        "n_used": build.n_series,
        "n_monthly": build.n_monthly,
        "n_quarterly": build.n_quarterly,
        "groups": {k: list(v) for k, v in build.groups.items()},
        "dropped": build.dropped,
        "fetch_errors": dict(LOAD_ERRORS),
        "duplicate_choices": [
            {"group": c.group, "chosen": c.chosen, "dropped": list(c.dropped), "reason": c.reason}
            for c in choices
        ],
    }
    path = ROOT / "artifacts" / "reports" / "macro_comprehensive_panel_build.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True))
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
