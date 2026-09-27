"""Phase 9 driver logic that doesn't need a live fit: picking which series
proxies each block for `what_changed`.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.factors.news_report import top_loading_per_block
from ace.state.factors import FactorCount, FactorFit


def _fit(loadings: pd.DataFrame, blocks: dict[str, str]) -> FactorFit:
    fc = FactorCount(k=1, criterion="ICp2", kmax=6, n=len(blocks), t=50, ic={1: -1.0})
    return FactorFit(
        as_of="2020-01-01", factors=pd.DataFrame(), loadings=loadings, blocks=blocks,
        n_factors=loadings.shape[1], factor_count=fc, converged=True, llf=0.0,
        n_obs=50, series=tuple(blocks),
    )


def test_picks_the_largest_absolute_loading_per_block():
    loadings = pd.DataFrame(
        {
            "growth.1": [0.9, 0.2, 0.0, 0.0],
            "labor.1": [0.0, 0.0, -0.8, 0.3],
            "global.1": [0.5, 0.5, 0.5, 0.5],
        },
        index=["G0", "G1", "L0", "L1"],
    )
    blocks = {"G0": "growth", "G1": "growth", "L0": "labor", "L1": "labor"}
    fit = _fit(loadings, blocks)

    proxies = top_loading_per_block(fit)
    assert proxies == {"growth": "G0", "labor": "L0"}
    assert "global" not in proxies


def test_a_block_with_no_finite_loadings_is_skipped():
    loadings = pd.DataFrame({"growth.1": [float("nan"), float("nan")]}, index=["G0", "G1"])
    blocks = {"G0": "growth", "G1": "growth"}
    fit = _fit(loadings, blocks)
    assert top_loading_per_block(fit) == {}
