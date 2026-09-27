"""Phase 9 of the factor-engine brief: "what changed" — state-space news
decomposition, via `DynamicFactorMQ`'s `.news()` (Bańbura & Modugno 2014;
Bańbura, Giannone & Reichlin 2011; Bańbura, Giannone, Modugno & Reichlin
2013). `ace.state.factors`'s own docstring names this as the reason the
production panel uses `DynamicFactorMQ` at all: "the model that produces the
state is the same one that explains why the state moved." This module is
where that explanation actually gets built.

WHAT `.news()` ACTUALLY EXPLAINS, AND WHY THIS MODULE DOES NOT CLAIM MORE

Read directly off the installed statsmodels (0.15.0) source rather than
assumed: `DynamicFactorMQResults.news`'s `impacted_variable` argument must be
one of the model's own endog series — there is no argument that names a
latent factor directly. So "what moved the factor" is answered here as "what
moved THIS SERIES' nowcast, filtered to the channel that runs through the
common factor states" — `state_index="common"` (the default below) is a real
statsmodels argument that excludes each series' own idiosyncratic AR(1) term
from the decomposition, which is the closest honest thing this API offers to
a factor-level attribution. That is a narrower claim than "the factor's own
smoothed value moved by exactly this", and the difference is documented here
rather than blurred by a function name that overpromises.

A caller who wants "what moved the growth factor" should pass a series that
loads heavily on it — `ace.factors.factor_state`'s `top_positive_loadings` /
`top_negative_loadings` on the corresponding factor are exactly the list to
pick from.

TWO FITS, SAME SPECIFICATION, DIFFERENT DATA

`.news()` compares two `MLEResults` from the SAME model specification fit on
two vintages of data — `ace.state.factors.fit_factors` called twice, once on
last period's `PanelBuild` and once on this period's, with the same `k` and
`use_blocks` so the comparison is apples to apples. Both `FactorFit`s must
retain `.results`, which `fit_factors` populates for exactly this reason; a
fit that does not have it (for instance, one hand-built for a test) is
refused here rather than silently producing nothing.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from ace.state.factors import FactorFit


@dataclass(frozen=True)
class NewsContribution:
    """One update's effect on the impacted series' forecast.

    `kind` is `"news"` for a newly published observation that did not exist
    in the previous fit, or `"revision"` for one whose VALUE changed between
    the two fits. `observed_value` / `previous_forecast` are None for a
    grouped revision entry (statsmodels' default groups every revision before
    `revisions_details_start` into one "all prior revisions" line rather than
    detailing each one — see `ace.state.factors.fit_factors`'s callers if
    per-revision detail is ever needed, which costs more compute per call).
    """

    kind: str
    series_id: str
    observation_date: str
    observed_value: float | None
    previous_forecast: float | None
    weight: float
    impact: float

    def to_dict(self) -> dict:
        return {
            "kind": self.kind, "series_id": self.series_id,
            "observation_date": self.observation_date,
            "observed_value": self.observed_value, "previous_forecast": self.previous_forecast,
            "weight": self.weight, "impact": self.impact,
        }


@dataclass(frozen=True)
class NewsDecomposition:
    """What changed in one series' nowcast between two point-in-time fits, and why."""

    impacted_series: str
    impact_date: str
    #: `"common"`, or `"all"` when the idiosyncratic channel was included —
    #: see the module docstring for what this restricts.
    state_index: str
    estimate_previous: float
    estimate_updated: float
    impact_of_news: float
    impact_of_revisions: float
    total_impact: float
    #: Every contributing update, sorted by |impact| descending — the
    #: "attribute the change to specific observations" the brief asks for.
    contributions: tuple[NewsContribution, ...]

    def to_dict(self) -> dict:
        return {
            "impacted_series": self.impacted_series,
            "impact_date": self.impact_date,
            "state_index": self.state_index,
            "estimate_previous": self.estimate_previous,
            "estimate_updated": self.estimate_updated,
            "impact_of_news": self.impact_of_news,
            "impact_of_revisions": self.impact_of_revisions,
            "total_impact": self.total_impact,
            "contributions": [c.to_dict() for c in self.contributions],
        }


def _to_date_str(value) -> str:
    """A date-like index value, as a plain ISO date string.

    `fit_factors` re-stamps the panel on a `PeriodIndex` before fitting (see
    `ace.state.factors._as_periods`), so `.news()`'s own index values come
    back as `pandas.Period`, not `Timestamp` — and `pd.Timestamp(a_period)`
    raises rather than converting, because a period is a span, not an
    instant. `Period.to_timestamp()` is unambiguous (it is documented to
    return the period's start), so that path is tried first; anything else
    that is not already date-like (statsmodels' grouped-revision label "all
    prior revisions", for one) falls back to its own string form.
    """
    if isinstance(value, pd.Period):
        return str(value.to_timestamp(how="start").date())
    try:
        return str(pd.Timestamp(value).date())
    except (TypeError, ValueError):
        return str(value)


def _xs_or_empty(frame: pd.DataFrame, key: tuple) -> pd.DataFrame:
    """`frame.xs(key, level=[0, 1])`, or empty if `key` is not in the index.

    `details_by_impact` / `revision_details_by_impact` can legitimately be
    empty (no revisions at all, in particular), and `.xs` raises `KeyError`
    on a key that is not present rather than returning nothing — this is the
    "not present" case rendered as an empty frame instead of a crash.
    """
    if frame.empty:
        return frame
    try:
        return frame.xs(key, level=[0, 1])
    except KeyError:
        return frame.iloc[0:0]


def _news_contributions(details: pd.DataFrame) -> list[NewsContribution]:
    out = []
    for idx, row in details.iterrows():
        update_date, updated_variable = idx[-2], idx[-1]
        out.append(NewsContribution(
            kind="news",
            series_id=str(updated_variable),
            observation_date=_to_date_str(update_date),
            observed_value=(
                float(row["observed"]) if pd.notna(row.get("observed")) else None
            ),
            previous_forecast=(
                float(row["forecast (prev)"]) if pd.notna(row.get("forecast (prev)")) else None
            ),
            weight=float(row["weight"]) if pd.notna(row.get("weight")) else float("nan"),
            impact=float(row["impact"]),
        ))
    return out


def _revision_contributions(details: pd.DataFrame) -> list[NewsContribution]:
    out = []
    for idx, row in details.iterrows():
        revision_date, revised_variable = idx[-2], idx[-1]
        out.append(NewsContribution(
            kind="revision",
            series_id=str(revised_variable),
            observation_date=_to_date_str(revision_date),
            observed_value=(
                float(row["revised"]) if pd.notna(row.get("revised")) else None
            ),
            previous_forecast=(
                float(row["observed (prev)"]) if pd.notna(row.get("observed (prev)")) else None
            ),
            weight=float(row["weight"]) if pd.notna(row.get("weight")) else float("nan"),
            impact=float(row["impact"]),
        ))
    return out


def what_changed(
    previous: FactorFit,
    updated: FactorFit,
    *,
    impacted_series: str,
    impact_date: str | pd.Timestamp | None = None,
    state_index: str | None = "common",
) -> tuple[NewsDecomposition, ...]:
    """Decompose the change in `impacted_series`'s nowcast between two fits.

    `impact_date=None` (the default) asks statsmodels for its own default —
    the first out-of-sample period relative to `previous`, i.e. the newest
    month `updated` has that `previous` did not. Pass an explicit date to ask
    about a specific month instead.

    Returns one `NewsDecomposition` per (impact date, impacted variable) pair
    `.news()` reports — normally exactly one, since `impacted_series` and
    `impact_date` each name a single value, but written as a tuple rather
    than assumed singular so a future caller passing a list or a date range
    is not silently truncated to the first result.
    """
    if previous.results is None or updated.results is None:
        raise ValueError(
            "both fits must come from ace.state.factors.fit_factors(), which "
            "retains the statsmodels results object .news() needs — a FactorFit "
            "built without going through fit_factors() has no .results to call it on"
        )
    if impacted_series not in updated.series:
        raise ValueError(
            f"{impacted_series!r} is not one of this fit's series: {updated.series}"
        )

    news = updated.results.news(
        previous.results, impacted_variable=impacted_series,
        impact_date=impact_date, state_index=state_index,
    )
    if news.impacts.empty:
        return ()

    out: list[NewsDecomposition] = []
    for key, imp in news.impacts.iterrows():
        date_value, variable = key
        news_details = _xs_or_empty(news.details_by_impact, key)
        revision_details = _xs_or_empty(news.revision_details_by_impact, key)

        contributions = _news_contributions(news_details) + _revision_contributions(revision_details)
        contributions.sort(key=lambda c: abs(c.impact), reverse=True)

        out.append(NewsDecomposition(
            impacted_series=str(variable),
            impact_date=_to_date_str(date_value),
            state_index=str(state_index),
            estimate_previous=float(imp["estimate (prev)"]),
            estimate_updated=float(imp["estimate (new)"]),
            impact_of_news=float(imp["impact of news"]),
            impact_of_revisions=float(imp["impact of revisions"]),
            total_impact=float(imp["total impact"]),
            contributions=tuple(contributions),
        ))
    return tuple(out)
