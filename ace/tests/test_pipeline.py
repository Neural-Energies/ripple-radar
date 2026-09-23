"""Tests for the ACE quantitative pipeline (§52, §53).

The leakage tests matter most. A pipeline that leaks does not crash — it
reports excellent performance that does not exist. These assert the specific
mistakes that produce fake financial results.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.calibration.calibrate import fit_calibrator
from ace.features.pit import CLOSE_FEATURE_COLUMNS, build_close_features
from ace.metrics.classification import evaluate, expected_calibration_error, reliability_table
from ace.validation.leakage import (
    LeakageError,
    assert_features_precede_prediction,
    assert_labels_follow_prediction,
    assert_no_duplicate_keys,
    assert_probabilities,
    assert_split_is_chronological,
)
from ace.validation.walkforward import sealed_split, walk_forward_folds


# ---------------------------------------------------------------- leakage ---
def test_features_after_prediction_are_rejected():
    ts = pd.Series(pd.date_range("2020-01-01", periods=5, tz="UTC"))
    assert_features_precede_prediction(ts, ts)  # equal is fine
    with pytest.raises(LeakageError):
        assert_features_precede_prediction(ts + pd.Timedelta(days=1), ts)


def test_labels_resolving_before_prediction_are_rejected():
    p = pd.Series(pd.date_range("2020-01-01", periods=5, tz="UTC"))
    assert_labels_follow_prediction(p, p + pd.Timedelta(days=5))
    with pytest.raises(LeakageError):
        assert_labels_follow_prediction(p, p)


def test_split_without_the_full_blackout_is_rejected():
    tr = pd.Series(pd.date_range("2020-01-01", periods=50, tz="UTC"))
    va = pd.Series(pd.date_range("2020-02-27", periods=20, tz="UTC"))
    assert_split_is_chronological(tr, va, label_horizon_days=5, embargo_days=2)
    near = pd.Series(pd.date_range("2020-02-20", periods=20, tz="UTC"))
    with pytest.raises(LeakageError):
        assert_split_is_chronological(tr, near, label_horizon_days=30, embargo_days=5)


def test_duplicate_observations_are_rejected():
    df = pd.DataFrame({"date": ["a", "a", "b"], "channel": ["x", "x", "y"]})
    with pytest.raises(LeakageError):
        assert_no_duplicate_keys(df, ["date", "channel"])


def test_walk_forward_never_trains_on_the_future():
    ts = pd.Series(pd.date_range("2015-01-01", periods=2000, freq="B", tz="UTC"))
    folds = walk_forward_folds(ts, n_folds=4, label_horizon_days=5, embargo_days=2, min_train=300)
    assert folds
    for f in folds:
        tr = ts.iloc[f.train_idx]
        va = ts.iloc[f.valid_idx]
        assert tr.max() < va.min(), "a training row is dated at or after validation opens"
        gap = va.min() - tr.max()
        assert gap >= pd.Timedelta(days=7), f"blackout too short: {gap}"
        assert len(np.intersect1d(f.train_idx, f.valid_idx)) == 0


def test_walk_forward_purges_more_when_the_horizon_is_longer():
    ts = pd.Series(pd.date_range("2015-01-01", periods=2000, freq="B", tz="UTC"))
    short = walk_forward_folds(ts, n_folds=4, label_horizon_days=1, embargo_days=0, min_train=300)
    long_ = walk_forward_folds(ts, n_folds=4, label_horizon_days=30, embargo_days=5, min_train=300)
    assert sum(f.n_purged for f in long_) > sum(f.n_purged for f in short)


def test_sealed_holdout_is_strictly_later_than_development():
    ts = pd.Series(pd.date_range("2015-01-01", periods=2000, freq="B", tz="UTC"))
    dev, hold, boundary = sealed_split(ts, holdout_frac=0.2, label_horizon_days=5, embargo_days=2)
    assert ts.iloc[dev].max() < ts.iloc[hold].min()
    assert len(np.intersect1d(dev, hold)) == 0


# --------------------------------------------------------------- features ---
def test_close_features_use_no_future_bars():
    """Truncating the series must not change features on the rows that remain.

    If a feature peeked ahead, the values before the cut would move when later
    bars are removed. This is the cheapest and strongest anti-leak check.
    """
    rng = np.random.default_rng(3)
    idx = pd.date_range("2015-01-01", periods=900, freq="B", tz="UTC")
    close = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, len(idx)))), index=idx)
    full = build_close_features(close)
    cut = 700
    partial = build_close_features(close.iloc[:cut])
    cols = list(CLOSE_FEATURE_COLUMNS)
    a = full[cols].iloc[:cut].to_numpy(dtype=float)
    b = partial[cols].to_numpy(dtype=float)
    both = ~np.isnan(a) & ~np.isnan(b)
    assert both.sum() > 0
    assert np.allclose(a[both], b[both], atol=1e-10), "a feature changed when future bars were removed"


# ---------------------------------------------------------------- metrics ---
def test_probability_bounds_enforced():
    assert_probabilities(np.array([0.0, 0.5, 1.0]))
    with pytest.raises(LeakageError):
        assert_probabilities(np.array([-0.01, 0.5]))
    with pytest.raises(LeakageError):
        assert_probabilities(np.array([0.5, np.nan]))


def test_brier_skill_score_is_zero_for_the_base_rate_forecast():
    y = np.array([1.0] * 40 + [0.0] * 60)
    p = np.full(100, 0.4)
    r = evaluate(y, p, base_rate=0.4)
    assert abs(r.brier_skill_score) < 1e-9
    assert not r.beats_baseline()


def test_an_overconfident_model_fails_the_gate_despite_equal_ranking():
    rng = np.random.default_rng(0)
    z = rng.normal(size=3000)
    y = (rng.uniform(size=3000) < 1 / (1 + np.exp(-0.4 * z))).astype(float)
    calibrated = 1 / (1 + np.exp(-0.4 * z))
    overconfident = np.clip(1 / (1 + np.exp(-2.0 * z)), 0.01, 0.99)
    rc, ro = evaluate(y, calibrated), evaluate(y, overconfident)
    assert abs(rc.roc_auc - ro.roc_auc) < 1e-3, "essentially the same ranking by construction"
    assert rc.beats_baseline() and not ro.beats_baseline()
    assert ro.ece > rc.ece


def test_expected_calibration_error_is_zero_when_perfectly_calibrated():
    y = np.concatenate([np.ones(70), np.zeros(30)])
    p = np.full(100, 0.7)
    assert expected_calibration_error(y, p, n_bins=10) < 1e-9


def test_reliability_buckets_report_realized_frequency():
    y = np.concatenate([np.ones(80), np.zeros(20)])
    rows = reliability_table(y, np.full(100, 0.8))
    assert rows and rows[-1]["n"] == 100
    assert abs(rows[-1]["realized_frequency"] - 0.8) < 1e-9


# ------------------------------------------------------------ calibration ---
def test_calibrator_fixes_a_systematically_overconfident_forecaster():
    rng = np.random.default_rng(5)
    z = rng.normal(size=4000)
    y = (rng.uniform(size=4000) < 1 / (1 + np.exp(-0.4 * z))).astype(float)
    bad = np.clip(1 / (1 + np.exp(-2.0 * z)), 0.01, 0.99)
    cal, _ = fit_calibrator(y, bad, base_rate=float(y.mean()))
    fixed = cal.transform(bad)
    assert_probabilities(fixed)
    assert evaluate(y, fixed).ece < evaluate(y, bad).ece


def test_calibrator_output_stays_a_probability():
    rng = np.random.default_rng(7)
    p = rng.uniform(size=500)
    y = (rng.uniform(size=500) < p).astype(float)
    cal, _ = fit_calibrator(y, p, base_rate=float(y.mean()))
    out = cal.transform(np.array([0.0, 0.5, 1.0]))
    assert np.all((out >= 0) & (out <= 1))


# -------------------------------------------------------------- registry ----
def test_registry_refuses_to_mint_production_directly(tmp_path, monkeypatch):
    import ace.registry.registry as reg

    monkeypatch.setattr(reg, "REGISTRY_PATH", tmp_path / "r.json")
    monkeypatch.setattr(reg, "MODELS", tmp_path)
    rec = reg.ModelRecord(
        model_id="m", model_family="f", model_version="v1", analysis_type="a", target_variable="t",
        feature_schema=[], training_start="", training_end="", validation_periods=[], holdout_period={},
        training_dataset_hash="h", hyperparameters={}, random_seed=1, performance_metrics={},
        calibration_metrics={}, benchmark_metrics={}, model_artifact_path="",
        creation_timestamp=reg.utcnow(), production_status="PRODUCTION",
    )
    with pytest.raises(ValueError):
        reg.register(rec)


def _record(reg, model_id="m", status="CANDIDATE", notes=""):
    return reg.ModelRecord(
        model_id=model_id, model_family="f", model_version="v1", analysis_type="a",
        target_variable="t", feature_schema=[], training_start="", training_end="",
        validation_periods=[], holdout_period={}, training_dataset_hash="h", hyperparameters={},
        random_seed=1, performance_metrics={}, calibration_metrics={}, benchmark_metrics={},
        model_artifact_path="", creation_timestamp=reg.utcnow(), production_status=status,
        notes=notes,
    )


def _isolated_registry(reg, tmp_path, monkeypatch):
    monkeypatch.setattr(reg, "REGISTRY_PATH", tmp_path / "r.json")
    monkeypatch.setattr(reg, "MODELS", tmp_path)


def test_re_registering_over_a_production_row_is_refused(tmp_path, monkeypatch):
    """The defect: a re-run on another channel silently demoted the champion.

    register() replaces the row for an id:version. When that row was the live
    PRODUCTION model, the replacement took it out of production with no retire
    event and no reason recorded — and the registry then reported FAILED for a
    model that had passed.
    """
    import ace.registry.registry as reg

    _isolated_registry(reg, tmp_path, monkeypatch)
    reg.register(_record(reg))
    reg.promote("m", "v1", reason="gate passed")
    assert reg.production_model("m")["production_status"] == "PRODUCTION"

    with pytest.raises(ValueError, match="PRODUCTION"):
        reg.register(_record(reg, status="FAILED"))
    assert reg.production_model("m") is not None, "the champion survived the refused write"


def test_retire_then_re_register_is_allowed(tmp_path, monkeypatch):
    """Demotion is available — it just has to be asked for, with a reason."""
    import ace.registry.registry as reg

    _isolated_registry(reg, tmp_path, monkeypatch)
    reg.register(_record(reg))
    reg.promote("m", "v1", reason="gate passed")
    retired = reg.retire("m", "v1", reason="holdout no longer clears the gate")
    assert retired["production_status"] == "RETIRED"
    assert "holdout no longer clears the gate" in retired["notes"]
    assert reg.production_model("m") is None
    reg.register(_record(reg, status="FAILED"))
    assert len(reg.all_records()) == 1


def test_retire_refuses_a_model_that_is_not_in_production(tmp_path, monkeypatch):
    import ace.registry.registry as reg

    _isolated_registry(reg, tmp_path, monkeypatch)
    reg.register(_record(reg))
    with pytest.raises(ValueError, match="only a PRODUCTION model"):
        reg.retire("m", "v1", reason="no")


def test_promote_refuses_anything_that_is_not_a_candidate(tmp_path, monkeypatch):
    import ace.registry.registry as reg

    _isolated_registry(reg, tmp_path, monkeypatch)
    reg.register(_record(reg, status="FAILED"))
    with pytest.raises(ValueError, match="only a CANDIDATE"):
        reg.promote("m", "v1", reason="wishful")


def test_per_channel_models_keep_separate_rows(tmp_path, monkeypatch):
    """Two channels of the same family must not overwrite each other."""
    import ace.registry.registry as reg

    _isolated_registry(reg, tmp_path, monkeypatch)
    reg.register(_record(reg, model_id="fam_SP500"))
    reg.promote("fam_SP500", "v1", reason="passed on SP500")
    reg.register(_record(reg, model_id="fam_WTI", status="FAILED"))
    assert reg.production_model("fam_SP500") is not None
    assert reg.production_model("fam_WTI") is None
    assert {r["model_id"] for r in reg.all_records()} == {"fam_SP500", "fam_WTI"}
