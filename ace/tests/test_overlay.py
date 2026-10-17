"""Macro-surprise signs, the frozen z-score, and the news flatten.

These checks are the rules. They do not look at 2023–2026 P&L.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.tactical.macro import (
    card_position,
    frozen_z_moments,
    load_releases,
    release_sign,
    with_surprise,
)
from ace.tactical.overlay import _cash_session, apply_target, choose_stack

ASSETS = ("NQ", "ES", "GC", "CL")


def test_hot_and_cool_cpi_are_opposite_books_and_crude_is_included():
    hot = [release_sign("cpi", 1.2, asset, True, True) for asset in ASSETS]
    cool = [release_sign("cpi", -1.2, asset, False, False) for asset in ASSETS]
    assert hot == [-1, -1, -1, 1]
    assert cool == [1, 1, 1, -1]
    assert release_sign("cpi", 0.2, "NQ", True, True) == 0


def test_payrolls_flip_with_growth_and_gold_needs_high_inflation():
    assert release_sign("nfp", 1.4, "NQ", True, True) == -1
    assert release_sign("nfp", 1.4, "NQ", True, False) == 1
    assert release_sign("nfp", -1.4, "ES", False, True) == 1
    assert release_sign("nfp", 1.4, "GC", True, True) == -1
    assert release_sign("nfp", 1.4, "GC", False, True) == 0
    assert release_sign("nfp", 1.4, "CL", True, True) == 0
    assert release_sign("nfp", 1.4, "NQ", True, None) == 0


def test_fomc_leaves_crude_alone_and_hawkish_is_short_equities():
    assert release_sign("fomc", 1.1, "NQ", None, None) == -1
    assert release_sign("fomc", -1.1, "GC", None, None) == 1
    assert release_sign("fomc", 2.0, "CL", True, True) == 0


def test_naive_card_map_matches_the_accuracy_report():
    assert card_position("hot_inflation", "NQ") == -1
    assert card_position("hot_inflation", "CL") == 1
    assert card_position("cool_inflation", "ES") == 1
    assert card_position("cool_inflation", "GC") == 1
    # Both labor cards are short equities. Cold is not the mirror image.
    assert card_position("hot_labor", "NQ") == -1
    assert card_position("cold_labor", "ES") == -1
    assert card_position("hot_labor", "CL") == 0
    assert card_position("cold_labor", "GC") == 1
    assert card_position("hawkish", "CL") == 0
    assert card_position("dovish", "NQ") == 1
    assert card_position("tariff", "GC") == 1
    assert card_position("tariff", "CL") == 0
    assert card_position("inline", "ES") == 0
    assert card_position("hold", "NQ") == 0


def test_overlay_respects_size_vol_and_does_not_short_on_the_news_filter():
    oppose = [(-1, 1.2)]
    soft = [(-1, 0.6)]
    assert apply_target(1, oppose, False, False, "macro_flat") == 0
    assert apply_target(1, soft, False, False, "macro_flat") == 1
    assert apply_target(1, oppose, False, False, "macro_flip") == -1
    assert apply_target(1, oppose, True, False, "macro_flip") == 0
    assert apply_target(0, [(1, 1.5)], False, False, "macro_flip") == 1
    assert apply_target(0, [(1, 1.5)], True, False, "macro_only") == 0
    # A short core is flattened, not flipped to a fresh short, when news is hot.
    assert apply_target(-1, [], False, True, "core") == 0
    assert apply_target(1, [], False, True, "core") == 0
    assert apply_target(1, [(-1, 2.0), (1, 1.5)], False, False, "macro_flip") == 0


def test_stack_choice_keeps_the_core_unless_a_candidate_adds_dollars():
    pnl = {
        "core": 100.0,
        "core_macro_flat": 90.0,
        "core_macro_flip": 80.0,
        "core_news": 100.0,
        "core_macro_flat_news": 110.0,
        "core_macro_flip_news": 110.0,
        "macro_only": 50.0,
    }
    # Tie at 110 keeps the earlier stack.
    assert choose_stack(pnl) == "core_macro_flat_news"
    pnl["core_macro_flat_news"] = 90.0
    pnl["core_macro_flip_news"] = 90.0
    pnl["core_news"] = 90.0
    assert choose_stack(pnl) == "core"


def test_sixteen_oclock_release_waits_for_the_next_session():
    dates = pd.to_datetime(["2025-04-02", "2025-04-03", "2025-04-04"])
    assert _cash_session(dates, "2025-04-02T20:00:00") == pd.Timestamp("2025-04-03")
    assert _cash_session(dates, "2025-04-02T13:30:00") == pd.Timestamp("2025-04-02")
    # Saturday morning New York is not a session.
    weekend = pd.to_datetime(["2023-10-06", "2023-10-09"])
    assert _cash_session(weekend, "2023-10-07T04:30:00") == pd.Timestamp("2023-10-09")


def test_first_prints_match_the_known_releases_and_the_futures_roll_is_not_a_surprise():
    releases = load_releases()
    cpi = releases[(releases["series"] == "cpi") & (releases["obs_period"] == "2024-03")].iloc[0]
    assert cpi["available_on"] == pd.Timestamp("2024-04-30")
    assert 0.3 < cpi["actual"] < 0.5
    nfp = releases[(releases["series"] == "nfp") & (releases["obs_period"] == "2024-07")].iloc[0]
    assert nfp["actual"] == pytest.approx(114.0)
    assert nfp["available_on"] == pd.Timestamp("2024-08-31")
    fomc = releases[(releases["series"] == "fomc") & (releases["obs_period"] == "2023-02-01")].iloc[0]
    # Close-to-close on this session is the contract splice, about +24bp.
    # The open-to-close surprise is the priced-in hike.
    assert abs(fomc["actual"]) < 0.02


def test_a_release_is_invisible_until_its_vintage_date():
    from ace.tactical.macro import _latest

    scored = with_surprise(load_releases())
    early = _latest(scored, "cpi", pd.Timestamp("2024-04-29"))
    late = _latest(scored, "cpi", pd.Timestamp("2024-04-30"))
    assert pd.Timestamp(early["available_on"]) <= pd.Timestamp("2024-03-31")
    assert late["obs_period"] == "2024-03"


def test_out_of_sample_actuals_do_not_move_the_frozen_z_moments():
    releases = load_releases()
    base = with_surprise(releases)
    mean, std = frozen_z_moments(base, "cpi")
    shocked = releases.copy()
    mask = (shocked["series"] == "cpi") & (shocked["available_on"] >= "2024-01-01")
    shocked.loc[mask, "actual"] = shocked.loc[mask, "actual"] + 5.0
    moved = with_surprise(shocked)
    assert frozen_z_moments(moved, "cpi") == pytest.approx((mean, std))
    june = base[(base["series"] == "cpi") & (base["obs_period"] == "2023-06")].iloc[0]
    june_moved = moved[(moved["series"] == "cpi") & (moved["obs_period"] == "2023-06")].iloc[0]
    assert june["z"] == pytest.approx(june_moved["z"])
    assert np.isfinite(june["z"])


def test_train_window_surprises_do_move_the_frozen_moments():
    releases = load_releases()
    base_mean, _ = frozen_z_moments(with_surprise(releases), "nfp")
    shocked = releases.copy()
    mask = (shocked["series"] == "nfp") & (shocked["available_on"] >= "2018-01-01") & (shocked["available_on"] <= "2018-12-31")
    shocked.loc[mask, "actual"] = shocked.loc[mask, "actual"] + 500.0
    moved_mean, _ = frozen_z_moments(with_surprise(shocked), "nfp")
    assert moved_mean != pytest.approx(base_mean)
