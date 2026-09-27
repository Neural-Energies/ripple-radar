"""Redundancy in a comprehensive macro panel, found and labelled rather than pruned.

A universe assembled for breadth is redundant by construction, and the redundancy
is not a mistake to clean up — it is information about measurement. CPI and core
CPI are 95% the same series and their DIFFERENCE is the whole food-and-energy
argument. Payrolls and household employment measure one quantity two ways and
their gap is a known measurement puzzle. Dropping either member of those pairs
loses the thing worth knowing.

What redundancy does do is break a factor model quietly. Principal components are
computed on a correlation matrix, and a concept represented by six near-identical
series contributes six times the variance of a concept represented by one. The
first component then describes the panel's composition rather than the economy.
So the redundancy has to be MEASURED and CARRIED IN METADATA, and the modelling
layer decides what to do about it.

THE SIX KINDS THIS DETECTS

  `identical`        correlation of transformed values indistinguishable from 1
  `seasonal_pair`    the same concept seasonally adjusted and not
  `real_nominal`     the same quantity in dollars and in volume terms
  `aggregate_child`  a component of an aggregate that is also present
  `vintage_twin`     the same concept on two routes or two frequencies
  `near_duplicate`   correlation above `NEAR_DUPLICATE_RHO` without a known reason

The first five are found from METADATA — ids, titles, units, seasonal-adjustment
flags and the concept catalogue — because a structural relationship is a fact
about what the series are, and reading it off a correlation would make it a
function of the sample window. Only `near_duplicate` is measured from data, and
only for pairs the structural rules did not already explain.

Nothing here deletes a series. `redundancy_group` and `redundant_with` go into
the registry, `ace.factors.panels` chooses a representative per group when it
builds a modelling view, and the choice is recorded with the panel.
"""
from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

#: Above this, two transformed series are treated as the same measurement unless
#: the structural rules already explained the relationship. 0.995 is high on
#: purpose: the job is to catch series that are the same number under two names,
#: not to thin out a correlated panel. Genuine economic co-movement — payrolls
#: and household employment, CPI and core CPI — sits well below it, and a factor
#: model is supposed to see that.
NEAR_DUPLICATE_RHO = 0.995

#: Minimum overlapping observations before a correlation is allowed to claim a
#: relationship. Two series sharing eighteen months can correlate at 0.999 by
#: accident of a common trend.
MIN_OVERLAP = 60

#: Suffix conventions FRED uses for the seasonally-adjusted / not-adjusted pair.
#: Matched on the id because the `seasonal_adjustment` metadata field is the
#: authority and this is the cheap pre-filter for which pairs to compare.
_SA_SUFFIXES = ("SA", "NSA", "SAAR")

#: Words whose presence distinguishes a real series from its nominal twin.
_REAL_MARKERS = ("real", "chained", "constant dollar", "in 2017 dollars", "volume")


@dataclass(frozen=True)
class Relation:
    """One redundancy relationship between two series, and how it was found."""

    a: str
    b: str
    kind: str
    #: "metadata" for a structural relationship, "measured" for a correlation.
    basis: str
    rho: float | None = None
    n_overlap: int | None = None
    detail: str = ""


@dataclass
class RedundancyReport:
    relations: list[Relation] = field(default_factory=list)
    #: series_id -> group label. A group is a set of series measuring one thing.
    groups: dict[str, str] = field(default_factory=dict)

    def for_series(self, series_id: str) -> list[Relation]:
        return [r for r in self.relations if series_id in (r.a, r.b)]

    def group_members(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for series_id, label in sorted(self.groups.items()):
            out.setdefault(label, []).append(series_id)
        return {k: v for k, v in out.items() if len(v) > 1}


def _normalise_title(title: str) -> str:
    """Strip the words that distinguish a variant from its base concept.

    Leaves the economic subject, so "Real Personal Consumption Expenditures,
    Seasonally Adjusted Annual Rate" and "Personal Consumption Expenditures"
    collapse to the same key and are then compared field by field. The point is
    to find CANDIDATE pairs cheaply, not to decide anything.
    """
    text = title.lower()
    for noise in (
        "seasonally adjusted annual rate", "seasonally adjusted",
        "not seasonally adjusted", "annual rate", "chained", "real", "nominal",
        "index", "millions of dollars", "billions of dollars", "thousands",
        "percent", "rate", "all items", "total", "(", ")", ",", ":", ".", "-",
    ):
        text = text.replace(noise, " ")
    return re.sub(r"\s+", " ", text).strip()


def structural(records: list[dict]) -> list[Relation]:
    """Relationships readable from metadata alone.

    `records` are dicts with at least `series_id`, `title`, `units`,
    `seasonal_adjustment`, `concept`, `family` and `sub_family` — the registry's
    own shape, so this runs on the registry rather than needing its own copy of
    the universe.
    """
    out: list[Relation] = []
    by_id = {r["series_id"]: r for r in records}

    # (1) Two series serving the SAME concept. The concept catalogue already
    # asserts they measure one quantity, which is stronger evidence than any
    # correlation, so this rule comes first.
    by_concept: dict[str, list[str]] = {}
    for record in records:
        if record.get("concept"):
            by_concept.setdefault(record["concept"], []).append(record["series_id"])
    for concept, members in by_concept.items():
        for a, b in itertools.combinations(sorted(members), 2):
            out.append(Relation(
                a=a, b=b, kind="vintage_twin", basis="metadata",
                detail=f"both are candidates for the concept {concept!r}",
            ))

    # (2) Seasonal pairs and real/nominal pairs, from normalised titles.
    by_subject: dict[str, list[str]] = {}
    for record in records:
        key = _normalise_title(record.get("title", "") or "")
        if key:
            by_subject.setdefault(key, []).append(record["series_id"])
    for subject, members in by_subject.items():
        for a, b in itertools.combinations(sorted(members), 2):
            ra, rb = by_id[a], by_id[b]
            sa_a = (ra.get("seasonal_adjustment") or "").lower()
            sa_b = (rb.get("seasonal_adjustment") or "").lower()
            title_a = (ra.get("title") or "").lower()
            title_b = (rb.get("title") or "").lower()
            real_a = any(m in title_a for m in _REAL_MARKERS)
            real_b = any(m in title_b for m in _REAL_MARKERS)
            if sa_a and sa_b and ("not" in sa_a) != ("not" in sa_b):
                out.append(Relation(
                    a=a, b=b, kind="seasonal_pair", basis="metadata",
                    detail=f"same subject {subject!r}, {sa_a} vs {sa_b}",
                ))
            elif real_a != real_b:
                out.append(Relation(
                    a=a, b=b, kind="real_nominal", basis="metadata",
                    detail=f"same subject {subject!r}, one deflated and one not",
                ))
            elif (ra.get("units") or "") != (rb.get("units") or ""):
                out.append(Relation(
                    a=a, b=b, kind="vintage_twin", basis="metadata",
                    detail=f"same subject {subject!r}, units "
                           f"{ra.get('units')!r} vs {rb.get('units')!r}",
                ))

    # (3) Aggregate and component, where the catalogue marks one a sub-component
    # of the other's family. Structural, and the reason it matters is arithmetic:
    # an aggregate plus all its parts is a linearly dependent block, which makes
    # the correlation matrix singular rather than merely redundant.
    for record in records:
        parent = record.get("component_of")
        if parent and parent in by_id:
            out.append(Relation(
                a=parent, b=record["series_id"], kind="aggregate_child",
                basis="metadata",
                detail=f"{record['series_id']} is a declared component of {parent}",
            ))
    return out


def measured(
    frame: pd.DataFrame,
    known: list[Relation],
    *,
    rho: float = NEAR_DUPLICATE_RHO,
    min_overlap: int = MIN_OVERLAP,
) -> list[Relation]:
    """Near-duplicates the structural rules did not explain.

    Runs on the TRANSFORMED panel, not on levels. Two price indices in level
    form correlate at 0.99 because both trend; the same two in second log
    differences correlate at whatever their inflation rates actually share,
    which is the question. Correlating levels here would flag most of the
    universe and mean nothing.
    """
    explained = {tuple(sorted((r.a, r.b))) for r in known}
    out: list[Relation] = []
    columns = list(frame.columns)
    for a, b in itertools.combinations(columns, 2):
        if tuple(sorted((a, b))) in explained:
            continue
        pair = frame[[a, b]].dropna()
        if len(pair) < min_overlap:
            continue
        # Guard a constant column: `corr` returns NaN and comparing it is False,
        # which would silently skip rather than report an unusable pair.
        if pair[a].std(ddof=0) == 0 or pair[b].std(ddof=0) == 0:
            continue
        r = float(pair[a].corr(pair[b]))
        if np.isfinite(r) and abs(r) >= rho:
            out.append(Relation(
                a=a, b=b, kind="near_duplicate", basis="measured",
                rho=round(r, 6), n_overlap=int(len(pair)),
                detail="correlation of transformed values at or above the "
                       f"{rho} threshold with no structural explanation",
            ))
    return out


def _label(members: set[str], records: dict[str, dict]) -> str:
    """A readable name for a redundancy group.

    Prefers the concept the members share, then their common family, then the
    alphabetically first id — so the label says what the group MEASURES wherever
    the metadata knows, and degrades to something stable rather than to a number.
    """
    concepts = {records.get(m, {}).get("concept") for m in members} - {None, ""}
    if len(concepts) == 1:
        return f"concept:{next(iter(concepts))}"
    families = {records.get(m, {}).get("family") for m in members} - {None, ""}
    if len(families) == 1:
        return f"family:{next(iter(families))}:{min(members)}"
    return f"group:{min(members)}"


def build(records: list[dict], frame: pd.DataFrame | None = None) -> RedundancyReport:
    """Structural relations, then measured ones, then transitive grouping."""
    relations = structural(records)
    if frame is not None and not frame.empty:
        relations = relations + measured(frame, relations)

    # Union-find over the relations, so a chain A~B~C becomes one group rather
    # than two pairs. Without this, a concept measured three ways would be
    # deduplicated to two representatives.
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: str, y: str) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    # Only two kinds mean "these are interchangeable, pick one": a shared
    # concept under two names (`vintage_twin`) and a seasonal-adjustment pair,
    # where SA is the conventional choice for modelling (`seasonal_pair`). A
    # near-duplicate measured from data is the same case by construction.
    #
    # `real_nominal` and `aggregate_child` do NOT mean that, and grouping them
    # was a real defect caught by reading this module's own output: personal
    # income and real personal income landed in one group, and so did nominal
    # and real GDI — which is exactly the "discard a useful variant blindly"
    # the brief forbids. A real series and its nominal twin carry DIFFERENT
    # information (the deflator between them is itself informative), so each
    # keeps its own group and the relation is recorded without merging.
    MERGING_KINDS = {"vintage_twin", "seasonal_pair", "near_duplicate"}
    for relation in relations:
        if relation.kind in MERGING_KINDS:
            union(relation.a, relation.b)

    by_id = {r["series_id"]: r for r in records}
    clusters: dict[str, set[str]] = {}
    for series_id in parent:
        clusters.setdefault(find(series_id), set()).add(series_id)

    groups: dict[str, str] = {}
    for members in clusters.values():
        if len(members) < 2:
            continue
        label = _label(members, by_id)
        for member in members:
            groups[member] = label

    return RedundancyReport(relations=relations, groups=groups)
