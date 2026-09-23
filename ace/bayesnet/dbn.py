"""Two-slice Dynamic Bayesian Network over the discrete world state.

The claim a DBN makes is specific: the probability of tomorrow's state depends
on today's state ACROSS VARIABLES, not just on the same variable's own
history. So the model must be judged against exactly that — a first-order
Markov chain on the target alone. Beating a base rate proves nothing here,
because persistence alone would do that.

Conditional probability tables are estimated with a Dirichlet prior rather
than raw counts. With four parents the table has dozens of configurations and
some will be rare or unseen; maximum likelihood assigns those probability 0 or
NaN, and a forecast of exactly 0 for an event that has simply not occurred yet
is both wrong and unrecoverable. The prior keeps every cell finite and lets
the data dominate wherever it is plentiful.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd


@dataclass
class ConditionalTable:
    """P(target | parents), with the counts it was estimated from."""

    target: str
    parents: list[str]
    states: list[str]
    # key: tuple of parent state values -> {state: probability}
    table: dict[tuple, dict[str, float]]
    counts: dict[tuple, int]
    prior_strength: float
    n_configurations: int
    n_unseen: int

    def predict(self, parent_values: tuple) -> dict[str, float]:
        """Probability over target states for a parent configuration.

        An unseen configuration falls back to the prior, which is the marginal
        — the honest answer for "we have never observed this combination".
        """
        return self.table.get(parent_values, self.table["__prior__"])

    def summary(self) -> dict:
        d = asdict(self)
        d.pop("table")
        d.pop("counts")
        return d


def fit_cpt(
    data: pd.DataFrame,
    target: str,
    parents: list[str],
    *,
    prior_strength: float = 4.0,
) -> ConditionalTable:
    """Estimate P(target | parents) with Dirichlet smoothing toward the marginal."""
    if target not in data.columns:
        raise KeyError(f"target {target} not in data")
    missing = [p for p in parents if p not in data.columns]
    if missing:
        raise KeyError(f"parents not in data: {missing}")

    states = sorted(data[target].dropna().unique().tolist())
    if len(states) < 2:
        raise ValueError(f"target {target} has {len(states)} state(s); need >=2")

    marginal = data[target].value_counts(normalize=True)
    prior = {s: float(marginal.get(s, 1.0 / len(states))) for s in states}

    table: dict[tuple, dict[str, float]] = {"__prior__": prior}
    counts: dict[tuple, int] = {}
    grouped = data.groupby(parents, dropna=True)[target] if parents else None

    if grouped is not None:
        for key, series in grouped:
            key = key if isinstance(key, tuple) else (key,)
            n = len(series)
            obs = series.value_counts()
            # Dirichlet posterior mean: (count + alpha * prior) / (n + alpha)
            table[key] = {
                s: float((obs.get(s, 0) + prior_strength * prior[s]) / (n + prior_strength))
                for s in states
            }
            counts[key] = int(n)

    n_configs = int(np.prod([data[p].nunique() for p in parents])) if parents else 1
    return ConditionalTable(
        target=target,
        parents=list(parents),
        states=states,
        table=table,
        counts=counts,
        prior_strength=prior_strength,
        n_configurations=n_configs,
        n_unseen=max(0, n_configs - len(counts)),
    )


def predict_proba(cpt: ConditionalTable, data: pd.DataFrame, state: str) -> np.ndarray:
    """P(target == state) for each row, from its parent configuration."""
    if not cpt.parents:
        return np.full(len(data), cpt.table["__prior__"][state])
    keys = list(zip(*[data[p].to_numpy() for p in cpt.parents]))
    return np.array([cpt.predict(k).get(state, 0.0) for k in keys], dtype=float)


@dataclass
class DBNSpec:
    """A two-slice network: which slice-0 variables parent each slice-1 target."""

    structure: dict[str, list[str]]

    def targets(self) -> list[str]:
        return list(self.structure)


def fit_dbn(two_slice: pd.DataFrame, spec: DBNSpec, *, prior_strength: float = 4.0
            ) -> dict[str, ConditionalTable]:
    """Fit one conditional table per slice-1 target.

    `two_slice` carries (variable, slice) tuple columns; this flattens to the
    plain names the tables use.
    """
    flat = pd.DataFrame(
        {f"{v}_t{sl}": two_slice[(v, sl)] for (v, sl) in two_slice.columns}
    )
    out: dict[str, ConditionalTable] = {}
    for target, parents in spec.structure.items():
        out[target] = fit_cpt(
            flat, f"{target}_t1", [f"{p}_t0" for p in parents], prior_strength=prior_strength
        )
    return out


def flatten(two_slice: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({f"{v}_t{sl}": two_slice[(v, sl)] for (v, sl) in two_slice.columns},
                        index=two_slice.index)
