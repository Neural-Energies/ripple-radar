"""Historical analog retrieval tests (§26)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.analogs.historical import find_analogs


@pytest.fixture(scope="module")
def synthetic_returns():
    rng = np.random.default_rng(12)
    n = 2500
    idx = pd.date_range("2012-01-01", periods=n, freq="B", tz="UTC")
    return pd.DataFrame(
        {
            "SP500": rng.normal(0, 0.01, n),
            "UST10Y": rng.normal(0, 0.03, n),
            "WTI": rng.normal(0, 0.02, n),
            "USD_BROAD": rng.normal(0, 0.004, n),
            "VIX": rng.normal(0, 0.06, n),
        },
        index=idx,
    )


def test_every_analog_predates_the_query(synthetic_returns):
    """The look-ahead guard: an analog from the future is not an analog."""
    as_of = synthetic_returns.index[-1]
    res = find_analogs(synthetic_returns, as_of=as_of, target_channel="SP500", k=20)
    assert res["available"]
    assert all(a["date"] < res["as_of"] for a in res["analogs"])


def test_analog_outcome_windows_close_before_the_query(synthetic_returns):
    """A recent analog's 'what happened next' must not overlap the present."""
    as_of = synthetic_returns.index[-1]
    forward = 20
    res = find_analogs(synthetic_returns, as_of=as_of, target_channel="SP500", forward=forward, k=20)
    latest = max(pd.Timestamp(a["date"], tz="UTC") for a in res["analogs"])
    assert (pd.Timestamp(res["as_of"], tz="UTC") - latest).days > forward


def test_distances_are_sorted_and_non_negative(synthetic_returns):
    res = find_analogs(synthetic_returns, as_of=synthetic_returns.index[-1], target_channel="SP500", k=15)
    d = [a["distance"] for a in res["analogs"]]
    assert all(x >= 0 for x in d)
    assert d == sorted(d)


def test_outcome_distribution_is_reported_not_a_point_forecast(synthetic_returns):
    res = find_analogs(synthetic_returns, as_of=synthetic_returns.index[-1], target_channel="SP500", k=20)
    o = res["outcome_distribution"]
    for key in ("p10", "p25", "median", "p75", "p90", "std", "share_positive"):
        assert key in o
    assert o["p10"] <= o["median"] <= o["p90"]
    assert 0.0 <= o["share_positive"] <= 1.0


def test_agreement_is_low_when_history_is_split(synthetic_returns):
    """On noise, analogs should disagree — and the engine should say so."""
    res = find_analogs(synthetic_returns, as_of=synthetic_returns.index[-1], target_channel="SP500", k=24)
    assert res["agreement"] < 0.75, "pure noise must not produce a confident directional read"


def test_insufficient_history_returns_unavailable_rather_than_a_guess(synthetic_returns):
    early = synthetic_returns.index[60]
    res = find_analogs(synthetic_returns, as_of=early, target_channel="SP500", k=20)
    assert res["available"] is False
    assert "reason" in res
