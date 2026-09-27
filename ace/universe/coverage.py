"""What the target universe asks for, against what Ripple already holds.

Phase 2's second half. `ace.universe.inventory` says what exists,
`ace.universe.families` says what should exist, and this compares them at the
level of CONCEPTS rather than series ids — because a gap list of ids answers a
question about FRED's naming, and a gap list of concepts answers a question
about the economy.

A concept counts as covered when any of its candidate series is already defined
somewhere in the repository. That is deliberately generous: a series defined in
`ace.data.fred_market` as a reaction channel is not yet a factor input, but the
DATA is present and acquiring it again would be the duplication the brief
forbids. Coverage here means "Ripple has this number"; whether the factor panel
uses it is a separate decision made in `ace.factors.panels`.

Run: `python -m ace.universe.coverage`
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from ace.config import ROOT
from ace.universe.families import BY_FAMILY, FAMILIES, UNIVERSE, Concept
from ace.universe.inventory import collect


@dataclass(frozen=True)
class ConceptCoverage:
    """One concept, and whether anything in the repository serves it."""

    concept: Concept
    #: Candidates that are already defined somewhere, in preference order.
    present: tuple[str, ...]
    #: Where each present candidate is defined.
    defined_in: dict[str, list[str]] = field(default_factory=dict)

    @property
    def covered(self) -> bool:
        return bool(self.present)

    @property
    def best(self) -> str | None:
        """The most-preferred candidate that is present, if any."""
        return self.present[0] if self.present else None

    @property
    def preferred_missing(self) -> bool:
        """Covered, but by a substitute rather than by the preferred series.

        Worth separating from an outright gap: it is a smaller problem and a
        different one. It means the concept is measured, possibly less well.
        """
        return self.covered and self.present[0] != self.concept.candidates[0]


def assess() -> tuple[list[ConceptCoverage], dict]:
    inventory = collect()
    where: dict[str, list[str]] = {}
    for row in inventory.rows:
        where.setdefault(row.series_id, []).append(row.defined_in)

    out: list[ConceptCoverage] = []
    for concept in UNIVERSE:
        present = tuple(s for s in concept.candidates if s in where)
        out.append(
            ConceptCoverage(
                concept=concept,
                present=present,
                defined_in={s: sorted(set(where[s])) for s in present},
            )
        )

    # Series Ripple holds that the target universe never asks for. Not waste —
    # it is where the universe is incomplete, or where a series is used for
    # something other than macro state (an event-impact key, a reaction
    # channel). Reported so the universe can be corrected rather than trusted.
    claimed = {s for c in UNIVERSE for s in c.candidates}
    unclaimed = sorted(set(where) - claimed)

    meta = {
        "n_series_held": len(where),
        "n_concepts": len(UNIVERSE),
        "unclaimed_series": {s: sorted(set(where[s])) for s in unclaimed},
    }
    return out, meta


def main() -> None:
    coverage, meta = assess()
    by_id = {c.concept.concept: c for c in coverage}

    covered = [c for c in coverage if c.covered]
    gaps = [c for c in coverage if not c.covered]
    substitutes = [c for c in covered if c.preferred_missing]

    print(f"{len(covered)}/{len(coverage)} concepts covered by the "
          f"{meta['n_series_held']} series Ripple already holds "
          f"({len(covered) / len(coverage):.0%})")
    print(f"{len(gaps)} concepts have no series at all")
    print(f"{len(substitutes)} are covered by a substitute rather than the preferred series")

    print(f"\n{'family':<24}{'concepts':>9}{'covered':>9}{'gap':>6}  coverage")
    print("-" * 62)
    rows = []
    for family in FAMILIES:
        members = BY_FAMILY[family]
        n_cov = sum(1 for m in members if by_id[m.concept].covered)
        share = n_cov / len(members) if members else 0.0
        bar = "#" * int(round(share * 20))
        print(f"{family:<24}{len(members):>9}{n_cov:>9}{len(members) - n_cov:>6}  "
              f"{bar:<20} {share:>4.0%}")
        rows.append({
            "family": family,
            "n_concepts": len(members),
            "n_covered": n_cov,
            "n_gap": len(members) - n_cov,
            "coverage": round(share, 4),
        })

    print("\nGAPS, by family:")
    for family in FAMILIES:
        missing = [m for m in BY_FAMILY[family] if not by_id[m.concept].covered]
        if not missing:
            continue
        print(f"\n  {family} ({len(missing)})")
        for m in missing:
            flag = "" if m.factor_eligible else "  [not factor-eligible]"
            print(f"    {m.concept:<46} {'|'.join(m.candidates)}{flag}")

    if meta["unclaimed_series"]:
        print(f"\nHELD BUT NOT IN THE TARGET UNIVERSE ({len(meta['unclaimed_series'])}):")
        for series_id, modules in meta["unclaimed_series"].items():
            print(f"  {series_id:<20} {', '.join(modules)}")

    report = ROOT / "artifacts" / "reports" / "macro_universe_coverage.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({
        "n_concepts": len(coverage),
        "n_covered": len(covered),
        "n_gap": len(gaps),
        "n_covered_by_substitute": len(substitutes),
        "by_family": rows,
        "unclaimed_series": meta["unclaimed_series"],
        "concepts": [
            {
                "concept": c.concept.concept,
                "family": c.concept.family,
                "sub_family": c.concept.sub_family,
                "layer": c.concept.layer,
                "code": c.concept.code,
                "vintage_matters": c.concept.vintage_matters,
                "factor_eligible": c.concept.factor_eligible,
                "candidates": list(c.concept.candidates),
                "present": list(c.present),
                "defined_in": c.defined_in,
                "covered": c.covered,
                "covered_by_substitute": c.preferred_missing,
                "note": c.concept.note,
            }
            for c in coverage
        ],
    }, indent=2, sort_keys=True))
    print(f"\nwrote {report}")


if __name__ == "__main__":
    main()
