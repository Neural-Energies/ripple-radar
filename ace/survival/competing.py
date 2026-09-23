"""Competing-risks engine (§3 Engine 2): which event happens next, and when?

ACE does not only ask what happens — it asks what happens FIRST. After a
material event, several distinct developments are possible and only one can
be the next one. That is a competing-risks problem, not a sequence of
independent binary questions.

Why the distinction matters, concretely: if you model "does escalation occur
within 30 days" with ordinary survival analysis and treat de-escalation as
censoring, you estimate the probability of escalation in a world where
de-escalation never happens. That number is always too high. The cumulative
incidence function is the quantity that answers the real question — the
probability that event type k occurs first, by time t, accounting for the
others racing against it.

  CIF_k(t) = P(T <= t AND cause = k)

and sum_k CIF_k(t) + P(no event by t) = 1, which is the closure property a
scenario set needs.

Estimated by Aalen-Johansen, which is non-parametric: no proportional-hazards
assumption, no distributional shape imposed on the waiting times.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from sksurv.nonparametric import cumulative_incidence_competing_risks


@dataclass(frozen=True)
class CompetingRisksFit:
    causes: list[str]
    n_subjects: int
    n_censored: int
    horizon_grid: list[float]
    # cif[cause][i] = P(cause occurs first by horizon_grid[i])
    cif: dict[str, list[float]]
    event_counts: dict[str, int]
    median_time: dict[str, float | None]

    def to_dict(self) -> dict:
        return asdict(self)

    def probabilities_at(self, t: float) -> dict[str, float]:
        """CIF for each cause at horizon t, plus the probability nothing happens."""
        grid = np.asarray(self.horizon_grid)
        idx = int(np.searchsorted(grid, t, side="right") - 1)
        idx = max(0, min(idx, len(grid) - 1))
        out = {c: round(float(self.cif[c][idx]), 6) for c in self.causes}
        out["no_event"] = round(max(0.0, 1.0 - sum(out.values())), 6)
        return out


def fit_competing_risks(
    durations: np.ndarray,
    causes: np.ndarray,
    cause_names: dict[int, str],
    *,
    grid: np.ndarray | None = None,
) -> CompetingRisksFit:
    """Aalen-Johansen cumulative incidence for each competing cause.

    `causes` uses 0 for censored (nothing happened before the window closed)
    and 1..K for the observed cause. Censoring is not a missing value here —
    it is the real and common outcome that nothing material happened yet, and
    dropping those rows would bias every estimate upward.
    """
    d = np.asarray(durations, dtype=float)
    c = np.asarray(causes, dtype=int)
    if len(d) != len(c):
        raise ValueError(f"length mismatch: {len(d)} durations, {len(c)} causes")
    ok = np.isfinite(d) & (d > 0)
    d, c = d[ok], c[ok]
    if len(d) < 50:
        raise ValueError(f"need >=50 subjects, got {len(d)}")
    # Aalen-Johansen needs at least two competing causes. With one, the
    # question is plain survival and the answer is the Kaplan-Meier
    # complement — a different estimator. Say so rather than letting the
    # underlying library fail on an array shape.
    if len(cause_names) < 2:
        raise ValueError(
            "competing risks needs >=2 causes; for a single cause use "
            "Kaplan-Meier (1 - survival) instead"
        )
    observed = {int(k) for k in np.unique(c) if k != 0}
    missing = observed - set(cause_names)
    if missing:
        raise ValueError(f"causes {sorted(missing)} present in data but not named")

    times, cif_all = cumulative_incidence_competing_risks(c, d)

    if grid is None:
        grid = np.unique(np.quantile(d, np.linspace(0.01, 0.99, 60)))

    names = [cause_names[k] for k in sorted(cause_names)]
    cif: dict[str, list[float]] = {}
    medians: dict[str, float | None] = {}
    counts: dict[str, int] = {}

    for k, name in zip(sorted(cause_names), names):
        # cif_all[0] is the overall survival complement; causes start at index 1
        curve = np.asarray(cif_all[k])
        vals = np.interp(grid, times, curve, left=0.0, right=float(curve[-1]))
        cif[name] = [round(float(v), 6) for v in vals]
        counts[name] = int(np.sum(c == k))
        # "median" here is where this cause's CIF reaches half its plateau —
        # a cause that never reaches half its own total has no median.
        plateau = float(curve[-1])
        medians[name] = (
            round(float(np.interp(plateau / 2, curve, times)), 4) if plateau > 1e-9 else None
        )

    return CompetingRisksFit(
        causes=names,
        n_subjects=int(len(d)),
        n_censored=int(np.sum(c == 0)),
        horizon_grid=[round(float(g), 4) for g in grid],
        cif=cif,
        event_counts=counts,
        median_time=medians,
    )


def calibration_by_horizon(
    fit: CompetingRisksFit,
    durations: np.ndarray,
    causes: np.ndarray,
    cause_names: dict[int, str],
    horizons: tuple[float, ...],
) -> list[dict]:
    """Predicted CIF vs realized frequency at fixed horizons, out of sample.

    The honest test of a competing-risks model: of the subjects observed long
    enough to know, how many actually had cause k first by time t, against
    what the fitted CIF said.
    """
    d = np.asarray(durations, dtype=float)
    c = np.asarray(causes, dtype=int)
    rows: list[dict] = []
    for t in horizons:
        pred = fit.probabilities_at(t)
        # A subject is informative at horizon t if it either had an event by t,
        # or was followed past t without one.
        informative = (d <= t) | (d > t)
        for k, name in sorted(cause_names.items()):
            realized = float(np.mean((c[informative] == k) & (d[informative] <= t)))
            rows.append({
                "horizon": float(t),
                "cause": name,
                "predicted": round(float(pred[name]), 4),
                "realized": round(realized, 4),
                "error": round(float(pred[name]) - realized, 4),
                "n": int(informative.sum()),
            })
    return rows
