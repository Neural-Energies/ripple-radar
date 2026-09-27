"""The Macro Data Registry, and the modules that feed it.

Three failure modes matter here, and none of them look wrong in the output:

1. The registry silently omits a series that is actually reachable (undercounts
   the universe, which contradicts "comprehensive").
2. The registry silently ADMITS a series that cannot be reached, or claims a
   point-in-time route it does not have (overcounts, which is the more
   dangerous direction — a factor model would fit on it).
3. The redundancy detector groups two genuinely different quantities together,
   or misses two copies of the same one.

Real API access is not required: `ace.universe.families` and
`ace.universe.duplicates` are pure, and `ace.universe.registry` is tested here
against small, hand-built probe/inventory fixtures rather than live data.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.universe.families import (
    FAMILIES,
    LAYERS,
    UNIVERSE,
    Concept,
    all_candidate_ids,
    concepts_for,
)
from ace.universe.duplicates import (
    NEAR_DUPLICATE_RHO,
    Relation,
    build as build_redundancy,
    measured,
    structural,
)


# --- ace.universe.families ---------------------------------------------------

def test_every_concept_declares_a_known_family_and_layer():
    for c in UNIVERSE:
        assert c.family in FAMILIES, c.concept
        assert c.layer in LAYERS, c.concept
        assert c.candidates, f"{c.concept} has no candidate series"


def test_notes_are_substantive_where_present():
    """Not every concept needs a note — a self-explanatory one like 'real GDP'
    does not. But a note that exists must say something, and the two cases
    that MUST carry one are a multi-candidate concept (the ordering is a
    judgement call) and a concept excluded from factor modelling (the reason
    a reader cannot see from the flag alone)."""
    for c in UNIVERSE:
        if c.note:
            assert len(c.note) > 15, f"{c.concept} has a note too short to say anything"
        if len(c.candidates) > 1:
            assert c.note, f"{c.concept} has {len(c.candidates)} candidates and no note explaining the ordering"
        if not c.factor_eligible and c.family != "demographics":
            assert c.note, f"{c.concept} is excluded from factor modelling with no stated reason"


def test_concept_construction_rejects_an_unknown_family():
    with pytest.raises(ValueError, match="family"):
        Concept(concept="x", family="not_a_family", sub_family="y",
                candidates=("Z",), code=5)


def test_concept_construction_rejects_no_candidates():
    with pytest.raises(ValueError, match="no candidate"):
        Concept(concept="x", family="growth" if "growth" in FAMILIES else FAMILIES[0],
                sub_family="y", candidates=(), code=5)


def test_demographic_concepts_are_never_factor_eligible():
    """Stated in the module docstring as a deliberate rule; enforced here so a
    future edit cannot silently re-admit a near-constant trend column."""
    demo = [c for c in UNIVERSE if c.family == "demographics"]
    assert demo, "no demographic concepts to check"
    assert all(not c.factor_eligible for c in demo)


def test_all_candidate_ids_is_deduplicated_and_ordered():
    ids = all_candidate_ids()
    assert len(ids) == len(set(ids))
    # First-seen order, not sorted — later code may rely on preference order.
    seen = []
    for c in UNIVERSE:
        for sid in c.candidates:
            if sid not in seen:
                seen.append(sid)
    assert list(ids) == seen


def test_concepts_for_finds_every_concept_a_series_could_serve():
    # PAYEMS is unambiguous: nonfarm payrolls, one concept.
    matches = concepts_for("PAYEMS")
    assert len(matches) >= 1
    assert any(m.concept == "nonfarm payrolls" for m in matches)


def test_no_concept_lists_a_real_and_nominal_pair_as_substitutes():
    """The regression this guards: `gross domestic income` originally listed
    GDI (nominal) and A261RX1Q020SBEA (real) as substitutes for ONE concept.
    The redundancy detector caught it — a nominal and a real series are
    different quantities, not two names for the same one — and it was split
    into two concepts. This asserts the split rather than the bug."""
    names = {c.concept for c in UNIVERSE}
    assert "nominal gross domestic income" in names
    assert "real gross domestic income" in names
    assert "gross domestic income" not in names


# --- ace.universe.duplicates: structural rules -------------------------------

def _rec(series_id, title, units="Index", sa="Seasonally Adjusted",
         concept="", family="growth", sub_family="x", component_of=""):
    return {
        "series_id": series_id, "title": title, "units": units,
        "seasonal_adjustment": sa, "concept": concept, "family": family,
        "sub_family": sub_family, "component_of": component_of,
    }


def test_shared_concept_is_flagged_vintage_twin():
    recs = [
        _rec("A", "Series A", concept="widgets"),
        _rec("B", "Series B", concept="widgets"),
    ]
    relations = structural(recs)
    assert any(r.kind == "vintage_twin" and {r.a, r.b} == {"A", "B"} for r in relations)


def test_seasonal_pair_is_detected_from_titles_and_sa_flags():
    recs = [
        _rec("X", "Housing Starts", sa="Seasonally Adjusted Annual Rate"),
        _rec("Y", "Housing Starts", sa="Not Seasonally Adjusted"),
    ]
    relations = structural(recs)
    assert any(r.kind == "seasonal_pair" for r in relations)


def test_real_nominal_pair_is_detected_from_titles():
    recs = [
        _rec("P", "Personal Consumption Expenditures"),
        _rec("Q", "Real Personal Consumption Expenditures"),
    ]
    relations = structural(recs)
    assert any(r.kind == "real_nominal" for r in relations)


def test_unrelated_series_produce_no_structural_relation():
    recs = [
        _rec("M", "Unemployment Rate", concept="u"),
        _rec("N", "Housing Starts", concept="h"),
    ]
    assert structural(recs) == []


def test_aggregate_child_relation_does_not_merge_the_group():
    """A component and its aggregate are related but NOT interchangeable —
    grouping them would deduplicate away information the panel keeps on
    purpose (e.g. core CPI is not a substitute for headline CPI)."""
    recs = [
        _rec("AGG", "Total", concept="total"),
        _rec("PART", "Total: Core Component", concept="core", component_of="AGG"),
    ]
    report = build_redundancy(recs)
    kinds = {r.kind for r in report.relations}
    assert "aggregate_child" in kinds
    groups = report.group_members()
    assert not groups, "aggregate/component must not be merged into one group"


# --- ace.universe.duplicates: measured near-duplicates -----------------------

def test_near_duplicate_requires_minimum_overlap():
    rng = np.random.default_rng(0)
    idx = pd.date_range("2000-01-01", periods=40, freq="MS")  # below MIN_OVERLAP
    a = pd.Series(rng.normal(size=40), index=idx)
    b = a.copy()
    frame = pd.DataFrame({"A": a, "B": b})
    assert measured(frame, []) == []


def test_near_identical_series_are_flagged_near_duplicate():
    rng = np.random.default_rng(1)
    idx = pd.date_range("2000-01-01", periods=200, freq="MS")
    a = pd.Series(rng.normal(size=200), index=idx)
    b = a * 1.0000001 + 1e-9  # same series, negligible noise
    frame = pd.DataFrame({"A": a, "B": b})
    relations = measured(frame, [])
    assert any(r.kind == "near_duplicate" and r.rho >= NEAR_DUPLICATE_RHO for r in relations)


def test_genuinely_correlated_but_distinct_series_are_not_flagged():
    """Payrolls and household employment move together without being the same
    number — the threshold has to leave room below it for real co-movement."""
    rng = np.random.default_rng(2)
    idx = pd.date_range("2000-01-01", periods=200, freq="MS")
    common = np.cumsum(rng.normal(size=200))
    a = pd.Series(common + rng.normal(scale=2.0, size=200), index=idx)
    b = pd.Series(common + rng.normal(scale=2.0, size=200), index=idx)
    frame = pd.DataFrame({"A": a, "B": b})
    relations = measured(frame, [])
    assert relations == [] or all(r.rho < NEAR_DUPLICATE_RHO for r in relations)


def test_a_constant_column_does_not_crash_the_correlation_scan():
    idx = pd.date_range("2000-01-01", periods=100, freq="MS")
    frame = pd.DataFrame({
        "A": np.zeros(100), "B": np.arange(100.0),
    }, index=idx)
    assert measured(frame, []) == []


def test_relations_already_explained_structurally_are_not_reflagged():
    rng = np.random.default_rng(3)
    idx = pd.date_range("2000-01-01", periods=200, freq="MS")
    a = pd.Series(rng.normal(size=200), index=idx)
    b = a.copy()
    frame = pd.DataFrame({"A": a, "B": b})
    known = [Relation(a="A", b="B", kind="vintage_twin", basis="metadata")]
    assert measured(frame, known) == []


# --- ace.universe.duplicates: transitive grouping ----------------------------

def test_a_three_way_chain_becomes_one_group_not_three_pairs():
    recs = [
        _rec("A", "CPI", concept="cpi"),
        _rec("B", "CPI", concept="cpi"),
        _rec("C", "CPI", concept="cpi"),
    ]
    report = build_redundancy(recs)
    groups = report.group_members()
    assert len(groups) == 1
    (members,) = groups.values()
    assert set(members) == {"A", "B", "C"}


def test_real_nominal_pairs_are_not_merged_into_one_group():
    """The defect this guards: personal income and real personal income, and
    nominal vs real GDI, landed in one redundancy group on the first build —
    which means a panel builder choosing 'one representative per group' would
    have silently dropped one of two genuinely different quantities. A real
    series and its nominal twin carry different information (the deflator
    between them), so the relation is recorded but the two must keep separate
    identities."""
    recs = [
        _rec("PI", "Personal Income"),
        _rec("RPI", "Real Personal Income"),
    ]
    report = build_redundancy(recs)
    assert any(r.kind == "real_nominal" for r in report.relations), (
        "the relation itself should still be recorded"
    )
    assert report.groups == {}, "real/nominal must not be merged into a group"


def test_group_label_prefers_the_shared_concept():
    recs = [_rec("A", "X", concept="widgets"), _rec("B", "X", concept="widgets")]
    report = build_redundancy(recs)
    label = report.groups["A"]
    assert "widgets" in label


# --- ace.universe.registry: SeriesRecord invariants --------------------------

def test_series_record_rejects_first_release_route_without_vintage_support():
    from ace.universe.registry import SeriesRecord

    with pytest.raises(ValueError, match="vintage_support"):
        SeriesRecord(
            series_id="X", canonical_name="X", source="FRED", source_url="",
            concept="c", economic_category="growth", sub_category="s",
            layer="hard", frequency="monthly", units="", seasonal_adjustment="",
            observation_start="", observation_end="", last_update="",
            availability_status="vintage", route="alfred_first_release",
            vintage_support=False,
        )


def test_series_record_round_trips_through_dict():
    from ace.universe.registry import SeriesRecord

    record = SeriesRecord(
        series_id="PAYEMS", canonical_name="Nonfarm Payrolls", source="FRED",
        source_url="https://fred.stlouisfed.org/series/PAYEMS",
        concept="nonfarm payrolls", economic_category="labor", sub_category="x",
        layer="hard", frequency="monthly", units="Persons", seasonal_adjustment="SA",
        observation_start="1939-01-01", observation_end="2026-08-01",
        last_update="2026-09-01", availability_status="vintage",
        route="alfred_first_release", vintage_support=True,
        redundant_with=("A", "B"),
    )
    back = SeriesRecord.from_dict(record.to_dict())
    assert back == record


def test_eligible_for_panel_excludes_non_factor_eligible():
    from ace.universe.registry import SeriesRecord, eligible_for_panel

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="growth",
        sub_category="s", layer="hard", frequency="monthly", units="",
        seasonal_adjustment="", observation_start="", observation_end="",
        last_update="", availability_status="vintage", route="alfred_first_release",
        vintage_support=True, n_vintage_observations=100,
        revision_behaviour="archive_present",
    )
    records = (
        SeriesRecord(series_id="A", canonical_name="A", factor_eligible=True, **base),
        SeriesRecord(series_id="B", canonical_name="B", factor_eligible=False, **base),
    )
    out = eligible_for_panel(records)
    assert [r.series_id for r in out] == ["A"]


def test_eligible_for_panel_excludes_unsafe_standard_observation_route():
    """A series read via the standard endpoint may only join the panel when
    its revision behaviour was MEASURED benign — not merely unknown."""
    from ace.universe.registry import SeriesRecord, eligible_for_panel

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="growth",
        sub_category="s", layer="market", frequency="daily", units="",
        seasonal_adjustment="", observation_start="", observation_end="",
        last_update="", availability_status="observation_only",
        route="standard_observation", vintage_support=False, factor_eligible=True,
    )
    safe = SeriesRecord(series_id="SAFE", canonical_name="Safe",
                         revision_behaviour="measured_none", **base)
    unknown = SeriesRecord(series_id="RISKY", canonical_name="Risky",
                            revision_behaviour="unknown", **base)
    out = eligible_for_panel((safe, unknown))
    assert [r.series_id for r in out] == ["SAFE"]


def test_eligible_for_panel_excludes_thin_vintage_history():
    from ace.universe.registry import SeriesRecord, eligible_for_panel

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="growth",
        sub_category="s", layer="hard", frequency="monthly", units="",
        seasonal_adjustment="", observation_start="", observation_end="",
        last_update="", availability_status="vintage", route="alfred_first_release",
        vintage_support=True, revision_behaviour="archive_present",
        factor_eligible=True,
    )
    thin = SeriesRecord(series_id="THIN", canonical_name="Thin",
                         n_vintage_observations=10, **base)
    deep = SeriesRecord(series_id="DEEP", canonical_name="Deep",
                         n_vintage_observations=200, **base)
    out = eligible_for_panel((thin, deep))
    assert [r.series_id for r in out] == ["DEEP"]


def test_a_production_panel_series_is_eligible_without_a_probed_vintage_count():
    """The defect this guards: `n_vintage_observations` is None for every one
    of the 89 production series, because probing them again would re-pay for
    an answer the panel already relies on. Reading None as zero excluded all
    89 from their own registry on the first build — `eligible_for_panel`
    dropped everything currently in production. Membership in the panel
    already proves `ace.state.panel.build_asof` cleared this exact bar."""
    from ace.universe.registry import SeriesRecord, eligible_for_panel

    record = SeriesRecord(
        series_id="CPIAUCSL", canonical_name="CPI", source="FRED", source_url="",
        concept="c", economic_category="inflation", sub_category="s",
        layer="hard", frequency="monthly", units="", seasonal_adjustment="",
        observation_start="", observation_end="", last_update="",
        availability_status="vintage", route="alfred_first_release",
        vintage_support=True, n_vintage_observations=None,
        revision_behaviour="archive_present", factor_eligible=True,
        in_production_panel=True,
    )
    out = eligible_for_panel((record,))
    assert [r.series_id for r in out] == ["CPIAUCSL"]


def test_load_raises_a_clear_error_when_the_registry_has_not_been_built(tmp_path):
    from ace.universe.registry import load

    with pytest.raises(FileNotFoundError, match="python -m ace.universe.registry"):
        load(tmp_path / "does_not_exist.json")


# --- the committed registry artifact, if present -----------------------------

def test_the_committed_registry_is_internally_consistent():
    """If the registry has been built and committed, every record must satisfy
    its own invariants and the redundancy groups must reference real ids.

    Skips rather than fails when the artifact is absent — this file has to
    pass in a fresh checkout before the registry is ever built, and building it
    requires network access this test suite does not have.
    """
    from ace.universe.registry import REGISTRY_PATH, SeriesRecord

    if not REGISTRY_PATH.exists():
        pytest.skip("registry not built in this checkout")

    payload = json.loads(REGISTRY_PATH.read_text())
    records = [SeriesRecord.from_dict(r) for r in payload["records"]]
    assert len(records) == payload["n_records"]
    ids = {r.series_id for r in records}

    for r in records:
        assert r.series_id in ids
        for partner in r.redundant_with:
            assert partner in ids, f"{r.series_id} points at unknown partner {partner}"
        if r.route == "alfred_first_release":
            assert r.vintage_support

    # Every panel-eligible record must be usable — the filter's own promise.
    from ace.universe.registry import eligible_for_panel
    for r in eligible_for_panel(tuple(records)):
        assert r.usable


# --- ace.factors.universe_panel ----------------------------------------------

def test_duplicate_resolution_excludes_a_discontinued_candidate():
    """The defect this guards: `_pick_representative` chose PPIITM
    (discontinued 2015) over WPUID61 (current) and IOER (discontinued 2021)
    over IORB (current), because 'deepest vintage history' measures total
    observation COUNT, which a long-dead series can still win on. Running
    static PCA on the resulting 167-series panel found that these frozen
    columns, at that breadth, crushed the balanced-matrix requirement to zero
    usable rows."""
    from ace.factors.universe_panel import _pick_representative
    from ace.universe.registry import SeriesRecord

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="credit",
        sub_category="s", layer="hard", frequency="monthly", units="",
        seasonal_adjustment="", availability_status="vintage",
        route="alfred_first_release", vintage_support=True,
        revision_behaviour="archive_present", factor_eligible=True,
        in_production_panel=False, last_update="",
    )
    by_id = {
        "DEAD": SeriesRecord(series_id="DEAD", canonical_name="Dead",
                              observation_start="1947-01-01", observation_end="2015-12-01",
                              n_vintage_observations=800, **base),
        "LIVE": SeriesRecord(series_id="LIVE", canonical_name="Live",
                              observation_start="1947-01-01", observation_end="2026-08-01",
                              n_vintage_observations=200, **base),
    }
    choice = _pick_representative(("DEAD", "LIVE"), by_id, now="2026-09-27")
    assert choice.chosen == "LIVE", "a discontinued series must not win on raw history depth"
    assert "discontinued" in choice.reason


def test_duplicate_resolution_falls_back_when_every_candidate_is_stale():
    """A duplicate group where NOTHING is fresh must still return a choice —
    silently returning nothing would be worse than picking a stale one and
    saying so."""
    from ace.factors.universe_panel import _pick_representative
    from ace.universe.registry import SeriesRecord

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="credit",
        sub_category="s", layer="hard", frequency="monthly", units="",
        seasonal_adjustment="", availability_status="vintage",
        route="alfred_first_release", vintage_support=True,
        revision_behaviour="archive_present", factor_eligible=True,
        in_production_panel=False, last_update="",
        observation_start="1947-01-01",
    )
    by_id = {
        "A": SeriesRecord(series_id="A", canonical_name="A",
                           observation_end="2010-01-01", n_vintage_observations=500, **base),
        "B": SeriesRecord(series_id="B", canonical_name="B",
                           observation_end="2011-01-01", n_vintage_observations=100, **base),
    }
    choice = _pick_representative(("A", "B"), by_id, now="2026-09-27")
    assert choice.chosen in ("A", "B")


def test_is_fresh_treats_a_blank_observation_end_as_fresh():
    """A production-panel record was never re-probed for its end date;
    absence of the field must not read as evidence of staleness for the one
    class of record already validated by its own panel membership."""
    from ace.factors.universe_panel import _is_fresh
    from ace.universe.registry import SeriesRecord

    record = SeriesRecord(
        series_id="X", canonical_name="X", source="FRED", source_url="",
        concept="c", economic_category="growth", sub_category="s", layer="hard",
        frequency="monthly", units="", seasonal_adjustment="",
        observation_start="", observation_end="", last_update="",
        availability_status="vintage", route="alfred_first_release",
        vintage_support=True, in_production_panel=True,
    )
    assert _is_fresh(record, now="2026-09-27") is True


def test_duplicate_resolution_prefers_the_production_panel_member():
    from ace.factors.universe_panel import _pick_representative
    from ace.universe.registry import SeriesRecord

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="growth",
        sub_category="s", layer="hard", frequency="monthly", units="",
        seasonal_adjustment="", observation_start="", observation_end="",
        last_update="", availability_status="vintage", route="alfred_first_release",
        vintage_support=True, revision_behaviour="archive_present",
        factor_eligible=True,
    )
    by_id = {
        "OLD": SeriesRecord(series_id="OLD", canonical_name="Old",
                             n_vintage_observations=50, in_production_panel=True, **base),
        "NEW": SeriesRecord(series_id="NEW", canonical_name="New",
                             n_vintage_observations=500, in_production_panel=False, **base),
    }
    choice = _pick_representative(("OLD", "NEW"), by_id)
    assert choice.chosen == "OLD", "production membership must win even over more history"
    assert choice.dropped == ("NEW",)


def test_duplicate_resolution_prefers_vintage_route_over_history_length():
    from ace.factors.universe_panel import _pick_representative
    from ace.universe.registry import SeriesRecord

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="growth",
        sub_category="s", layer="hard", frequency="monthly", units="",
        seasonal_adjustment="", observation_start="", observation_end="",
        last_update="", factor_eligible=True, in_production_panel=False,
    )
    by_id = {
        "SHORT_VINTAGE": SeriesRecord(
            series_id="SHORT_VINTAGE", canonical_name="Short",
            availability_status="vintage", route="alfred_first_release",
            vintage_support=True, revision_behaviour="archive_present",
            n_vintage_observations=40, **base,
        ),
        "LONG_STANDARD": SeriesRecord(
            series_id="LONG_STANDARD", canonical_name="Long",
            availability_status="observation_only", route="standard_observation",
            vintage_support=False, revision_behaviour="measured_none",
            n_vintage_observations=4000, **base,
        ),
    }
    choice = _pick_representative(("SHORT_VINTAGE", "LONG_STANDARD"), by_id)
    assert choice.chosen == "SHORT_VINTAGE"


def test_resolve_duplicates_drops_exactly_the_non_chosen_members():
    from ace.factors.universe_panel import resolve_duplicates
    from ace.universe.registry import SeriesRecord

    base = dict(
        source="FRED", source_url="", concept="c", economic_category="growth",
        sub_category="s", layer="hard", frequency="monthly", units="",
        seasonal_adjustment="", observation_start="", observation_end="",
        last_update="", availability_status="vintage", route="alfred_first_release",
        vintage_support=True, revision_behaviour="archive_present",
        factor_eligible=True, in_production_panel=False,
    )
    records = (
        SeriesRecord(series_id="A", canonical_name="A", n_vintage_observations=100,
                     redundancy_group="grp", **base),
        SeriesRecord(series_id="B", canonical_name="B", n_vintage_observations=200,
                     redundancy_group="grp", **base),
        SeriesRecord(series_id="C", canonical_name="C", **base),  # not in any group
    )
    kept, choices = resolve_duplicates(records)
    kept_ids = {r.series_id for r in kept}
    assert kept_ids == {"B", "C"}
    assert len(choices) == 1
    assert choices[0].chosen == "B"


def test_to_spec_carries_a_fetch_start_override_through():
    """The defect this guards: NFCI and ANFCI need `vintage_start=2005-01-01`
    (FRED 504s on the archive request from 1980 and returns in seconds from
    2005 — measured in an earlier session). That override lived only on
    `ace.state.panel.SeriesSpec` and the registry round-trip silently dropped
    it, so rebuilding a `SeriesSpec` from the registry re-fetched from 1980 and
    504'd again on the very next comprehensive-panel build — caught by actually
    running that fetch rather than by a unit test alone."""
    from ace.factors.universe_panel import _to_spec
    from ace.universe.registry import SeriesRecord

    record = SeriesRecord(
        series_id="NFCI", canonical_name="NFCI", source="FRED", source_url="",
        concept="c", economic_category="financial_conditions", sub_category="s",
        layer="derived", frequency="weekly", units="", seasonal_adjustment="",
        observation_start="", observation_end="", last_update="",
        availability_status="vintage", route="alfred_first_release",
        vintage_support=True, fetch_start_override="2005-01-01",
    )
    assert _to_spec(record).vintage_start == "2005-01-01"


def test_to_spec_leaves_vintage_start_unset_without_an_override():
    from ace.factors.universe_panel import _to_spec
    from ace.universe.registry import SeriesRecord

    record = SeriesRecord(
        series_id="X", canonical_name="X", source="FRED", source_url="",
        concept="c", economic_category="growth", sub_category="s",
        layer="hard", frequency="monthly", units="", seasonal_adjustment="",
        observation_start="", observation_end="", last_update="",
        availability_status="vintage", route="alfred_first_release",
        vintage_support=True,
    )
    assert _to_spec(record).vintage_start is None


def test_to_spec_carries_the_route_through_to_revised_flag():
    from ace.factors.universe_panel import _to_spec
    from ace.universe.registry import SeriesRecord

    vintage = SeriesRecord(
        series_id="V", canonical_name="V", source="FRED", source_url="",
        concept="c", economic_category="growth", sub_category="s", layer="hard",
        frequency="monthly", units="", seasonal_adjustment="",
        observation_start="", observation_end="", last_update="",
        availability_status="vintage", route="alfred_first_release",
        vintage_support=True,
    )
    standard = SeriesRecord(
        series_id="S", canonical_name="S", source="FRED", source_url="",
        concept="c", economic_category="financial_conditions", sub_category="s",
        layer="market", frequency="daily", units="", seasonal_adjustment="",
        observation_start="", observation_end="", last_update="",
        availability_status="observation_only", route="standard_observation",
        vintage_support=False,
    )
    assert _to_spec(vintage).revised is True
    assert _to_spec(standard).revised is False


def test_default_panel_and_research_panel_agree_outside_duplicate_groups():
    """The two views should differ only inside redundancy groups."""
    from ace.factors.universe_panel import default_panel, research_panel

    default_ids = {s.series_id for s in default_panel()[0]}
    research_ids = {s.series_id for s in research_panel()}
    assert default_ids <= research_ids
    dropped = research_ids - default_ids
    # Every dropped id must actually belong to a resolved duplicate group.
    _, choices = default_panel()
    all_dropped = {sid for c in choices for sid in c.dropped}
    assert dropped == all_dropped


def test_the_production_panel_is_a_subset_of_the_comprehensive_default_panel():
    """The one series known to be excluded is SP500, and for a stated reason:
    its revision safety could never be measured (FRED's licence refuses both
    the vintage archive and any as-of snapshot for it), so the registry is
    conservative rather than assuming a market quote is always safe. Every
    other production series must survive into the comprehensive panel — this
    is the exact defect that shipped once, when a None probe count on every
    production series read as zero observations and excluded all 89 of them."""
    from ace.state.panel import PANEL
    from ace.universe.registry import REGISTRY_PATH

    if not REGISTRY_PATH.exists():
        pytest.skip("registry not built in this checkout")

    from ace.factors.universe_panel import default_panel

    specs, _ = default_panel()
    comp_ids = {s.series_id for s in specs}
    production_ids = {s.series_id for s in PANEL}
    missing = production_ids - comp_ids
    assert missing <= {"SP500"}, f"unexpectedly excluded: {missing}"
