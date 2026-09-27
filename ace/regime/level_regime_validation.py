"""WP3's exit condition, and Phase 10 of the factor-engine brief, built as one
piece of machinery rather than two competing ones (they ask the same
question of two different factor sources).

WP3 exit condition: does `ace.regime.mean_vs_variance`'s level-regime read on
a PRODUCTION-panel factor (housing, financial conditions — the two blocks it
found a real level regime in) actually forecast anything, scored against
climatology on purged, point-in-time folds?

Phase 10: does substituting a Phase 6/7 comprehensive-panel DOMAIN PCA factor
for that same block change the answer — does the broader universe's version
of "housing" or "financial conditions" read the regime better, worse, or the
same?

WHY THIS IS AN EXPANDING-WINDOW REFIT AT EACH ANCHOR, NOT A REUSE OF ONE FIT

A single full-history fit's "filtered" state at some past date t is filtered
using PARAMETERS estimated from the WHOLE sample, including everything after
t — real information leakage, just one level removed from using the smoothed
state directly (`ace.regime.markov`'s own docstring calls this exact trap out
for state-level leakage; parameter-level leakage is the same mistake one
layer down). The only way to get a genuinely as-of-`anchor` regime read is to
refit BOTH the factor extraction and the regime model using only data through
`anchor` — the same discipline `ace.factors.pca_research.run_stability`
already applies to PCA. This module applies it to whichever factor source it
is handed, DFM or PCA alike.

WHAT COUNTS AS THE OUTCOME

The forward outcome (did the factor rise over the next `HORIZON_MONTHS`) is
read from ONE reference build made with ALL of today's data — using our BEST
available reconstruction of what actually happened, which is the correct
role for a label. The FEATURE (the anchor's regime probability) never sees
that reference build; only `run_validation`'s outcome lookup does. Climatology
at each anchor is computed from THAT SAME anchor's own causal history, never
from the evaluation sample itself, or the comparison Module 10 exists to make
would be scored against a benchmark that had already seen the answer.

Run: `python -m ace.regime.level_regime_validation`
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd

from ace.factors.pca import domain_panels, fit as fit_pca
from ace.regime.climatology import AnchorReading, skill_report
from ace.regime.macro_regime import MIN_OBS
from ace.regime.markov import filtered_probabilities, regime_params
from ace.regime.mean_vs_variance import _fit as _fit_switching_model
from ace.state.factors import fit_factors
from ace.state.panel import PANEL, build_asof

#: How far forward the outcome looks. A couple of quarters — long enough that
#: a regime read has time to matter, short enough that most anchors have a
#: fully-realized outcome well before "now".
HORIZON_MONTHS = 6

FactorSource = Callable[[pd.Timestamp], pd.Series]


def production_dfm_factor_source(
    block: str, vintages: dict, specs=PANEL, *, maxiter: int = 80
) -> FactorSource:
    """The production DFM's own block factor, refit as of each anchor.

    Column names carry a `.N` suffix when a block has multiplicity > 1 (see
    `ace.state.factors.fit_factors`); this matches on the prefix before the
    first `.`, same convention `ace.state.state.build_state` uses to key a
    `BlockState` off a factor column.

    `maxiter` is deliberately lower than `fit_factors`'s own default (200):
    each anchor here only needs a serviceable regime read, not the last digit
    of likelihood precision, and this function is called once per anchor per
    block — the full 200 would make a several-anchor validation run for
    hours rather than minutes on this panel's ~500s-per-fit scale.
    """
    def _source(as_of: pd.Timestamp) -> pd.Series:
        build = build_asof(as_of, vintages, specs=specs)
        if build.frame.empty:
            return pd.Series(dtype=float)
        fit = fit_factors(build, maxiter=maxiter)
        col = next((c for c in fit.factors.columns if str(c).split(".")[0] == block), None)
        return fit.factors[col].dropna() if col else pd.Series(dtype=float)
    return _source


def domain_pca_factor_source(label: str, vintages: dict, specs) -> FactorSource:
    """A Phase 6/7 domain's PC1, refit as of each anchor."""
    def _source(as_of: pd.Timestamp) -> pd.Series:
        build = build_asof(as_of, vintages, specs=specs)
        panels = domain_panels(build.frame, build.groups)
        frame = panels.get(label)
        if frame is None:
            return pd.Series(dtype=float)
        try:
            fit = fit_pca(frame, as_of=build.as_of, label=label, k=1)
        except ValueError:
            return pd.Series(dtype=float)
        return fit.scores["PC1"]
    return _source


def _high_mean_probability(series: pd.Series, *, seed: int = 17) -> float | None:
    """P(the high-mean state), from FILTERED probabilities only.

    Reuses `ace.regime.mean_vs_variance`'s own switching-mean-and-variance
    specification (`_fit`) rather than a second copy of the model, and
    `ace.regime.markov.regime_params` / `filtered_probabilities` to read it —
    both already battle-tested by `ace.tests.test_macro_regime`'s ground-truth
    pin against reading the wrong parameter block by position.
    """
    y = series.dropna()
    if len(y) < MIN_OBS:
        return None
    try:
        res = _fit_switching_model(y, switching_trend=True, seed=seed)
        means, _ = regime_params(res, 2)
    except Exception:  # noqa: BLE001 — an unfittable anchor is a skipped anchor
        return None
    high_idx = int(np.argmax(means))
    probs = filtered_probabilities(res)
    last = np.asarray(probs[-1] if probs.ndim == 2 else probs[:, -1]).ravel()
    if high_idx >= len(last):
        return None
    return float(last[high_idx])


def forward_direction_outcomes(series: pd.Series, horizon_periods: int) -> pd.Series:
    """1.0 if the series is higher `horizon_periods` steps ahead, else 0.0.

    NaN (and so dropped) wherever the future value does not exist yet — this
    IS the purge: an anchor within `horizon_periods` of a series' own last
    observation has no label to score against and is excluded rather than
    filled in.
    """
    future = series.shift(-horizon_periods)
    return (future > series).astype(float).where(future.notna())


def _climatology_rate_at(series: pd.Series, horizon_periods: int) -> float | None:
    """The share of ALREADY-REALIZED transitions that were "up", using only
    data at or before the anchor `series` was built through — see the module
    docstring for why this must not be computed from the evaluation sample.
    """
    outcomes = forward_direction_outcomes(series, horizon_periods).dropna()
    if outcomes.empty:
        return None
    return float(outcomes.mean())


def run_validation(
    source: FactorSource,
    reference: pd.Series,
    anchors: pd.DatetimeIndex,
    *,
    horizon_periods: int = HORIZON_MONTHS,
) -> dict:
    """One `AnchorReading` per anchor with enough data, scored against climatology."""
    readings: list[AnchorReading] = []
    skipped: dict[str, str] = {}
    for anchor in anchors:
        history = source(anchor)
        if history.empty or len(history.dropna()) < MIN_OBS:
            skipped[str(anchor.date())] = f"only {len(history.dropna())} observations"
            continue

        model_p = _high_mean_probability(history)
        if model_p is None:
            skipped[str(anchor.date())] = "switching-model fit failed or too short"
            continue
        clim_p = _climatology_rate_at(history, horizon_periods)
        if clim_p is None:
            skipped[str(anchor.date())] = "no realized transitions yet for climatology"
            continue

        target_date = pd.Timestamp(history.index.max()) + pd.DateOffset(months=horizon_periods)
        ref = reference.dropna()
        future_idx = ref.index[ref.index >= target_date]
        anchor_value = ref.asof(history.index.max())
        if future_idx.empty or anchor_value is None or not np.isfinite(anchor_value):
            skipped[str(anchor.date())] = "reference series has no realized future value yet"
            continue
        future_value = float(ref.loc[future_idx[0]])
        outcome = 1.0 if future_value > float(anchor_value) else 0.0

        readings.append(AnchorReading(
            as_of=str(anchor.date()), model_probability=model_p,
            climatology_probability=clim_p, outcome=outcome,
        ))

    report = skill_report(readings)
    report["skipped"] = skipped
    report["horizon_months"] = horizon_periods
    return report


def main() -> None:
    import json

    from ace.config import ROOT
    from ace.factors.universe_panel import default_panel
    from ace.jsonutil import to_json_safe
    from ace.state.panel import load_vintages

    now = pd.Timestamp.now(tz="UTC")
    # Three anchors, ~6 years apart: enough to see whether the relationship is
    # even directionally consistent without multiplying an ~80-iteration DFM
    # refit (still several minutes each on this panel) past what this
    # session's compute budget can absorb across two blocks. Honestly a low-
    # power design — `ace.regime.climatology.skill_report`'s bootstrap CI on
    # this few anchors will usually be wide, and that width is itself part of
    # the honest answer, not a reason to inflate the anchor count silently.
    anchors = pd.date_range("2010-01-01", "2022-01-01", freq="72MS", tz="UTC")

    production_vintages = load_vintages(PANEL)
    comprehensive_specs, _ = default_panel()
    comprehensive_vintages = load_vintages(comprehensive_specs)

    results: dict[str, dict] = {}
    for block, domain_label in (("housing", "housing"), ("financial", "financial_conditions")):
        print(f"\n=== {block} (production DFM) vs {domain_label} (domain PCA) ===")

        dfm_source = production_dfm_factor_source(block, production_vintages)
        reference = dfm_source(now)
        if reference.empty:
            print(f"  production block {block!r} not found in this fit — skipping")
            continue
        dfm_report = run_validation(dfm_source, reference, anchors)
        print(f"  DFM:  {dfm_report['verdict']}  "
              f"(skill={dfm_report['skill']}, n={dfm_report['n_anchors']})")

        pca_source = domain_pca_factor_source(domain_label, comprehensive_vintages, comprehensive_specs)
        pca_reference = pca_source(now)
        if pca_reference.empty:
            print(f"  domain {domain_label!r} not found in the comprehensive panel — skipping")
            results[block] = {"dfm": dfm_report}
            continue
        pca_report = run_validation(pca_source, pca_reference, anchors)
        print(f"  PCA:  {pca_report['verdict']}  "
              f"(skill={pca_report['skill']}, n={pca_report['n_anchors']})")

        results[block] = {"dfm": dfm_report, "domain_pca": pca_report}

    out = {
        "generated": str(now.date()),
        "question": (
            "Does a level-regime probability forecast the factor's own forward "
            "direction better than climatology — and does a Phase 6/7 domain PCA "
            "factor do this better, worse, or the same as the production DFM's?"
        ),
        "anchors": [str(a.date()) for a in anchors],
        "horizon_months": HORIZON_MONTHS,
        "results": results,
    }
    path = ROOT / "artifacts" / "reports" / "macro_level_regime_validation.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_json_safe(out), indent=2, sort_keys=True, default=str, allow_nan=False))
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
