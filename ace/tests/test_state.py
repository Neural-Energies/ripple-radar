"""The macro panel's leakage properties, and the transforms under it.

The failure this file exists to catch is invisible in the output: a panel that
saw a number nobody had on the date it claims to describe. It does not throw,
it does not look wrong, and every model downstream inherits it.

Synthetic vintages throughout, so a leak is unambiguous rather than a plausible
number.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.state.panel import (
    MIN_USABLE_OBS,
    PANEL,
    PANEL_BY_ID,
    SeriesSpec,
    build_asof,
)
from ace.state.transforms import (
    TRANSFORM_NAMES,
    TransformError,
    apply_code,
    apply_panel,
    lags_consumed,
    standardize,
)


# --- fixtures ---------------------------------------------------------------

def _vintage(n: int, *, start: str = "2000-01-01", lag_days: int = 45,
             first: float = 100.0, step: float = 1.0) -> pd.DataFrame:
    """A first-release archive: each month published `lag_days` after it starts."""
    obs = pd.date_range(start, periods=n, freq="MS", tz="UTC")
    return pd.DataFrame({
        "obs_date": obs,
        "value": [first + step * i for i in range(n)],
        "published": obs + pd.Timedelta(days=lag_days),
    })


def _panel_of(*ids: str) -> tuple[SeriesSpec, ...]:
    return tuple(PANEL_BY_ID[i] for i in ids)


# --- transforms -------------------------------------------------------------

def test_every_code_consumes_the_lags_it_declares():
    s = pd.Series([100.0, 101.0, 103.0, 106.0, 110.0, 115.0],
                  index=pd.date_range("2020-01-01", periods=6, freq="MS"))
    for code in TRANSFORM_NAMES:
        out = apply_code(s, code)
        assert len(out) == len(s), f"code {code} changed the index length"
        assert int(out.isna().sum()) == lags_consumed(code), f"code {code} lag mismatch"


def test_transforms_are_causal():
    """The property that makes a feature safe: t uses nothing after t.

    Changing a FUTURE observation must not change any past transformed value.
    A centred difference or a two-sided filter would fail this silently.
    """
    s = pd.Series([100.0, 101.0, 103.0, 106.0, 110.0, 115.0],
                  index=pd.date_range("2020-01-01", periods=6, freq="MS"))
    tampered = s.copy()
    tampered.iloc[-1] = 9_999.0
    for code in TRANSFORM_NAMES:
        a = apply_code(s, code).iloc[:-1]
        b = apply_code(tampered, code).iloc[:-1]
        pd.testing.assert_series_equal(a, b, check_names=False)


def test_log_codes_refuse_non_positive_input():
    bad = pd.Series([1.0, 0.0, 2.0], name="X")
    for code in (4, 5, 6):
        with pytest.raises(TransformError, match="positive"):
            apply_code(bad, code)
    # A non-log code is unbothered by a zero.
    assert np.isfinite(apply_code(bad, 2).iloc[-1])


def test_unknown_code_raises_rather_than_passing_through():
    with pytest.raises(TransformError, match="unknown transform code"):
        apply_code(pd.Series([1.0, 2.0]), 99)


def test_unlabelled_columns_are_dropped_not_passed_through():
    frame = pd.DataFrame({"A": [1.0, 2.0, 3.0], "B": [1.0, 2.0, 3.0]})
    out = apply_panel(frame, {"A": 2})
    assert list(out.columns) == ["A"], "an uncoded column must not enter the panel"


def test_standardize_returns_its_moments_so_a_holdout_can_reuse_them():
    """Recomputing moments on the holdout leaks its mean and variance in."""
    train = pd.DataFrame({"A": [1.0, 2.0, 3.0, 4.0]})
    holdout = pd.DataFrame({"A": [10.0, 20.0]})
    z_train, mu, sigma = standardize(train)
    assert abs(float(z_train["A"].mean())) < 1e-12
    z_hold, mu2, sigma2 = standardize(holdout, mean=mu, std=sigma)
    pd.testing.assert_series_equal(mu, mu2)
    # Standardised with TRAINING moments, the holdout is far from zero-mean —
    # which is the point. A z-score near zero would mean the moments were refit.
    assert float(z_hold["A"].mean()) > 3.0


def test_a_constant_column_does_not_become_infinite():
    frame = pd.DataFrame({"A": [5.0, 5.0, 5.0], "B": [1.0, 2.0, 3.0]})
    z, _, _ = standardize(frame)
    assert z["A"].isna().all(), "zero variance must give NaN, never inf"
    assert np.isfinite(z["B"]).all()


# --- the point-in-time guarantee -------------------------------------------

def test_panel_never_sees_an_observation_published_after_its_date():
    specs = _panel_of("PAYEMS", "INDPRO", "CPIAUCSL")
    n = MIN_USABLE_OBS + 24
    vin = {s.series_id: _vintage(n, lag_days=45) for s in specs}
    when = pd.Timestamp("2003-06-30", tz="UTC")
    build = build_asof(when, vin, specs=specs)
    assert build.n_series == 3
    for sid, e in build.edge.items():
        through = pd.Timestamp(e["through"], tz="UTC")
        assert through < when, f"{sid} read data observed {e['through']}"
        # And the publication date of that observation must also precede `when`.
        assert through + pd.Timedelta(days=45) <= when


def test_a_later_vintage_cannot_change_an_earlier_panel():
    """The regression that matters: appending future data leaves history alone."""
    specs = _panel_of("PAYEMS", "INDPRO", "CPIAUCSL")
    n = MIN_USABLE_OBS + 24
    base = {s.series_id: _vintage(n, lag_days=45) for s in specs}
    when = pd.Timestamp("2003-06-30", tz="UTC")
    before = build_asof(when, base, specs=specs)

    extended = {}
    for sid, hist in base.items():
        extra = _vintage(24, start="2003-01-01", lag_days=45, first=9_999.0, step=-500.0)
        extended[sid] = pd.concat([hist, extra], ignore_index=True)
    after = build_asof(when, extended, specs=specs)

    assert before.used == after.used
    pd.testing.assert_frame_equal(before.frame, after.frame)
    assert before.edge == after.edge


def test_the_filter_runs_before_the_transform():
    """Differencing the revised series then cutting leaves a phantom last value.

    Built correctly, the final transformed value on date D is the difference of
    two observations BOTH published by D. If the transform ran first, the last
    difference would be taken against a number nobody had.
    """
    specs = _panel_of("PAYEMS")
    n = MIN_USABLE_OBS + 12
    vin = {"PAYEMS": _vintage(n, lag_days=45, first=100.0, step=1.0)}
    when = pd.Timestamp("2003-06-30", tz="UTC")
    build = build_asof(when, vin, specs=specs)
    published = build.levels["PAYEMS"].dropna()
    expected = float(np.log(published.iloc[-1]) - np.log(published.iloc[-2]))
    assert build.frame["PAYEMS"].dropna().iloc[-1] == pytest.approx(expected)


def test_the_ragged_edge_is_kept_rather_than_filled():
    """Series publish on different calendars; squaring the panel invents data."""
    fast = _panel_of("PAYEMS")[0]       # 34d
    slow = _panel_of("PCEC96")[0]       # 59d
    n = MIN_USABLE_OBS + 24
    vin = {
        fast.series_id: _vintage(n, lag_days=34),
        slow.series_id: _vintage(n, lag_days=70),
    }
    build = build_asof("2003-06-30", vin, specs=(fast, slow))
    assert build.n_series == 2
    assert build.edge[fast.series_id]["days_behind"] < build.edge[slow.series_id]["days_behind"]
    # The slow series must be NaN at the newest month, not carried forward.
    last_row = build.frame.iloc[-1]
    assert pd.isna(last_row[slow.series_id])
    assert not pd.isna(last_row[fast.series_id])


def test_a_series_with_too_little_history_is_dropped_with_a_reason():
    specs = _panel_of("PAYEMS", "RRSFS")
    vin = {
        "PAYEMS": _vintage(MIN_USABLE_OBS + 24, lag_days=45),
        "RRSFS": _vintage(6, lag_days=45),
    }
    build = build_asof("2003-06-30", vin, specs=specs)
    assert build.used == ("PAYEMS",)
    assert "RRSFS" in build.dropped
    assert "observations" in build.dropped["RRSFS"]


def test_an_empty_panel_returns_empty_rather_than_raising():
    specs = _panel_of("PAYEMS")
    build = build_asof("2003-06-30", {"PAYEMS": pd.DataFrame(
        columns=["obs_date", "value", "published"]).astype({"value": float})}, specs=specs)
    assert build.n_series == 0
    assert build.frame.empty
    assert "PAYEMS" in build.dropped


def test_every_panel_member_declares_a_group_and_a_valid_code():
    for spec in PANEL:
        assert spec.code in TRANSFORM_NAMES
        assert spec.group
        assert spec.typical_lag_days > 0
        assert len(spec.note) > 10, f"{spec.series_id} has no stated rationale"


def test_price_indices_take_a_second_log_difference():
    # The first log difference of a price index is inflation; the second says
    # whether inflation is turning, which is what a factor should load on.
    for sid in ("CPIAUCSL", "CPILFESL", "PPIACO"):
        assert PANEL_BY_ID[sid].code == 6, f"{sid} is not second-log-differenced"
    # Rates are differenced, not log-differenced — they can be zero or negative.
    for sid in ("UNRATE", "TCU"):
        assert PANEL_BY_ID[sid].code == 2
