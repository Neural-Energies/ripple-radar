"""The macro panel's leakage properties, and the transforms under it.

The failure this file exists to catch is invisible in the output: a panel that
saw a number nobody had on the date it claims to describe. It does not throw,
it does not look wrong, and every model downstream inherits it.

Synthetic vintages throughout, so a leak is unambiguous rather than a plausible
number.
"""
from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.state.panel import (
    FREQUENCIES,
    GROUPS,
    MAX_UNREVISED_DIVERGENCE,
    MIN_USABLE_OBS,
    MONTH_COVERAGE,
    UNVERIFIABLE_ROUTE,
    PANEL,
    PANEL_BY_ID,
    UNAVAILABLE,
    SeriesSpec,
    build_asof,
    load_vintages,
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


def _daily_vintage(start: str, end: str, *, first: float = 1.0,
                   step: float = 1.0, lag_days: int = 1) -> pd.DataFrame:
    """A never-revised daily quote: published `lag_days` after it printed.

    Business days only, which is what a market series actually has, so the
    month-coverage threshold is tested against a realistic count.
    """
    obs = pd.date_range(start, end, freq="B", tz="UTC")
    return pd.DataFrame({
        "obs_date": obs,
        "value": [first + step * i for i in range(len(obs))],
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
        assert spec.group in GROUPS, f"{spec.series_id} is in block {spec.group!r}"
        assert spec.frequency in FREQUENCIES
        # Zero is a real answer for a same-day quote, so the floor is >= 0 —
        # but it must be stated, not left to a default that happens to be zero.
        assert spec.typical_lag_days >= 0
        assert len(spec.note) > 10, f"{spec.series_id} has no stated rationale"


def test_the_unrevised_route_is_only_taken_by_high_frequency_series():
    """The one way this panel could leak wholesale.

    `revised=False` means the standard endpoint, whose value is the CURRENT one,
    revisions included. That is only safe where there are no revisions — a market
    close, a spread computed from closes. Taking it for a monthly statistical
    release would hand a model the final figure a day after the reference month.
    """
    for spec in PANEL:
        if spec.revised:
            continue
        assert spec.frequency == "daily", (
            f"{spec.series_id} takes the unrevised route at {spec.frequency} "
            "frequency; only same-day quotes qualify"
        )
        assert spec.typical_lag_days == 0, (
            f"{spec.series_id} claims a {spec.typical_lag_days}-day publication "
            "lag AND no revisions, which cannot both be true"
        )


def test_every_unrevised_series_carries_a_measurement_or_a_flag():
    """Governance, not statistics: a series may not join the unrevised route on
    someone's reasoning about what kind of series it is.

    The check that caught this mattering: the broad trade-weighted dollar index
    looks exactly like a market quote and disagrees with its own archive on 91%
    of days, because the H.10 basket weights are re-estimated annually and
    applied backwards. Reasoning would have kept it; the measurement removed it.
    """
    report = (
        Path(__file__).resolve().parents[2]
        / "artifacts" / "reports" / "macro_route_asof_check.json"
    )
    assert report.exists(), (
        "the unrevised route has no verification record; run "
        "the route check before adding a series to it"
    )
    import json
    measured = {
        r["series"]: r for r in json.loads(report.read_text())["results"]
    }
    for spec in PANEL:
        if spec.revised:
            continue
        sid = spec.series_id
        if sid in UNVERIFIABLE_ROUTE:
            assert len(UNVERIFIABLE_ROUTE[sid]) > 40
            continue
        assert sid in measured, f"{sid} takes the unrevised route unmeasured"
        shares = [
            c["share_differing"] for c in measured[sid]["checks"]
            if "share_differing" in c
        ]
        assert shares, f"{sid} has a record with no usable comparison in it"
        assert max(shares) <= MAX_UNREVISED_DIVERGENCE, (
            f"{sid} disagrees with its point-in-time history on "
            f"{max(shares):.1%} of observations"
        )


def test_the_route_actually_called_matches_the_spec(monkeypatch):
    """Not just what the spec says — what `load_vintages` does with it."""
    import ace.state.panel as panel_mod

    called: dict[str, str] = {}

    def fake_release(sid, start):
        called[sid] = f"alfred:{start}"
        return _vintage(48)

    def fake_plain(sid, start):
        called[sid] = f"plain:{start}"
        return _vintage(48)

    monkeypatch.setattr(panel_mod, "release_history", fake_release)
    monkeypatch.setattr(panel_mod, "unrevised_history", fake_plain)
    specs = _panel_of("PAYEMS", "DGS10", "NFCI")
    load_vintages(specs, start="1980-01-01")
    assert called["PAYEMS"].startswith("alfred:")
    assert called["DGS10"].startswith("plain:")
    # And a spec-level archive start overrides the default rather than being
    # silently ignored, which is the whole reason NFCI is reachable at all.
    assert called["NFCI"] == "alfred:2005-01-01"


def test_a_failed_fetch_is_attributable_to_its_series(monkeypatch):
    import ace.state.panel as panel_mod

    def fake_release(sid, start):
        if sid == "INDPRO":
            raise RuntimeError("HTTP Error 504: Gateway Time-out")
        return _vintage(MIN_USABLE_OBS + 24)

    monkeypatch.setattr(panel_mod, "release_history", fake_release)
    specs = _panel_of("PAYEMS", "INDPRO")
    vin = load_vintages(specs)
    build = build_asof("2003-06-30", vin, specs=specs)
    assert build.used == ("PAYEMS",)
    # The reason must be the actual failure, not a generic "no archive" — the
    # difference between a 504 to retry and a series that does not exist.
    assert "504" in build.dropped["INDPRO"]


def test_a_daily_series_becomes_the_last_print_in_the_month():
    """Not the month's average: a well-defined level whether the month finished."""
    spec = PANEL_BY_ID["DGS10"]
    vin = {"DGS10": _daily_vintage("2015-01-01", "2020-12-31")}
    build = build_asof("2021-01-31", vin, specs=(spec,))
    levels = build.levels["DGS10"].dropna()
    raw = vin["DGS10"].set_index("obs_date")["value"]
    for month in ("2020-10-01", "2020-11-01", "2020-12-01"):
        m = pd.Timestamp(month, tz="UTC")
        in_month = raw[(raw.index >= m) & (raw.index < m + pd.offsets.MonthBegin(1))]
        assert levels.loc[m] == pytest.approx(float(in_month.iloc[-1]))


def test_collapsing_a_month_in_progress_cannot_see_past_the_as_of_date():
    """The leak the collapse could introduce, and the reason it runs last.

    Aggregating before the point-in-time filter would let days after `as_of`
    into the current month's figure — invisible in the output, and it would make
    the newest observation the most contaminated one.
    """
    spec = PANEL_BY_ID["DGS10"]
    vin = {"DGS10": _daily_vintage("2015-01-01", "2020-12-31")}
    when = pd.Timestamp("2020-12-16", tz="UTC")
    build = build_asof(when, vin, specs=(spec,))
    levels = build.levels["DGS10"].dropna()
    raw = vin["DGS10"]
    knowable = raw[raw["published"] <= when].set_index("obs_date")["value"]
    december = pd.Timestamp("2020-12-01", tz="UTC")
    assert december in levels.index, "a half-finished month with enough prints is usable"
    assert levels.loc[december] == pytest.approx(float(knowable.iloc[-1]))
    # And strictly less than the month's real last value, which is the leak.
    assert levels.loc[december] < float(raw["value"].iloc[-1])


def test_a_month_below_coverage_is_absent_rather_than_represented_by_one_print():
    spec = PANEL_BY_ID["DGS10"]
    vin = {"DGS10": _daily_vintage("2015-01-01", "2020-12-31")}
    # Two business days into January: below the daily threshold, so the month
    # must not appear at all.
    when = pd.Timestamp("2021-01-05", tz="UTC")
    build = build_asof(when, vin, specs=(spec,))
    assert pd.Timestamp("2021-01-01", tz="UTC") not in build.levels.index
    assert MONTH_COVERAGE["daily"] > 2


def test_the_edge_reports_the_print_date_not_the_month_it_landed_in():
    """A same-day yield stamped into the September row is one day old, not 25."""
    spec = PANEL_BY_ID["DGS10"]
    vin = {"DGS10": _daily_vintage("2015-01-01", "2020-12-24")}
    when = pd.Timestamp("2020-12-28", tz="UTC")
    build = build_asof(when, vin, specs=(spec,))
    e = build.edge["DGS10"]
    assert e["through"] == "2020-12-24"
    assert e["panel_month"] == "2020-12-01"
    assert e["days_behind"] == 4
    # The frame's newest ROW is still the month, which is what months_behind says.
    assert build.months_behind == 0
    assert e["n_native"] > e["n_published"]


def test_quarterly_members_go_to_their_own_frame():
    """Stacked into the monthly frame they would read as a mostly-missing
    monthly series, which is a different and wrong claim than a quarterly one."""
    specs = _panel_of("PAYEMS", "GDPC1")
    obs_q = pd.date_range("1995-01-01", periods=100, freq="QS", tz="UTC")
    vin = {
        "PAYEMS": _vintage(MIN_USABLE_OBS + 240, start="1995-01-01", lag_days=34),
        "GDPC1": pd.DataFrame({
            "obs_date": obs_q,
            "value": [10_000.0 + 50.0 * i for i in range(len(obs_q))],
            "published": obs_q + pd.Timedelta(days=120),
        }),
    }
    build = build_asof("2019-12-31", vin, specs=specs)
    assert "GDPC1" not in build.frame.columns
    assert list(build.frame_q.columns) == ["GDPC1"]
    assert "GDPC1" in build.used and "PAYEMS" in build.used
    assert build.n_monthly == 1 and build.n_quarterly == 1
    assert build.edge["GDPC1"]["frequency"] == "quarterly"


def test_probed_but_unavailable_candidates_are_not_quietly_in_the_panel():
    overlap = set(UNAVAILABLE) & set(PANEL_BY_ID)
    assert not overlap, f"{overlap} are recorded as unavailable AND in the panel"
    for sid, reason in UNAVAILABLE.items():
        assert len(reason) > 40, f"{sid} is excluded without a stated measurement"


def test_price_indices_take_a_second_log_difference():
    # The first log difference of a price index is inflation; the second says
    # whether inflation is turning, which is what a factor should load on.
    for sid in ("CPIAUCSL", "CPILFESL", "PPIACO"):
        assert PANEL_BY_ID[sid].code == 6, f"{sid} is not second-log-differenced"
    # Rates are differenced, not log-differenced — they can be zero or negative.
    for sid in ("UNRATE", "TCU"):
        assert PANEL_BY_ID[sid].code == 2


# --- the factor model's frequency handling ---------------------------------

def test_period_conversion_round_trips_the_panel_index():
    """The factors come back on whatever index statsmodels used; downstream
    joins against `build.frame`, so the trip out and back must be lossless."""
    from ace.state.factors import _as_periods, _restore_index

    idx = pd.date_range("2010-01-01", periods=48, freq="MS", tz="UTC")
    frame = pd.DataFrame({"a": np.arange(48.0)}, index=idx)
    periods = _as_periods(frame, "M")
    assert isinstance(periods.index, pd.PeriodIndex)
    back = _restore_index(periods, idx)
    pd.testing.assert_index_equal(pd.DatetimeIndex(back.index), idx)


def test_block_map_reads_the_build_rather_than_a_module_constant():
    """A custom panel's blocks must survive; filtering against a global list
    would drop them and the loss would read as a modelling result."""
    from ace.state.factors import _block_map
    from ace.state.panel import PanelBuild

    build = PanelBuild(
        as_of="2020-01-01",
        frame=pd.DataFrame(columns=["A", "B", "C", "D"]),
        levels=pd.DataFrame(),
        used=("A", "B", "C", "D"),
        dropped={},
        edge={},
        groups={"invented_block": ("A", "B"), "singleton": ("C",)},
    )
    blocks = _block_map(build)
    assert blocks == {"invented_block": ["A", "B"]}, blocks


def test_a_quarterly_member_reaches_the_factor_model_through_endog_quarterly():
    """Not stacked into the monthly frame: DynamicFactorMQ must see it as
    quarterly so the Mariano-Murasawa aggregation applies."""
    from ace.state.factors import fit_factors

    specs = _panel_of("PAYEMS", "UNRATE", "MANEMP", "INDPRO", "GDPC1")
    n, rng = 200, np.random.default_rng(3)
    common = np.cumsum(rng.normal(0, 1, n))
    obs_m = pd.date_range("2000-01-01", periods=n, freq="MS", tz="UTC")
    vin = {}
    for i, spec in enumerate(specs[:-1]):
        base = 100.0 + 0.4 * common + rng.normal(0, 0.5, n) + 0.05 * i * np.arange(n)
        vin[spec.series_id] = pd.DataFrame({
            "obs_date": obs_m, "value": np.abs(base) + 10.0,
            "published": obs_m + pd.Timedelta(days=34),
        })
    obs_q = pd.date_range("2000-01-01", periods=n // 3, freq="QS", tz="UTC")
    vin["GDPC1"] = pd.DataFrame({
        "obs_date": obs_q,
        "value": 10_000.0 + np.cumsum(rng.normal(30, 10, len(obs_q))),
        "published": obs_q + pd.Timedelta(days=120),
    })
    build = build_asof("2016-06-30", vin, specs=specs)
    assert "GDPC1" in build.frame_q.columns
    fit = fit_factors(build, k=1, maxiter=15)
    assert "GDPC1" in fit.series
    assert fit.series_quarterly == ("GDPC1",)
    assert "GDPC1" not in fit.series_monthly
    # The factors must come back on the monthly panel's own index, not on the
    # PeriodIndex statsmodels works in.
    pd.testing.assert_index_equal(
        pd.DatetimeIndex(fit.factors.index), pd.DatetimeIndex(build.frame.index)
    )
    # And the training moments must cover the quarterly member too, or a later
    # date would standardise it against nothing.
    assert "GDPC1" in fit.mean.index and "GDPC1" in fit.std.index


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


def test_a_block_whose_edge_error_swamps_its_own_spread_is_flagged():
    """The failure mode this catches: a slow block whose newest month the filter
    knows nothing about reverts to the mean, so `level` reads as a confident
    zero rather than as silence."""
    from ace.state.state import UNINFORMATIVE_SE_RATIO, build_state

    fit, build = _toy_fit()
    wide = fit.factor_se.copy()
    for column in fit.factors.columns:
        # Ten times the factor's own spread: unambiguously uninformative.
        wide.loc[column] = 10.0 * float(fit.factors[column].std(ddof=1))
    state = build_state(replace(fit, factor_se=wide), build)
    assert state.blocks, "the fixture produced no blocks"
    for key, block in state.blocks.items():
        assert not block.informative, key
        assert block.uncertainty_ratio >= UNINFORMATIVE_SE_RATIO
    assert any("unconditional mean" in n for n in state.notes)

    # And the converse: a tiny error leaves every block usable.
    narrow = fit.factor_se.copy()
    for column in fit.factors.columns:
        narrow.loc[column] = 0.01 * float(fit.factors[column].std(ddof=1))
    ok = build_state(replace(fit, factor_se=narrow), build)
    assert all(b.informative for b in ok.blocks.values())
    assert not any("unconditional mean" in n for n in ok.notes)


def test_missing_uncertainty_counts_as_uninformative_rather_than_fine():
    """Absence of an error estimate is not evidence the estimate is good."""
    from ace.state.state import build_state

    fit, build = _toy_fit()
    blank = pd.Series(np.nan, index=fit.factor_se.index, dtype=float)
    state = build_state(replace(fit, factor_se=blank), build)
    for key, block in state.blocks.items():
        assert not block.informative, key
        assert np.isnan(block.uncertainty_ratio)


def test_a_non_binding_factor_count_says_so_rather_than_looking_load_bearing():
    """Under the block specification each block already gets a factor, so
    Bai-Ng's k changes nothing until it exceeds the number of blocks."""
    from ace.state.state import build_state

    fit, build = _toy_fit()
    state = build_state(replace(fit, count_binding=False), build)
    assert any("did not shape this fit" in n for n in state.notes)
    # It is still recorded — the point is to label it, not to hide it.
    assert state.factor_count == fit.factor_count.k


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
