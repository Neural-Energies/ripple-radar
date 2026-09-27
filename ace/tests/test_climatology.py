"""WP3's exit condition scorer: does a Brier-vs-climatology comparison say
what it should on cases with a KNOWN answer?
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.regime.climatology import AnchorReading, brier_score, skill_report


def test_brier_score_of_a_perfect_forecast_is_zero():
    assert brier_score([0, 1, 0, 1], [0, 1, 0, 1]) == pytest.approx(0.0)


def test_brier_score_of_a_confidently_wrong_forecast_is_one():
    assert brier_score([0, 1, 0, 1], [1, 0, 1, 0]) == pytest.approx(1.0)


def test_brier_score_of_a_coin_flip_forecast_is_a_quarter():
    assert brier_score([0, 1, 0, 1, 0, 1], [0.5] * 6) == pytest.approx(0.25)


def _readings(model_probs, outcomes, clim=0.5) -> list[AnchorReading]:
    return [
        AnchorReading(as_of=f"2020-{i+1:02d}-01", model_probability=mp,
                      climatology_probability=clim, outcome=y)
        for i, (mp, y) in enumerate(zip(model_probs, outcomes))
    ]


def test_a_perfect_model_beats_constant_climatology_significantly():
    outcomes = [0, 1, 0, 1, 0, 1, 0, 1]
    readings = _readings(outcomes, outcomes, clim=0.5)  # model == truth exactly
    report = skill_report(readings)
    assert report["model_brier"] == pytest.approx(0.0)
    assert report["climatology_brier"] == pytest.approx(0.25)
    assert report["skill"] == pytest.approx(0.25)
    assert report["ci"]["lo"] > 0
    assert "IMPROVES" in report["verdict"]


def test_an_always_wrong_model_is_worse_than_climatology_significantly():
    outcomes = [0, 1, 0, 1, 0, 1, 0, 1]
    wrong = [1 - y for y in outcomes]
    report = skill_report(_readings(wrong, outcomes, clim=0.5))
    assert report["model_brier"] == pytest.approx(1.0)
    assert report["skill"] < 0
    assert report["ci"]["hi"] < 0
    assert "WORSE" in report["verdict"]


def test_no_readings_is_reported_as_inconclusive_not_a_crash():
    report = skill_report([])
    assert report["n_anchors"] == 0
    assert report["model_brier"] is None
    assert "no anchors" in report["verdict"]


def test_a_single_anchor_cannot_support_a_bootstrap_ci():
    report = skill_report(_readings([0.9], [1], clim=0.5))
    assert report["n_anchors"] == 1
    # A single row resampled with replacement is always that same row, so the
    # CI collapses to a point rather than spanning a real distribution — this
    # is reported honestly as inconclusive, not dressed up as significant.
    assert report["ci"]["lo"] == pytest.approx(report["ci"]["hi"])
