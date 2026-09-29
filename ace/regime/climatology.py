"""WP3's exit condition: score a probability forecast against climatology.

BRIER SCORE, NOT ACCURACY

A probability forecast is not scored well by thresholding it into a
right/wrong count — a model saying "60%" and being wrong is a worse forecast
than one saying "51%" and being wrong, and accuracy cannot see that
difference. Brier score (mean squared error between a probability forecast
and the 0/1 outcome) can.

CLIMATOLOGY MEANS "THE HISTORICAL BASE RATE, KNOWN AT THE TIME"

The climatology baseline for an anchor is the share of past events computed
from data available AT that anchor — never the share within the evaluation
sample, which would make climatology look sharp by peeking at the outcomes it
is scored against. The caller builds each `AnchorReading`'s
`climatology_probability` that way; this module only scores what it is given.

WHAT MAY BE CONCLUDED FROM HOW MANY OBSERVATIONS (PR #5 B04)

`skill_report([one favourable anchor])` used to return "IMPROVES ON
CLIMATOLOGY (CI excludes zero)" with CI [.24, .24]: resampling one row a
thousand times adds no information. A verdict other than INCONCLUSIVE now
requires, fixed before any score is looked at:

- at least `min_n` scored anchors, with `min_events` events and
  `min_non_events` non-events among them;
- no duplicated anchor;
- a CI from a moving-block bootstrap over the anchors in time order, so
  serial dependence between neighbouring anchors is kept rather than assumed
  away, at a level the caller adjusts for how many comparisons it runs.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class AnchorReading:
    """One point-in-time prediction and the outcome once it was known."""

    as_of: str
    model_probability: float
    climatology_probability: float
    outcome: float  # 0.0 or 1.0


@dataclass(frozen=True)
class Sufficiency:
    """The sample a verdict needs. Fixed by the protocol, never by the result."""

    min_n: int = 20
    min_events: int = 6
    min_non_events: int = 6


DEFAULT_SUFFICIENCY = Sufficiency()


def brier_score(outcomes: np.ndarray, probabilities: np.ndarray) -> float:
    """Mean squared error between a 0/1 outcome and a probability forecast."""
    y = np.asarray(outcomes, dtype=float).ravel()
    p = np.asarray(probabilities, dtype=float).ravel()
    if len(y) == 0:
        return float("nan")
    return float(np.mean((y - p) ** 2))


def default_block_length(n: int) -> int:
    """n^(1/3), the usual rate for a moving-block bootstrap, and at least 1."""
    return max(1, int(round(n ** (1 / 3)))) if n > 0 else 1


def _block_bootstrap_ci(
    rows: np.ndarray,
    statistic,
    *,
    block: int,
    n_boot: int,
    alpha: float,
    seed: int,
) -> dict:
    """Percentile CI for `statistic(outcomes, model_p, clim_p)` by circular
    moving-block resampling of time-ordered rows."""
    n = len(rows)
    rng = np.random.default_rng(seed)
    starts_needed = int(np.ceil(n / block))
    draws: list[float] = []
    for _ in range(n_boot):
        starts = rng.integers(0, n, size=starts_needed)
        idx = (starts[:, None] + np.arange(block)[None, :]).ravel()[:n] % n
        sample = rows[idx]
        value = statistic(sample[:, 0], sample[:, 1], sample[:, 2])
        if np.isfinite(value):
            draws.append(float(value))
    point = float(statistic(rows[:, 0], rows[:, 1], rows[:, 2]))
    boot = np.asarray(draws)
    return {
        "point": round(point, 6),
        "lo": round(float(np.quantile(boot, alpha / 2)), 6) if len(boot) else float("nan"),
        "hi": round(float(np.quantile(boot, 1 - alpha / 2)), 6) if len(boot) else float("nan"),
        "level": round(1 - alpha, 6),
        "block": block,
        "n_boot": len(draws),
        "n_anchors": n,
    }


def _lag1(x: np.ndarray) -> float | None:
    if len(x) < 3 or np.std(x) == 0:
        return None
    return round(float(np.corrcoef(x[:-1], x[1:])[0, 1]), 4)


def skill_report(
    readings: list[AnchorReading],
    *,
    sufficiency: Sufficiency = DEFAULT_SUFFICIENCY,
    alpha: float = 0.05,
    block: int | None = None,
    n_boot: int = 2000,
    seed: int = 17,
) -> dict:
    """Does the forecast beat its own point-in-time climatology?

    `skill` is `climatology_brier - model_brier`: positive means the forecast
    was closer to the outcomes than always guessing the base rate. Readings
    must be in time order. `alpha` is the family-wise level the caller has
    already divided by its number of comparisons.
    """
    as_of = [r.as_of for r in readings]
    if len(set(as_of)) != len(as_of):
        raise ValueError("duplicate anchors: each anchor may be scored once")
    if as_of != sorted(as_of):
        raise ValueError("readings must be in time order for a block bootstrap")

    n = len(readings)
    outcomes = np.array([r.outcome for r in readings], dtype=float)
    model_p = np.array([r.model_probability for r in readings], dtype=float)
    clim_p = np.array([r.climatology_probability for r in readings], dtype=float)
    events = int(outcomes.sum()) if n else 0
    base = {
        "n_anchors": n,
        "events": events,
        "non_events": n - events,
        "sufficiency": asdict(sufficiency),
        "readings": [
            {"as_of": r.as_of, "model_probability": round(r.model_probability, 4),
             "climatology_probability": round(r.climatology_probability, 4), "outcome": r.outcome}
            for r in readings
        ],
    }
    if n == 0:
        return {**base, "model_brier": None, "climatology_brier": None, "skill": None, "ci": None,
                "verdict": "INCONCLUSIVE — no anchors produced a reading"}

    model_brier = brier_score(outcomes, model_p)
    climatology_brier = brier_score(outcomes, clim_p)
    diffs = (outcomes - clim_p) ** 2 - (outcomes - model_p) ** 2
    report = {
        **base,
        "model_brier": round(model_brier, 6),
        "climatology_brier": round(climatology_brier, 6),
        "skill": round(climatology_brier - model_brier, 6),
        "skill_diff_lag1_autocorr": _lag1(diffs),
    }

    short = []
    if n < sufficiency.min_n:
        short.append(f"n={n} < {sufficiency.min_n}")
    if events < sufficiency.min_events:
        short.append(f"events={events} < {sufficiency.min_events}")
    if n - events < sufficiency.min_non_events:
        short.append(f"non-events={n - events} < {sufficiency.min_non_events}")
    if short:
        return {**report, "ci": None, "verdict": f"INCONCLUSIVE — insufficient sample ({', '.join(short)})"}

    rows = np.column_stack([outcomes, model_p, clim_p])
    ci = _block_bootstrap_ci(
        rows,
        lambda y, pm, pc: brier_score(y, pc) - brier_score(y, pm),
        block=block or default_block_length(n),
        n_boot=n_boot,
        alpha=alpha,
        seed=seed,
    )
    if ci["n_boot"] == 0 or not np.isfinite(ci["lo"]):
        verdict = "INCONCLUSIVE — bootstrap produced no interval"
    elif ci["lo"] > 0:
        verdict = "IMPROVES ON CLIMATOLOGY (CI excludes zero)"
    elif ci["hi"] < 0:
        verdict = "WORSE THAN CLIMATOLOGY (CI excludes zero)"
    else:
        verdict = "NO SIGNIFICANT DIFFERENCE FROM CLIMATOLOGY (CI spans zero)"
    return {**report, "ci": ci, "verdict": verdict}
