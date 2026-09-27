"""The Macro Data Registry: one record per series, and where every field came from.

The brief's requirement is that "the system should be able to explain exactly
where every input came from". That rules out a hand-written table. A person
typing two hundred records copies a frequency wrong, guesses a publication lag,
and leaves the units blank — and none of those errors surface until a factor
model has already been built on them.

So the registry is ASSEMBLED, from three sources that each own what they know:

  `ace.universe.families`   what a series is FOR — concept, family, sub-family,
                            data layer, whether it belongs in a factor model.
                            Editorial, and the only hand-written input.
  `ace.universe.probe`      what a series IS — title, frequency, units, seasonal
                            adjustment, observation range, last update, which
                            route serves it, and the publication lag MEASURED
                            from the vintage archive rather than read off a
                            release calendar.
  `ace.state.panel`         the transform code and the written rationale for the
                            89 series already in production. These were argued
                            for once and that argument is not re-derivable from
                            an API, so it is carried forward rather than lost.

`build()` merges them and writes `artifacts/reports/macro_registry.json`, which
is committed. `load()` reads that file, so importing the registry costs no
network call and a model fit cannot silently depend on the API being up.

WHY THE PANEL IS DERIVED FROM THIS AND NOT THE OTHER WAY ROUND

`ace.state.panel.PANEL` was the source of truth for the production panel, and it
stays the thing the factor model reads — nothing about its behaviour changes.
What changes is that its membership becomes ANSWERABLE: `eligible_for_panel()`
returns the registry records that pass the stated filter, and a test asserts the
two agree. A series in the panel with no registry record, or a record that
claims panel eligibility while sitting outside the panel, is a contradiction the
test catches rather than a discrepancy nobody notices.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ace.config import ROOT

REGISTRY_PATH = ROOT / "artifacts" / "reports" / "macro_registry.json"

#: FRED's own base for a human-readable series page. Stored per record so a
#: reader can get from a factor loading to the source documentation in one hop.
FRED_SERIES_URL = "https://fred.stlouisfed.org/series/{series_id}"

#: How a series is read. Mirrors `ace.state.panel.SeriesSpec.revised`, named
#: from the data's side rather than the fetch's: `alfred_first_release` is the
#: point-in-time archive, `standard_observation` is today's value, which is only
#: safe where today's value IS the first release.
ROUTES = ("alfred_first_release", "standard_observation", "unavailable")

#: What is known about how a series gets revised. `measured_*` values come from
#: comparing routes in `ace.state.route_check`; `archive_present` means a vintage
#: archive exists so revisions are handled regardless of their size; `unknown`
#: is recorded as unknown rather than assumed benign.
REVISION_BEHAVIOUR = (
    "archive_present",
    "measured_none",
    "measured_negligible",
    "measured_substantial",
    "unknown",
)


@dataclass(frozen=True)
class SeriesRecord:
    """One series, fully described. Every field has a stated origin."""

    # --- identity -----------------------------------------------------------
    series_id: str
    canonical_name: str
    source: str
    source_url: str

    # --- economic placement (from ace.universe.families) --------------------
    concept: str
    economic_category: str
    sub_category: str
    #: hard / soft / market / derived. Which panel views may include it.
    layer: str

    # --- measured properties (from ace.universe.probe) ----------------------
    frequency: str
    units: str
    seasonal_adjustment: str
    observation_start: str
    observation_end: str
    last_update: str
    availability_status: str
    route: str
    vintage_support: bool
    #: Median and 90th-percentile days from reference period to first
    #: publication, measured from the archive. None where no archive exists.
    release_lag_median_days: float | None = None
    release_lag_p90_days: float | None = None
    #: First observation the vintage archive covers, which is usually LATER
    #: than `observation_start` — the series may run to 1947 while its
    #: point-in-time history starts in 1997.
    vintage_start: str = ""
    #: Override for the archive REQUEST's start date, when the full archive
    #: from `ace.state.panel`'s default is unreachable. NFCI/ANFCI are the
    #: known case: requesting from 1980 gets a 504 from FRED's own server, and
    #: 2005 returns in seconds. Carried from `SeriesSpec.vintage_start` for a
    #: production-panel series; `ace.factors.universe_panel._to_spec` must read
    #: this back or the override is silently lost on every re-fetch.
    fetch_start_override: str = ""
    n_vintage_observations: int | None = None
    revision_behaviour: str = "unknown"

    # --- modelling -----------------------------------------------------------
    #: FRED-MD transform code. See `ace.state.transforms`.
    transformation: int = 5
    factor_eligible: bool = True
    #: True when this record is in the production factor panel today.
    in_production_panel: bool = False

    # --- redundancy (from ace.universe.duplicates) --------------------------
    redundancy_group: str = ""
    redundant_with: tuple[str, ...] = ()
    component_of: str = ""

    # --- provenance ---------------------------------------------------------
    #: Which of the three inputs supplied each non-obvious field, so a wrong
    #: value can be traced to the source that produced it.
    field_provenance: dict[str, str] = field(default_factory=dict)
    note: str = ""

    def __post_init__(self) -> None:
        if self.route not in ROUTES:
            raise ValueError(f"{self.series_id}: unknown route {self.route!r}")
        if self.revision_behaviour not in REVISION_BEHAVIOUR:
            raise ValueError(
                f"{self.series_id}: unknown revision behaviour "
                f"{self.revision_behaviour!r}"
            )
        # A record claiming the point-in-time route must have an archive behind
        # it. Letting these disagree is how a panel ends up reading revised data
        # while its metadata says otherwise.
        if self.route == "alfred_first_release" and not self.vintage_support:
            raise ValueError(
                f"{self.series_id}: claims the first-release route with "
                "vintage_support=False"
            )

    @property
    def usable(self) -> bool:
        return self.availability_status in ("vintage", "observation_only")

    def to_dict(self) -> dict:
        out = asdict(self)
        out["redundant_with"] = list(self.redundant_with)
        return out

    @classmethod
    def from_dict(cls, payload: dict) -> "SeriesRecord":
        data = dict(payload)
        data["redundant_with"] = tuple(data.get("redundant_with") or ())
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})


def load(path: Path | None = None) -> tuple[SeriesRecord, ...]:
    """Read the committed registry. No network, no API key.

    Raises rather than returning empty when the file is missing: a factor model
    silently fitting on nothing is worse than one that refuses to start.
    """
    target = path or REGISTRY_PATH
    if not target.exists():
        raise FileNotFoundError(
            f"{target} does not exist — run `python -m ace.universe.registry` "
            "to build it from the probe and the concept catalogue"
        )
    payload = json.loads(target.read_text())
    return tuple(SeriesRecord.from_dict(r) for r in payload["records"])


def by_id(records: tuple[SeriesRecord, ...] | None = None) -> dict[str, SeriesRecord]:
    return {r.series_id: r for r in (records if records is not None else load())}


def eligible_for_panel(
    records: tuple[SeriesRecord, ...] | None = None,
) -> tuple[SeriesRecord, ...]:
    """The registry's answer to "what should the factor panel contain".

    Four conditions, each of which has cost something to learn:

    1. `factor_eligible` — the concept catalogue's editorial judgement. Excludes
       demographic trends, which standardise to near-constant columns, and
       context series carried for interpretation only.
    2. `usable` — the probe reached observations. A series FRED describes but
       will not serve is not a panel member.
    3. enough vintage history to carry its transform, where a vintage archive is
       what the series needs. A 13-month rolling window cannot be modelled.
    4. a route that is safe for what the series is: the standard endpoint only
       where revisions were measured to be absent or negligible.

    The filter is a function rather than a stored flag so that changing it
    re-derives the panel instead of requiring 250 records to be re-edited.
    """
    out = []
    for record in (records if records is not None else load()):
        if not record.factor_eligible or not record.usable:
            continue
        if record.route == "standard_observation" and record.revision_behaviour not in (
            "measured_none", "measured_negligible"
        ):
            continue
        # A production-panel series was never re-probed for its vintage count —
        # doing so would re-pay for an answer the panel already relies on —
        # so `n_vintage_observations` is None for all 89 of them. Reading that
        # None as "0 observations" excluded every production series from its
        # own registry on the first build. Membership in the production panel
        # already means `ace.state.panel.build_asof` cleared this exact bar at
        # build time, so it stands in for the count here.
        if (
            record.route == "alfred_first_release"
            and not record.in_production_panel
            and (record.n_vintage_observations or 0) < 36
        ):
            continue
        out.append(record)
    return tuple(out)


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def _existing_panel_index() -> dict[str, dict]:
    """Transform codes and written rationale for the production panel.

    These are the one input that cannot be re-derived: `ace/state/panel.py`'s
    notes are an argument for why each series is present and what its transform
    means, and they were written once against measured behaviour.
    """
    from ace.state.panel import PANEL

    return {
        spec.series_id: {
            "code": spec.code,
            "note": spec.note,
            "label": spec.label,
            "group": spec.group,
            "revised": spec.revised,
            "frequency": spec.frequency,
            "typical_lag_days": spec.typical_lag_days,
            "vintage_start": spec.vintage_start or "",
        }
        for spec in PANEL
    }


def _probe_index() -> dict[str, dict]:
    probe_path = ROOT / "artifacts" / "reports" / "macro_universe_probe.json"
    if not probe_path.exists():
        return {}
    payload = json.loads(probe_path.read_text())
    return {r["series_id"]: r for r in payload.get("results", [])}


def _revision_behaviour(series_id: str, route: str) -> str:
    """What is known about this series' revisions, from measurement where it exists.

    `ace.state.route_check` writes two reports: a direct comparison against the
    first-release archive, and ALFRED as-of snapshots for the series that have no
    archive. Both are read here rather than re-run, and a series neither covers
    is recorded `unknown` — which `eligible_for_panel` then refuses to put on the
    standard-observation route.
    """
    if route == "alfred_first_release":
        return "archive_present"

    asof_path = ROOT / "artifacts" / "reports" / "macro_route_asof_check.json"
    if not asof_path.exists():
        return "unknown"
    payload = json.loads(asof_path.read_text())
    for row in payload.get("results", []):
        if row.get("series") != series_id:
            continue
        shares = [
            c["share_differing"] for c in row.get("checks", [])
            if "share_differing" in c
        ]
        if not shares:
            return "unknown"
        worst = max(shares)
        if worst == 0:
            return "measured_none"
        # 0.002 is `ace.state.panel.MAX_UNREVISED_DIVERGENCE`, set where the
        # measured population separates: the series kept on this route sit at
        # 0.0005-0.001, the one rejected sat at 0.91.
        return "measured_negligible" if worst <= 0.002 else "measured_substantial"
    return "unknown"


def build() -> tuple[tuple[SeriesRecord, ...], dict]:
    """Merge the three inputs into one record per reachable series."""
    from ace.universe.duplicates import build as build_redundancy
    from ace.universe.families import UNIVERSE
    from ace.universe.inventory import collect as collect_inventory

    panel = _existing_panel_index()
    probed = _probe_index()
    # `ace.data.fred_market` and `ace.news.indices` hold series the repository
    # already has and reads successfully, but they are not `ace.state.panel`
    # members. Treating only the factor panel as "held" made a market channel
    # the repo has used for years — WTI, EUR/USD, the uncertainty indices —
    # register as an unprobed gap. `held` covers every module the inventory
    # already knows how to read.
    held = {r.series_id: r for r in collect_inventory().rows}

    records: list[SeriesRecord] = []
    skipped: dict[str, str] = {}
    seen: set[str] = set()

    for concept in UNIVERSE:
        for series_id in concept.candidates:
            if series_id in seen:
                continue
            seen.add(series_id)

            in_panel = series_id in panel
            held_row = held.get(series_id)
            probe = probed.get(series_id, {})

            # A held series was never probed (that would re-pay for an answer
            # already in the repository), so its measured fields come from
            # whichever module defines it and the rest are recorded as unprobed
            # rather than invented.
            if not probe and not in_panel and held_row is None:
                skipped[series_id] = "neither probed nor held anywhere in the repository"
                continue

            status = probe.get("status") or (
                "vintage" if in_panel
                else "observation_only" if held_row is not None
                else "unknown"
            )
            if status in ("no_such_series", "metadata_only"):
                skipped[series_id] = status
                continue

            if in_panel:
                route = (
                    "alfred_first_release" if panel[series_id]["revised"]
                    else "standard_observation"
                )
            elif held_row is not None:
                # `ace.data.fred_market` reads the standard endpoint for every
                # series it defines; `ace.news.indices` likewise. Neither module
                # has an ALFRED branch today, so a held-but-not-panel series is
                # read as observation-only until proven otherwise.
                route = "standard_observation"
            else:
                route = (
                    "alfred_first_release" if status == "vintage"
                    else "standard_observation"
                )

            provenance = {
                "concept": "ace.universe.families",
                "economic_category": "ace.universe.families",
                "layer": "ace.universe.families",
                "factor_eligible": "ace.universe.families",
                "transformation": (
                    "ace.state.panel" if in_panel else "ace.universe.families"
                ),
                "note": "ace.state.panel" if in_panel else "ace.universe.families",
                "frequency": "ace.state.panel" if in_panel else "ace.universe.probe",
                "units": "ace.universe.probe" if probe else "unprobed",
                "release_lag_median_days": (
                    "ace.universe.probe" if probe.get("release_lag_median_days")
                    is not None else "ace.state.panel (documented, not measured)"
                ),
                "revision_behaviour": "ace.state.route_check",
            }

            records.append(SeriesRecord(
                series_id=series_id,
                canonical_name=(
                    probe.get("title")
                    or (panel.get(series_id, {}).get("label"))
                    or (held_row.label if held_row is not None else None)
                    or series_id
                ),
                source=concept.source,
                source_url=FRED_SERIES_URL.format(series_id=series_id),
                concept=concept.concept,
                economic_category=concept.family,
                sub_category=concept.sub_family,
                layer=concept.layer,
                frequency=(
                    panel[series_id]["frequency"] if in_panel
                    else held_row.frequency if held_row is not None and held_row.frequency
                    else _frequency_from(probe)
                ),
                units=probe.get("units", ""),
                seasonal_adjustment=probe.get("seasonal_adjustment", ""),
                observation_start=probe.get("observation_start", ""),
                observation_end=probe.get("observation_end", ""),
                last_update=probe.get("last_updated", ""),
                availability_status=status,
                route=route,
                vintage_support=route == "alfred_first_release",
                release_lag_median_days=(
                    probe.get("release_lag_median_days")
                    if probe.get("release_lag_median_days") is not None
                    else (float(panel[series_id]["typical_lag_days"]) if in_panel else None)
                ),
                release_lag_p90_days=probe.get("release_lag_p90_days"),
                vintage_start=probe.get("vintage_first_obs", ""),
                n_vintage_observations=probe.get("vintage_n"),
                revision_behaviour=_revision_behaviour(series_id, route),
                fetch_start_override=(
                    panel.get(series_id, {}).get("vintage_start", "") if in_panel else ""
                ),
                transformation=(
                    panel[series_id]["code"] if in_panel else concept.code
                ),
                factor_eligible=concept.factor_eligible,
                in_production_panel=in_panel,
                field_provenance=provenance,
                note=(panel[series_id]["note"] if in_panel else concept.note),
            ))

    # Redundancy needs every record present, so it runs last and the relations
    # are written back onto the records.
    payload = [
        {
            "series_id": r.series_id, "title": r.canonical_name, "units": r.units,
            "seasonal_adjustment": r.seasonal_adjustment, "concept": r.concept,
            "family": r.economic_category, "sub_family": r.sub_category,
            "component_of": r.component_of,
        }
        for r in records
    ]
    redundancy = build_redundancy(payload)
    partners: dict[str, set[str]] = {}
    for relation in redundancy.relations:
        partners.setdefault(relation.a, set()).add(relation.b)
        partners.setdefault(relation.b, set()).add(relation.a)

    final = tuple(
        SeriesRecord(**{
            **r.to_dict(),
            "redundant_with": tuple(sorted(partners.get(r.series_id, ()))),
            "redundancy_group": redundancy.groups.get(r.series_id, ""),
        })
        for r in records
    )

    meta = {
        "n_records": len(final),
        "skipped": skipped,
        "n_relations": len(redundancy.relations),
        "redundancy_groups": redundancy.group_members(),
        "relations": [asdict(x) for x in redundancy.relations],
    }
    return final, meta


def _frequency_from(probe: dict) -> str:
    """Map FRED's frequency code onto the panel's vocabulary."""
    return {
        "D": "daily", "W": "weekly", "BW": "weekly", "M": "monthly",
        "Q": "quarterly", "SA": "quarterly", "A": "quarterly",
    }.get(probe.get("frequency_short", ""), "monthly")


def main() -> None:
    records, meta = build()
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps({
        "n_records": len(records),
        "skipped": meta["skipped"],
        "n_redundancy_relations": meta["n_relations"],
        "redundancy_groups": meta["redundancy_groups"],
        "relations": meta["relations"],
        "records": [r.to_dict() for r in records],
    }, indent=2, sort_keys=True))

    eligible = eligible_for_panel(records)
    print(f"{len(records)} registry records, {len(eligible)} panel-eligible")
    print(f"{len(meta['skipped'])} candidates skipped")

    def tally(attribute):
        counts: dict[str, int] = {}
        for r in records:
            counts[str(getattr(r, attribute))] = counts.get(str(getattr(r, attribute)), 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

    for attribute in ("economic_category", "layer", "frequency", "route",
                      "availability_status", "revision_behaviour"):
        print(f"\nby {attribute}:")
        for key, count in tally(attribute).items():
            print(f"  {key:<26} {count:>4}")

    print(f"\n{meta['n_relations']} redundancy relations, "
          f"{len(meta['redundancy_groups'])} groups with more than one member")
    print(f"\nwrote {REGISTRY_PATH}")


if __name__ == "__main__":
    main()
