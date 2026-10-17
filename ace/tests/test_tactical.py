"""Tactical futures book: lag, costs, frozen thresholds, and the published numbers.

The integration test recomputes the book from the committed price file and
checks it against src/lib/tactical/book.json. A change to a rule or a price
has to update both, on purpose.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.tactical.data import execution_frame, load_panel, price_haircut
from ace.tactical.models import month_ends, position_and_cost, regime_thresholds, return_sign, round_contracts, run
from ace.tactical.report import build_book
from ace.tactical.spec import CONTRACTS, TEST_START, TRAIN_END, TRAIN_START

BOOK = Path(__file__).resolve().parents[2] / "src" / "lib" / "tactical" / "book.json"


def test_round_contracts_is_half_away_from_zero_and_capped():
    assert round_contracts(0.5) == 1
    assert round_contracts(-0.5) == -1
    assert round_contracts(0.49) == 0
    assert round_contracts(4.2) == 4
    assert round_contracts(-9) == -4
    assert round_contracts(float("nan")) == 0


def test_position_starts_the_session_after_the_signal_and_cost_is_on_the_signal_day():
    index = pd.to_datetime(["2020-01-30", "2020-01-31", "2020-02-03", "2020-02-04"])
    targets = pd.Series({pd.Timestamp("2020-01-31"): 1, pd.Timestamp("2020-02-03"): -1})
    pos, cost = position_and_cost(index, targets, cost_per_side=10.0)
    assert list(pos.astype(int)) == [0, 0, 1, -1]
    assert cost.loc["2020-01-31"] == pytest.approx(10.0)
    # Flip from +1 to -1 turns two contracts.
    assert cost.loc["2020-02-03"] == pytest.approx(20.0)
    assert cost.loc["2020-01-30"] == 0
    assert cost.loc["2020-02-04"] == 0


def test_roll_haircut_removes_the_clipped_splice_and_leaves_a_large_basis_move():
    index = pd.to_datetime(["2020-03-18", "2020-03-19", "2020-03-20", "2020-06-18", "2020-06-19"])
    close = pd.Series([100.0, 100.0, 105.0, 100.0, 110.0], index=index)
    proxy = pd.Series([100.0, 100.0, 101.0, 100.0, 101.0], index=index)
    rolls = pd.DatetimeIndex(["2020-03-20", "2020-06-19"])
    haircut = price_haircut(close, proxy, rolls)
    # 5% futures vs 1% cash, clip 2 points on a 100 price.
    assert haircut.loc["2020-03-20"] == pytest.approx(2.0)
    # 10% vs 1% is past the 2% clip, so only 2 points come out and 8 stay.
    assert haircut.loc["2020-06-19"] == pytest.approx(2.0)
    assert haircut.loc["2020-03-19"] == 0


def test_momentum_sign_does_not_move_when_later_prices_change():
    index = pd.bdate_range("2010-01-01", periods=800)
    price = pd.Series(np.linspace(100, 180, len(index)), index=index)
    original = return_sign(price, 252)
    bumped = price.copy()
    bumped.iloc[-30:] = bumped.iloc[-30:] * 2
    revised = return_sign(bumped, 252)
    stamp = index[-40]
    assert original.loc[stamp] == revised.loc[stamp]
    assert original.loc[stamp] == 1


def test_unfinished_final_month_is_not_a_rebalance():
    index = pd.to_datetime(["2026-09-29", "2026-09-30", "2026-10-15", "2026-10-16"])
    ends = month_ends(index)
    assert pd.Timestamp("2026-09-30") in ends
    assert pd.Timestamp("2026-10-16") not in ends


def test_regime_threshold_uses_the_train_window_only():
    train = pd.date_range("2015-01-31", "2022-12-31", freq="ME")
    test = pd.date_range("2023-01-31", "2026-09-30", freq="ME")
    index = train.append(test)
    rv = pd.Series(0.10, index=index)
    rv.loc[train] = np.linspace(0.05, 0.40, len(train))
    rv.loc[test] = 9.0
    thresholds = regime_thresholds(rv)
    frozen = thresholds.loc[test, "p80"]
    assert frozen.nunique() == 1
    expected = float(np.quantile(rv.loc[train].to_numpy(), 0.80))
    assert frozen.iloc[0] == pytest.approx(expected)
    # The first train dates have no threshold until 24 readings exist, and the
    # reading on a date is not inside its own threshold.
    assert pd.isna(thresholds.iloc[0]["p80"])
    early = thresholds.loc[train[24], "p80"]
    assert early == pytest.approx(float(np.quantile(rv.loc[train[:24]].to_numpy(), 0.80)))


def test_published_panel_keeps_the_negative_crude_settlement():
    panel = load_panel()
    frames = execution_frame(panel)
    change = frames["CL"]["dollar_change"]
    april20 = float(change.loc["2020-04-20"])
    april17 = float(panel.loc["2020-04-17", "CL"])
    april20_px = float(panel.loc["2020-04-20", "CL"])
    assert april20_px < 0
    assert april20 == pytest.approx((april20_px - april17) * CONTRACTS["CL"].multiplier)
    assert april20 < -50_000


def test_published_book_matches_a_fresh_run_and_the_windows_are_sealed():
    panel = load_panel()
    fresh = build_book(panel)
    saved = json.loads(BOOK.read_text())
    assert saved["tuned_on_test"] is False
    assert saved["windows"]["train"] == {"start": TRAIN_START, "end": TRAIN_END, "role": saved["windows"]["train"]["role"]}
    assert saved["windows"]["test"]["start"] == TEST_START
    assert saved["as_of"] >= "2026-01-01"
    assert saved["models"]["carry"]["assets"]["CL"]["available"] is False
    assert saved["data"]["cl_2020_04_20_dollar_change"] < -50_000
    for model, block in saved["models"].items():
        fresh_block = fresh["models"][model]
        for asset, stats in block["assets"].items():
            other = fresh_block["assets"][asset]
            assert stats["available"] == other["available"]
            if not stats["available"]:
                continue
            for window in ("in_sample", "out_of_sample"):
                assert stats[window]["sharpe"] == pytest.approx(other[window]["sharpe"], rel=1e-9, abs=1e-9)
                assert stats[window]["total_pnl"] == pytest.approx(other[window]["total_pnl"], rel=0, abs=1e-6)
                assert stats[window]["max_drawdown"] == pytest.approx(other[window]["max_drawdown"], abs=1e-6)
                assert stats[window]["trade_count"] == other[window]["trade_count"]
                assert stats[window]["start"] >= (TRAIN_START if window == "in_sample" else TEST_START)
                if window == "in_sample":
                    assert stats[window]["end"] <= TRAIN_END
                else:
                    assert stats[window]["start"] >= TEST_START
        for window in ("in_sample", "out_of_sample"):
            assert block["book"][window]["total_pnl"] == pytest.approx(fresh_block["book"][window]["total_pnl"], abs=1e-6)
    assert saved["schema"] == "tactical-book-v2"
    assert saved["layers"]["parameters_fit_on_test"] is False
    assert saved["layers"]["stack_chosen_on_test"] is True
    assert saved["layers"]["recommended"] == fresh["layers"]["recommended"]
    for name in ("core", "core_news", "core_macro_flat", "core_macro_flip", "macro_only", "naive_proxy", "naive_catalog"):
        for window in ("in_sample", "out_of_sample"):
            assert saved["layers"]["stacks"][name]["book"][window]["total_pnl"] == pytest.approx(
                fresh["layers"]["stacks"][name]["book"][window]["total_pnl"], abs=1e-6
            )


def test_out_of_sample_prices_do_not_move_the_frozen_volatility_line():
    panel = load_panel()
    base = run(panel)
    shocked = panel.copy()
    shocked.loc[shocked.index >= TEST_START, "NQ"] = shocked.loc[shocked.index >= TEST_START, "NQ"] * 1.8
    moved = run(shocked)
    base_line = base["thresholds"]["NQ"]["p80"].loc[TEST_START:].dropna()
    moved_line = moved["thresholds"]["NQ"]["p80"].loc[TEST_START:].dropna()
    assert len(base_line) > 12
    assert base_line.nunique() == 1
    assert float(moved_line.iloc[0]) == pytest.approx(float(base_line.iloc[0]))


def test_cost_identity_and_contract_costs():
    panel = load_panel()
    result = run(panel)
    book = result["books"]["vol_filter_tsmom"]["ES"]
    assert book["gross"].sum() - book["cost"].sum() == pytest.approx(book["net"].sum())
    assert CONTRACTS["NQ"].cost_per_side == pytest.approx(2.50 + 5.0)
    assert CONTRACTS["ES"].cost_per_side == pytest.approx(2.50 + 12.50)
    assert CONTRACTS["GC"].cost_per_side == pytest.approx(2.50 + 20.0)
    assert CONTRACTS["CL"].cost_per_side == pytest.approx(2.50 + 20.0)
    # A one-lot that trades has a positive cost drag.
    assert book["cost"].sum() > 0
