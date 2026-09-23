"""GDELT store tests.

Two defects these pin, both of which are silent and both of which showed up
in the real data.

A day that was never downloaded is not a day with no events. Entered as a
zero, a run of gap days drags a trailing mean down and inflates its standard
deviation — enough, on the real cache, to take a spike detector from five
firings to one.

And GDELT carries two dates. An article published in 2022 about an event in
2012 enters the file dated 2022 with SQLDATE 2012. A model keyed on the event
date would use 1.5% of its observations before anyone could have known them,
one of them by ten years.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.feeds.gdelt_store import (
    CAMEO_ROOT,
    daily_series,
    event_times,
    spike_days,
)


def _events(days: list[str], per_day: int = 5, lag_days: int = 0) -> pd.DataFrame:
    rows = []
    for d in days:
        obs = pd.Timestamp(d, tz="UTC")
        for i in range(per_day):
            rows.append({
                "observed_at": obs,
                "event_date": obs - pd.Timedelta(days=lag_days),
                "num_mentions": 10 + i,
                "event_root_code": "19",
                "root_label": CAMEO_ROOT["19"],
                "report_lag_days": lag_days,
            })
    df = pd.DataFrame(rows)
    return df.set_index("observed_at").sort_index()


def test_a_day_that_was_never_fetched_is_nan_not_zero():
    present = ["2022-01-01", "2022-01-02", "2022-01-04"]
    ev = _events(present)
    on_days = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC") for d in present])
    out = daily_series(ev, on_days=on_days)["count"]
    assert out.loc["2022-01-01"] == 5
    assert np.isnan(out.loc["2022-01-03"]), "an un-fetched day must not read as zero"


def test_a_fetched_day_with_no_qualifying_events_is_a_real_zero():
    ev = _events(["2022-01-01", "2022-01-03"])
    # 2022-01-02 WAS fetched; it simply had nothing above the threshold.
    on_days = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC")
                                for d in ("2022-01-01", "2022-01-02", "2022-01-03")])
    out = daily_series(ev, on_days=on_days)["count"]
    assert out.loc["2022-01-02"] == 0.0
    assert not np.isnan(out.loc["2022-01-02"])


def test_gap_days_do_not_suppress_the_spike_detector():
    """The real failure: zeros in the window kill every z-score."""
    rng = np.random.default_rng(0)
    idx = pd.date_range("2022-01-01", periods=300, freq="D", tz="UTC")
    counts = pd.Series(rng.normal(8000, 400, size=300), index=idx)
    gapped = counts.copy()
    gapped.iloc[200:240] = np.nan                 # forty days never fetched
    gapped.iloc[250] = 40000                      # a surge while the gap is
    counts.iloc[250] = 40000                      # still inside the window

    as_zeros = gapped.fillna(0.0)
    assert spike_days(gapped).loc[idx[250]] == 1.0, "the surge must be detected"
    assert spike_days(as_zeros).loc[idx[250]] == 0.0, (
        "entering gap days as zeros inflates the trailing spread enough to hide it"
    )


def test_daily_series_splits_by_a_column():
    a = _events(["2022-01-01"], per_day=3)
    b = _events(["2022-01-01"], per_day=2)
    b["event_root_code"] = "18"
    b["root_label"] = CAMEO_ROOT["18"]
    ev = pd.concat([a, b]).sort_index()
    on_days = pd.DatetimeIndex([pd.Timestamp("2022-01-01", tz="UTC")])
    out = daily_series(ev, by="root_label", on_days=on_days)
    assert out.loc["2022-01-01", CAMEO_ROOT["19"]] == 3
    assert out.loc["2022-01-01", CAMEO_ROOT["18"]] == 2


def test_spike_days_standardizes_in_logs_so_quiet_stretches_can_still_spike():
    """On the raw scale a Gaussian threshold fires on ordinary busy days."""
    idx = pd.date_range("2022-01-01", periods=200, freq="D", tz="UTC")
    counts = pd.Series(100.0, index=idx)
    counts.iloc[:100] = 10.0                      # a quiet regime
    counts.iloc[80] = 40.0                        # a 4x surge inside it
    flags = spike_days(counts, window=60, sigma=2.0)
    assert flags.loc[idx[80]] == 1.0


def test_event_times_are_days_since_the_first_observation():
    idx = pd.date_range("2022-01-01", periods=10, freq="D", tz="UTC")
    flags = pd.Series(0.0, index=idx)
    flags.iloc[[2, 5, 9]] = 1.0
    t, dates = event_times(flags)
    assert list(t) == [2.0, 5.0, 9.0]
    assert len(dates) == 3


def test_event_times_on_an_empty_flag_series_returns_nothing():
    idx = pd.date_range("2022-01-01", periods=5, freq="D", tz="UTC")
    t, dates = event_times(pd.Series(0.0, index=idx))
    assert len(t) == 0 and len(dates) == 0


def test_the_report_lag_is_carried_so_the_dual_clock_is_visible():
    ev = _events(["2022-04-11"], lag_days=3650)
    assert ev["report_lag_days"].iloc[0] == 3650
    assert ev.index[0] > ev["event_date"].iloc[0]


def test_cameo_root_codes_are_complete_and_zero_padded():
    assert len(CAMEO_ROOT) == 20
    assert all(len(k) == 2 and k.isdigit() for k in CAMEO_ROOT)
    assert CAMEO_ROOT["19"] == "fight"
