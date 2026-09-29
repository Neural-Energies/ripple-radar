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

THE CURVE IS A STEP FUNCTION, AND IS STORED AND READ AS ONE

An Aalen-Johansen CIF only moves at an event time and is right-continuous.
The curve is kept at exactly those jump times — nothing is lost — and read by
step lookup: zero before the first event, the value at the last jump at or
before t otherwise. An earlier version resampled it onto a quantile grid with
linear interpolation, which invented probability between jumps (0.75 at day
15 for a curve that is 0.5 until day 20) and reported the first grid value
for any horizon before it (0.5 at day 0 for a curve that starts at day 10).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

#: Holdout subjects still under observation at a horizon below which a
#: realized incidence is reported but not scored.
MIN_AT_RISK = 30


def aalen_johansen(
    durations: np.ndarray, causes: np.ndarray, cause_ids: list[int]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cumulative incidence of each cause at every event time.

    Returns (times, cif, at_risk): `times` are the distinct event times of any
    cause, `cif[i, j]` the incidence of `cause_ids[i]` by `times[j]`, and
    `at_risk[j]` the subjects still under observation at `times[j]` (a
    subject censored at an event time is at risk for it, the standard
    convention). A named cause with no events has a flat zero row, and one
    observed cause alone is fine — the library estimator this replaces
    failed on both.
    """
    d = np.asarray(durations, dtype=float)
    c = np.asarray(causes, dtype=int)
    ids = list(cause_ids)
    event = c != 0
    times, total = np.unique(d[event], return_counts=True)
    if len(times) == 0:
        return times, np.zeros((len(ids), 0)), np.zeros(0, dtype=int)
    at_risk = len(d) - np.searchsorted(np.sort(d), times, side="left")
    per_cause = np.zeros((len(ids), len(times)))
    for i, k in enumerate(ids):
        u, n = np.unique(d[c == k], return_counts=True)
        if len(u):
            per_cause[i, np.searchsorted(times, u)] = n
    surv_after = np.cumprod(1.0 - total / at_risk)
    surv_before = np.concatenate([[1.0], surv_after[:-1]])
    cif = np.cumsum(surv_before * per_cause / at_risk, axis=1)
    return times, cif, at_risk


def _step(times: np.ndarray, values: np.ndarray, t: float) -> float:
    """Right-continuous step lookup; zero before the first jump."""
    i = int(np.searchsorted(times, t, side="right")) - 1
    return 0.0 if i < 0 else float(values[i])


@dataclass(frozen=True)
class CompetingRisksFit:
    causes: list[str]
    n_subjects: int
    n_censored: int
    # Every jump time of any cause, led by 0.0 so the table itself says
    # "nothing yet" before the first event. cif[cause][i] = P(cause occurs
    # first by horizon_grid[i]), constant until horizon_grid[i + 1].
    horizon_grid: list[float]
    cif: dict[str, list[float]]
    event_counts: dict[str, int]
    median_time: dict[str, float | None]
    #: Longest follow-up in the fitted sample. The curve is not measured past it.
    max_follow_up: float = float("nan")

    def to_dict(self) -> dict:
        return asdict(self)

    def probabilities_at(self, t: float) -> dict[str, float]:
        """CIF for each cause at horizon t, plus the probability nothing happens."""
        grid = np.asarray(self.horizon_grid, dtype=float)
        out = {c: round(_step(grid, np.asarray(self.cif[c]), t), 6) for c in self.causes}
        out["no_event"] = round(max(0.0, 1.0 - sum(out.values())), 6)
        return out


def fit_competing_risks(
    durations: np.ndarray,
    causes: np.ndarray,
    cause_names: dict[int, str],
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

    ids = sorted(cause_names)
    times, curves, _ = aalen_johansen(d, c, ids)

    names = [cause_names[k] for k in ids]
    cif: dict[str, list[float]] = {}
    medians: dict[str, float | None] = {}
    counts: dict[str, int] = {}

    for i, (k, name) in enumerate(zip(ids, names)):
        curve = curves[i]
        cif[name] = [0.0] + [round(float(v), 6) for v in curve]
        counts[name] = int(np.sum(c == k))
        # "median" here is the first time this cause's CIF reaches half its
        # plateau — read off the step function, not interpolated between
        # jumps. A cause with no events has no median.
        plateau = float(curve[-1]) if len(curve) else 0.0
        medians[name] = (
            round(float(times[int(np.argmax(curve >= plateau / 2))]), 4) if plateau > 1e-9 else None
        )

    return CompetingRisksFit(
        causes=names,
        n_subjects=int(len(d)),
        n_censored=int(np.sum(c == 0)),
        # Full precision: catalog times carry milliseconds, and rounding to
        # 1e-6 days merged distinct jumps into duplicate knots.
        horizon_grid=[0.0] + [float(g) for g in times],
        cif=cif,
        event_counts=counts,
        median_time=medians,
        max_follow_up=round(float(d.max()), 6),
    )


def calibration_by_horizon(
    fit: CompetingRisksFit,
    durations: np.ndarray,
    causes: np.ndarray,
    cause_names: dict[int, str],
    horizons: tuple[float, ...],
    *,
    min_at_risk: int = MIN_AT_RISK,
    n_boot: int = 500,
    seed: int = 17,
) -> list[dict]:
    """Predicted CIF vs the holdout's own Aalen-Johansen CIF, by horizon.

    The realized side must be censor-aware. An earlier version counted a
    holdout subject censored BEFORE t as a known "no event by t" — its
    `informative` mask was `(d <= t) | (d > t)`, which is everything. With 50
    subjects censored on day 1, 25 events on day 2 and 25 followed to day 20,
    it reported 0.25 incidence by day 10; the risk-set answer is 0.50 (25
    events among the 50 still observed). Deleting early-censored subjects
    instead would not be unbiased in general either, so the holdout gets the
    same estimator the fit does.

    `supported` is False when the holdout was not followed to t, or fewer than
    `min_at_risk` subjects were still observed there; such rows are reported
    and must not be scored. `realized_ci` is a 95% subject-bootstrap interval.
    """
    d = np.asarray(durations, dtype=float)
    c = np.asarray(causes, dtype=int)
    ids = sorted(cause_names)
    times, curves, _ = aalen_johansen(d, c, ids)

    rng = np.random.default_rng(seed)
    draws = np.full((n_boot, len(horizons), len(ids)), np.nan)
    for b in range(n_boot):
        idx = rng.integers(0, len(d), size=len(d))
        bt, bc, _ = aalen_johansen(d[idx], c[idx], ids)
        for h, t in enumerate(horizons):
            for i in range(len(ids)):
                draws[b, h, i] = _step(bt, bc[i], t)

    rows: list[dict] = []
    for h, t in enumerate(horizons):
        pred = fit.probabilities_at(t)
        n_at_risk = int(np.sum(d >= t))
        supported = bool(len(d) and d.max() >= t and n_at_risk >= min_at_risk)
        for i, k in enumerate(ids):
            name = cause_names[k]
            realized = _step(times, curves[i], t)
            lo, hi = np.nanquantile(draws[:, h, i], [0.025, 0.975]) if n_boot else (np.nan, np.nan)
            rows.append({
                "horizon": float(t),
                "cause": name,
                "predicted": round(float(pred[name]), 4),
                "realized": round(realized, 4),
                "realized_ci": [round(float(lo), 4), round(float(hi), 4)],
                "error": round(float(pred[name]) - realized, 4),
                "n": int(len(d)),
                "n_at_risk": n_at_risk,
                "supported": supported,
            })
    return rows
