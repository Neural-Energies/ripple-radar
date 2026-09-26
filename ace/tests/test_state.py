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


# --- the MacroState contract -----------------------------------------------

def _toy_fit(n: int = 120, k: int = 2):
    """A small factor fit on synthetic data, so state tests stay offline."""
    from ace.state.factors import fit_factors
    specs = _panel_of("PAYEMS", "UNRATE", "MANEMP", "INDPRO", "TCU",
                      "CPIAUCSL", "CPILFESL", "PPIACO")
    rng = np.random.default_rng(11)
    vin = {}
    common = np.cumsum(rng.normal(0, 1, n))
    for i, s in enumerate(specs):
        base = 100.0 + 0.4 * common + rng.normal(0, 0.5, n) + 0.05 * i * np.arange(n)
        obs = pd.date_range("2005-01-01", periods=n, freq="MS", tz="UTC")
        vin[s.series_id] = pd.DataFrame({
            "obs_date": obs, "value": np.abs(base) + 10.0,
            "published": obs + pd.Timedelta(days=45),
        })
    build = build_asof("2016-06-30", vin, specs=specs)
    return fit_factors(build, k=k, maxiter=25), build


def test_state_populates_every_field_the_contract_promises():
    from ace.state.state import build_state
    fit, build = _toy_fit()
    st = build_state(fit, build)
    assert st.blocks, "no blocks produced"
    for name, b in st.blocks.items():
        assert np.isfinite(b.level), f"{name} level"
        assert np.isfinite(b.momentum), f"{name} momentum"
        assert np.isfinite(b.acceleration), f"{name} acceleration"
        assert 0.0 <= b.percentile <= 100.0, f"{name} percentile out of range"
        assert b.direction in {"rising", "falling", "flat"}
        assert b.through, f"{name} has no observation month"
        assert b.days_behind >= 0
        assert b.n_series >= 1


def test_acceleration_is_the_change_in_momentum():
    from ace.state.state import MOMENTUM_MONTHS, build_state
    fit, build = _toy_fit()
    st = build_state(fit, build)
    for name, b in st.blocks.items():
        series = fit.factors[name if name in fit.factors else name].dropna()
        mom = float(series.iloc[-1] - series.iloc[-1 - MOMENTUM_MONTHS])
        prior = float(series.iloc[-1 - MOMENTUM_MONTHS] - series.iloc[-1 - 2 * MOMENTUM_MONTHS])
        assert b.momentum == pytest.approx(mom, abs=1e-6)
        assert b.acceleration == pytest.approx(mom - prior, abs=1e-6)


def test_direction_has_a_dead_zone():
    """Without one, every reading has a direction including the noise."""
    from ace.state.state import DIRECTION_FLOOR, _direction
    assert _direction(0.0) == "flat"
    assert _direction(DIRECTION_FLOOR * 0.5) == "flat"
    assert _direction(-DIRECTION_FLOOR * 0.5) == "flat"
    assert _direction(DIRECTION_FLOOR * 2) == "rising"
    assert _direction(-DIRECTION_FLOOR * 2) == "falling"
    assert _direction(float("nan")) == "flat"


def test_uncertainty_comes_from_the_smoother_and_is_never_invented():
    from ace.state.state import _uncertainty, build_state
    fit, build = _toy_fit()
    st = build_state(fit, build)
    # At least one block must carry a real posterior standard error.
    reported = [b.uncertainty for b in st.blocks.values() if np.isfinite(b.uncertainty)]
    assert reported, "no block reported a smoother standard error"
    assert all(u > 0 for u in reported), "a standard error cannot be non-positive"
    # A factor the model never estimated has no uncertainty, and gets NaN
    # rather than a substituted value.
    assert np.isnan(_uncertainty(fit, "not_a_factor"))


def test_drivers_are_loading_times_observation_and_stay_in_their_block():
    from ace.state.state import build_state
    fit, build = _toy_fit()
    st = build_state(fit, build)
    for name, b in st.blocks.items():
        for d in b.drivers:
            assert d.contribution == pytest.approx(d.loading * d.z, abs=1e-4)
            assert d.series_id in fit.series
            if not name.startswith("global"):
                assert fit.blocks[d.series_id] == name.split(".")[0]
        # Sorted by absolute contribution, largest first.
        mags = [abs(d.contribution) for d in b.drivers]
        assert mags == sorted(mags, reverse=True)


def test_a_boundary_factor_count_is_reported_not_hidden():
    from ace.state.factors import FactorCount
    interior = FactorCount(k=2, criterion="ICp2", kmax=6, n=8, t=100,
                           ic={1: -0.2, 2: -0.5, 3: -0.4})
    assert not interior.at_boundary
    boundary = FactorCount(k=3, criterion="ICp2", kmax=6, n=8, t=100,
                           ic={1: -0.2, 2: -0.4, 3: -0.6})
    assert boundary.at_boundary, "a monotone IC is a boundary hit, not a selection"


def test_state_serialises_with_its_provenance():
    from ace.state.state import build_state
    fit, build = _toy_fit()
    d = build_state(fit, build).to_dict()
    for key in ("as_of", "model_id", "model_version", "provenance", "months_behind",
                "n_series", "factor_count", "converged", "blocks"):
        assert key in d, f"missing {key}"
    assert d["provenance"] == "point_in_time_alfred_vintages"
    any_block = next(iter(d["blocks"].values()))
    assert "drivers" in any_block and isinstance(any_block["drivers"], list)


def test_an_empty_panel_yields_an_empty_state_rather_than_raising():
    from ace.state.state import build_state
    from ace.state.factors import FactorCount, FactorFit
    empty = FactorFit(as_of="2020-01-01", factors=pd.DataFrame(),
                      loadings=pd.DataFrame(), blocks={}, n_factors=0,
                      factor_count=FactorCount(0, "ICp2", 6, 0, 0, {}),
                      converged=True, llf=0.0, n_obs=0, series=())
    build = build_asof("2020-01-01", {}, specs=_panel_of("PAYEMS"))
    st = build_state(empty, build)
    assert st.blocks == {}
    assert "no factors" in " ".join(st.notes)
