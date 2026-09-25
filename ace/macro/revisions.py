"""What revision costs, measured — and the spec chosen by it.

A real-time regime label is a claim about data that is not finished. Payrolls
get two scheduled revisions and an annual benchmark; industrial production is
revised for years. So the honest question is not "what quad is it" but "what
quad is it, and how often does that answer survive?"

This module answers that empirically, by running the SAME arithmetic twice:

    real-time   — first-release vintages, filtered to what was published then
    answer key  — today's fully revised series, cut to the same months

The gap between them is revision risk. It is measurable, it is large, and
almost nobody who sells this framework publishes it.

THREE THINGS FALL OUT OF THE COMPARISON

1. A SURVIVAL RATE per specification — how often the real-time label matched
   what the revised data later said. That is a criterion, so the choice of
   which series go into the composite stops being taste. `select_spec()` picks
   the winner on a training window and re-checks it on a holdout, because
   picking the best of eight on the full sample is selection, not evidence.

2. A CALIBRATION ON MARGIN — bin readings by how far the rates of change sat
   from the boundary, and measure survival within each bin. A reading whose
   growth rate-of-change is +0.03 is not the same claim as one at +2.5, and
   this is how much less of a claim it is.

3. A CONFUSION MATRIX — when the label did change, what it changed INTO.
   Revision does not scatter labels at random: it has a direction, and the
   direction is informative about which way the current label is likely to be
   wrong.

WHAT THIS IS NOT

It is not a forecast of the revision. It is the historical frequency with which
readings like this one held. If the revision process changes, this number is
stale, and the export records the window it was measured over so a reader can
see how old the evidence is.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ace.macro.durations import kaplan_meier, median_survival, spell_durations
from ace.macro.quads import (
    DEFAULT_SPEC,
    QUAD_NAMES,
    SPECS,
    Spec,
    final_reading_at,
    quad_history,
    reading_at,
    runs,
)

#: Margin bins, in percentage points of rate-of-change. The boundaries are
#: fixed in advance rather than fitted to the data, so the calibration is a
#: measurement and not a curve chosen to look monotone.
MARGIN_BINS: tuple[tuple[float, float, str], ...] = (
    (0.0, 0.25, "knife-edge"),
    (0.25, 0.75, "thin"),
    (0.75, 2.0, "clear"),
    (2.0, float("inf"), "decisive"),
)

#: A bin below this many observations reports its count but is not used to
#: calibrate a live reading — a survival rate from six months is noise.
MIN_BIN = 20

#: Readings younger than this are excluded from the survival measurement: the
#: revised series has not had time to revise yet, so they would score as
#: survivors by default and flatter the number.
SETTLING_MONTHS = 18

#: A specification whose median completed spell is shorter than this is not
#: describing a regime, whatever its revision survival — it is describing a
#: month. Pre-registered as an ELIGIBILITY rule rather than folded into the
#: score, so it cannot be traded off against survival to rescue a candidate.
#:
#: Two months is a deliberately weak floor. The honest finding here is that
#: EVERY specification tested sits close to it: on point-in-time monthly data
#: the quad changes roughly every two months under all of them, which is a
#: result about the framework and not about the choice between its variants.
MIN_MEDIAN_SPELL_MONTHS = 2.0


@dataclass(frozen=True)
class SpecScore:
    name: str
    n: int
    survived: int
    survival: float
    n_train: int
    survival_train: float
    n_holdout: int
    survival_holdout: float
    median_lag_days: float
    unclassified: int

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "n": self.n,
            "survived": self.survived,
            "survival": round(self.survival, 4),
            "n_train": self.n_train,
            "survival_train": round(self.survival_train, 4),
            "n_holdout": self.n_holdout,
            "survival_holdout": round(self.survival_holdout, 4),
            "median_lag_days": round(self.median_lag_days, 1),
            "unclassified": self.unclassified,
        }


def bin_for(margin: float | None) -> str | None:
    """Which margin bin a reading falls in, or None if it has no margin."""
    if margin is None or not np.isfinite(margin):
        return None
    for lo, hi, label in MARGIN_BINS:
        if lo <= margin < hi:
            return label
    return MARGIN_BINS[-1][2]


def compare(
    dates: pd.DatetimeIndex,
    vintages: dict[str, pd.DataFrame],
    finals: dict[str, pd.Series],
    *,
    spec: Spec | str = DEFAULT_SPEC,
) -> pd.DataFrame:
    """Real-time label against the revised answer for the same months.

    The answer key is cut to the real-time reading's own newest observation
    month, so the two differ only in how revised the values are — not in how
    much data each one saw.
    """
    spec = SPECS[spec] if isinstance(spec, str) else spec
    rows = []
    for d in dates:
        rt = reading_at(d, vintages, spec=spec)
        if rt.quad is None:
            rows.append({"as_of": str(pd.Timestamp(d).date()), "realtime": None,
                         "final": None, "survived": None, "margin": None,
                         "bin": None, "data_lag_days": None})
            continue
        through = max(
            pd.Timestamp(rt.growth_through, tz="UTC"),
            pd.Timestamp(rt.inflation_through, tz="UTC"),
        )
        fin = final_reading_at(d, finals, spec=spec, through=through)
        rows.append({
            "as_of": str(pd.Timestamp(d).date()),
            "realtime": rt.quad,
            "final": fin.quad,
            "survived": None if fin.quad is None else bool(rt.quad == fin.quad),
            "margin": rt.margin,
            "bin": bin_for(rt.margin),
            "data_lag_days": rt.data_lag_days,
            "growth_roc_rt": rt.growth_roc,
            "growth_roc_final": fin.growth_roc,
            "inflation_roc_rt": rt.inflation_roc,
            "inflation_roc_final": fin.inflation_roc,
        })
    out = pd.DataFrame(rows)
    out.index = pd.DatetimeIndex(dates)
    return out


def settled(cmp: pd.DataFrame, now: pd.Timestamp | None = None) -> pd.DataFrame:
    """Drop readings too recent for the revised data to have revised yet.

    Public because every consumer must use the SAME sample. Computing a pooled
    survival rate over all comparisons while the per-bin rates use only the
    settled ones produces two numbers that describe different things and a
    pooled figure flattered by months that have not had time to be revised.
    """
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    cutoff = now - pd.DateOffset(months=SETTLING_MONTHS)
    idx = cmp.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    return cmp[(idx <= cutoff) & cmp["survived"].notna()]


def score_spec(
    cmp: pd.DataFrame,
    name: str,
    *,
    train_frac: float = 0.70,
    now: pd.Timestamp | None = None,
) -> SpecScore:
    """Survival rate for one spec, split chronologically."""
    sel_all = settled(cmp, now)
    n = int(len(sel_all))
    if n == 0:
        return SpecScore(name, 0, 0, float("nan"), 0, float("nan"), 0, float("nan"),
                         float("nan"), int(cmp["realtime"].isna().sum()))
    cut = int(n * train_frac)
    tr, ho = sel_all.iloc[:cut], sel_all.iloc[cut:]
    surv = int(sel_all["survived"].sum())
    return SpecScore(
        name=name,
        n=n,
        survived=surv,
        survival=surv / n,
        n_train=int(len(tr)),
        survival_train=float(tr["survived"].mean()) if len(tr) else float("nan"),
        n_holdout=int(len(ho)),
        survival_holdout=float(ho["survived"].mean()) if len(ho) else float("nan"),
        median_lag_days=float(sel_all["data_lag_days"].median()),
        unclassified=int(cmp["realtime"].isna().sum()),
    )


def select_spec(
    dates: pd.DatetimeIndex,
    vintages: dict[str, pd.DataFrame],
    finals: dict[str, pd.Series],
    *,
    specs: dict[str, Spec] | None = None,
    train_frac: float = 0.70,
    now: pd.Timestamp | None = None,
) -> dict:
    """Pick the specification whose real-time label most often survives.

    Chosen on the TRAINING window only. The holdout number is then reported for
    the winner and for every rival, so a reader can see whether the choice held
    up or whether eight candidates on one sample simply produced a lucky one.

    Ties go to the spec with the shorter publication lag: if two composites are
    equally durable, the one that knows sooner is worth more.
    """
    specs = SPECS if specs is None else specs
    comparisons = {name: compare(dates, vintages, finals, spec=s) for name, s in specs.items()}
    scores = {name: score_spec(c, name, train_frac=train_frac, now=now)
              for name, c in comparisons.items()}
    persistence = {name: spell_stats(dates, vintages, spec=s) for name, s in specs.items()}

    eligible: dict[str, str | None] = {}
    for name in specs:
        med = persistence[name]["median_months"]
        if med is None or med < MIN_MEDIAN_SPELL_MONTHS:
            eligible[name] = (
                f"median spell {med if med is not None else 'unmeasurable'} months is below "
                f"the {MIN_MEDIAN_SPELL_MONTHS:g}-month floor — this labels months, not regimes"
            )
        else:
            eligible[name] = None

    usable = [
        s for s in scores.values()
        if s.n_train > 0 and np.isfinite(s.survival_train) and eligible.get(s.name) is None
    ]
    if not usable:
        raise ValueError("no specification is both persistent enough and scorable")
    best = max(usable, key=lambda s: (round(s.survival_train, 4), -s.median_lag_days))

    ranked_holdout = sorted(
        (s for s in usable if np.isfinite(s.survival_holdout)),
        key=lambda s: -s.survival_holdout,
    )
    holdout_rank = next(
        (i + 1 for i, s in enumerate(ranked_holdout) if s.name == best.name), None
    )
    return {
        "chosen": best.name,
        "criterion": "among specifications whose median spell clears the persistence "
                     f"floor of {MIN_MEDIAN_SPELL_MONTHS:g} months, the highest share of "
                     "real-time labels that survived revision, measured on the training "
                     "window; ties to the shorter publication lag",
        "train_frac": train_frac,
        "settling_months": SETTLING_MONTHS,
        "persistence_floor_months": MIN_MEDIAN_SPELL_MONTHS,
        "scores": {n: s.to_dict() for n, s in scores.items()},
        "persistence": persistence,
        "eligible": {n: (r is None) for n, r in eligible.items()},
        "disqualified": {n: r for n, r in eligible.items() if r is not None},
        "chosen_holdout_rank": holdout_rank,
        "n_candidates_ranked": len(ranked_holdout),
        "comparisons": comparisons,
    }


def spell_stats(
    dates: pd.DatetimeIndex,
    vintages: dict[str, pd.DataFrame],
    *,
    spec: Spec | str = DEFAULT_SPEC,
) -> dict:
    """How long this specification's regimes actually last.

    Right-censored, so the spell still running contributes to the risk set
    without being counted as a short completed one. `share_ge_quarter` is the
    number that matters against the framework's own claim: quads are presented
    as quarterly regimes, so the share of spells reaching three months is the
    share that behaves the way the framework says they do.
    """
    spec = SPECS[spec] if isinstance(spec, str) else spec
    hist = quad_history(dates, spec=spec, vintages=vintages)
    table = runs(hist)
    if table.empty:
        return {"n_spells": 0, "median_months": None, "mean_completed_months": None,
                "share_ge_quarter": None}
    d, o = spell_durations(table)
    completed = d[o]
    curve = kaplan_meier(d, o)
    return {
        "n_spells": int(len(table)),
        "n_completed": int(o.sum()),
        "median_months": median_survival(curve),
        "mean_completed_months": round(float(completed.mean()), 2) if completed.size else None,
        "share_ge_quarter": round(float(np.mean(completed >= 3)), 4) if completed.size else None,
    }


def margin_calibration(cmp: pd.DataFrame, now: pd.Timestamp | None = None) -> dict:
    """Survival rate by how far the reading sat from a boundary.

    This is what makes a margin mean something on screen. Without it, "margin
    0.08" is a number; with it, it is "readings this close held 6 times in 10".
    """
    sel_all = settled(cmp, now)
    out = {}
    for lo, hi, label in MARGIN_BINS:
        sel = sel_all[sel_all["bin"] == label]
        n = int(len(sel))
        out[label] = {
            "lo": lo,
            "hi": None if not np.isfinite(hi) else hi,
            "n": n,
            "survived": int(sel["survived"].sum()) if n else 0,
            "survival": round(float(sel["survived"].mean()), 4) if n else None,
            "usable": bool(n >= MIN_BIN),
        }
    return out


def confusion(cmp: pd.DataFrame, now: pd.Timestamp | None = None) -> dict:
    """Where a real-time label ended up once the data settled.

    Rows are the real-time quad, columns what the revised data said. The
    diagonal is survival; the off-diagonal says which way the mistakes go.
    """
    sel_all = settled(cmp, now)
    mat = {q: {c: 0 for c in (1, 2, 3, 4)} for q in (1, 2, 3, 4)}
    for _, r in sel_all.iterrows():
        mat[int(r["realtime"])][int(r["final"])] += 1
    out = {}
    for q in (1, 2, 3, 4):
        total = sum(mat[q].values())
        out[str(q)] = {
            "name": QUAD_NAMES[q],
            "n": total,
            "to": {str(c): (round(mat[q][c] / total, 4) if total else 0.0) for c in (1, 2, 3, 4)},
            "counts": {str(c): mat[q][c] for c in (1, 2, 3, 4)},
        }
    return out


def survival_for(margin: float | None, calibration: dict) -> dict:
    """The measured survival rate for a live reading's margin, or an honest miss.

    Returns the bin, its rate, and whether the bin had enough observations to
    be worth quoting. A caller that gets `usable: False` must render the
    absence, not fall back to the pooled rate — the pooled rate is dominated by
    decisive readings and would flatter a knife-edge one.
    """
    label = bin_for(margin)
    if label is None:
        return {"bin": None, "survival": None, "n": 0, "usable": False}
    row = calibration.get(label, {})
    return {
        "bin": label,
        "survival": row.get("survival"),
        "n": row.get("n", 0),
        "usable": bool(row.get("usable")),
    }
