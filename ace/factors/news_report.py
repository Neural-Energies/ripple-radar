"""Phase 9 driver: run `ace.factors.news.what_changed` on the PRODUCTION
DFM panel (`ace.state.panel.PANEL`, the same one `ace.state.state` builds
`MacroState` from), comparing "now" against `DEFAULT_LOOKBACK_DAYS` ago.

WHY THE PRODUCTION PANEL, NOT THE COMPREHENSIVE ONE

`ace.state.factors`'s own docstring names `.news()` as the reason the
production panel is fit with `DynamicFactorMQ` at all — this module is that
promise kept, applied to the model that is actually the system's regime read
today, not the still-experimental comprehensive-panel PCA/DFM work from
Phases 6/7. The comprehensive panel's own DFM fit is also the one that grew
past 12GB before being killed (see `ace.factors.pca_research`'s docstring) —
running `.news()` on it would mean fitting it TWICE, which is exactly the
cost that incident ruled out for this session's compute budget.

WHICH SERIES TO EXPLAIN, PER BLOCK

`.news()` needs an actual observed series name (see `ace.factors.news`'s
docstring for why a literal factor-level target does not exist in this
statsmodels version). `_top_loading_per_block` picks, per block, whichever
member has the LARGEST |loading| on that block's own factor in the CURRENT
fit — decided by the evidence in that fit, not assumed in advance, the same
discipline the rest of the factor-engine brief applies to naming anything.

KEEPING THE TWO FITS COMPARABLE

`.news()` compares two `MLEResults` built from the SAME state-space
specification. On this panel (9 blocks, `kmax=6`), `factor_multiplicities`
for the global factor is `max(1, k - 9)` — see `ace.state.factors.fit_factors`
— which is 1 for every k Bai-Ng can return, so the SPECIFICATION is already
invariant to which k Bai-Ng picks on either vintage. This module still pins
`updated`'s `k` to `previous`'s (`fit_factors(..., k=previous_fit.factor_count.k)`)
rather than relying on that being true forever: if the panel's block count
ever changes, forcing the same k keeps the two fits comparable instead of
silently drifting apart.

Run: `python -m ace.factors.news_report`
"""
from __future__ import annotations

import json

import pandas as pd

from ace.config import ROOT
from ace.factors.news import NewsDecomposition, what_changed
from ace.jsonutil import to_json_safe
from ace.state.factors import FactorFit, fit_factors
from ace.state.panel import PANEL, PANEL_BY_ID, build_asof, load_vintages

#: A week: long enough that at least one release has usually landed for some
#: block, short enough that panel membership essentially never changes
#: between the two builds it compares.
DEFAULT_LOOKBACK_DAYS = 7

#: How many contributions to print per block in the console summary. The
#: written artifact keeps every contribution regardless.
TOP_CONTRIBUTIONS_SHOWN = 5


def top_loading_per_block(fit: FactorFit) -> dict[str, str]:
    """The series with the largest |loading| on each block's own factor."""
    out: dict[str, str] = {}
    for column in fit.loadings.columns:
        block = str(column).split(".")[0]
        if block == "global":
            continue
        members = [s for s, b in fit.blocks.items() if b == block]
        candidates = fit.loadings.loc[[m for m in members if m in fit.loadings.index], column].dropna()
        if candidates.empty:
            continue
        out[block] = str(candidates.abs().idxmax())
    return out


def run_what_changed(
    previous_fit: FactorFit, updated_fit: FactorFit
) -> dict[str, dict]:
    """One `what_changed` decomposition per block, explained through that
    block's best-loading series (see module docstring).
    """
    proxies = top_loading_per_block(updated_fit)
    report: dict[str, dict] = {}
    for block, series_id in sorted(proxies.items()):
        if series_id not in previous_fit.series:
            report[block] = {
                "proxy_series": series_id,
                "error": "proxy series was not present in the previous fit",
            }
            continue
        try:
            decompositions = what_changed(previous_fit, updated_fit, impacted_series=series_id)
        except Exception as exc:  # noqa: BLE001 — a failed block is reported, not fatal
            report[block] = {"proxy_series": series_id, "error": str(exc)}
            continue
        if not decompositions:
            report[block] = {"proxy_series": series_id, "error": "no impact reported"}
            continue

        d: NewsDecomposition = decompositions[0]
        label = PANEL_BY_ID[series_id].label if series_id in PANEL_BY_ID else series_id
        print(f"\n{block} (proxy: {series_id} — {label}): "
              f"{d.estimate_previous:+.3f} -> {d.estimate_updated:+.3f}  "
              f"(news {d.impact_of_news:+.3f}, revisions {d.impact_of_revisions:+.3f})")
        for c in d.contributions[:TOP_CONTRIBUTIONS_SHOWN]:
            print(f"    {c.kind:<9} {c.series_id:<14} {c.observation_date}  impact={c.impact:+.4f}")

        report[block] = {"proxy_series": series_id, "proxy_label": label, **d.to_dict()}
    return report


def main() -> None:
    now = pd.Timestamp.now(tz="UTC")
    previous_when = now - pd.Timedelta(days=DEFAULT_LOOKBACK_DAYS)
    vintages = load_vintages(PANEL)

    previous_build = build_asof(previous_when, vintages)
    print(f"previous ({previous_build.as_of}): {previous_build.describe()}")
    previous_fit = fit_factors(previous_build)
    print(f"  fit: {previous_fit.describe()}")

    updated_build = build_asof(now, vintages)
    print(f"\nupdated ({updated_build.as_of}): {updated_build.describe()}")
    updated_fit = fit_factors(updated_build, k=previous_fit.factor_count.k)
    print(f"  fit: {updated_fit.describe()}")

    report = run_what_changed(previous_fit, updated_fit)

    out = {
        "generated": str(now.date()),
        "previous_as_of": previous_build.as_of,
        "updated_as_of": updated_build.as_of,
        "lookback_days": DEFAULT_LOOKBACK_DAYS,
        "blocks": report,
    }
    path = ROOT / "artifacts" / "reports" / "macro_what_changed.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_json_safe(out), indent=2, sort_keys=True, default=str, allow_nan=False))
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
