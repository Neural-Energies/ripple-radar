"""Causal graph and identification (§3 Engine 4 — structural causal models).

The reason this module exists as a separate step from estimation: an estimate
is only causal if the quantity is *identified* first. Regressing an outcome on
a treatment and "some controls" answers a causal question only when those
controls happen to block every backdoor path — and when none of them is a
collider or a descendant of the treatment, either of which opens a path that
was closed and makes the estimate worse than the unadjusted one.

So the graph is stated explicitly, the adjustment set is derived from it, and
a question with no valid adjustment set returns NOT IDENTIFIED rather than a
number. The assumption that the graph is right stays an assumption — this
module makes it visible and checkable instead of implicit.

Reference: Pearl's backdoor criterion. Z satisfies it for (X -> Y) when
  1. no node in Z is a descendant of X, and
  2. Z blocks every path from X to Y that starts with an arrow into X.
"""
from __future__ import annotations

from dataclasses import dataclass

import networkx as nx


class NotIdentified(Exception):
    """The causal effect cannot be estimated from observed variables alone."""


@dataclass
class Identification:
    treatment: str
    outcome: str
    adjustment_set: tuple[str, ...]
    strategy: str
    note: str


class CausalDAG:
    """A directed acyclic graph over named variables."""

    def __init__(self, edges: list[tuple[str, str]], *, observed: set[str] | None = None):
        self.graph = nx.DiGraph(edges)
        if not nx.is_directed_acyclic_graph(self.graph):
            cycle = nx.find_cycle(self.graph)
            raise ValueError(f"not a DAG — cycle through {cycle}")
        # Anything not named as observed is latent: it constrains which
        # adjustment sets exist but can never appear in one.
        self.observed = set(observed) if observed is not None else set(self.graph.nodes)
        unknown = self.observed - set(self.graph.nodes)
        if unknown:
            raise ValueError(f"observed names not in the graph: {sorted(unknown)}")

    @property
    def nodes(self) -> list[str]:
        return list(self.graph.nodes)

    def latent(self) -> set[str]:
        return set(self.graph.nodes) - self.observed

    def parents(self, node: str) -> set[str]:
        return set(self.graph.predecessors(node))

    def descendants(self, node: str) -> set[str]:
        return set(nx.descendants(self.graph, node))

    def blocks_backdoor(self, z: set[str], treatment: str, outcome: str) -> bool:
        """Does Z satisfy the backdoor criterion for treatment -> outcome?"""
        if z & (self.descendants(treatment) | {treatment}):
            return False  # conditioning on a descendant of the treatment
        # Backdoor paths are exactly the paths remaining once the treatment's
        # own outgoing edges are cut; Z must d-separate X from Y in that graph.
        cut = self.graph.copy()
        cut.remove_edges_from(list(self.graph.out_edges(treatment)))
        return nx.is_d_separator(cut, {treatment}, {outcome}, set(z))

    def identify(self, treatment: str, outcome: str) -> Identification:
        """Find a minimal observed adjustment set, or say it is not identified."""
        for name in (treatment, outcome):
            if name not in self.graph:
                raise KeyError(f"{name} is not in the graph")
        if outcome not in self.descendants(treatment):
            raise NotIdentified(
                f"{treatment} has no directed path to {outcome}; the graph says "
                "there is no effect to estimate"
            )

        if self.blocks_backdoor(set(), treatment, outcome):
            return Identification(treatment, outcome, (), "unadjusted",
                                  "no open backdoor path — the raw contrast is the effect")

        # Search smallest-first so the returned set is minimal in size: every
        # extra control costs precision and risks being a collider.
        candidates = sorted(self.observed - {treatment, outcome} - self.descendants(treatment))
        from itertools import combinations
        for size in range(1, len(candidates) + 1):
            for combo in combinations(candidates, size):
                if self.blocks_backdoor(set(combo), treatment, outcome):
                    return Identification(
                        treatment, outcome, tuple(combo), "backdoor",
                        f"adjusting for {', '.join(combo)} blocks every backdoor path",
                    )

        raise NotIdentified(
            f"no observed set blocks the backdoor paths from {treatment} to {outcome}. "
            f"Latent variables: {sorted(self.latent()) or 'none'}. "
            "The effect is not estimable from this data without a further assumption "
            "(an instrument, a discontinuity, or a panel design)."
        )

    def colliders_on_paths(self, treatment: str, outcome: str) -> set[str]:
        """Nodes that would open a closed path if someone controlled for them.

        Reported so a caller who wants to add their own controls can see which
        ones would actively damage the estimate.
        """
        out: set[str] = set()
        undirected = self.graph.to_undirected()
        for path in nx.all_simple_paths(undirected, treatment, outcome):
            for a, b, c in zip(path, path[1:], path[2:]):
                if self.graph.has_edge(a, b) and self.graph.has_edge(c, b):
                    out.add(b)
        return out
