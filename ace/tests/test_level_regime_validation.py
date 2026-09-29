"""WP3's scorer on the exact target (PR #5 B04): the event, its dates, the
factor's sign, label availability and the confirmation split, each against a
known answer. No live DFM or PCA fit is needed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.regime import level_regime_validation as v
from ace.regime.level_regime_validation import (
    PROTOCOL,
    AnchorRow,
    anchors_for,
    calibrate_rows,
    climatology_at,
    collect,
    evaluate,
    exact_event,
    orient,
    regime_forecast,
)


def monthly(values, start="2000-01-01"):
    return pd.Series(np.asarray(values, dtype=float), index=pd.date_range(start, periods=len(values), freq="MS"))


# ------------------------------------------------------------ the event --

def test_the_target_month_must_exist_exactly_never_a_later_one():
    # The audit's case: history ends February, the 3-month target (May) is
    # absent, October exists. That used to score October as the outcome.
    s = pd.Series([1.0, 2.0, 9.0], index=pd.to_datetime(["2020-01-01", "2020-02-01", "2020-10-01"]))
    assert exact_event(s, pd.Timestamp("2020-02-01"), 3) is None
    assert exact_event(s, pd.Timestamp("2020-02-01"), 8) == 1.0
    assert exact_event(s, pd.Timestamp("2020-03-01"), 7) is None, "the base month must exist too"


def test_climatology_counts_only_realised_pairs_in_the_vintage():
    assert climatology_at(monthly(np.arange(20.0)), 3) == pytest.approx(1.0)
    assert climatology_at(monthly([1.0, 2.0]), 6) is None
    # A gap does not pair a month with the wrong one.
    gappy = pd.Series([1.0, 5.0, 0.0], index=pd.to_datetime(["2020-01-01", "2020-02-01", "2020-08-01"]))
    assert climatology_at(gappy, 6) == pytest.approx(0.0)


def test_anchors_stop_where_the_target_month_cannot_yet_be_observed():
    a = anchors_for(PROTOCOL, pd.Timestamp("2026-08-01"))
    assert str(a[-1].date()) == "2026-01-01"
    assert all((b - x).days >= 180 for x, b in zip(a[:-1], a[1:])), "outcome windows do not overlap"


# --------------------------------------------------------------- the sign --

def test_the_factor_is_oriented_to_the_observable_from_the_anchor_data():
    obs = monthly(np.sin(np.arange(60) / 5))
    flipped, corr = orient(-obs * 3, obs, min_corr=0.1)
    assert corr < 0
    assert np.corrcoef(flipped, obs)[0, 1] > 0.99
    noise = monthly(np.random.default_rng(0).normal(size=60))
    assert orient(noise * 0 + 1, obs, min_corr=0.1) is None, "a constant factor has no sign"


# ------------------------------------------------------------ the forecast --

class _Res:
    """A fitted switching model with known parameters."""

    def __init__(self, means, variances, C, pi):
        from types import SimpleNamespace

        self.model = SimpleNamespace(param_names=["p[0->0]", "p[1->0]", "const[0]", "const[1]", "sigma2[0]", "sigma2[1]"])
        self.params = np.array([C[0][0], C[0][1], means[0], means[1], variances[0], variances[1]])
        self.regime_transition = np.asarray(C, dtype=float).reshape(2, 2, 1)
        self.filtered_marginal_probabilities = np.asarray([pi])


def test_the_forecast_is_the_probability_of_the_event_not_of_the_state():
    # Certainly in the high state now, and sitting exactly at its mean: the
    # state probability is ~1, but a rise over the horizon is a coin flip.
    res = _Res(means=[-2.0, 2.0], variances=[1.0, 1.0], C=[[0.99, 0.01], [0.01, 0.99]], pi=[0.0, 1.0])
    fc = regime_forecast(res, y_last=2.0, horizon=6)
    assert fc["p_high_state_now"] == pytest.approx(1.0)
    assert fc["p_rise"] == pytest.approx(0.5, abs=0.05)
    # Deep below the high mean, a rise is near certain.
    assert regime_forecast(res, y_last=-1.0, horizon=6)["p_rise"] > 0.95


def test_a_switch_expected_within_the_horizon_moves_the_forecast():
    # Now high, but the high state is short-lived: over 6 months the low state dominates.
    res = _Res(means=[-2.0, 2.0], variances=[0.25, 0.25], C=[[0.95, 0.6], [0.05, 0.4]], pi=[0.0, 1.0])
    assert regime_forecast(res, y_last=2.0, horizon=6)["p_rise"] < 0.2


# ----------------------------------------------- labels and calibration --

def test_calibration_only_uses_labels_published_by_the_anchor(monkeypatch):
    idx = pd.date_range("1990-01-01", periods=400, freq="MS", tz="UTC")
    final = pd.Series(np.sin(np.arange(400) / 7) + np.arange(400) / 400, index=idx)
    lag = 3  # the observable is published three months late

    def factor_at(as_of):
        return final[final.index <= as_of - pd.DateOffset(months=1)]

    def observable_at(as_of):
        known = final[final.index <= as_of - pd.DateOffset(months=lag)]
        return known, known

    monkeypatch.setattr(v, "_fit", lambda y, seed: None)
    monkeypatch.setattr(v, "regime_forecast", lambda res, y_last, h: {"p_rise": 0.5, "p_high_state_now": 0.5})
    monkeypatch.setattr(v, "MIN_OBS", 24)
    anchors = pd.date_range("2000-01-01", periods=40, freq="6MS", tz="UTC")
    rows, skipped = collect(factor_at, observable_at, final, anchors, PROTOCOL)
    assert not skipped
    for i, r in enumerate(rows):
        published_through = pd.Timestamp(r.anchor) - pd.DateOffset(months=lag)
        for prev_anchor, _ in r.known_labels:
            prev = next(x for x in rows if x.anchor == prev_anchor)
            target_month = pd.Timestamp(prev.month) + pd.DateOffset(months=PROTOCOL.horizon_months)
            assert target_month <= published_through, "a label unpublished at the anchor was used"
        # The immediately preceding anchor's label is never yet published (6m + 3m lag > 6m spacing).
        if i > 0:
            assert rows[i - 1].anchor not in {a for a, _ in r.known_labels}

    scored, burn = calibrate_rows(rows, PROTOCOL)
    assert len(burn) >= PROTOCOL.calibration_min_pairs, "the first anchors are burn-in, not forecasts"
    assert all(r.calibrated is not None and 0 < r.calibrated < 1 for r in scored)


def test_the_verdict_is_read_on_the_later_confirmation_share_only():
    rows = [
        AnchorRow(anchor=f"{2000 + i}-01-01", month=f"{2000 + i}-01-01", raw=0.5, p_high_state_now=0.5,
                  orientation_corr=0.9, climatology=0.5, outcome=float(i % 2), known_labels=[],
                  calibrated=(0.9 if i % 2 else 0.1) if i < 30 else 0.5)
        for i in range(50)
    ]
    report = evaluate(rows, comparisons=4, protocol=PROTOCOL)
    assert report["split"]["confirmation"] == ["2030-01-01", "2049-01-01"]
    assert "IMPROVES" in report["development"]["verdict"], "a strong development period"
    assert report["confirmation"]["skill"] == pytest.approx(0.0), "does not carry into confirmation"
    assert not report["verdict"].startswith("IMPROVES")
    assert report["alpha_per_comparison"] == pytest.approx(0.0125)
