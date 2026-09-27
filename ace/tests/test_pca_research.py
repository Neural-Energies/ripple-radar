"""The pure-logic pieces of the PCA research orchestration — the parts that
decide WHICH data goes into a fit, tested without needing network access.
Whether the fits themselves are correct is `ace.tests.test_pca`'s job; this
file is about the selection logic around them.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.factors.pca_research import _deep_history_columns


def test_deep_history_selects_only_columns_starting_on_or_before_the_cutoff():
    import numpy as np
    idx = pd.date_range("1990-01-01", periods=400, freq="MS", tz="UTC")
    recent = np.full(400, np.nan)
    recent[350:] = 1.0                                     # starts late
    frame = pd.DataFrame({"OLD": np.ones(400), "RECENT": recent}, index=idx)

    cutoff = pd.Timestamp("2000-01-01", tz="UTC")
    cols = _deep_history_columns(frame, cutoff)
    assert cols == ["OLD"]


def test_deep_history_excludes_an_all_nan_column_rather_than_crashing():
    idx = pd.date_range("1990-01-01", periods=50, freq="MS", tz="UTC")
    frame = pd.DataFrame({"EMPTY": [float("nan")] * 50, "FULL": [1.0] * 50}, index=idx)
    cols = _deep_history_columns(frame, pd.Timestamp("1995-01-01", tz="UTC"))
    assert cols == ["FULL"]


def test_deep_history_boundary_is_inclusive():
    idx = pd.date_range("2000-01-01", periods=12, freq="MS", tz="UTC")
    frame = pd.DataFrame({"EXACT": [1.0] * 12}, index=idx)
    cutoff = idx[0]  # exactly the first observation date
    assert _deep_history_columns(frame, cutoff) == ["EXACT"]
