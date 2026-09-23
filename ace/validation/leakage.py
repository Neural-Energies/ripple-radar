"""Explicit leakage assertions (§53). These raise — they do not warn."""
from __future__ import annotations

import numpy as np
import pandas as pd


class LeakageError(AssertionError):
    """A feature or split exposes information that did not exist yet."""


def assert_features_precede_prediction(feature_ts: pd.Series, predict_ts: pd.Series) -> None:
    f = pd.to_datetime(pd.Series(feature_ts), utc=True).reset_index(drop=True)
    p = pd.to_datetime(pd.Series(predict_ts), utc=True).reset_index(drop=True)
    bad = int((f > p).sum())
    if bad:
        raise LeakageError(f"{bad} rows carry features stamped after the prediction time")


def assert_labels_follow_prediction(predict_ts: pd.Series, label_ts: pd.Series) -> None:
    p = pd.to_datetime(pd.Series(predict_ts), utc=True).reset_index(drop=True)
    l = pd.to_datetime(pd.Series(label_ts), utc=True).reset_index(drop=True)
    bad = int((l <= p).sum())
    if bad:
        raise LeakageError(f"{bad} labels resolve at or before their own prediction time")


def assert_split_is_chronological(
    train_ts: pd.Series, valid_ts: pd.Series, *, label_horizon_days: int, embargo_days: int = 0
) -> None:
    tr = pd.to_datetime(pd.Series(train_ts), utc=True)
    va = pd.to_datetime(pd.Series(valid_ts), utc=True)
    if tr.empty or va.empty:
        return
    required_gap = pd.Timedelta(days=label_horizon_days + embargo_days)
    gap = va.min() - tr.max()
    if gap < required_gap:
        raise LeakageError(
            f"train ends {tr.max()} and validation opens {va.min()}: gap {gap} < required {required_gap}"
        )


def assert_no_duplicate_keys(frame: pd.DataFrame, keys: list[str]) -> None:
    dupes = int(frame.duplicated(subset=keys).sum())
    if dupes:
        raise LeakageError(f"{dupes} duplicate rows on {keys} — the same observation counted twice")


def assert_probabilities(p: np.ndarray, *, tol: float = 1e-9) -> None:
    arr = np.asarray(p, dtype=float)
    if not np.all(np.isfinite(arr)):
        raise LeakageError("probabilities contain NaN or inf")
    if arr.min() < -tol or arr.max() > 1 + tol:
        raise LeakageError(f"probabilities outside [0,1]: min={arr.min()} max={arr.max()}")
