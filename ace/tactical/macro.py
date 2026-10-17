"""Point-in-time macro surprises and the news filter.

The numbers in `data/macro_releases.csv` are first releases. A surprise is
the first release minus the median of the previous 36 first releases for
CPI and payrolls. For FOMC it is already the futures surprise (the rate
priced just before the statement is the consensus). Z-scores use the
2015–2022 surprises only, expanding inside that window and frozen after it.

Nothing here reads a price from the test window in order to set a threshold.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ace.tactical.data import DATA_DIR
from ace.tactical.spec import (
    EPU_HIGH_Q,
    MIN_REGIME_OBS,
    REGIME_TRAIL,
    SURPRISE_MEDIAN,
    SURPRISE_MIN_Z,
    TRAIN_END,
    TRAIN_START,
    Z_ABSTAIN,
)

RELEASES_PATH = DATA_DIR / "macro_releases.csv"
EPU_PATH = DATA_DIR / "epu_monthly.csv"
CATALOG_PATH = DATA_DIR / "naive_catalog.json"
SOURCES_PATH = DATA_DIR / "macro_sources.json"

# The card from scripts/replay-eval/score.mjs on cursor/replay-accuracy-5997
# (PR #10). Copied here so this book does not import that harness. Empty
# means the card abstains. Yields and the dollar are not in this futures book.
NAIVE_RULES: dict[str, dict[str, int]] = {
    "hot_inflation": {"SPY": -1, "QQQ": -1, "TNX": 1, "DXY": 1, "GLD": -1, "CL": 1},
    "cool_inflation": {"SPY": 1, "QQQ": 1, "TNX": -1, "DXY": -1, "GLD": 1, "CL": -1},
    "inline": {},
    "hot_labor": {"SPY": -1, "QQQ": -1, "TNX": 1, "DXY": 1, "GLD": -1},
    "cold_labor": {"SPY": -1, "QQQ": -1, "TNX": -1, "DXY": -1, "GLD": 1},
    "hawkish": {"SPY": -1, "QQQ": -1, "TNX": 1, "DXY": 1, "GLD": -1},
    "dovish": {"SPY": 1, "QQQ": 1, "TNX": -1, "DXY": -1, "GLD": 1},
    "hold": {},
    "oil_cut": {"SPY": -1, "QQQ": -1, "TNX": 1, "GLD": 1, "CL": 1},
    "geo_shock": {"SPY": -1, "QQQ": -1, "TNX": -1, "DXY": 1, "GLD": 1, "CL": 1},
    "long_nvda": {"NVDA": 1, "QQQ": 1, "SPY": 1},
    "short_tsla": {"TSLA": -1, "QQQ": -1, "SPY": -1},
    "tariff": {"SPY": -1, "QQQ": -1, "TNX": -1, "DXY": 1, "GLD": 1},
    "none": {},
}

_FUTURE_KEY = {"NQ": "QQQ", "ES": "SPY", "GC": "GLD", "CL": "CL"}
ASSETS = ("NQ", "ES", "GC", "CL")


def load_releases() -> pd.DataFrame:
    frame = pd.read_csv(RELEASES_PATH)
    frame["available_on"] = pd.to_datetime(frame["available_on"])
    frame["actual"] = pd.to_numeric(frame["actual"], errors="coerce")
    frame["state"] = pd.to_numeric(frame["state"], errors="coerce")
    return frame.sort_values(["series", "available_on", "obs_period"]).reset_index(drop=True)


def load_epu() -> pd.Series:
    frame = pd.read_csv(EPU_PATH)
    index = pd.PeriodIndex(frame["month"].astype(str), freq="M")
    return pd.Series(pd.to_numeric(frame["value"], errors="coerce").to_numpy(), index=index, name="epu")


def load_catalog() -> list[dict]:
    return json.loads(CATALOG_PATH.read_text())


def load_sources() -> dict:
    if not SOURCES_PATH.exists():
        return {}
    return json.loads(SOURCES_PATH.read_text())


def card_position(rule: str, asset: str) -> int:
    """The PR #10 card, mapped onto NQ, ES, GC and CL. Missing leg is abstain."""
    table = NAIVE_RULES.get(rule, {})
    return int(table.get(_FUTURE_KEY[asset], 0))


def _moments(values: list[float]) -> tuple[float | None, float | None]:
    if len(values) < SURPRISE_MIN_Z:
        return None, None
    arr = np.asarray(values, dtype=float)
    std = float(arr.std(ddof=1))
    if not np.isfinite(std) or std == 0:
        return None, None
    return float(arr.mean()), std


def with_surprise(releases: pd.DataFrame) -> pd.DataFrame:
    """Consensus, surprise and a train-frozen z-score on each release."""
    train_start = pd.Timestamp(TRAIN_START)
    train_end = pd.Timestamp(TRAIN_END)
    frames = []
    for _, group in releases.groupby("series", sort=False):
        group = group.sort_values("available_on").copy()
        series = str(group["series"].iloc[0])
        actual = group["actual"].to_numpy(dtype=float)
        consensus = np.full(len(group), np.nan)
        surprise = np.full(len(group), np.nan)
        for i in range(len(group)):
            if not np.isfinite(actual[i]):
                continue
            # The fed-funds future is already the consensus. CPI and payrolls
            # have no free survey, so the consensus is the median of the
            # previous 36 first releases.
            if series == "fomc":
                consensus[i] = 0.0
                surprise[i] = float(actual[i])
                continue
            hist = actual[:i]
            hist = hist[np.isfinite(hist)]
            if len(hist) < SURPRISE_MEDIAN:
                continue
            median = float(np.median(hist[-SURPRISE_MEDIAN:]))
            consensus[i] = median
            surprise[i] = float(actual[i] - median)
        dates = pd.to_datetime(group["available_on"])
        z = np.full(len(group), np.nan)
        past: list[float] = []
        frozen: tuple[float | None, float | None] | None = None
        for i, stamp in enumerate(dates):
            stamp = pd.Timestamp(stamp)
            value = surprise[i]
            if stamp < train_start:
                continue
            if stamp > train_end:
                if frozen is None:
                    frozen = _moments(past)
                mean, std = frozen
            else:
                mean, std = _moments(past)
            if np.isfinite(value) and mean is not None and std is not None:
                z[i] = (float(value) - mean) / std
            if stamp <= train_end and np.isfinite(value):
                past.append(float(value))
        group["consensus"] = consensus
        group["surprise"] = surprise
        group["z"] = z
        frames.append(group)
    return pd.concat(frames, ignore_index=True)


def _history(scored: pd.DataFrame, series: str, stamp: pd.Timestamp) -> pd.DataFrame:
    group = scored[(scored["series"] == series) & (scored["available_on"] <= stamp)]
    return group.sort_values("available_on")


def regime_at(scored: pd.DataFrame, stamp: pd.Timestamp) -> tuple[bool | None, bool | None]:
    """Inflation and growth versus their own trailing five-year median.

    The current release is not part of its own median. Unknown when fewer
    than five years of first-release states are already out.
    """
    stamp = pd.Timestamp(stamp)

    def high(series: str) -> bool | None:
        group = _history(scored, series, stamp).dropna(subset=["state"])
        if len(group) < REGIME_TRAIL + 1:
            return None
        states = group["state"].to_numpy(dtype=float)
        current = float(states[-1])
        median = float(np.median(states[-(REGIME_TRAIL + 1) : -1]))
        return bool(current > median)

    return high("cpi"), high("nfp")


def release_sign(
    series: str,
    z: float,
    asset: str,
    inflation_high: bool | None,
    growth_high: bool | None,
) -> int:
    """One-lot sign for a release that is already large enough to have a view.

    CPI follows the naive card in every regime. Payrolls follow Boyd, Hu and
    Jagannathan on the equity indexes (the growth state) and only speak on
    gold when inflation is already high. FOMC follows the card and leaves
    crude alone. A z inside the abstain band returns 0.
    """
    if z is None or not np.isfinite(z) or abs(z) < Z_ABSTAIN:
        return 0
    hot = z > 0
    if series == "cpi":
        base = {"NQ": -1, "ES": -1, "GC": -1, "CL": 1}[asset]
        return base if hot else -base
    if series == "nfp":
        if asset == "CL":
            return 0
        if asset in ("NQ", "ES"):
            if growth_high is None:
                return 0
            if growth_high:
                return -1 if hot else 1
            return 1 if hot else -1
        if not inflation_high:
            return 0
        return -1 if hot else 1
    if series == "fomc":
        if asset == "CL":
            return 0
        return -1 if hot else 1
    return 0


def _latest(scored: pd.DataFrame, series: str, stamp: pd.Timestamp) -> pd.Series | None:
    group = _history(scored, series, stamp)
    if group.empty:
        return None
    return group.iloc[-1]


def views_at(scored: pd.DataFrame, stamp: pd.Timestamp, *, card: bool = False) -> dict[str, list[tuple[int, float]]]:
    """Per asset, the live (sign, z) pairs known at this close."""
    stamp = pd.Timestamp(stamp)
    inflation_high, growth_high = regime_at(scored, stamp)
    views: dict[str, list[tuple[int, float]]] = {asset: [] for asset in ASSETS}
    for series, rule_hot, rule_cold in (
        ("cpi", "hot_inflation", "cool_inflation"),
        ("nfp", "hot_labor", "cold_labor"),
        ("fomc", "hawkish", "dovish"),
    ):
        row = _latest(scored, series, stamp)
        if row is None or not np.isfinite(row["z"]) or abs(float(row["z"])) < Z_ABSTAIN:
            continue
        z = float(row["z"])
        for asset in ASSETS:
            if card:
                sign = card_position(rule_hot if z > 0 else rule_cold, asset)
            else:
                sign = release_sign(series, z, asset, inflation_high, growth_high)
            if sign != 0:
                views[asset].append((sign, z))
    return views


def lagged_epu(epu: pd.Series, stamp: pd.Timestamp) -> float | None:
    """Previous calendar month's news index. The current month is not used."""
    period = pd.Timestamp(stamp).to_period("M") - 1
    if period not in epu.index:
        return None
    value = epu.loc[period]
    if isinstance(value, pd.Series):
        value = value.iloc[0]
    if value is None or not np.isfinite(value):
        return None
    return float(value)


def epu_hot(dates: pd.DatetimeIndex, epu: pd.Series) -> dict[pd.Timestamp, bool]:
    """True when lagged EPU is above the train-frozen 80th percentile."""
    train_start = pd.Timestamp(TRAIN_START)
    train_end = pd.Timestamp(TRAIN_END)
    past: list[float] = []
    frozen: float | None = None
    flags: dict[pd.Timestamp, bool] = {}
    for raw in dates:
        stamp = pd.Timestamp(raw)
        value = lagged_epu(epu, stamp)
        if stamp > train_end:
            if frozen is None and len(past) >= MIN_REGIME_OBS:
                frozen = float(np.quantile(np.asarray(past, dtype=float), EPU_HIGH_Q))
            limit = frozen
        elif stamp < train_start or len(past) < MIN_REGIME_OBS:
            limit = None
        else:
            limit = float(np.quantile(np.asarray(past, dtype=float), EPU_HIGH_Q))
        flags[stamp] = bool(limit is not None and value is not None and value > limit)
        if train_start <= stamp <= train_end and value is not None:
            past.append(value)
    return flags


def frozen_z_moments(scored: pd.DataFrame, series: str) -> tuple[float, float]:
    """Mean and std of train-window surprises. Test-window rows are not in it."""
    group = scored[scored["series"] == series].sort_values("available_on")
    train = group[
        (group["available_on"] >= pd.Timestamp(TRAIN_START))
        & (group["available_on"] <= pd.Timestamp(TRAIN_END))
        & np.isfinite(group["surprise"])
    ]
    mean, std = _moments(list(train["surprise"].astype(float)))
    if mean is None or std is None:
        raise RuntimeError(f"no frozen moments for {series}")
    return mean, std
