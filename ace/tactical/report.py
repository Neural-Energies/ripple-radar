"""Assemble the published tactical book from a price panel.

The book is a data artifact. It is the payload served by the tactical API.
It records what was fixed, what was earned in each window, and the position
the rules held on the last session. It does not decide that a model is good.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import pandas as pd

from ace.tactical.models import run, window_metrics
from ace.tactical.spec import (
    CITATIONS,
    COMPOSITE_LOT_THRESHOLD,
    CONTRACTS,
    MAX_CONTRACTS,
    MIN_REGIME_OBS,
    MODEL_SUMMARY,
    MODELS,
    MOM_LOOKBACKS,
    REGIME_HIGH_Q,
    ROLL_CLIP,
    TEST_START,
    TRAIN_END,
    TRAIN_START,
    VALUE_LOOKBACK,
    VOL_BUDGET,
    VOL_WINDOW,
)


def _num(value):
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (int, float)):
        return value
    return value


def _clean(value):
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, float):
        return _num(value)
    return value


def _slice_sum(series: pd.Series, start: str, end: str | None) -> float:
    stop = series.index.max() if end is None else pd.Timestamp(end)
    window = series.loc[(series.index >= pd.Timestamp(start)) & (series.index <= stop)]
    return float(window.sum())


def _days_in_market(position: pd.Series, start: str, end: str | None) -> int:
    stop = position.index.max() if end is None else pd.Timestamp(end)
    window = position.loc[(position.index >= pd.Timestamp(start)) & (position.index <= stop)]
    return int((window != 0).sum())


def _metrics_for(book: dict, start: str, end: str | None) -> dict:
    metrics = window_metrics(book["net"], book["target"], start, end)
    metrics["cost_drag"] = _slice_sum(book["cost"], start, end)
    metrics["gross_pnl"] = metrics["total_pnl"] + metrics["cost_drag"]
    metrics["days_in_market"] = _days_in_market(book["position"], start, end)
    return metrics


def _compare(in_sample: dict, out_of_sample: dict) -> dict:
    sharpe_gap = None
    if in_sample.get("sharpe") is not None and out_of_sample.get("sharpe") is not None:
        sharpe_gap = out_of_sample["sharpe"] - in_sample["sharpe"]
    return {
        "sharpe_out_minus_in": sharpe_gap,
        "pnl_in_sample": in_sample.get("total_pnl"),
        "pnl_out_of_sample": out_of_sample.get("total_pnl"),
        "max_drawdown_in_sample": in_sample.get("max_drawdown"),
        "max_drawdown_out_of_sample": out_of_sample.get("max_drawdown"),
    }


def _path(net: pd.Series) -> list[dict]:
    """Month-end cumulative dollars from the first in-sample session."""
    start = pd.Timestamp(TRAIN_START)
    series = net.loc[net.index >= start]
    if series.empty:
        return []
    equity = series.cumsum()
    month = equity.groupby(equity.index.to_period("M")).tail(1)
    return [
        {"date": pd.Timestamp(stamp).strftime("%Y-%m-%d"), "equity": round(float(value), 2)}
        for stamp, value in month.items()
    ]


def _portfolio(books: dict[str, dict]) -> dict[str, pd.Series]:
    union = books[next(iter(books))]["net"].index
    for book in books.values():
        union = union.union(book["net"].index)
    union = pd.DatetimeIndex(union).sort_values()
    net = sum(book["net"].reindex(union).fillna(0.0) for book in books.values())
    cost = sum(book["cost"].reindex(union).fillna(0.0) for book in books.values())
    position = sum(book["position"].reindex(union).fillna(0).astype(int) for book in books.values())
    # Trade count is summed from the legs. An empty target keeps that sum from
    # being recomputed off a stacked, duplicate-dated series.
    return {"net": net, "cost": cost, "position": position, "target": pd.Series(dtype="float64")}


def build_book(panel: pd.DataFrame) -> dict:
    result = run(panel)
    frames = result["frames"]
    signals = result["signals"]
    as_of = max(frame.index.max() for frame in frames.values())
    models: dict[str, dict] = {}
    for model in MODELS:
        assets: dict[str, dict] = {}
        per_asset_books = result["books"][model]
        for symbol in CONTRACTS:
            carry_available = bool(signals["carry"][symbol].notna().any())
            available = carry_available if model == "carry" else True
            if not available:
                assets[symbol] = {
                    "available": False,
                    "reason": "No deferred crude contract and no cash series distinct from the prompt, so carry is not identified.",
                }
                continue
            book = per_asset_books[symbol]
            in_sample = _metrics_for(book, TRAIN_START, TRAIN_END)
            out_of_sample = _metrics_for(book, TEST_START, None)
            assets[symbol] = {
                "available": True,
                "in_sample": in_sample,
                "out_of_sample": out_of_sample,
                "comparison": _compare(in_sample, out_of_sample),
                "equity_month_end": _path(book["net"]),
                "last_target": _last_target(book["target"]),
                "position_on_last_session": int(book["position"].iloc[-1]),
            }
        portfolio_metrics = _portfolio_metrics(per_asset_books, model, signals)
        models[model] = {
            "summary": MODEL_SUMMARY[model],
            "assets": assets,
            "book": portfolio_metrics,
        }
    return _clean(
        {
            "schema": "tactical-book-v1",
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "as_of": pd.Timestamp(as_of).strftime("%Y-%m-%d"),
            "tuned_on_test": False,
            "windows": {
                "train": {"start": TRAIN_START, "end": TRAIN_END, "role": "Thresholds use only this window, expanding, then freeze."},
                "test": {"start": TEST_START, "end": pd.Timestamp(as_of).strftime("%Y-%m-%d"), "role": "Scored once. No rule was changed after seeing it."},
            },
            "parameters": {
                "momentum_lookbacks_sessions": list(MOM_LOOKBACKS),
                "value_lookback_sessions": VALUE_LOOKBACK,
                "vol_window_sessions": VOL_WINDOW,
                "regime_high_quantile": REGIME_HIGH_Q,
                "min_regime_observations": MIN_REGIME_OBS,
                "roll_clip": ROLL_CLIP,
                "composite_one_lot_threshold": COMPOSITE_LOT_THRESHOLD,
                "vol_budget_dollars": VOL_BUDGET,
                "max_contracts": MAX_CONTRACTS,
                "rebalance": "monthly, own last session of the month",
                "execution": "signal at the close, new position earns the next session, cost charged on the signal day",
            },
            "contracts": {
                symbol: {
                    "name": contract.name,
                    "yahoo": contract.yahoo,
                    "multiplier": contract.multiplier,
                    "tick_size": contract.tick_size,
                    "tick_value": contract.tick_value,
                    "slippage_ticks_per_side": contract.slippage_ticks,
                    "commission_per_side": 2.50,
                    "cost_per_side": contract.cost_per_side,
                    "roll": contract.roll,
                    "roll_proxy": contract.proxy,
                }
                for symbol, contract in CONTRACTS.items()
            },
            "data": _data_block(panel, frames),
            "citations": list(CITATIONS),
            "models": models,
        }
    )


def _last_target(target: pd.Series) -> dict:
    if target.empty:
        return {"date": None, "contracts": None}
    stamp = pd.Timestamp(target.index[-1])
    return {"date": stamp.strftime("%Y-%m-%d"), "contracts": int(target.iloc[-1])}


def _portfolio_metrics(books: dict[str, dict], model: str, signals: dict) -> dict:
    usable = {
        symbol: book
        for symbol, book in books.items()
        if model != "carry" or bool(signals["carry"][symbol].notna().any())
    }
    combined = _portfolio(usable)
    # Trade count is the sum of the legs. The concatenated target series would
    # double-count a calendar day on which two markets rebalance, and would
    # mis-handle the "previous position" of a different market. Sum the legs.
    in_sample = _metrics_for(combined, TRAIN_START, TRAIN_END)
    out_of_sample = _metrics_for(combined, TEST_START, None)
    in_sample["trade_count"] = sum(_metrics_for(book, TRAIN_START, TRAIN_END)["trade_count"] for book in usable.values())
    out_of_sample["trade_count"] = sum(_metrics_for(book, TEST_START, None)["trade_count"] for book in usable.values())
    return {
        "legs": list(usable),
        "note": "Sum of the leg P&L. Trade count is the sum of the leg trade counts. Inverse-vol models already size each leg to the same dollar-vol budget.",
        "in_sample": in_sample,
        "out_of_sample": out_of_sample,
        "comparison": _compare(in_sample, out_of_sample),
        "equity_month_end": _path(combined["net"]),
    }


def _data_block(panel: pd.DataFrame, frames: dict[str, pd.DataFrame]) -> dict:
    rows = {}
    for symbol, frame in frames.items():
        close = frame["close"]
        rows[symbol] = {
            "first": close.index.min().strftime("%Y-%m-%d"),
            "last": close.index.max().strftime("%Y-%m-%d"),
            "sessions": int(close.shape[0]),
            "roll_sessions_adjusted": int((frame["haircut"].abs() > 1e-9).sum()),
        }
    cl = frames["CL"]["dollar_change"]
    april20 = cl.loc["2020-04-20"] if "2020-04-20" in cl.index else None
    april21 = cl.loc["2020-04-21"] if "2020-04-21" in cl.index else None
    return {
        "prices": "Yahoo Finance daily continuous front-month futures, plus cash index and GLD for the roll check.",
        "real_yield": "U.S. Treasury H.15 10-year inflation-indexed yield. This is the series FRED publishes as DFII10. The FRED file download did not respond; the Treasury file is the primary source.",
        "panel_first": panel.index.min().strftime("%Y-%m-%d"),
        "panel_last": panel.index.max().strftime("%Y-%m-%d"),
        "assets": rows,
        "cl_2020_04_20_dollar_change": None if april20 is None else float(april20),
        "cl_2020_04_21_dollar_change": None if april21 is None else float(april21),
    }
