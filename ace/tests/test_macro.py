"""Revision risk, spell durations and specification selection.

These are the modules that qualify the quad, so their failure mode is not a
wrong number on screen — it is a right number with a missing caveat. The tests
are built around the specific ways a caveat goes missing:

  * a survival rate computed over months the data has not had time to revise,
    which scores as a survivor by default and flatters the figure
  * an unfinished spell counted as a completed short one, which makes every
    regime look more fragile than it is
  * a specification chosen on the sample it is then reported on
  * a confidence bin quoted from six observations

Synthetic data throughout, so a leak is unambiguous rather than plausible.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.macro.durations import (
    MIN_SPELLS,
    conditional_exit,
    duration_report,
    kaplan_meier,
    median_survival,
    spell_durations,
)
from ace.macro.quads import SPECS, occupancy, runs
from ace.macro.revisions import (
    MARGIN_BINS,
    MIN_BIN,
    MIN_MEDIAN_SPELL_MONTHS,
    SETTLING_MONTHS,
    bin_for,
    confusion,
    margin_calibration,
    settled,
    survival_for,
)


# --- fixtures ---------------------------------------------------------------

def _comparison(rows: list[dict], end: str = "2026-01-31") -> pd.DataFrame:
    """A comparison frame like `revisions.compare` produces."""
    idx = pd.date_range(end=pd.Timestamp(end, tz="UTC"), periods=len(rows), freq="ME")
    out = pd.DataFrame(rows)
    out["as_of"] = [str(d.date()) for d in idx]
    out["bin"] = [bin_for(m) for m in out["margin"]]
    out.index = idx
    return out


def _history(quads: list[int | None], end: str = "2026-01-31") -> pd.DataFrame:
    idx = pd.date_range(end=pd.Timestamp(end, tz="UTC"), periods=len(quads), freq="ME")
    return pd.DataFrame({"quad": quads}, index=idx)


# --- Kaplan-Meier -----------------------------------------------------------

def test_censored_spell_is_not_counted_as_a_death():
    """The defect this module exists to prevent."""
    # Four spells ended at 6 months; a fifth is still running at 2.
    d = np.array([6.0, 6.0, 6.0, 6.0, 2.0])
    o = np.array([True, True, True, True, False])
    curve = kaplan_meier(d, o)
    # At t=6 the risk set is the four that reached it, not all five — the
    # running spell left the risk set when the sample ended, without dying.
    row = curve[curve["t"] == 6.0].iloc[0]
    assert row["at_risk"] == 4
    assert row["deaths"] == 4
    assert row["survival"] == pytest.approx(0.0)
    # Naive arithmetic would have said the mean spell is (6*4+2)/5 = 5.2.
    assert float(d[o].mean()) == pytest.approx(6.0)


def test_survival_is_monotone_and_starts_at_one():
    d = np.array([1.0, 2.0, 2.0, 5.0, 8.0])
    o = np.array([True, True, True, True, True])
    curve = kaplan_meier(d, o)
    s = curve["survival"].to_numpy()
    assert np.all(np.diff(s) <= 1e-12), "survival cannot increase"
    assert curve["survival"].iloc[0] < 1.0


def test_median_is_none_when_the_sample_does_not_contain_it():
    # Most spells still running: the curve never reaches 0.5, and saying so is
    # a real answer rather than a failure.
    d = np.array([3.0, 4.0, 5.0, 6.0, 7.0])
    o = np.array([True, False, False, False, False])
    assert median_survival(kaplan_meier(d, o)) is None


def test_conditional_exit_is_conditional():
    # Deaths at 2 and at 8 only. Given a spell has already reached 4, nothing
    # can end it before 8, so the 3-month window is empty.
    d = np.array([2.0, 8.0, 8.0, 8.0])
    o = np.array([True, True, True, True])
    curve = kaplan_meier(d, o)
    assert conditional_exit(curve, 4, 3) == pytest.approx(0.0)
    assert conditional_exit(curve, 4, 6) == pytest.approx(1.0)


def test_conditional_exit_past_the_last_event_does_not_claim_certainty():
    d = np.array([1.0, 2.0, 3.0])
    o = np.array([True, True, True])
    curve = kaplan_meier(d, o)
    # Survival is zero past t=3, so the ratio is undefined rather than 1.0.
    assert conditional_exit(curve, 10, 3) is None


def test_empty_input_is_handled_rather_than_raising():
    assert kaplan_meier(np.array([]), np.array([], dtype=bool)).empty
    assert median_survival(pd.DataFrame()) is None
    assert conditional_exit(pd.DataFrame(), 3, 3) is None


# --- runs and the duration report -------------------------------------------

def test_runs_marks_only_the_last_spell_censored():
    hist = _history([1, 1, 2, 2, 2, 3])
    table = runs(hist)
    assert list(table["quad"]) == [1, 2, 3]
    assert list(table["months"]) == [2, 3, 1]
    assert list(table["censored"]) == [False, False, True]


def test_duration_report_falls_back_to_pooled_when_a_quad_is_thin():
    # Q4 appears once, at the end, so its own curve cannot support odds.
    hist = _history([1, 1, 2, 2, 3, 3, 1, 1, 2, 2, 3, 3, 1, 1, 2, 2, 4])
    rep = duration_report(runs(hist))
    assert rep["available"]
    assert rep["current"]["quad"] == 4
    assert rep["by_quad"]["4"]["usable"] is False
    assert rep["current"]["basis"] == "all spells pooled"
    assert rep["current"]["basis_n_completed"] == rep["pooled"]["n_completed"]


def test_duration_report_uses_the_quad_curve_when_it_is_thick_enough():
    hist = _history([1, 2] * (MIN_SPELLS + 4))
    rep = duration_report(runs(hist))
    q = rep["current"]["quad"]
    assert rep["by_quad"][str(q)]["usable"] is True
    assert rep["current"]["basis"] == f"Q{q} spells"


def test_spell_durations_filters_by_quad():
    # Two Q1 spells (two months, then three), split by a one-month Q2; the
    # trailing Q2 is the censored one and belongs to the other quad.
    hist = _history([1, 1, 2, 1, 1, 1, 2])
    table = runs(hist)
    d, o = spell_durations(table, 1)
    assert sorted(d.tolist()) == [2.0, 3.0]
    assert o.tolist() == [True, True], "neither Q1 spell is the one still running"
    d2, o2 = spell_durations(table, 2)
    assert sorted(d2.tolist()) == [1.0, 1.0]
    assert sorted(o2.tolist()) == [False, True], "the trailing Q2 spell is censored"


# --- margin bins and calibration --------------------------------------------

def test_margin_bins_tile_the_line():
    los = [b[0] for b in MARGIN_BINS]
    his = [b[1] for b in MARGIN_BINS]
    assert los[0] == 0.0
    assert his[-1] == float("inf")
    for lo, prev_hi in zip(los[1:], his[:-1]):
        assert lo == prev_hi, "bins must meet exactly, with no gap or overlap"


@pytest.mark.parametrize("margin,expected", [
    (0.0, "knife-edge"), (0.249, "knife-edge"), (0.25, "thin"),
    (0.74, "thin"), (0.75, "clear"), (1.99, "clear"), (2.0, "decisive"), (99.0, "decisive"),
])
def test_bin_for_uses_half_open_intervals(margin, expected):
    assert bin_for(margin) == expected


def test_bin_for_refuses_a_missing_margin():
    assert bin_for(None) is None
    assert bin_for(float("nan")) is None


def test_calibration_excludes_months_the_data_has_not_revised_yet():
    """The flattering bug: unsettled months score as survivors by default."""
    now = pd.Timestamp("2026-01-31", tz="UTC")
    old = [{"realtime": 1, "final": 2, "survived": False, "margin": 0.1,
            "data_lag_days": 60} for _ in range(30)]
    # Recent months, all "survived" only because nothing has been revised yet.
    recent = [{"realtime": 1, "final": 1, "survived": True, "margin": 0.1,
               "data_lag_days": 60} for _ in range(SETTLING_MONTHS)]
    cmp = _comparison(old + recent, end="2026-01-31")

    kept = settled(cmp, now)
    assert len(kept) == 30, "the unsettled tail must be dropped"
    cal = margin_calibration(cmp, now=now)
    assert cal["knife-edge"]["survival"] == pytest.approx(0.0)
    # Pooling over everything instead would have reported 18/48 = 37.5%.
    assert float(cmp["survived"].mean()) > 0.3


def test_a_thin_bin_is_reported_but_not_usable():
    now = pd.Timestamp("2026-01-31", tz="UTC")
    rows = [{"realtime": 1, "final": 1, "survived": True, "margin": 3.0,
             "data_lag_days": 60} for _ in range(MIN_BIN - 1)]
    cal = margin_calibration(_comparison(rows, end="2020-01-31"), now=now)
    assert cal["decisive"]["n"] == MIN_BIN - 1
    assert cal["decisive"]["usable"] is False
    assert cal["decisive"]["survival"] == 1.0, "the rate is still reported, just not quotable"


def test_survival_for_passes_the_usable_flag_through():
    now = pd.Timestamp("2026-01-31", tz="UTC")
    rows = [{"realtime": 1, "final": 1, "survived": True, "margin": 3.0,
             "data_lag_days": 60} for _ in range(MIN_BIN - 1)]
    cal = margin_calibration(_comparison(rows, end="2020-01-31"), now=now)
    live = survival_for(3.0, cal)
    assert live["bin"] == "decisive"
    assert live["usable"] is False
    assert survival_for(None, cal) == {"bin": None, "survival": None, "n": 0, "usable": False}


# --- confusion --------------------------------------------------------------

def test_confusion_rows_are_distributions_over_the_revised_answer():
    now = pd.Timestamp("2026-01-31", tz="UTC")
    rows = (
        [{"realtime": 1, "final": 1, "survived": True, "margin": 1.0, "data_lag_days": 60}] * 6
        + [{"realtime": 1, "final": 4, "survived": False, "margin": 0.1, "data_lag_days": 60}] * 4
    )
    conf = confusion(_comparison(rows, end="2020-01-31"), now=now)
    assert conf["1"]["n"] == 10
    assert conf["1"]["to"]["1"] == pytest.approx(0.6)
    assert conf["1"]["to"]["4"] == pytest.approx(0.4)
    assert sum(conf["1"]["to"].values()) == pytest.approx(1.0)
    # A quad that never occurred reports zeros, not a divide-by-zero.
    assert conf["2"]["n"] == 0
    assert all(v == 0.0 for v in conf["2"]["to"].values())


# --- occupancy --------------------------------------------------------------

def test_occupancy_shares_sum_to_one_and_count_switches():
    hist = _history([1, 1, 3, 3, 3, 3, 3, 3, 1, 1, 4, 4])
    occ = occupancy(hist, 12)
    assert occ["months"] == 12
    # Largest-remainder rounding, so the stacked bar cannot overflow its track.
    assert sum(occ["shares"].values()) == pytest.approx(1.0, abs=1e-9)
    assert occ["dominant"] == 3
    assert occ["dominant_share"] == pytest.approx(6 / 12)
    assert occ["tied"] is False
    assert occ["distinct_quads"] == 3
    assert occ["switches"] == 3


def test_occupancy_reports_a_tie_rather_than_picking_a_winner():
    # Five months of Q1 and five of Q3: naming either as "the regime" would be
    # an artefact of index order.
    hist = _history([1, 1, 1, 3, 3, 3, 3, 3, 1, 1, 4, 4])
    occ = occupancy(hist, 12)
    assert occ["tied"] is True
    assert occ["tied_with"] == [3]
    # Rounded to four places, so compare at that precision.
    assert occ["dominant_share"] == pytest.approx(5 / 12, abs=1e-4)


def test_occupancy_window_shorter_than_history_takes_the_tail():
    hist = _history([1] * 20 + [4] * 4)
    occ = occupancy(hist, 3)
    assert occ["months"] == 3
    assert occ["shares"] == {"4": 1.0}
    assert occ["switches"] == 0


def test_occupancy_ignores_unclassified_months():
    hist = _history([None, None, 2, 2, 3])
    occ = occupancy(hist, 12)
    assert occ["months"] == 3
    assert set(occ["shares"]) == {"2", "3"}


# --- the constants are choices, so pin them ---------------------------------

def test_the_persistence_floor_and_settling_window_are_deliberate():
    # Both are pre-registered rules rather than tuned parameters. Pinning them
    # means a later change has to be a decision, not a drift.
    assert MIN_MEDIAN_SPELL_MONTHS == 2.0
    assert SETTLING_MONTHS == 18
    assert MIN_BIN == 20
    assert MIN_SPELLS == 6


def test_every_named_spec_is_internally_consistent():
    for name, spec in SPECS.items():
        assert spec.name == name
        assert spec.growth, f"{name} has no growth series"
        assert spec.inflation, f"{name} has no inflation series"
        assert spec.lookback >= 1
        assert not set(spec.growth) & set(spec.inflation), \
            f"{name} uses a series on both axes"
        assert len(spec.rationale) > 20, f"{name} has no stated rationale"
