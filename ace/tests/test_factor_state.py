"""Phase 8: does the Factor State API report the brief's full field contract
honestly, including the fields where the honest answer is "not available"?
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.factors.factor_state import (
    build_factor_states,
    load_snapshot,
    save_snapshot,
)
from ace.factors.pca import ComponentLoadings, PCAFit, fit
from ace.state.factors import FactorCount
from ace.state.panel import PanelBuild


def _panel(n_series: int, n_obs: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    common = np.cumsum(rng.normal(size=n_obs)).reshape(-1, 1)
    loadings = np.concatenate([np.ones(n_series // 2), -np.ones(n_series - n_series // 2)])
    signal = common @ loadings.reshape(1, -1)
    values = signal + rng.normal(scale=0.5, size=signal.shape)
    idx = pd.date_range("2000-01-01", periods=n_obs, freq="MS", tz="UTC")
    return pd.DataFrame(values, index=idx, columns=[f"S{i}" for i in range(n_series)])


def _tiny_fit(n_obs: int = 3) -> PCAFit:
    """A hand-built PCAFit with too little history for momentum/acceleration."""
    fc = FactorCount(k=1, criterion="ICp2", kmax=6, n=2, t=n_obs, ic={1: -1.0})
    comp = ComponentLoadings(
        index=1, explained_variance_ratio=0.9, cumulative_variance_ratio=0.9,
        eigenvalue=1.0, loadings=pd.Series({"S0": 1.0, "S1": -1.0}),
        top_positive=(("S0", 1.0),), top_negative=(("S1", -1.0),),
    )
    idx = pd.date_range("2020-01-01", periods=n_obs, freq="MS", tz="UTC")
    scores = pd.DataFrame({"PC1": np.linspace(0.1, 0.3, n_obs)}, index=idx)
    return PCAFit(
        as_of=str(idx[-1].date()), panel_label="tiny", n_series=2, n_obs=n_obs,
        series=("S0", "S1"), dates=tuple(idx), factor_count=fc,
        components=(comp,), scores=scores,
        mean=pd.Series({"S0": 0.0, "S1": 0.0}), std=pd.Series({"S0": 1.0, "S1": 1.0}),
    )


@pytest.fixture(scope="module")
def synthetic_fit() -> PCAFit:
    frame = _panel(n_series=24, n_obs=240, seed=1)
    return fit(frame, as_of="2020-01-01", label="test")


def test_full_field_contract_is_populated(synthetic_fit):
    states = build_factor_states(synthetic_fit)
    assert states
    s = states[0]

    assert s.factor_id == "test.PC1"
    assert s.factor_name == "test PC1"
    assert s.panel_label == "test"
    assert s.model_version == "v1"
    assert s.as_of_date
    assert s.last_model_fit == synthetic_fit.as_of

    assert np.isfinite(s.level)
    assert np.isfinite(s.z_score)
    assert 0.0 <= s.historical_percentile <= 100.0
    assert np.isfinite(s.momentum)
    assert np.isfinite(s.acceleration)
    assert s.direction in {"rising", "falling", "flat"}
    assert np.isfinite(s.volatility)

    # Static PCA has no posterior — this is an honest NaN, not a fabricated
    # confidence score.
    assert np.isnan(s.uncertainty)
    assert any("no posterior" in note for note in s.notes)

    # Monthly cadence: a "1-week" change would just be last month's change
    # wearing the wrong label, so it must come back as None, not a number.
    assert s.change_1w is None
    assert s.change_1m is not None
    assert s.change_3m is not None

    assert s.top_positive_loadings
    assert s.top_negative_loadings
    assert s.number_of_active_series == synthetic_fit.n_series
    assert s.number_of_missing_series == 0
    assert s.data_coverage == pytest.approx(1.0)
    assert s.drivers == ()  # no `build` was supplied


def test_change_since_previous_run_diffs_against_the_supplied_snapshot(synthetic_fit):
    baseline = build_factor_states(synthetic_fit)[0]
    previous = {baseline.factor_id: baseline.level - 2.0}

    states = build_factor_states(synthetic_fit, previous=previous)
    assert states[0].change_since_previous_run == pytest.approx(2.0, abs=1e-6)


def test_change_since_previous_run_is_none_when_no_snapshot_exists(synthetic_fit):
    states = build_factor_states(synthetic_fit, previous={})
    assert states[0].change_since_previous_run is None


def test_names_override_replaces_the_neutral_default(synthetic_fit):
    default_state = build_factor_states(synthetic_fit)[0]
    assert "growth" not in default_state.factor_name

    named = build_factor_states(synthetic_fit, names={"test.PC1": "growth (candidate)"})[0]
    assert named.factor_name == "growth (candidate)"


def test_a_component_with_too_little_history_is_skipped():
    assert build_factor_states(_tiny_fit(n_obs=3)) == ()


def test_coverage_falls_back_to_the_fits_own_dropped_columns_without_a_build():
    fc = FactorCount(k=1, criterion="ICp2", kmax=6, n=2, t=10, ic={1: -1.0})
    comp = ComponentLoadings(
        index=1, explained_variance_ratio=0.9, cumulative_variance_ratio=0.9,
        eigenvalue=1.0, loadings=pd.Series({"S0": 1.0, "S1": -1.0}),
        top_positive=(("S0", 1.0),), top_negative=(("S1", -1.0),),
    )
    idx = pd.date_range("2020-01-01", periods=10, freq="MS", tz="UTC")
    scores = pd.DataFrame({"PC1": np.linspace(0.1, 1.0, 10)}, index=idx)
    pca_fit = PCAFit(
        as_of=str(idx[-1].date()), panel_label="tiny", n_series=2, n_obs=10,
        series=("S0", "S1"), dates=tuple(idx), factor_count=fc,
        components=(comp,), scores=scores,
        mean=pd.Series({"S0": 0.0, "S1": 0.0}), std=pd.Series({"S0": 1.0, "S1": 1.0}),
        dropped_for_coverage={"S9": 0.5},
    )
    state = build_factor_states(pca_fit)[0]
    assert state.number_of_active_series == 2
    assert state.number_of_missing_series == 1
    assert state.data_coverage == pytest.approx(2 / 3, abs=1e-4)


def test_coverage_and_drivers_use_the_build_when_supplied(synthetic_fit):
    frame = _panel(n_series=24, n_obs=240, seed=1)  # same series `synthetic_fit` was built from
    all_series = tuple(frame.columns)
    build = PanelBuild(
        as_of="2020-01-01",
        frame=frame,
        levels=frame,
        used=all_series,
        dropped={},
        edge={sid: {"through": "2019-12-01", "days_behind": 5} for sid in all_series},
        groups={"test": all_series},
    )
    state = build_factor_states(synthetic_fit, build=build)[0]

    assert state.number_of_active_series == synthetic_fit.n_series
    assert state.number_of_missing_series == 0
    assert state.data_coverage == pytest.approx(1.0)
    assert state.drivers
    assert all(np.isfinite(d.contribution) for d in state.drivers)
    assert all(d.days_behind == 5 for d in state.drivers)


def test_intended_series_for_the_global_label_reads_the_whole_frame():
    frame = _panel(n_series=10, n_obs=200, seed=7)
    global_fit = fit(frame, as_of="2020-01-01", label="global")
    build = PanelBuild(
        as_of="2020-01-01", frame=frame, levels=frame, used=tuple(frame.columns),
        dropped={}, edge={}, groups={},
    )
    state = build_factor_states(global_fit, build=build)[0]
    assert state.number_of_active_series == global_fit.n_series
    assert state.data_coverage == pytest.approx(1.0)


def test_snapshot_round_trips_through_disk(tmp_path, synthetic_fit):
    path = tmp_path / "snapshot.json"
    states = build_factor_states(synthetic_fit)
    save_snapshot(states, path=path)

    loaded = load_snapshot(path=path)
    assert loaded[states[0].factor_id] == pytest.approx(states[0].level)


def test_snapshot_missing_file_returns_empty(tmp_path):
    assert load_snapshot(path=tmp_path / "does_not_exist.json") == {}
