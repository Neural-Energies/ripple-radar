"""Signals, sizing, and the dollar backtest.

A decision at the close of session t uses prices and yields through t.
The new position earns the close-to-close move that starts at that close
(the next session's dollar change). The cost is charged on t, the day the
order is sent. Nothing in the out-of-sample window is allowed to change a
threshold, a lookback, or a budget.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ace.tactical.data import align_real_yield, execution_frame
from ace.tactical.spec import (
    ANNUALIZATION,
    COMPOSITE_LOT_THRESHOLD,
    CONTRACTS,
    MAX_CONTRACTS,
    MIN_REGIME_OBS,
    MODELS,
    MOM_LOOKBACKS,
    REGIME_HIGH_Q,
    REGIME_LOW_Q,
    TEST_START,
    TRAIN_END,
    TRAIN_START,
    VALUE_LOOKBACK,
    VOL_BUDGET,
    VOL_WINDOW,
)


def _sign(series: pd.Series) -> pd.Series:
    values = np.sign(series.to_numpy(dtype=float))
    return pd.Series(values, index=series.index)


def return_sign(price: pd.Series, lookback: int) -> pd.Series:
    """Sign of the lookback return. Unavailable when either price is not positive."""
    lagged = price.shift(lookback)
    ok = (price > 0) & (lagged > 0)
    raw = price / lagged - 1
    return _sign(raw).where(ok)


def month_ends(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Last session of each month. The unfinished final month is not a rebalance.

    A download that stops on the 16th is not a month-end. Treating it as one
    would send an order that a monthly book would not have sent, and would
    charge the cost with no following session to earn it back.
    """
    series = pd.Series(1, index=index)
    ends = series.groupby(index.to_period("M")).tail(1).index
    if len(ends) == 0:
        return ends
    last = pd.Timestamp(ends[-1])
    sample_ends_before_next_month = index.max() < last + pd.offsets.MonthBegin(1)
    if sample_ends_before_next_month and last.day < 25:
        return ends[:-1]
    return ends


def regime_thresholds(month_end_rv: pd.Series) -> pd.DataFrame:
    """Expanding 50th and 80th percentiles inside the train window, then frozen.

    The reading on the decision date is not included in its own threshold.
    Out-of-sample dates reuse the full train-window distribution and do not
    add themselves to it.
    """
    train_start = pd.Timestamp(TRAIN_START)
    train_end = pd.Timestamp(TRAIN_END)
    rows: list[tuple[pd.Timestamp, float | None, float | None]] = []
    past: list[float] = []
    frozen: tuple[float | None, float | None] | None = None
    for stamp, rv in month_end_rv.items():
        stamp = pd.Timestamp(stamp)
        finite = rv is not None and np.isfinite(rv)
        if stamp < train_start or stamp > train_end:
            if stamp > train_end:
                if frozen is None:
                    frozen = _quantiles(past)
                rows.append((stamp, frozen[0], frozen[1]))
            else:
                rows.append((stamp, None, None))
            continue
        p50, p80 = _quantiles(past) if len(past) >= MIN_REGIME_OBS else (None, None)
        rows.append((stamp, p50, p80))
        if finite:
            past.append(float(rv))
    frame = pd.DataFrame(rows, columns=["date", "p50", "p80"]).set_index("date")
    return frame


def _quantiles(values: list[float]) -> tuple[float | None, float | None]:
    if len(values) < MIN_REGIME_OBS:
        return None, None
    arr = np.asarray(values, dtype=float)
    return float(np.quantile(arr, REGIME_LOW_Q)), float(np.quantile(arr, REGIME_HIGH_Q))


def round_contracts(value: float) -> int:
    """Round half away from zero, then cap at MAX_CONTRACTS."""
    if value is None or not np.isfinite(value):
        return 0
    magnitude = math.floor(abs(value) + 0.5)
    signed = int(math.copysign(magnitude, value)) if magnitude else 0
    if signed > MAX_CONTRACTS:
        return MAX_CONTRACTS
    if signed < -MAX_CONTRACTS:
        return -MAX_CONTRACTS
    return signed


def size_to_budget(signal: float, dollar_vol: float) -> int:
    """Contracts so that signal × forecast dollar-vol ≈ VOL_BUDGET × signal."""
    if signal is None or not np.isfinite(signal) or signal == 0:
        return 0
    if dollar_vol is None or not np.isfinite(dollar_vol) or dollar_vol <= 0:
        return 0
    return round_contracts(signal * VOL_BUDGET / dollar_vol)


def position_and_cost(
    index: pd.DatetimeIndex,
    targets: pd.Series,
    cost_per_side: float,
) -> tuple[pd.Series, pd.Series]:
    """Hold the target from the session after the decision. Charge cost on the decision.

    A missing target does not change the position. Targets must be indexed by
    decision dates that sit on `index`.
    """
    pos = pd.Series(0, index=index, dtype=int)
    cost = pd.Series(0.0, index=index)
    indexer = {pd.Timestamp(stamp): i for i, stamp in enumerate(index)}
    current = 0
    starts: dict[pd.Timestamp, int] = {}
    ordered = targets.dropna().sort_index()
    for stamp, value in ordered.items():
        stamp = pd.Timestamp(stamp)
        loc = indexer.get(stamp)
        if loc is None:
            continue
        new = int(value)
        cost.at[stamp] = cost.at[stamp] + abs(new - current) * cost_per_side
        current = new
        if loc + 1 < len(index):
            starts[pd.Timestamp(index[loc + 1])] = new
    held = 0
    for stamp in index:
        stamp = pd.Timestamp(stamp)
        if stamp in starts:
            held = starts[stamp]
        pos.at[stamp] = held
    return pos, cost


def window_metrics(pnl: pd.Series, decisions: pd.Series, start: str, end: str | None) -> dict:
    """Sharpe, drawdown, profit factor and trade count on one window.

    Drawdown restarts at the first day of the window. Profit factor is the
    sum of winning days over the absolute sum of losing days, after costs.
    Trade count is the number of decision days inside the window where the
    contract position changed, including an open from flat.
    """
    stop = pnl.index.max() if end is None else pd.Timestamp(end)
    start_ts = pd.Timestamp(start)
    series = pnl.loc[(pnl.index >= start_ts) & (pnl.index <= stop)].astype(float)
    if series.empty:
        return _empty_metrics(start, None)
    equity = series.cumsum()
    drawdown = equity - equity.cummax()
    std = float(series.std(ddof=1)) if len(series) > 1 else 0.0
    sharpe = None if std == 0 or not np.isfinite(std) else float(series.mean() / std * np.sqrt(ANNUALIZATION))
    gains = float(series[series > 0].sum())
    losses = float(-series[series < 0].sum())
    profit_factor = None if losses == 0 else gains / losses
    chosen = decisions.dropna().sort_index()
    if not isinstance(chosen.index, pd.DatetimeIndex):
        chosen = pd.Series(dtype=float)
    in_window = chosen.loc[(chosen.index >= start_ts) & (chosen.index <= stop)] if len(chosen) else chosen
    changes = in_window.diff()
    if len(in_window):
        # Opening from flat counts. diff() is NaN on the first decision in the
        # window, so compare that one with the position just before the window.
        prior = chosen.loc[chosen.index < start_ts]
        previous = 0 if prior.empty else int(prior.iloc[-1])
        first_change = int(in_window.iloc[0]) - previous
        n_changes = int((changes.iloc[1:].abs() > 0).sum()) if len(in_window) > 1 else 0
        if first_change != 0:
            n_changes += 1
    else:
        n_changes = 0
    days_in = int((series != 0).sum())
    return {
        "start": series.index.min().strftime("%Y-%m-%d"),
        "end": series.index.max().strftime("%Y-%m-%d"),
        "days": int(len(series)),
        "total_pnl": float(series.sum()),
        "sharpe": sharpe,
        "max_drawdown": float(drawdown.min()),
        "profit_factor": None if profit_factor is None else float(profit_factor),
        "trade_count": n_changes,
        "days_with_pnl": days_in,
        "cost_drag": None,
    }


def _empty_metrics(start: str, end: str | None) -> dict:
    return {
        "start": start,
        "end": end,
        "days": 0,
        "total_pnl": 0.0,
        "sharpe": None,
        "max_drawdown": 0.0,
        "profit_factor": None,
        "trade_count": 0,
        "days_with_pnl": 0,
        "cost_drag": 0.0,
    }


def _sample(series: pd.Series, stamps: pd.DatetimeIndex) -> pd.Series:
    return series.reindex(stamps)


def build_signals(panel: pd.DataFrame) -> tuple[dict[str, pd.DatetimeIndex], dict[str, dict[str, pd.Series]], dict[str, pd.DataFrame]]:
    """Month-end signals and the execution frames they were built from."""
    frames = execution_frame(panel)
    union = pd.DatetimeIndex(sorted(set().union(*[frame.index for frame in frames.values()])))
    real = align_real_yield(panel, union)
    signals: dict[str, dict[str, pd.Series]] = {name: {} for name in (
        "mom12", "mom_multi", "value", "carry", "rv", "dollar_vol"
    )}
    ends_by_asset: dict[str, pd.DatetimeIndex] = {}
    for symbol, frame in frames.items():
        ends = month_ends(frame.index)
        ends_by_asset[symbol] = ends
        price = frame["adj_close"]
        mom_parts = [return_sign(price, lookback) for lookback in MOM_LOOKBACKS]
        mom_avg = pd.concat(mom_parts, axis=1).mean(axis=1, skipna=True)
        signals["mom12"][symbol] = _sample(return_sign(price, MOM_LOOKBACKS[-1]), ends)
        signals["mom_multi"][symbol] = _sample(_sign(mom_avg).where(mom_avg.notna()), ends)
        signals["value"][symbol] = _sample(_value_sign(price), ends)
        signals["rv"][symbol] = _sample(frame["rv"], ends)
        signals["dollar_vol"][symbol] = _sample(frame["dollar_vol"], ends)
        signals["carry"][symbol] = _sample(_carry(symbol, frame, real), ends)
    return ends_by_asset, signals, frames


def _value_sign(price: pd.Series) -> pd.Series:
    """Sign of the negative five-year return: long what has fallen."""
    lagged = price.shift(VALUE_LOOKBACK)
    ok = (price > 0) & (lagged > 0)
    raw = price / lagged - 1
    return _sign(-raw).where(ok)


def _days_to_quarterly_expiry(stamp: pd.Timestamp) -> int:
    year = stamp.year
    candidates = []
    for yr in (year, year + 1):
        for month in (3, 6, 9, 12):
            first = pd.Timestamp(year=yr, month=month, day=1)
            offset = (4 - int(first.weekday())) % 7
            candidates.append(first + pd.Timedelta(days=offset + 14))
    future = [day for day in candidates if day > stamp]
    return int((min(future) - stamp).days)


def _carry(symbol: str, frame: pd.DataFrame, real: pd.Series) -> pd.Series:
    """Basis carry for the equity indexes. Real-yield carry for gold. None for crude.

    Crude has no deferred contract and no cash series that is distinct from the
    prompt in the free data, so the carry sleeve is left unavailable rather
    than filled with a proxy that is the same price.
    """
    index = frame.index
    if symbol in ("NQ", "ES"):
        proxy = frame["proxy"]
        basis = frame["close"] / proxy - 1
        ok = (frame["close"] > 0) & (proxy > 0) & basis.notna()
        sign = _sign(-basis).where(ok)
        days = pd.Series([_days_to_quarterly_expiry(pd.Timestamp(stamp)) for stamp in index], index=index)
        return sign.where(days >= 5)
    if symbol == "GC":
        ry = real.reindex(index)
        return _sign(-ry).where(ry.notna())
    return pd.Series(np.nan, index=index)


def _at(series: pd.Series, stamp: pd.Timestamp) -> float | None:
    if stamp not in series.index:
        return None
    value = series.loc[stamp]
    if isinstance(value, pd.Series):
        value = value.iloc[-1]
    if value is None or not np.isfinite(value):
        return None
    return float(value)


def _thresholds_for(signals: dict[str, dict[str, pd.Series]]) -> dict[str, pd.DataFrame]:
    return {symbol: regime_thresholds(signals["rv"][symbol]) for symbol in CONTRACTS}


def _composite_score(
    symbol: str,
    stamp: pd.Timestamp,
    signals: dict[str, dict[str, pd.Series]],
    thresholds: pd.DataFrame,
) -> float | None:
    parts: list[float] = []
    for key in ("mom_multi", "carry", "value"):
        value = _at(signals[key][symbol], stamp)
        if value is not None:
            parts.append(value)
    vol = _vol_sign(symbol, stamp, signals, thresholds)
    if vol is not None:
        parts.append(vol)
    if not parts:
        return None
    return float(np.mean(parts))


def _vol_sign(
    symbol: str,
    stamp: pd.Timestamp,
    signals: dict[str, dict[str, pd.Series]],
    thresholds: pd.DataFrame,
) -> float | None:
    rv = _at(signals["rv"][symbol], stamp)
    if rv is None or stamp not in thresholds.index:
        return None
    p50 = thresholds.at[stamp, "p50"]
    p80 = thresholds.at[stamp, "p80"]
    if p50 is None or p80 is None or not np.isfinite(p50) or not np.isfinite(p80):
        return None
    if rv > p80:
        return -1.0
    if rv < p50:
        return 1.0
    return 0.0


def decide(
    model: str,
    symbol: str,
    stamp: pd.Timestamp,
    signals: dict[str, dict[str, pd.Series]],
    thresholds: pd.DataFrame,
) -> int:
    """Target contracts at this close. The caller only asks on sessions that printed."""
    mom12 = _at(signals["mom12"][symbol], stamp)
    multi = _at(signals["mom_multi"][symbol], stamp)
    value = _at(signals["value"][symbol], stamp)
    carry = _at(signals["carry"][symbol], stamp)
    dvol = _at(signals["dollar_vol"][symbol], stamp)
    if model == "buy_hold":
        return 1
    if model == "buy_hold_vol_target":
        return size_to_budget(1.0, dvol if dvol is not None else float("nan"))
    if model == "tsmom_12":
        return 0 if mom12 is None else int(mom12)
    if model == "tsmom_12_vol":
        return 0 if mom12 is None else size_to_budget(mom12, dvol if dvol is not None else float("nan"))
    if model == "tsmom_multi":
        return 0 if multi is None else int(multi)
    if model == "carry":
        return 0 if carry is None else int(carry)
    if model == "value":
        return 0 if value is None else int(value)
    if model == "vol_filter_tsmom":
        if multi is None:
            return 0
        rv = _at(signals["rv"][symbol], stamp)
        p80 = thresholds.at[stamp, "p80"] if stamp in thresholds.index else None
        if rv is not None and p80 is not None and np.isfinite(p80) and rv > p80:
            return 0
        return int(multi)
    score = _composite_score(symbol, stamp, signals, thresholds)
    if score is None:
        return 0
    if model == "composite_1lot":
        if score >= COMPOSITE_LOT_THRESHOLD:
            return 1
        if score <= -COMPOSITE_LOT_THRESHOLD:
            return -1
        return 0
    if model == "composite_vol_target":
        return size_to_budget(score, dvol if dvol is not None else float("nan"))
    raise KeyError(model)


def run(panel: pd.DataFrame) -> dict:
    """Full-sample positions and daily net P&L for every model and asset."""
    ends_by_asset, signals, frames = build_signals(panel)
    thresholds = _thresholds_for(signals)
    books: dict[str, dict[str, dict[str, pd.Series]]] = {}
    for model in MODELS:
        books[model] = {}
        for symbol, contract in CONTRACTS.items():
            asset_ends = ends_by_asset[symbol]
            targets = pd.Series(
                {
                    pd.Timestamp(stamp): decide(model, symbol, pd.Timestamp(stamp), signals, thresholds[symbol])
                    for stamp in asset_ends
                },
                dtype="float",
            )
            targets = targets.dropna().astype(int)
            index = frames[symbol].index
            pos, cost = position_and_cost(index, targets, contract.cost_per_side)
            dollar = frames[symbol]["dollar_change"].reindex(index).fillna(0.0)
            gross = pos.astype(float) * dollar
            net = gross - cost.reindex(index).fillna(0.0)
            books[model][symbol] = {
                "position": pos,
                "target": targets,
                "net": net,
                "cost": cost,
                "gross": gross,
            }
    return {
        "ends": ends_by_asset,
        "signals": signals,
        "frames": frames,
        "thresholds": thresholds,
        "books": books,
    }
