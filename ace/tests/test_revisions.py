"""Revision measurement and spec selection must measure revision, and only on
what existed when the choice was made (PR #5 A11).

Three defects this guards:

1. As-of reads kept each month's FIRST print forever, so a revision already
   public on the date was invisible (see test_quads for `known_at`).
2. The revised-data answer key was cut at the later of the two axes' months
   and rebuilt its own membership, so a staggered release calendar with no
   revision at all could "flip" a label.
3. Selection split each candidate at its own row count, measured persistence
   and the lag tie-break over the full sample, and scored training labels
   against today's revised data.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import ace.data.alfred as alfred
from ace.macro.quads import (
    SPECS,
    Spec,
    final_reading_like,
    reading_at,
    reading_from_levels,
)
from ace.macro.revisions import (
    SETTLING_MONTHS,
    calendar_cutoff,
    compare,
    select_spec,
    settled,
)

UTC = "UTC"


def _first_prints(levels: pd.Series, lag_days: int) -> pd.DataFrame:
    return pd.DataFrame({
        "obs_date": levels.index,
        "value": levels.to_numpy(dtype=float),
        "published": levels.index + pd.Timedelta(days=lag_days),
    })


def _monthly(values: list[float], start: str) -> pd.Series:
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="MS", tz=UTC))


# ------------------------------------------- 2. like-for-like answer key ---
def _staggered_world():
    """The audit's fixture: growth published through May, inflation through
    June, no revision anywhere. Growth's rate of change is +10 through May and
    −10 through June."""
    g = [100.0] * 12 + [100.0, 100.0, 110.0, 110.0, 110.0, 100.0]      # 2019-01 .. 2020-06
    c = [100.0] * 12 + [101.0, 102.0, 103.0, 104.0, 105.0, 106.0]
    indpro = _monthly(g, "2019-01-01")
    cpi = _monthly(c, "2019-01-01")
    vintages = {"INDPRO": _first_prints(indpro, 75), "CPIAUCSL": _first_prints(cpi, 30)}
    finals = {"INDPRO": indpro, "CPIAUCSL": cpi}   # zero revision
    return vintages, finals


def test_zero_revision_on_a_staggered_calendar_never_flips():
    vintages, finals = _staggered_world()
    when = pd.Timestamp("2020-07-25", tz=UTC)
    spec = SPECS["production"]              # INDPRO vs CPIAUCSL, 3-month lookback
    rt = reading_at(when, vintages, spec=spec)
    assert (rt.growth_through, rt.inflation_through) == ("2020-05-01", "2020-06-01")
    assert rt.growth_roc == pytest.approx(10.0) and rt.quad == 2

    # The defect, reproduced: one cut at the later axis advances growth to June.
    cut = pd.Timestamp("2020-06-01", tz=UTC)
    old = reading_from_levels({k: v[v.index <= cut] for k, v in finals.items()}, when, spec)
    assert old.growth_roc == pytest.approx(-10.0) and old.quad == 3

    row = compare(pd.DatetimeIndex([when]), vintages, finals, spec=spec).iloc[0]
    assert row["realtime"] == 2 and row["final"] == 2 and bool(row["survived"])
    assert row["growth_roc_final"] == row["growth_roc_rt"]
    assert row["inflation_roc_final"] == row["inflation_roc_rt"]


def test_answer_key_keeps_the_real_time_membership():
    # PAYEMS has too little published history to contribute in real time; the
    # revised series has all of it, falling hard. Letting it join the answer
    # key would book a composition change as a revision.
    i = np.arange(20)
    indpro = _monthly(list(100 * np.exp(0.0005 * i**2)), "2019-01-01")    # accelerating
    payems = _monthly(list(200 * np.exp(-0.002 * i**2)), "2019-01-01")    # collapsing
    cpi = _monthly(list(100.0 + 0.1 * i * i), "2019-01-01")
    spec = Spec("pair", ("INDPRO", "PAYEMS"), ("CPIAUCSL",), 3, "")
    vintages = {
        "INDPRO": _first_prints(indpro, 30),
        "PAYEMS": _first_prints(payems[payems.index >= "2020-01-01"], 30),
        "CPIAUCSL": _first_prints(cpi, 30),
    }
    finals = {"INDPRO": indpro, "PAYEMS": payems, "CPIAUCSL": cpi}
    when = pd.Timestamp("2020-08-15", tz=UTC)
    rt = reading_at(when, vintages, spec=spec)
    assert rt.growth_used == ("INDPRO",) and "PAYEMS" in rt.growth_missing
    fin = final_reading_like(rt, finals, spec=spec)
    assert fin.growth_used == ("INDPRO",)
    assert fin.quad == rt.quad and fin.growth_roc == rt.growth_roc
    # ...whereas letting the revised data rebuild membership would flip it.
    both = reading_from_levels(
        {k: v[v.index <= pd.Timestamp(rt.growth_through, tz=UTC)] for k, v in finals.items()},
        when, spec)
    assert both.quad != rt.quad


def test_a_real_revision_still_flips_the_label():
    vintages, finals = _staggered_world()
    when = pd.Timestamp("2020-07-25", tz=UTC)
    revised = finals["INDPRO"].copy()
    revised.loc[pd.Timestamp("2020-05-01", tz=UTC)] = 95.0   # May revised down hard
    row = compare(pd.DatetimeIndex([when]), vintages,
                  {**finals, "INDPRO": revised}, spec="production").iloc[0]
    assert row["realtime"] == 2 and row["final"] == 3 and not bool(row["survived"])


def test_answer_key_that_cannot_cover_the_months_is_not_scored():
    vintages, finals = _staggered_world()
    when = pd.Timestamp("2020-07-25", tz=UTC)
    gap = finals["INDPRO"].drop(pd.Timestamp("2020-02-01", tz=UTC))   # the base month
    row = compare(pd.DatetimeIndex([when]), vintages,
                  {**finals, "INDPRO": gap}, spec="production").iloc[0]
    assert row["realtime"] == 2 and row["final"] is None and row["survived"] is None


# ------------------------------------------------- 3. sealed selection -----
NOW = pd.Timestamp("2017-12-31", tz=UTC)
CANDIDATES = {
    "a": Spec("a", ("INDPRO",), ("CPIAUCSL",), 3, ""),
    "b": Spec("b", ("PAYEMS",), ("CPIAUCSL",), 3, ""),
    "c": Spec("c", ("INDPRO", "PAYEMS"), ("CPIAUCSL",), 6, ""),
}


def _world(seed: int = 0):
    """Smooth cycles, first prints at a lag, one revision a year later."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range("1999-01-01", "2017-10-01", freq="MS", tz=UTC)
    t = np.arange(len(idx))
    level = {
        "INDPRO": 100 * np.exp(0.002 * t + 0.03 * np.sin(2 * np.pi * t / 41)),
        "PAYEMS": 100 * np.exp(0.0015 * t + 0.02 * np.sin(2 * np.pi * t / 53 + 1)),
        "CPIAUCSL": 100 * np.exp(0.002 * t + 0.015 * np.sin(2 * np.pi * t / 67 + 2)),
    }
    lag = {"INDPRO": 45, "PAYEMS": 34, "CPIAUCSL": 43}
    vintages, finals = {}, {}
    for sid, v in level.items():
        first = v * (1 + rng.normal(0, 0.004, len(v)))
        pub1 = idx + pd.Timedelta(days=lag[sid])
        pub2 = idx + pd.Timedelta(days=lag[sid] + 365)
        vintages[sid] = pd.DataFrame({
            "obs_date": np.concatenate([idx, idx]),
            "value": np.concatenate([first, v]),
            "published": np.concatenate([pub1, pub2]),
            "superseded": np.concatenate([pub2, [pd.NaT] * len(idx)]),
        })
        vintages[sid]["obs_date"] = pd.to_datetime(vintages[sid]["obs_date"], utc=True)
        vintages[sid]["published"] = pd.to_datetime(vintages[sid]["published"], utc=True)
        vintages[sid]["superseded"] = pd.to_datetime(vintages[sid]["superseded"], utc=True)
        finals[sid] = pd.Series(v, index=idx)
    dates = pd.date_range("2000-06-30", "2017-11-30", freq="ME", tz=UTC)
    return dates, vintages, finals


def _selection_view(sel: dict) -> dict:
    return {
        "chosen": sel["chosen"],
        "cutoff": sel["cutoff"],
        "eligible": sel["eligible"],
        "persistence": sel["persistence"],
        "train": {n: (s["n_train"], s["survival_train"], s["median_lag_days"])
                  for n, s in sel["scores"].items()},
    }


@pytest.fixture(scope="module")
def world():
    dates, vintages, finals = _world()
    sel = select_spec(dates, vintages, finals, specs=CANDIDATES, now=NOW)
    return dates, vintages, finals, sel


def test_one_calendar_cutoff_for_every_candidate(world):
    dates, vintages, finals, sel = world
    cutoff = calendar_cutoff(dates, train_frac=0.70, now=NOW)
    assert sel["cutoff"] == str(cutoff.date())
    ready = dates[dates <= NOW - pd.DateOffset(months=SETTLING_MONTHS)]
    assert cutoff == ready[int(len(ready) * 0.70) - 1]
    for name, cmp in sel["comparisons"].items():
        # Holdout rows are strictly after the one cutoff, whatever the spec.
        held = settled(cmp, NOW)
        n_after = int((held.index > cutoff).sum())
        assert sel["scores"][name]["n_holdout"] == n_after


def test_training_rows_are_the_ones_settled_by_the_cutoff(world):
    dates, vintages, finals, sel = world
    cutoff = pd.Timestamp(sel["cutoff"], tz=UTC)
    last_train = cutoff - pd.DateOffset(months=SETTLING_MONTHS)
    for name, spec in CANDIDATES.items():
        cmp = compare(dates[dates <= last_train], vintages, finals, spec=spec)
        assert sel["scores"][name]["n_train"] == int(cmp["realtime"].notna().sum())


def test_nothing_after_the_cutoff_can_change_the_choice(world):
    dates, vintages, finals, sel = world
    cutoff = pd.Timestamp(sel["cutoff"], tz=UTC)
    rng = np.random.default_rng(1)

    # Today's answer key rewritten wholesale, and a wild new vintage of EVERY
    # month published after the cutoff, including months the training window
    # used.
    scrambled = {sid: s * rng.uniform(0.5, 1.5, len(s)) for sid, s in finals.items()}
    later = {}
    for sid, h in vintages.items():
        months = h["obs_date"].drop_duplicates()
        wild = pd.DataFrame({
            "obs_date": months.to_numpy(),
            "value": rng.uniform(50, 150, len(months)),
            "published": cutoff + pd.Timedelta(days=1),
            "superseded": pd.NaT,
        })
        wild["obs_date"] = pd.to_datetime(wild["obs_date"], utc=True)
        wild["superseded"] = pd.to_datetime(wild["superseded"], utc=True)
        h = h.copy()
        # close whatever was open at the cutoff so the wild vintage replaces it
        still = h["superseded"].isna() | (h["superseded"] > cutoff + pd.Timedelta(days=1))
        h.loc[still & (h["published"] <= cutoff), "superseded"] = cutoff + pd.Timedelta(days=1)
        later[sid] = pd.concat([h, wild], ignore_index=True)

    again = select_spec(dates, later, scrambled, specs=CANDIDATES, now=NOW)
    assert _selection_view(again) == _selection_view(sel)
    # ...and the holdout DID see the change, so the test is not vacuous.
    assert any(again["scores"][n]["survival_holdout"] != sel["scores"][n]["survival_holdout"]
               for n in CANDIDATES)


def test_training_answer_key_is_the_one_that_existed_at_the_cutoff(world):
    # A revision published after the cutoff to a training month changes what
    # today's data says about that month, and must not change the training
    # survival it was selected on.
    dates, vintages, finals, sel = world
    flipped = {sid: -s for sid, s in finals.items()}
    again = select_spec(dates, vintages, flipped, specs=CANDIDATES, now=NOW)
    assert _selection_view(again) == _selection_view(sel)


def test_persistence_floor_is_measured_on_the_training_window(world):
    dates, vintages, finals, sel = world
    assert set(sel["persistence"]) == set(CANDIDATES)
    assert "persistence_full_sample" in sel
    cutoff = pd.Timestamp(sel["cutoff"], tz=UTC)
    from ace.macro.revisions import spell_stats
    for name, spec in CANDIDATES.items():
        assert sel["persistence"][name] == spell_stats(dates[dates <= cutoff], vintages, spec=spec)


# --------------------------------------------- 1. the ALFRED vintage fetch --
def test_vintage_history_pages_and_reads_validity_periods(monkeypatch):
    rows = [
        {"date": "2020-01-01", "value": "100", "realtime_start": "2020-02-15",
         "realtime_end": "2020-08-14"},
        {"date": "2020-01-01", "value": "180", "realtime_start": "2020-08-15",
         "realtime_end": "9999-12-31"},
        {"date": "2020-02-01", "value": "50", "realtime_start": "2020-03-15",
         "realtime_end": "2020-05-31"},
        {"date": "2020-02-01", "value": ".", "realtime_start": "2020-06-01",
         "realtime_end": "9999-12-31"},
        {"date": "2020-03-01", "value": "7", "realtime_start": "2020-04-15",
         "realtime_end": "9999-12-31"},
    ]
    calls = []

    def fake_get(path, params):
        off = int(params["offset"])
        calls.append(off)
        return {"count": len(rows), "observations": rows[off:off + 2]}

    monkeypatch.setattr(alfred, "_get", fake_get)
    monkeypatch.setattr(alfred, "_PAGE", 2)
    hist = alfred.vintage_history("X", "2020-01-01")
    assert calls == [0, 2, 4]
    assert len(hist) == 4                         # the "." vintage is not a value
    jan = pd.Timestamp("2020-01-01", tz=UTC)
    feb = pd.Timestamp("2020-02-01", tz=UTC)
    first = hist[(hist["obs_date"] == jan)].sort_values("published")
    assert first["superseded"].iloc[0] == pd.Timestamp("2020-08-15", tz=UTC)
    assert pd.isna(first["superseded"].iloc[1])

    at = alfred.vintage_at
    assert at(hist, pd.Timestamp("2020-05-01", tz=UTC)).to_dict() == {jan: 100.0, feb: 50.0,
                                                                       pd.Timestamp("2020-03-01", tz=UTC): 7.0}
    later = at(hist, pd.Timestamp("2020-09-01", tz=UTC))
    assert later.loc[jan] == 180.0
    assert feb not in later.index               # withdrawn from June on
    assert alfred.first_releases(hist).set_index("obs_date")["value"].to_dict()[jan] == 100.0
