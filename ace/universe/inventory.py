"""What macro data Ripple already holds — collected from the code, not transcribed.

Phase 2 of the factor-engine brief asks for a machine-readable inventory of
every macroeconomic series in the repository, broken down by source, category,
frequency, vintage capability and history. The point of generating it by
IMPORTING the definitions rather than by listing them in a document is that the
inventory cannot drift away from the code: add a series to `ace/state/panel.py`
and it appears here on the next run, whether or not anyone remembered to.

Five places define macro or market series today, and they were built for
different jobs:

  `ace/state/panel.py`        the point-in-time factor panel (89 series)
  `ace/macro/quads.py`        the growth/inflation quad basket (8 series)
  `ace/data/fred_market.py`   daily cross-asset market channels (16 series)
  `ace/news/indices.py`       uncertainty and attention indices (5 series)
  `ace/datasets/…`            event-impact release keys, drawn from the above

Overlap between them is expected and is reported rather than resolved here:
which representation a factor model should use is a research question, and
`ace/universe/duplicates.py` is where it gets answered.

Run: `python -m ace.universe.inventory`
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

from ace.config import ROOT


@dataclass(frozen=True)
class InventoryRow:
    """One series as some module in the repository currently defines it."""

    series_id: str
    label: str
    #: Module that owns the definition, as an import path.
    defined_in: str
    #: What that module uses it for. Not an economic category — the same series
    #: can be a factor input in one place and a reaction channel in another.
    role: str
    category: str = ""
    frequency: str = ""
    transform_code: int | None = None
    #: Does the owning module read this through a point-in-time archive?
    vintage_support: bool | None = None
    typical_lag_days: int | None = None
    note: str = ""


def _from_panel() -> list[InventoryRow]:
    from ace.state.panel import PANEL

    return [
        InventoryRow(
            series_id=s.series_id,
            label=s.label,
            defined_in="ace.state.panel",
            role="factor_panel",
            category=s.group,
            frequency=s.frequency,
            transform_code=s.code,
            vintage_support=s.revised,
            typical_lag_days=s.typical_lag_days,
            note=s.note,
        )
        for s in PANEL
    ]


def _from_quads() -> list[InventoryRow]:
    from ace.macro.quads import SERIES as QUAD_SERIES

    rows = []
    for s in QUAD_SERIES:
        # The quad specs predate the factor panel and carry a different shape;
        # read defensively by name so this does not break if either moves.
        rows.append(
            InventoryRow(
                series_id=s.series_id,
                label=getattr(s, "label", s.series_id),
                defined_in="ace.macro.quads",
                role="quad_basket",
                category=getattr(s, "axis", getattr(s, "group", "")),
                frequency="monthly",
                vintage_support=True,  # the quad model is ALFRED-only by design
                typical_lag_days=getattr(s, "typical_lag_days", None),
                note=getattr(s, "note", ""),
            )
        )
    return rows


def _from_market() -> list[InventoryRow]:
    from ace.data.fred_market import LEVEL_SERIES, MARKET_SERIES

    return [
        InventoryRow(
            series_id=series_id,
            label=channel,
            defined_in="ace.data.fred_market",
            role="market_channel",
            category="market",
            frequency="daily",
            # This module reads the standard endpoint. For a market quote that
            # is the first release; `ace.state.route_check` measures it.
            vintage_support=False,
            typical_lag_days=0,
            note="quoted as a level/spread" if channel in LEVEL_SERIES else "price level",
        )
        for channel, series_id in MARKET_SERIES.items()
    ]


def _from_news() -> list[InventoryRow]:
    from ace.news.indices import DAILY_NEWS_SERIES, MONTHLY_NEWS_SERIES

    rows = []
    for frequency, mapping in (
        ("daily", DAILY_NEWS_SERIES), ("monthly", MONTHLY_NEWS_SERIES)
    ):
        rows.extend(
            InventoryRow(
                series_id=series_id,
                label=name,
                defined_in="ace.news.indices",
                role="uncertainty_index",
                category="surveys_expectations",
                frequency=frequency,
                vintage_support=False,
                note="constructed index, not a government statistic",
            )
            for name, series_id in mapping.items()
        )
    return rows


COLLECTORS = {
    "ace.state.panel": _from_panel,
    "ace.macro.quads": _from_quads,
    "ace.data.fred_market": _from_market,
    "ace.news.indices": _from_news,
}


@dataclass
class Inventory:
    """Every definition found, and the cross-module overlap between them."""

    rows: list[InventoryRow] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)

    @property
    def unique_series(self) -> set[str]:
        return {r.series_id for r in self.rows}

    def by(self, attribute: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for row in self.rows:
            key = str(getattr(row, attribute, "") or "unset")
            counts[key] = counts.get(key, 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

    def shared(self) -> dict[str, list[str]]:
        """Series defined in more than one module, and where.

        Not a defect list. `CPIAUCSL` is legitimately a factor input, a quad
        axis member and an event-impact key at the same time. It matters because
        a factor panel that silently contains the same concept twice will load
        on it twice.
        """
        where: dict[str, list[str]] = {}
        for row in self.rows:
            where.setdefault(row.series_id, []).append(row.defined_in)
        return {k: v for k, v in sorted(where.items()) if len(v) > 1}


def collect() -> Inventory:
    """Import every definition site and record what it holds.

    A module that cannot be imported is recorded by name rather than skipped: an
    inventory that silently omits a source is worse than no inventory, because
    the gap analysis built on it would report absent data as missing from the
    economy rather than missing from the audit.
    """
    inventory = Inventory()
    for module, collector in COLLECTORS.items():
        try:
            inventory.rows.extend(collector())
        except Exception as exc:  # noqa: BLE001 — an unreadable source is a finding
            inventory.errors[module] = f"{type(exc).__name__}: {exc}"
    return inventory


def main() -> None:
    inventory = collect()
    print(
        f"{len(inventory.rows)} definitions across {len(COLLECTORS)} modules, "
        f"{len(inventory.unique_series)} unique series"
    )
    if inventory.errors:
        print("\nCOULD NOT READ:")
        for module, why in inventory.errors.items():
            print(f"  {module}: {why}")

    for attribute in ("defined_in", "role", "category", "frequency"):
        print(f"\nby {attribute}:")
        for key, count in inventory.by(attribute).items():
            print(f"  {key:<28} {count:>3}")

    shared = inventory.shared()
    print(f"\ndefined in more than one module: {len(shared)}")
    for series_id, modules in shared.items():
        print(f"  {series_id:<16} {', '.join(modules)}")

    report = ROOT / "artifacts" / "reports" / "macro_data_inventory.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({
        "n_definitions": len(inventory.rows),
        "n_unique_series": len(inventory.unique_series),
        "modules": list(COLLECTORS),
        "read_errors": inventory.errors,
        "by_module": inventory.by("defined_in"),
        "by_role": inventory.by("role"),
        "by_category": inventory.by("category"),
        "by_frequency": inventory.by("frequency"),
        "vintage_support": inventory.by("vintage_support"),
        "multi_module_series": shared,
        "rows": [asdict(r) for r in inventory.rows],
    }, indent=2, sort_keys=True))
    print(f"\nwrote {report}")


if __name__ == "__main__":
    main()
