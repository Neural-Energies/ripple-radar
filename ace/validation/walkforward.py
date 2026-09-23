"""Chronological validation with purging and embargo (§30).

Random K-fold is wrong here for two reasons, and both of them inflate results:

1. Shuffling lets the model train on the future and predict the past.
2. Even a chronological split leaks when labels span multiple days. A label
   stamped at time t is only known at t + horizon, so a training row near the
   boundary overlaps the validation window it is supposed to be blind to.

Purging drops training rows whose label window reaches into validation.
The embargo drops a further gap after the validation window, because serial
correlation means the observations immediately following still carry
information about it.

Splits are expanding-window: every fold trains on everything before it, which
is how the model would actually have been refit in production.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Fold:
    index: int
    train_idx: np.ndarray
    valid_idx: np.ndarray
    train_end: pd.Timestamp
    valid_start: pd.Timestamp
    valid_end: pd.Timestamp
    n_purged: int

    def describe(self) -> str:
        return (
            f"fold {self.index}: train n={len(self.train_idx):>6} through {self.train_end.date()} "
            f"| valid n={len(self.valid_idx):>5} {self.valid_start.date()}..{self.valid_end.date()} "
            f"| purged {self.n_purged}"
        )


def walk_forward_folds(
    timestamps: pd.Series,
    *,
    n_folds: int = 5,
    label_horizon_days: int,
    embargo_days: int = 2,
    min_train: int = 500,
) -> list[Fold]:
    """Expanding-window folds over rows ordered by `timestamps`.

    `label_horizon_days` must be the true span of the label, in calendar days —
    passing a smaller number silently reintroduces the leak this exists to stop.
    """
    if label_horizon_days < 0:
        raise ValueError("label_horizon_days must be >= 0")
    ts = pd.to_datetime(pd.Series(timestamps).reset_index(drop=True), utc=True)
    order = np.argsort(ts.values, kind="mergesort")
    ts_sorted = ts.iloc[order].reset_index(drop=True)
    n = len(ts_sorted)
    if n < min_train + n_folds:
        raise ValueError(f"not enough rows ({n}) for {n_folds} folds with min_train={min_train}")

    # Equal-sized validation blocks over the tail that remains after min_train.
    first_valid = max(min_train, n // (n_folds + 1))
    edges = np.linspace(first_valid, n, n_folds + 1).astype(int)
    blackout = pd.Timedelta(days=label_horizon_days + embargo_days)

    folds: list[Fold] = []
    for i in range(n_folds):
        v0, v1 = int(edges[i]), int(edges[i + 1])
        if v1 - v0 < 1:
            continue
        valid_pos = np.arange(v0, v1)
        valid_start = ts_sorted.iloc[v0]
        valid_end = ts_sorted.iloc[v1 - 1]

        # Purge: a training row is only usable if its whole label window closes
        # before validation opens.
        cand = np.arange(0, v0)
        cutoff = valid_start - blackout
        keep = cand[ts_sorted.iloc[cand].values <= cutoff.to_datetime64()]
        n_purged = len(cand) - len(keep)
        if len(keep) < min_train:
            continue
        folds.append(
            Fold(
                index=i,
                train_idx=order[keep],
                valid_idx=order[valid_pos],
                train_end=ts_sorted.iloc[keep[-1]],
                valid_start=valid_start,
                valid_end=valid_end,
                n_purged=n_purged,
            )
        )
    if not folds:
        raise ValueError("no usable folds after purging — widen the sample or shorten the horizon")
    return folds


def sealed_split(
    timestamps: pd.Series, *, holdout_frac: float = 0.2, label_horizon_days: int, embargo_days: int = 2
) -> tuple[np.ndarray, np.ndarray, pd.Timestamp]:
    """Split off a final, chronologically last holdout (§31).

    The gap between development and holdout is purged the same way, so the last
    development labels cannot reach into the holdout period.
    """
    ts = pd.to_datetime(pd.Series(timestamps).reset_index(drop=True), utc=True)
    order = np.argsort(ts.values, kind="mergesort")
    ts_sorted = ts.iloc[order].reset_index(drop=True)
    n = len(ts_sorted)
    cut = int(n * (1 - holdout_frac))
    boundary = ts_sorted.iloc[cut]
    cutoff = boundary - pd.Timedelta(days=label_horizon_days + embargo_days)
    dev_pos = np.arange(0, cut)
    dev_pos = dev_pos[ts_sorted.iloc[dev_pos].values <= cutoff.to_datetime64()]
    hold_pos = np.arange(cut, n)
    return order[dev_pos], order[hold_pos], boundary
