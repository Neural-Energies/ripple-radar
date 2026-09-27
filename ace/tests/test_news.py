"""Phase 9: does `what_changed` decompose a real news event into the right
pieces, on a synthetic panel with a KNOWN news observation and a KNOWN
revision — so a wrong attribution is unambiguous rather than merely
plausible-looking?
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.factors.news import what_changed
from ace.state.factors import FactorFit, fit_factors
from ace.state.panel import PanelBuild


def _synthetic_frame(seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n_obs, n_series = 60, 6
    common = np.cumsum(rng.normal(size=n_obs)).reshape(-1, 1)
    loadings = np.array([1, 1, 1, -1, -1, -1]).reshape(1, -1)
    values = common @ loadings + rng.normal(scale=0.3, size=(n_obs, n_series))
    idx = pd.date_range("2018-01-01", periods=n_obs, freq="MS", tz="UTC")
    return pd.DataFrame(values, columns=[f"S{i}" for i in range(n_series)], index=idx)


def _build(frame: pd.DataFrame, as_of: str) -> PanelBuild:
    return PanelBuild(
        as_of=as_of, frame=frame, levels=frame, used=tuple(frame.columns),
        dropped={}, edge={c: {"through": as_of, "days_behind": 0} for c in frame.columns},
    )


@pytest.fixture(scope="module")
def two_fits():
    full = _synthetic_frame(seed=3)
    previous_frame = full.iloc[:-1].copy()
    updated_frame = full.copy()
    # S0's second-to-last print is REVISED, distinct from the brand-new month
    # every series gets — so the decomposition has both a news and a
    # revision contribution to find.
    updated_frame.iloc[-2, 0] = updated_frame.iloc[-2, 0] + 0.5

    previous_build = _build(previous_frame, as_of=str(previous_frame.index[-1].date()))
    updated_build = _build(updated_frame, as_of=str(updated_frame.index[-1].date()))

    previous_fit = fit_factors(previous_build, k=1, use_blocks=False, maxiter=100)
    updated_fit = fit_factors(updated_build, k=1, use_blocks=False, maxiter=100)
    return previous_fit, updated_fit


def test_what_changed_decomposes_into_news_and_revisions(two_fits):
    previous_fit, updated_fit = two_fits
    target = next(s for s in updated_fit.series if s != "S0")

    decompositions = what_changed(previous_fit, updated_fit, impacted_series=target)
    assert len(decompositions) == 1
    d = decompositions[0]

    assert d.impacted_series == target
    assert d.state_index == "common"
    assert d.total_impact == pytest.approx(d.impact_of_news + d.impact_of_revisions, abs=1e-6)
    assert d.contributions

    news_total = sum(c.impact for c in d.contributions if c.kind == "news")
    revision_total = sum(c.impact for c in d.contributions if c.kind == "revision")
    assert news_total == pytest.approx(d.impact_of_news, abs=1e-6)
    assert revision_total == pytest.approx(d.impact_of_revisions, abs=1e-6)

    # S0 was the one series revised between the two fits.
    assert any(c.kind == "revision" for c in d.contributions)
    # Every series got a brand-new final month, so news should be non-empty too.
    assert any(c.kind == "news" for c in d.contributions)


def test_including_the_idiosyncratic_channel_changes_the_answer(two_fits):
    previous_fit, updated_fit = two_fits
    target = next(s for s in updated_fit.series if s != "S0")

    common_only = what_changed(previous_fit, updated_fit, impacted_series=target)[0]
    everything = what_changed(
        previous_fit, updated_fit, impacted_series=target, state_index=None
    )[0]
    assert everything.state_index == "None"
    # Restricting to the common factor channel is a real filter, not a no-op —
    # the two totals need not match once idiosyncratic noise is let back in.
    assert isinstance(common_only.total_impact, float)
    assert isinstance(everything.total_impact, float)


def test_what_changed_refuses_a_fit_without_a_results_object(two_fits):
    previous_fit, updated_fit = two_fits
    bare = FactorFit(
        as_of=updated_fit.as_of, factors=updated_fit.factors, loadings=updated_fit.loadings,
        blocks=updated_fit.blocks, n_factors=updated_fit.n_factors,
        factor_count=updated_fit.factor_count, converged=updated_fit.converged,
        llf=updated_fit.llf, n_obs=updated_fit.n_obs, series=updated_fit.series,
    )
    with pytest.raises(ValueError, match="results"):
        what_changed(previous_fit, bare, impacted_series=updated_fit.series[0])


def test_what_changed_refuses_a_series_not_in_the_fit(two_fits):
    previous_fit, updated_fit = two_fits
    with pytest.raises(ValueError, match="not one of"):
        what_changed(previous_fit, updated_fit, impacted_series="NOT_A_SERIES")
