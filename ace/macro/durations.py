"""How long a regime lasts, with the current one counted correctly.

The obvious way to answer "how long does a quad last" is to average the run
lengths in the history. That answer is wrong, and wrong in a predictable
direction.

The spell we are in right now has not ended. Its observed length is a LOWER
BOUND on its eventual length, not a measurement of it — and every long spell in
progress gets recorded short by exactly this mistake. Dropping it instead is no
better: that throws away the observation most relevant to the present. Both
roads bias the estimate downward, which is the direction that makes a regime
look more fragile than it is.

The correct treatment is right-censoring, which is what Kaplan-Meier is for: an
unfinished spell contributes to the risk set for every month it has survived
and never contributes a death. That is what this module does.

IT ALSO ANSWERS THE MORE USEFUL QUESTION

Not "how long do quads last" but "given this one has already run eleven months,
what is the chance it ends within the next three?" That is a conditional hazard
and it is what a reader actually wants when the panel says the regime has been
Q1 since March.

WHAT IT IS NOT

Descriptive, entirely. It is the historical distribution of spell lengths in
this sample, not a forecast, and with roughly two dozen completed spells across
four quads the per-quad curves are thin. The export reports the number of
spells behind every curve so a reader can discount a pooled-only answer.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

#: A per-quad curve below this many completed spells is reported but flagged
#: unusable — four completed runs cannot support a median.
MIN_SPELLS = 6


def kaplan_meier(durations: np.ndarray, observed: np.ndarray) -> pd.DataFrame:
    """Survival curve with right-censoring, computed directly.

    `durations[i]` is months survived; `observed[i]` is True if the spell ended
    (a "death") and False if it was still running when the sample stopped.

    Returns one row per distinct event time: the risk set, deaths, the hazard
    at that time, and the surviving fraction after it.
    """
    durations = np.asarray(durations, dtype=float)
    observed = np.asarray(observed, dtype=bool)
    if durations.size == 0:
        return pd.DataFrame(columns=["t", "at_risk", "deaths", "censored", "hazard", "survival"])

    rows = []
    s = 1.0
    for t in np.unique(durations[observed]):
        at_risk = int(np.sum(durations >= t))
        deaths = int(np.sum((durations == t) & observed))
        censored = int(np.sum((durations == t) & ~observed))
        if at_risk == 0:
            continue
        h = deaths / at_risk
        s *= 1.0 - h
        rows.append({
            "t": float(t),
            "at_risk": at_risk,
            "deaths": deaths,
            "censored": censored,
            "hazard": round(h, 6),
            "survival": round(s, 6),
        })
    return pd.DataFrame(rows)


def median_survival(curve: pd.DataFrame) -> float | None:
    """First time the survival curve drops to 0.5 or below.

    None when it never does — which happens when the longest spells are all
    still running, and is a real answer rather than a failure: the sample does
    not contain the median yet.
    """
    if curve.empty:
        return None
    below = curve[curve["survival"] <= 0.5]
    return None if below.empty else float(below["t"].iloc[0])


def conditional_exit(curve: pd.DataFrame, elapsed: float, within: int) -> float | None:
    """P(spell ends in the next `within` months | it has lasted `elapsed`).

    This is the number a reader wants when a panel says "Q1 since March". It is
    one minus the ratio of survival at `elapsed + within` to survival at
    `elapsed`, which is exactly the conditional probability the curve encodes.
    """
    if curve.empty:
        return None
    s_now = _survival_at(curve, elapsed)
    s_then = _survival_at(curve, elapsed + within)
    if s_now is None or s_then is None or s_now <= 0:
        return None
    return float(max(0.0, min(1.0, 1.0 - s_then / s_now)))


def _survival_at(curve: pd.DataFrame, t: float) -> float | None:
    """Step-function lookup: survival after the last event at or before `t`."""
    if curve.empty:
        return None
    prior = curve[curve["t"] <= t]
    if prior.empty:
        return 1.0
    # Beyond the last observed event the curve is flat, not zero — treating it
    # as zero would claim certainty the data does not have.
    return float(prior["survival"].iloc[-1])


def spell_durations(runs: pd.DataFrame, quad: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """(durations, observed) for all spells, or for one quad."""
    sel = runs if quad is None else runs[runs["quad"] == quad]
    if sel.empty:
        return np.array([]), np.array([], dtype=bool)
    return sel["months"].to_numpy(dtype=float), (~sel["censored"].to_numpy(dtype=bool))


def duration_report(runs: pd.DataFrame, *, horizons: tuple[int, ...] = (1, 3, 6)) -> dict:
    """Pooled and per-quad survival, plus the current spell's conditional exit.

    The pooled curve is the one to quote. Per-quad curves are reported with
    their spell counts and a `usable` flag, because four completed runs of Q2
    cannot support a median no matter how confidently it prints.
    """
    if runs.empty:
        return {"available": False, "reason": "no classified spells"}

    out: dict = {"available": True, "horizons": list(horizons)}

    d, o = spell_durations(runs)
    pooled = kaplan_meier(d, o)
    out["pooled"] = {
        "n_spells": int(len(runs)),
        "n_completed": int(o.sum()),
        "n_censored": int((~o).sum()),
        "median_months": median_survival(pooled),
        "mean_completed_months": round(float(d[o].mean()), 2) if o.any() else None,
        "curve": pooled.to_dict("records"),
        "usable": bool(o.sum() >= MIN_SPELLS),
    }

    out["by_quad"] = {}
    for q in (1, 2, 3, 4):
        dq, oq = spell_durations(runs, q)
        if dq.size == 0:
            out["by_quad"][str(q)] = {"n_spells": 0, "n_completed": 0, "usable": False,
                                      "median_months": None, "curve": []}
            continue
        cq = kaplan_meier(dq, oq)
        out["by_quad"][str(q)] = {
            "n_spells": int(dq.size),
            "n_completed": int(oq.sum()),
            "n_censored": int((~oq).sum()),
            "median_months": median_survival(cq),
            "mean_completed_months": round(float(dq[oq].mean()), 2) if oq.any() else None,
            "curve": cq.to_dict("records"),
            "usable": bool(oq.sum() >= MIN_SPELLS),
        }

    current = runs.iloc[-1]
    elapsed = float(current["months"])
    q = int(current["quad"])
    per_quad = out["by_quad"][str(q)]
    # Use the per-quad curve only when it has the spells to support one;
    # otherwise the pooled curve, and say which was used.
    use_quad = bool(per_quad["usable"])
    curve = pd.DataFrame(per_quad["curve"] if use_quad else out["pooled"]["curve"])
    out["current"] = {
        "quad": q,
        "elapsed_months": elapsed,
        "censored": bool(current["censored"]),
        "start": str(pd.Timestamp(current["start"]).date()),
        "basis": f"Q{q} spells" if use_quad else "all spells pooled",
        "basis_n_completed": per_quad["n_completed"] if use_quad else out["pooled"]["n_completed"],
        "exit_within": {
            str(h): (None if (v := conditional_exit(curve, elapsed, h)) is None else round(v, 4))
            for h in horizons
        },
        "beyond_sample": bool(not curve.empty and elapsed > float(curve["t"].max())),
    }
    return out
