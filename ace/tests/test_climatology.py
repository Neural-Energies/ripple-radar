"""WP3's exit condition scorer: does a Brier-vs-climatology comparison say
what it should on cases with a KNOWN answer, and refuse to conclude from too
little (PR #5 B04)?
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.regime.climatology import AnchorReading, Sufficiency, brier_score, skill_report


def test_brier_score_of_a_perfect_forecast_is_zero():
    assert brier_score([0, 1, 0, 1], [0, 1, 0, 1]) == pytest.approx(0.0)


def test_brier_score_of_a_confidently_wrong_forecast_is_one():
    assert brier_score([0, 1, 0, 1], [1, 0, 1, 0]) == pytest.approx(1.0)


def test_brier_score_of_a_coin_flip_forecast_is_a_quarter():
    assert brier_score([0, 1, 0, 1, 0, 1], [0.5] * 6) == pytest.approx(0.25)


def _readings(model_probs, outcomes, clim=0.5) -> list[AnchorReading]:
    return [
        AnchorReading(as_of=f"{2000 + i // 12}-{i % 12 + 1:02d}-01", model_probability=mp,
                      climatology_probability=clim, outcome=y)
        for i, (mp, y) in enumerate(zip(model_probs, outcomes))
    ]


ALTERNATING = [0, 1] * 12  # 24 anchors, 12 events, 12 non-events


def test_a_perfect_model_beats_constant_climatology_significantly():
    report = skill_report(_readings(ALTERNATING, ALTERNATING, clim=0.5))
    assert report["model_brier"] == pytest.approx(0.0)
    assert report["climatology_brier"] == pytest.approx(0.25)
    assert report["skill"] == pytest.approx(0.25)
    assert report["ci"]["lo"] > 0
    assert "IMPROVES" in report["verdict"]


def test_an_always_wrong_model_is_worse_than_climatology_significantly():
    wrong = [1 - y for y in ALTERNATING]
    report = skill_report(_readings(wrong, ALTERNATING, clim=0.5))
    assert report["model_brier"] == pytest.approx(1.0)
    assert report["skill"] < 0
    assert report["ci"]["hi"] < 0
    assert "WORSE" in report["verdict"]


def test_one_favourable_anchor_is_inconclusive_not_significant():
    # The audit's exact call: this used to read "IMPROVES ON CLIMATOLOGY (CI excludes zero)".
    report = skill_report([AnchorReading("2020-01-01", 0.9, 0.5, 1)], n_boot=100)
    assert report["verdict"].startswith("INCONCLUSIVE — insufficient sample")
    assert report["ci"] is None


def test_a_perfect_model_on_too_few_anchors_is_still_inconclusive():
    outcomes = [0, 1] * 4
    report = skill_report(_readings(outcomes, outcomes, clim=0.5))
    assert report["skill"] == pytest.approx(0.25), "the score is still reported"
    assert "INCONCLUSIVE" in report["verdict"]
    assert "n=8 < 20" in report["verdict"]


def test_event_coverage_is_required_not_just_count():
    all_up = [1] * 30
    report = skill_report(_readings([0.9] * 30, all_up, clim=0.5))
    assert "non-events=0 < 6" in report["verdict"]


def test_duplicate_or_unordered_anchors_are_refused():
    r = AnchorReading("2020-01-01", 0.9, 0.5, 1)
    with pytest.raises(ValueError, match="duplicate"):
        skill_report([r, r])
    with pytest.raises(ValueError, match="time order"):
        skill_report([AnchorReading("2021-01-01", 0.9, 0.5, 1), r])


def test_the_interval_widens_at_a_stricter_family_wise_level():
    probs = [0.7 if y else 0.3 for y in ALTERNATING]
    wide = skill_report(_readings(probs, ALTERNATING), alpha=0.05 / 4)
    narrow = skill_report(_readings(probs, ALTERNATING), alpha=0.05)
    assert wide["ci"]["hi"] - wide["ci"]["lo"] >= narrow["ci"]["hi"] - narrow["ci"]["lo"]
    assert wide["ci"]["level"] == pytest.approx(1 - 0.05 / 4)


def test_custom_sufficiency_is_recorded_with_the_report():
    report = skill_report(_readings(ALTERNATING, ALTERNATING), sufficiency=Sufficiency(min_n=30))
    assert report["sufficiency"]["min_n"] == 30
    assert "n=24 < 30" in report["verdict"]


def test_no_readings_is_reported_as_inconclusive_not_a_crash():
    report = skill_report([])
    assert report["n_anchors"] == 0
    assert report["model_brier"] is None
    assert "no anchors" in report["verdict"]
