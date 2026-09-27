"""Phase 6/7 of the factor-engine brief: run static PCA on the comprehensive
panel, test whether its loadings are stable across time, and compare it
against `DynamicFactorMQ` — the challenger and the incumbent, on the same data.

WHAT RUNS HERE

  1. GLOBAL PCA on the current comprehensive panel (up to 208 series): factor
     count, loadings, variance explained.
  2. DOMAIN PCA within each economic block big enough to support one (>= 4
     series) — the hierarchical alternative to one PCA explaining the whole
     economy, per the brief's `<data_layers>` section.
  3. STABILITY testing via `ace.factors.stability`, on a DEEP-HISTORY subset
     of the panel. Static PCA needs a BALANCED matrix (see `ace.factors.pca`'s
     docstring), so a stability test on all 208 series would be crushed to
     whatever window the newest series can support — a handful of years, not
     the "expanding across the sample" test the brief asks for. The deep
     subset is every series whose transformed history reaches back to 2000,
     chosen from what the live panel actually showed (77 of 167 monthly
     series), not assumed in advance.
  4. PCA vs DFM: the DEEP-HISTORY subset from step 3 is fit once with
     `fit_factors` (the production DynamicFactorMQ path) and once with static
     PCA, and the resulting global factors are compared with
     `ace.factors.stability`'s sign-aligned correlation — the empirical
     comparison the brief asks for, not an assumption that either wins. NOT
     the full comprehensive panel: see `run_pca_vs_dfm`'s docstring for the
     measured reason (a first attempt on all 206 series plus 41 quarterly
     members grew past 12GB of resident memory before being killed).

Every fit here is built from a `PanelBuild` that `ace.state.panel.build_asof`
produced — nothing in this module re-derives point-in-time filtering.

Run: `python -m ace.factors.pca_research`
"""
from __future__ import annotations

import json
import warnings

import numpy as np
import pandas as pd

from ace.config import ROOT
from ace.factors.pca import PCAFit, domain_panels, fit as fit_pca
from ace.factors.stability import WindowResult, compare_loadings, stability_report
from ace.factors.universe_panel import default_panel
from ace.state.factors import fit_factors
from ace.state.panel import build_asof, load_vintages

#: How far back a series must reach, in its TRANSFORMED form, to join the
#: stability-testing subset. Chosen from what the panel actually showed (see
#: module docstring) rather than picked in advance.
DEEP_HISTORY_CUTOFF = pd.Timestamp("2000-01-01", tz="UTC")

#: Anchor dates for the expanding-window test: PCA refit on everything
#: published by each date in turn, using the deep-history subset only.
EXPANDING_ANCHORS = pd.date_range("2005-01-01", "2025-01-01", freq="24MS", tz="UTC")

#: Window length and step for the rolling test, in months.
ROLLING_WINDOW_MONTHS = 180  # 15 years
ROLLING_STEP_MONTHS = 24


def run_global_and_domain(build) -> dict:
    """Steps 1-2: the current-snapshot global and domain fits."""
    global_fit = fit_pca(build.frame, as_of=build.as_of, label="global")
    print(f"\nGLOBAL: {global_fit.describe()}")
    for c in global_fit.components:
        pos = ", ".join(f"{s}({v:+.2f})" for s, v in c.top_positive[:5])
        neg = ", ".join(f"{s}({v:+.2f})" for s, v in c.top_negative[:5])
        print(f"  PC{c.index} ({c.explained_variance_ratio:.1%} var): "
              f"+[{pos}]  -[{neg}]")

    domains = domain_panels(build.frame, build.groups)
    domain_fits: dict[str, PCAFit] = {}
    print(f"\nDOMAIN PCA ({len(domains)} blocks with >= 4 series):")
    for name, frame in sorted(domains.items()):
        try:
            domain_fit = fit_pca(frame, as_of=build.as_of, label=name)
        except ValueError as exc:
            print(f"  {name:<24} SKIPPED: {exc}")
            continue
        domain_fits[name] = domain_fit
        c1 = domain_fit.components[0]
        pos = ", ".join(f"{s}({v:+.2f})" for s, v in c1.top_positive[:4])
        neg = ", ".join(f"{s}({v:+.2f})" for s, v in c1.top_negative[:4])
        print(f"  {name:<24} k={domain_fit.factor_count.k} "
              f"PC1={c1.explained_variance_ratio:.1%}  +[{pos}]  -[{neg}]")

    return {
        "global": global_fit.to_dict(),
        "domains": {k: v.to_dict() for k, v in domain_fits.items()},
    }, global_fit, domain_fits


def _deep_history_columns(frame: pd.DataFrame, cutoff: pd.Timestamp) -> list[str]:
    first_obs = frame.apply(lambda s: s.first_valid_index())
    return [c for c in frame.columns if first_obs[c] is not None and first_obs[c] <= cutoff]


def run_stability(vintages: dict, specs, current_frame: pd.DataFrame) -> tuple[dict, tuple]:
    """Step 3: expanding and rolling window PCA on the deep-history subset.

    Returns the report AND the deep-history specs, because Step 4 reuses this
    exact subset for the PCA-vs-DFM comparison — see that function's docstring
    for why the full comprehensive panel is not what DFM is fit on.
    """
    deep_cols = _deep_history_columns(current_frame, DEEP_HISTORY_CUTOFF)
    deep_specs = tuple(s for s in specs if s.series_id in deep_cols)
    print(f"\nDEEP-HISTORY SUBSET: {len(deep_specs)} of {len(specs)} series "
          f"reach back to {DEEP_HISTORY_CUTOFF.date()} or earlier")

    expanding_results: list[WindowResult] = []
    for anchor in EXPANDING_ANCHORS:
        build = build_asof(anchor, vintages, specs=deep_specs)
        if build.frame.empty or build.n_monthly < 5:
            continue
        try:
            f = fit_pca(build.frame, as_of=str(anchor.date()), label="deep_expanding", k=1)
        except ValueError:
            continue
        expanding_results.append(WindowResult(
            as_of=f.as_of, n_obs=f.n_obs, n_series=f.n_series, k=f.factor_count.k,
            pc1_loadings=f.components[0].loadings,
            explained_variance_ratio=f.components[0].explained_variance_ratio,
        ))
    expanding_report = stability_report(expanding_results)
    print(f"\nEXPANDING WINDOW ({len(expanding_results)} anchors, "
          f"{DEEP_HISTORY_CUTOFF.date()}-forward growing sample):")
    print(f"  mean PC1 loading correlation across steps: "
          f"{expanding_report['mean_loading_correlation']}")
    print(f"  min: {expanding_report['min_loading_correlation']}  "
          f"share stable: {expanding_report['share_stable_transitions']}  "
          f"k ever changed: {expanding_report['k_ever_changed']}")

    rolling_results: list[WindowResult] = []
    all_dates = current_frame.index
    step_dates = all_dates[ROLLING_WINDOW_MONTHS::ROLLING_STEP_MONTHS]
    for anchor in step_dates:
        build = build_asof(anchor, vintages, specs=deep_specs)
        window_start = anchor - pd.DateOffset(months=ROLLING_WINDOW_MONTHS)
        windowed_frame = build.frame[(build.frame.index >= window_start)]
        if windowed_frame.shape[0] < 60 or windowed_frame.shape[1] < 5:
            continue
        try:
            f = fit_pca(windowed_frame, as_of=str(anchor.date()), label="deep_rolling", k=1)
        except ValueError:
            continue
        rolling_results.append(WindowResult(
            as_of=f.as_of, n_obs=f.n_obs, n_series=f.n_series, k=f.factor_count.k,
            pc1_loadings=f.components[0].loadings,
            explained_variance_ratio=f.components[0].explained_variance_ratio,
        ))
    rolling_report = stability_report(rolling_results)
    print(f"\nROLLING WINDOW ({ROLLING_WINDOW_MONTHS}mo window, "
          f"{len(rolling_results)} steps):")
    print(f"  mean PC1 loading correlation across steps: "
          f"{rolling_report['mean_loading_correlation']}")
    print(f"  min: {rolling_report['min_loading_correlation']}  "
          f"share stable: {rolling_report['share_stable_transitions']}  "
          f"k ever changed: {rolling_report['k_ever_changed']}")

    return {
        "deep_history_cutoff": str(DEEP_HISTORY_CUTOFF.date()),
        "n_deep_series": len(deep_specs),
        "deep_series": sorted(deep_cols),
        "expanding_window": expanding_report,
        "rolling_window": rolling_report,
    }, deep_specs


def run_pca_vs_dfm(vintages: dict, deep_specs: tuple, as_of: pd.Timestamp) -> dict:
    """Step 4: fit both methods on the SAME panel and compare the global factor.

    Runs on the DEEP-HISTORY MONTHLY-ONLY subset (see `run_stability`), not the
    full comprehensive panel. Measured, not assumed: a first attempt fit
    `DynamicFactorMQ` on the full 206-series, 41-quarterly panel and it grew
    past 12GB of resident memory before being killed — the quarterly members'
    Mariano-Murasawa lag expansion (each needs several extra monthly lag
    states to tie one quarterly reading to three latent months) combined with
    per-series idiosyncratic AR(1) terms across 206 series pushes the Kalman
    filter's state dimension into the hundreds, and EM iterates that many times
    over 561 months. The deep-history subset (~80-110 monthly series, no
    quarterly) is the same scale as the 89-series fit that converged in 468
    seconds earlier in this project, so the comparison is run there, and this
    is the stated scope limitation rather than a silent downsizing.
    """
    build = build_asof(as_of, vintages, specs=deep_specs)
    print(f"\nPCA vs DFM on the deep-history subset ({build.describe()}):")
    pca_fit = fit_pca(build.frame, as_of=build.as_of, label="global_for_comparison", k=1)
    dfm_fit = fit_factors(build, maxiter=150)
    print(f"  PCA:  {pca_fit.describe()}")
    print(f"  DFM:  {dfm_fit.describe()}")

    dfm_global = dfm_fit.factors["global"] if "global" in dfm_fit.factors.columns else None
    comparison = None
    if dfm_global is not None:
        # DFM's index may carry tz info the PCA scores (from `standardize`,
        # which preserves the panel's own index) already share; align on the
        # calendar month regardless of tz representation.
        pca_scores = pca_fit.scores["PC1"].copy()
        pca_scores.index = pd.DatetimeIndex(pca_scores.index).tz_localize(None)
        dfm_scores = dfm_global.copy()
        dfm_scores.index = pd.DatetimeIndex(dfm_scores.index).tz_localize(None)
        common = pca_scores.index.intersection(dfm_scores.index)
        from ace.factors.stability import align_sign
        aligned_dfm = align_sign(pca_scores.loc[common], dfm_scores.loc[common])
        corr = float(pca_scores.loc[common].corr(aligned_dfm))
        print(f"  PC1 vs DFM global factor, sign-aligned correlation: {corr:.4f} "
              f"({len(common)} common months)")
        comparison = {"n_common_months": int(len(common)), "correlation": round(corr, 4)}

        # And the loading comparison: does PCA's PC1 agree with which series
        # the DFM's global factor actually loads on?
        dfm_loadings = dfm_fit.loadings["global"] if "global" in dfm_fit.loadings.columns else None
        if dfm_loadings is not None:
            loading_cmp = compare_loadings(pca_fit.components[0].loadings, dfm_loadings.dropna())
            print(f"  loading correlation: {loading_cmp.correlation:.4f} "
                  f"over {loading_cmp.n_common} common series")
            comparison["loading_correlation"] = (
                round(loading_cmp.correlation, 4) if np.isfinite(loading_cmp.correlation) else None
            )
            comparison["n_common_loadings"] = loading_cmp.n_common

    return {
        "scope_note": (
            "run on the deep-history monthly-only subset, not the full "
            "comprehensive panel — see this function's docstring"
        ),
        "n_series": len(deep_specs),
        "pca": {"n_series": pca_fit.n_series, "n_obs": pca_fit.n_obs,
                "variance_explained_pc1": pca_fit.components[0].explained_variance_ratio},
        # `FactorFit.n_obs` is MONTHS, not series — `dfm_fit.series` is the
        # series tuple. An earlier version reported `n_obs` under the key
        # "n_series", which put 561 (months) in a field a reader would take
        # for a series count.
        "dfm": {"n_series": len(dfm_fit.series), "n_months": dfm_fit.n_obs,
                "converged": dfm_fit.converged,
                "n_factors": dfm_fit.n_factors, "llf": dfm_fit.llf},
        "global_factor_comparison": comparison,
    }


def main() -> None:
    warnings.filterwarnings("ignore")
    specs, duplicate_choices = default_panel()
    print(f"comprehensive panel: {len(specs)} series")

    vintages = load_vintages(specs)
    now = pd.Timestamp.now(tz="UTC")
    build = build_asof(now, vintages, specs=specs)
    print(build.describe())

    snapshot, global_fit, domain_fits = run_global_and_domain(build)
    stability, deep_specs = run_stability(vintages, specs, build.frame)
    comparison = run_pca_vs_dfm(vintages, deep_specs, now)

    report = {
        "generated": str(now.date()),
        "as_of": build.as_of,
        "n_panel_series": len(specs),
        "n_used": build.n_series,
        "snapshot": snapshot,
        "stability": stability,
        "pca_vs_dfm": comparison,
    }
    path = ROOT / "artifacts" / "reports" / "macro_pca_research.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True, default=str))
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
