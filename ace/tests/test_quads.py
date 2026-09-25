"""Growth/inflation quad tests — the point-in-time discipline, mostly.

The classification itself is two comparisons and is hard to get wrong. What is
easy to get wrong, and invisible once it is wrong, is letting a value the
classification date could not have known into the reading. Every test here is
built to catch that: the vintages are synthetic, so a leak is unambiguous
rather than a plausible-looking number.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.macro.quads import (
    MIN_OBSERVATIONS_BASE,
    SPECS,
    classify,
    known_at,
    reading_at,
    transitions,
)

#: The fixtures below all use the default three-month lookback.
LOOKBACK = SPECS["fast"].lookback
MIN_OBSERVATIONS = MIN_OBSERVATIONS_BASE + LOOKBACK


def _vintage(values: dict[str, float], lag_days: int = 45) -> pd.DataFrame:
    """A first-release history: each month published `lag_days` after it ends."""
    obs = pd.to_datetime(list(values), utc=True)
    return pd.DataFrame(
        {
            "obs_date": obs,
            "value": list(values.values()),
            "published": obs + pd.Timedelta(days=lag_days),
        }
    )


def _ramp(start: str, n: int, first: float, step: float) -> dict[str, float]:
    idx = pd.date_range(start, periods=n, freq="MS")
    return {str(d.date()): first + step * i for i, d in enumerate(idx)}


def test_classify_is_the_two_by_two():
    assert classify(+1.0, -1.0) == 1   # growth up, inflation down
    assert classify(+1.0, +1.0) == 2   # both up
    assert classify(-1.0, +1.0) == 3   # growth down, inflation up
    assert classify(-1.0, -1.0) == 4   # both down


def test_classify_puts_flat_on_the_accelerating_side():
    # A boundary has to fall somewhere; it falls on "not decelerating", and
    # the test pins it so a later refactor cannot flip it silently.
    assert classify(0.0, 0.0) == 2
    assert classify(0.0, -1.0) == 1
    assert classify(-1.0, 0.0) == 3


def test_known_at_hides_values_not_yet_published():
    hist = _vintage(_ramp("2020-01-01", 6, 100.0, 1.0), lag_days=45)
    # 2020-03-01 publishes 2020-04-15; on 2020-04-01 it does not exist.
    seen = known_at(hist, pd.Timestamp("2020-04-01", tz="UTC"))
    assert str(seen.index.max().date()) == "2020-02-01"
    later = known_at(hist, pd.Timestamp("2020-04-20", tz="UTC"))
    assert str(later.index.max().date()) == "2020-03-01"


def test_known_at_keeps_the_first_release_not_the_revision():
    obs = pd.Timestamp("2020-01-01", tz="UTC")
    hist = pd.DataFrame(
        {
            "obs_date": [obs, obs],
            "value": [100.0, 180.0],
            "published": [
                pd.Timestamp("2020-02-15", tz="UTC"),
                pd.Timestamp("2020-08-15", tz="UTC"),
            ],
        }
    )
    seen = known_at(hist, pd.Timestamp("2021-01-01", tz="UTC"))
    # The revision is public by 2021, but it was not the number anyone acted
    # on — a backtest that uses 180 is trading on hindsight.
    assert seen.loc[obs] == 100.0


def test_reading_uses_only_published_months():
    n = MIN_OBSERVATIONS + 6
    vintages = {
        "INDPRO": _vintage(_ramp("2018-01-01", n, 100.0, 1.0), lag_days=45),
        "PAYEMS": _vintage(_ramp("2018-01-01", n, 150.0, 1.5), lag_days=34),
        "CPIAUCSL": _vintage(_ramp("2018-01-01", n, 250.0, 0.5), lag_days=45),
    }
    when = pd.Timestamp("2020-06-30", tz="UTC")
    r = reading_at(when, vintages, spec="fast")
    assert r.quad is not None
    # Newest input observation must predate the classification date, always.
    assert pd.Timestamp(r.growth_through, tz="UTC") < when
    assert pd.Timestamp(r.inflation_through, tz="UTC") < when
    assert r.data_lag_days > 0


def test_reading_is_unclassified_without_enough_history():
    short = {
        "INDPRO": _vintage(_ramp("2020-01-01", 4, 100.0, 1.0)),
        "PAYEMS": _vintage(_ramp("2020-01-01", 4, 150.0, 1.0)),
        "CPIAUCSL": _vintage(_ramp("2020-01-01", 4, 250.0, 1.0)),
    }
    r = reading_at(pd.Timestamp("2020-06-30", tz="UTC"), short, spec="fast")
    assert r.quad is None
    assert r.name == "unclassified"
    assert "not enough" in r.reason


def test_a_future_revision_cannot_change_a_past_reading():
    """The regression that matters: appending later data leaves history alone."""
    n = MIN_OBSERVATIONS + 6
    base = {
        "INDPRO": _vintage(_ramp("2018-01-01", n, 100.0, 1.0), lag_days=45),
        "PAYEMS": _vintage(_ramp("2018-01-01", n, 150.0, 1.5), lag_days=34),
        "CPIAUCSL": _vintage(_ramp("2018-01-01", n, 250.0, 0.5), lag_days=45),
    }
    when = pd.Timestamp("2020-06-30", tz="UTC")
    before = reading_at(when, base, spec="fast")

    # Now add a violent revision and several more months, all published later.
    revised = {}
    for sid, hist in base.items():
        extra = _vintage(_ramp("2020-06-01", 8, 999.0, -50.0), lag_days=45)
        revised[sid] = pd.concat([hist, extra], ignore_index=True)
    after = reading_at(when, revised, spec="fast")

    assert before.to_dict() == after.to_dict()


def test_roc_is_the_second_derivative_not_the_level():
    """A quad can read Goldilocks while growth is negative in level."""
    # Growth: deeply negative year-on-year, but improving quarter on quarter.
    n = MIN_OBSERVATIONS + 12
    idx = pd.date_range("2018-01-01", periods=n, freq="MS")
    # A V: falls hard, then recovers. Year-on-year stays negative through the
    # early recovery while the rate of change has already turned up.
    level = np.concatenate([
        np.linspace(100, 100, 12),
        np.linspace(100, 70, 8),
        np.linspace(70, 88, n - 20),
    ])
    growth = _vintage({str(d.date()): float(v) for d, v in zip(idx, level)}, lag_days=45)
    # Inflation decelerating.
    infl_level = np.concatenate([
        np.linspace(100, 108, 20),
        np.linspace(108, 109, n - 20),
    ])
    infl = _vintage({str(d.date()): float(v) for d, v in zip(idx, infl_level)}, lag_days=45)

    vintages = {"INDPRO": growth, "PAYEMS": growth, "CPIAUCSL": infl}

    # Scan the recovery rather than pinning one date: which month-end first
    # shows the disagreement depends on the shape of the V, and pinning it
    # would make the test about the fixture instead of the property.
    disagreements = [
        r
        for r in (
            reading_at(d, vintages, spec="fast")
            for d in pd.date_range("2019-06-30", "2020-12-31", freq="ME", tz="UTC")
        )
        if r.quad is not None and r.growth_yoy < 0 < r.growth_roc
    ]
    assert disagreements, "the fixture never produced a negative level with a rising rate"
    for r in disagreements:
        # Level negative, direction up: growth is on the accelerating row, so
        # with inflation decelerating this reads Goldilocks despite the economy
        # still being smaller than a year ago. That is the framework, not a bug.
        assert r.quad == 1, r


def test_transitions_collapse_runs_and_have_no_diagonal():
    hist = pd.DataFrame({"quad": [1, 1, 1, 2, 2, 3, 3, 3, 1, 4]})
    m = transitions(hist)
    assert np.allclose(np.diag(m.values), 0.0), "a collapsed run cannot transition to itself"
    for q in m.index:
        row = m.loc[q].sum()
        assert row == pytest.approx(1.0) or row == pytest.approx(0.0)
    # 1->2, 2->3, 3->1, 1->4: each the only move out of its quad except Q1.
    assert m.loc[2, 3] == pytest.approx(1.0)
    assert m.loc[3, 1] == pytest.approx(1.0)
    assert m.loc[1, 2] == pytest.approx(0.5)
    assert m.loc[1, 4] == pytest.approx(0.5)


def test_lookback_is_a_quarter_not_a_month():
    # One month of rate-of-change is revision noise; the default is a
    # deliberate choice and worth pinning so it is not drifted casually. The
    # one-month variant still exists as a named candidate, and is measured
    # against the others rather than assumed away.
    assert LOOKBACK == 3
    assert MIN_OBSERVATIONS == MIN_OBSERVATIONS_BASE + LOOKBACK
    assert SPECS["fast_1m"].lookback == 1
    assert SPECS["fast_6m"].lookback == 6
