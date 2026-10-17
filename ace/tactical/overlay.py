"""Macro-surprise and news overlays on the volatility-filtered trend.

The core position is decided first. A macro release can flatten it, or
replace it, only when the surprise z-score is at least 1. The news index
can flatten NQ and ES after that. It cannot open a position and it cannot
turn a flat into a short.

The naive card is scored beside these stacks. It is not one of them.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ace.tactical.macro import (
    ASSETS,
    card_position,
    epu_hot,
    views_at,
)
from ace.tactical.models import position_and_cost
from ace.tactical.spec import CONTRACTS, CORE_MODEL, NEWS_ASSETS, Z_ABSTAIN, Z_OVERRIDE

# mode, then whether the news filter flattens NQ and ES afterwards.
LAYER_SPEC: dict[str, tuple[str, bool]] = {
    "core": ("core", False),
    "core_macro_flat": ("macro_flat", False),
    "core_macro_flip": ("macro_flip", False),
    "core_news": ("core", True),
    "core_macro_flat_news": ("macro_flat", True),
    "core_macro_flip_news": ("macro_flip", True),
    "macro_only": ("macro_only", False),
    "naive_proxy": ("card", False),
}

# Stacks the test window is allowed to choose among. The naive card is not here.
CANDIDATES: tuple[str, ...] = (
    "core_macro_flat",
    "core_macro_flip",
    "core_news",
    "core_macro_flat_news",
    "core_macro_flip_news",
    "macro_only",
)

SELECTION_RULE = (
    "Of the pre-specified stacks, keep the one with the highest out-of-sample "
    "net dollar P&L after costs, if that P&L is above the volatility-filtered "
    "trend alone. If none is above it, keep the trend. A tie keeps the earlier "
    "stack. The naive card is the benchmark and is not a candidate. The test "
    "window is used for this choice once."
)

DEADBAND = 0.0005


def apply_target(
    core: int,
    views: list[tuple[int, float]],
    high_vol: bool,
    news_flatten: bool,
    mode: str,
) -> int:
    """Contracts after the overlay. `views` are (sign, z) pairs already non-zero."""
    if mode == "core":
        target = int(core)
    elif mode == "macro_flat":
        target = 0 if high_vol else int(core)
        if target != 0 and any(sign == -target and abs(z) >= Z_OVERRIDE for sign, z in views):
            target = 0
    elif mode == "macro_flip":
        if high_vol:
            target = 0
        else:
            large = {sign for sign, z in views if abs(z) >= Z_OVERRIDE}
            if len(large) == 1:
                target = large.pop()
            elif len(large) > 1:
                target = 0
            else:
                target = int(core)
    elif mode == "macro_only":
        if high_vol:
            target = 0
        else:
            large = {sign for sign, z in views if abs(z) >= Z_OVERRIDE}
            target = 0 if len(large) != 1 else large.pop()
    elif mode == "card":
        # The card has no vol gate and speaks from the abstain band up.
        voiced = {sign for sign, z in views if abs(z) >= Z_ABSTAIN}
        target = 0 if len(voiced) != 1 else voiced.pop()
    else:
        raise KeyError(mode)
    if news_flatten:
        target = 0
    return int(target)


def _high_vol(signals: dict, thresholds: pd.DataFrame, symbol: str, stamp: pd.Timestamp) -> bool:
    rv = signals["rv"][symbol]
    if stamp not in rv.index or stamp not in thresholds.index:
        return False
    value = rv.loc[stamp]
    limit = thresholds.at[stamp, "p80"]
    if value is None or limit is None or not np.isfinite(value) or not np.isfinite(limit):
        return False
    return bool(float(value) > float(limit))


def _books_from_targets(
    frames: dict[str, pd.DataFrame],
    targets_by_asset: dict[str, pd.Series],
) -> dict[str, dict[str, pd.Series]]:
    books = {}
    for symbol, contract in CONTRACTS.items():
        targets = targets_by_asset[symbol].dropna().astype(int)
        index = frames[symbol].index
        pos, cost = position_and_cost(index, targets, contract.cost_per_side)
        dollar = frames[symbol]["dollar_change"].reindex(index).fillna(0.0)
        gross = pos.astype(float) * dollar
        net = gross - cost.reindex(index).fillna(0.0)
        books[symbol] = {"position": pos, "target": targets, "net": net, "cost": cost, "gross": gross}
    return books


def run_layers(result: dict, scored: pd.DataFrame, epu: pd.Series) -> dict[str, dict]:
    """Monthly stacks. Targets are set on each market's own month-end close."""
    frames = result["frames"]
    core = result["books"][CORE_MODEL]
    hot_by_asset = {symbol: epu_hot(result["ends"][symbol], epu) for symbol in CONTRACTS}
    # Views depend only on the date, so cache them across the four markets.
    view_cache: dict[pd.Timestamp, dict] = {}
    card_cache: dict[pd.Timestamp, dict] = {}

    def views_for(stamp: pd.Timestamp, card: bool) -> dict:
        cache = card_cache if card else view_cache
        if stamp not in cache:
            cache[stamp] = views_at(scored, stamp, card=card)
        return cache[stamp]

    layers = {}
    for name, (mode, use_news) in LAYER_SPEC.items():
        targets_by_asset = {}
        for symbol in CONTRACTS:
            targets = {}
            for raw in result["ends"][symbol]:
                stamp = pd.Timestamp(raw)
                core_target = int(core[symbol]["target"].loc[stamp])
                view = views_for(stamp, card=(mode == "card"))[symbol]
                flatten = bool(use_news and symbol in NEWS_ASSETS and hot_by_asset[symbol].get(stamp, False))
                targets[stamp] = apply_target(
                    core_target,
                    view,
                    _high_vol(result["signals"], result["thresholds"][symbol], symbol, stamp),
                    flatten,
                    mode,
                )
            targets_by_asset[symbol] = pd.Series(targets, dtype="float")
        layers[name] = _books_from_targets(frames, targets_by_asset)
    return layers


def _cash_session(dates: pd.DatetimeIndex, release_utc: str) -> pd.Timestamp | None:
    """Same clock as the accuracy report: before 16:00 New York, else the next session."""
    stamp = pd.Timestamp(release_utc)
    if stamp.tzinfo is None:
        stamp = stamp.tz_localize("UTC")
    local = stamp.tz_convert("America/New_York")
    ymd = pd.Timestamp(local.date())
    minutes = local.hour * 60 + local.minute
    sessions = pd.DatetimeIndex(pd.to_datetime(dates)).sort_values().unique()
    if ymd in sessions and minutes < 16 * 60:
        return pd.Timestamp(ymd)
    future = sessions[sessions > ymd]
    if len(future) == 0:
        return None
    return pd.Timestamp(future[0])


def catalog_books(result: dict, catalog: list[dict]) -> tuple[dict[str, dict[str, pd.Series]], dict]:
    """The PR #10 card as one-session round trips on the four futures.

    The position is on for the cash session that contains the release and
    flat again the next session. Cost is the entry and the exit.
    """
    frames = result["frames"]
    es_dates = frames["ES"].index
    targets: dict[str, dict[pd.Timestamp, int]] = {symbol: {} for symbol in ASSETS}
    calls = []
    for event in catalog:
        session = _cash_session(es_dates, event["release_utc"])
        if session is None:
            continue
        for symbol in ASSETS:
            sign = card_position(event["naive"], symbol)
            if sign == 0:
                continue
            index = frames[symbol].index
            hold_candidates = index[index >= session]
            if len(hold_candidates) == 0:
                continue
            hold = pd.Timestamp(hold_candidates[0])
            prior_candidates = index[index < hold]
            if len(prior_candidates) == 0:
                continue
            prior = pd.Timestamp(prior_candidates[-1])
            _set(targets[symbol], prior, sign)
            _set(targets[symbol], hold, 0)
            close = frames[symbol]["close"]
            if hold not in close.index or prior not in close.index or float(close.loc[prior]) == 0:
                ret = None
            else:
                ret = float(close.loc[hold] / close.loc[prior] - 1.0)
            calls.append({"event": event["id"], "asset": symbol, "sign": sign, "session": hold, "ret": ret})
    books = _books_from_targets(
        frames,
        {symbol: pd.Series(targets[symbol], dtype="float") for symbol in ASSETS},
    )
    decided = [row for row in calls if row["ret"] is not None and abs(row["ret"]) >= DEADBAND]
    hits = [row for row in decided if np.sign(row["ret"]) == row["sign"]]
    flats = [row for row in calls if row["ret"] is not None and abs(row["ret"]) < DEADBAND]
    summary = {
        "calls": len(calls),
        "decided": len(decided),
        "hits": len(hits),
        "flats": len(flats),
        "hit_rate": None if not decided else len(hits) / len(decided),
        "deadband": DEADBAND,
        "note": (
            "Sign hit on the event session, absolute return at least 5 basis points, "
            "NQ/ES/GC/CL only. This is not the six-asset basket in the accuracy report."
        ),
    }
    return books, summary


def _set(bucket: dict[pd.Timestamp, int], stamp: pd.Timestamp, value: int) -> None:
    current = bucket.get(stamp)
    if current is None:
        bucket[stamp] = int(value)
    elif current != int(value):
        bucket[stamp] = 0


def choose_stack(oos_pnl: dict[str, float]) -> str:
    """Name of the stack to keep. `oos_pnl` includes 'core' and the candidates."""
    core = oos_pnl["core"]
    beaten = [name for name in CANDIDATES if oos_pnl[name] > core]
    if not beaten:
        return "core"
    return max(beaten, key=lambda name: (oos_pnl[name], -CANDIDATES.index(name)))
