# Macro Interpretation + Market Reaction Engine — design

Design before implementation. This document is outputs 3–9 of the commissioning
brief; outputs 1–2 (system map, gap analysis) are in the audit that produced it.

**Decision: the engine is built inside `ace/`.** Every macro model, the
FRED/ALFRED vintage layer, the leakage and walk-forward validation spine, the
model registry and the FHS distribution machinery already live there.
Building elsewhere would create the parallel duplicate the brief forbids.
`systematic-portfolio-research` contains no macro code — verified by grep
across `src/`, `tests/`, `research_program/` and `config/`.

---

## 3. External reuse matrix

Licenses were read from each repository's own LICENSE file over
`raw.githubusercontent.com`, not inferred. **No license file means all rights
reserved**, which makes a repository a methodology reference and nothing more,
however permissive its README sounds.

| # | Project | License (verified) | Class | Ripple module |
|---|---|---|---|---|
| 1 | `statsmodels` DynamicFactorMQ | **BSD-3-Clause** (LICENSE.txt, 3 clauses) | **A. REUSE DIRECTLY** — as a dependency | Module 1 macro state |
| 2 | `statsmodels` state-space `.news()` | **BSD-3-Clause** | **A. REUSE DIRECTLY** | Module 8 what-changed |
| 3 | `joe5saia/FredMD` | MIT | **C. REIMPLEMENT** from methodology | Module 1 — Bai-Ng factor count, FRED-MD transform codes |
| 4 | `RenatoVassallo/MacroPy` | MIT | **D. RESEARCH** first, B. ADAPT if it beats statsmodels | Module 5 — BVAR, SVAR, FEVD |
| 5 | `elenev/localprojections` | MIT | **D. RESEARCH** — `ace/causal/local_projection.py` already implements Jordà with Newey-West and Holm | Module 5 — read for regime interaction terms only |
| 6 | `knightianuncertainty/regimes` | MIT | **C. REIMPLEMENT** | Module 2 — Bai-Perron breaks, CUSUM |
| 7 | `SecondOrderEdge/Recession_Probability_Model` | MIT | **C. REIMPLEMENT** the *engineering* | Module 2 + validation — ensemble, expanding window, Brier/AUROC, indicator attribution |
| 8 | `superpilot69/fred-us-macro-open-data` | **Split. Code public-use (non-OSI); data explicitly stays under source owners' terms** | **E. REJECT for the consensus fields** (see below) | Module 3/4 — was the candidate consensus source |
| 9 | `theov07/GDP_Forecasting_With_MIDAS_Regressions` | **NO LICENSE FILE** → all rights reserved | **D. RESEARCH ONLY** | Module 1 — ADL-MIDAS, Almon weights |
| 10 | `Macroeconometrics-Monetary-Policy-Surprises` | **Could not locate the repository** | **D. RESEARCH ONLY** (brief's default) | Module 4 — target/path decomposition |
| 11 | `charlescoverdale/mpshock` | MIT (CRAN: "MIT + file LICENSE") — **R, not Python** | **B. ADAPT the provenance schema**, not the code | Module 4 — shock-series provenance metadata |
| — | `RenatoVassallo/NowForecasting` (found while searching #4) | **NO LICENSE FILE** → all rights reserved | **D. RESEARCH ONLY** | Module 1 |

### The finding that changes Module 3 and 4

`fred-us-macro-open-data` carries 2,692 events with explicit consensus forecast
values, which is precisely what Modules 3 and 4 need and what `ace/` lacks.
Its README states those values are **matched from Investing.com Economic
Calendar history**, and its LICENSE states plainly that underlying series
"remain subject to the terms, notices, and restrictions of their original data
owners" and that the repository "does not grant any rights beyond those source
terms".

That is not a FRED question. Redistribution of a commercial calendar's
consensus history is governed by that vendor's terms, and this repository
disclaims granting any right to it. **Ripple cannot take the consensus fields
from here.** The FRED-derived observations, vintage release dates and event
timestamps are a different matter and remain usable under FRED's own terms —
which `ace/data/alfred.py` already operates under.

**Consequence, stated rather than worked around:** Module 4 does not ship
"actual − economist consensus" at first. It ships **model-expectation
surprise** — actual minus a point-in-time nowcast of the release, standardized
by the historical standard deviation of that model's own errors. This is
legally clean, fully reproducible, and it is a *different quantity* from a
consensus surprise. Every surface that renders it must say which one it is.
A licensed consensus feed is the documented upgrade path; the interface is
designed so swapping the expectation source does not change anything
downstream.

---

## 4. Target architecture

New sub-packages, alongside the existing ones, following `ace/` conventions
(module docstring stating what is established and what is not; a `main()` for
anything that fits a model; registration in `ace/registry`).

```
ace/state/          Module 1 — latent macro state
  panel.py          FRED-MD-style panel assembly, point-in-time via ALFRED
  transforms.py     FRED-MD transform codes (1..7), stationarity
  factors.py        DynamicFactorMQ estimation, Bai-Ng factor count
  state.py          MacroState: level / momentum / acceleration / percentile /
                    uncertainty / drivers / as_of / freshness

ace/expectations/   Module 3 — what is priced
  curve.py          Treasury curve, breakevens, real yields from FRED
  policy_path.py    implied policy path from the curve (NOT fed funds futures;
                    FRED does not carry them — scope stated, not faked)
  state.py          ExpectationsState

ace/surprise/       Module 4 — economic surprise
  calendar.py       release calendar + vintage release dates from ALFRED
  expectation.py    point-in-time nowcast of the next release (the baseline
                    expectation), pluggable so consensus can replace it
  surprise.py       raw + standardized surprise, revisions, provenance

ace/reaction/       Module 6/7 — conditional market response distributions
  conditional.py    conditions ace/scenarios FHS on state + regime + surprise
  scenario.py       release-scenario bins and their conditional reactions

ace/news_decomp/    Module 8 — what changed
  decompose.py      statsmodels .news() wrapper: forecast revision attributed
                    to each arriving observation
  runstate.py       persisted run-over-run diff

ace/regime/         Module 2 — EXTENDED, not replaced
  macro_regime.py   Markov switching over the Module 1 factors, producing
                    probabilities over a macro taxonomy
  breaks.py         Bai-Perron / CUSUM structural break detection
```

Reused unchanged: `ace/data/alfred.py`, `ace/validation/*`, `ace/metrics/*`,
`ace/calibration/*`, `ace/registry/*`, `ace/scenarios/distribution.py`,
`ace/causal/local_projection.py`.

### Contract between modules

Every module emits a frozen dataclass carrying its own `as_of`, the vintage
each input was read at, and a `provenance` field. Nothing downstream may
consume a value without them. This is the existing `ace/registry` metadata
contract pushed down to the data level.

---

## 5. Data architecture

| Need | Source | Status |
|---|---|---|
| Macro levels, point-in-time | ALFRED first-release vintages, `ace/data/alfred.py` | **exists** |
| Macro panel breadth | 89 series across nine blocks, `ace/state/panel.py` | **exists** — see below |
| Release timestamps | ALFRED `realtime_start` | **exists** — this is the release date |
| Consensus forecasts | **none available under a usable license** | blocked, documented |
| Market series | `ace/data/fred_market.py` | **exists** |
| Treasury curve / breakevens | DGS2, DGS10, T10Y2Y, T10Y3M, T10YIE, DFII10 | **in the panel**, unrevised route |
| Fed funds futures / SOFR | not on FRED | out of scope, stated |

Storage follows the existing pattern: `artifacts/cache/` keyed on the request
without the API key, `artifacts/reports/` for scorecards, `artifacts/registry.json`
for model metadata. No new store.

### Panel coverage, measured

91 candidates were probed against the live API. 89 are in the panel; every one
joins on a build as of 2026-09-26 with nothing dropped.

| Block | n | Fastest member | Slowest member |
|---|---:|---|---|
| growth | 7 | INDPRO, 56d | GDPC1, 178d (quarterly) |
| manufacturing | 6 | IPMANSICS, 56d | BUSINV, 87d |
| labor | 16 | ICSA, 7d (weekly) | JOLTS, 87d |
| consumer | 7 | UMCSENT, 56d | PCEC96, 87d |
| housing | 9 | MORTGAGE30US, 4d (weekly) | CSUSHPINSA, 117d |
| inflation | 13 | CES0500000003, 56d | ECIWAG, 178d (quarterly) |
| liquidity | 8 | RRPONTSYD, 1d (daily) | M2SL, 56d |
| credit | 10 | BAA10Y, 2d (daily) | G.19 series, 87d |
| financial | 13 | the curve, 2d (daily) | FEDFUNDS, 56d |

**Two fetch routes, and the route is measured.** ALFRED's first-release archive
answers `output_type=4` with a 400 for daily market series — there is nothing to
archive, because a close is never revised. `SeriesSpec.revised` selects the
route and defaults to True. `ace/state/route_check.py` verifies each `False`
two ways and writes both to `artifacts/reports/`: against the archive where one
exists, and against ALFRED as-of snapshots two and four years back where it
does not.

The check has already overruled reasoning once. The broad trade-weighted dollar
index looks exactly like a market quote and disagrees with its own archive on
**91% of overlapping days by up to 2.18 index points**, because the H.10 basket
weights are re-estimated annually and applied backwards. It reads the archive
now. Eight series came back identical across ~2,500 observations; VIX and the
overnight repo facility came back with one and two corrections respectively, an
order 10⁻³ contamination recorded in their notes rather than rounded away; the
S&P 500's rolling licence refuses both checks, so it sits in `UNVERIFIABLE_ROUTE`
with its claim marked as reasoning.

**Mixed frequency.** Daily and weekly members collapse to the last print in a
month, and only once `MONTH_COVERAGE` prints have been published in it — the
month in progress therefore appears about half-way through. The collapse runs
AFTER the point-in-time filter; aggregating first would put days beyond the
as-of date into the current month's figure. Quarterly members (`GDPC1`,
`ECIWAG`, `DRTSCILM`) go to `DynamicFactorMQ` as `endog_quarterly`, so the
Mariano-Murasawa aggregation ties a quarterly reading to three latent monthly
values.

**What is not there, and why.** One genuine hole: existing home sales
(`EXHOSLUSM495S`), where FRED holds a 13-month rolling window under NAR
licensing — there is no history to fetch, at any price, from this API. New home
sales (`HSN1F`) is the federal substitute and is in the panel. The other two
excluded candidates were FRED-MD internal names that are not FRED series IDs;
both concepts are in the panel under their real IDs. All three are recorded in
`panel.UNAVAILABLE` with the measurement, because "we have every federal
series" is a claim and a claim needs its exceptions written where the panel is
read.

---

## 6. Model plan

| Module | Model | Why this one |
|---|---|---|
| 1 state | `DynamicFactorMQ` | Handles mixed frequency and ragged edges natively, which is the whole problem with a macro panel. EM estimation. BSD-3. Already installed. |
| 1 factor count | Bai-Ng IC_p2 | The standard; reimplemented from methodology rather than copied. |
| 2 regime | `MarkovAutoregression` on the growth/inflation factors | Gives *probabilities* with a transition matrix, which the brief requires, rather than a deterministic label. |
| 2 breaks | Bai-Perron | Detects whether the transition matrix itself moved. |
| 4 expectation | AR / factor nowcast, expanding window | Legally clean baseline expectation. Pluggable. |
| 5 transmission | `ace/causal/local_projection.py` + regime interaction | Already validated machinery; adding state conditioning is the new part. |
| 6 reaction | FHS from `ace/scenarios/distribution.py`, conditioned | Reuses validated PIT/coverage diagnostics. |
| 8 what-changed | statsmodels `.news()` | Exactly the decomposition the brief describes, from the model that produced the forecast. |

**Every one of these must beat a stated baseline or it does not ship.** The
baselines are: random walk / last value for levels; unconditional climatology
for probabilities; always-long for directional asset calls; AR(1) in log
realised vol for volatility. `ace/` already has three models registered FAILED
against exactly these, which is the standard being upheld.

---

## 7. Validation plan

Reusing `ace/validation/` and `ace/metrics/` rather than inventing a second
harness.

- **Leakage**: `assert_features_precede_prediction`, `assert_labels_follow_prediction`,
  `assert_split_is_chronological` on every fit. These raise.
- **Point-in-time replay**: every historical state is rebuilt from the ALFRED
  vintage available on that date. The quad work measured what skipping this
  costs — 74.2% of real-time labels survived revision, and 72% of the failures
  flipped the growth axis.
- **Splits**: expanding window with purge and embargo (`walk_forward_folds`),
  plus a `sealed_split` read once.
- **Point forecasts**: MAE, RMSE, vs random walk.
- **Probabilities**: Brier, log loss, AUROC/PR-AUC, ECE and reliability table
  (`ace/metrics/classification.py`), calibration fitted out-of-fold only.
- **Distributions**: PIT uniformity and interval coverage
  (`ace/scenarios/distribution.py` already implements both).
- **Significance**: block bootstrap (`ace/metrics/bootstrap.py`), Holm across
  simultaneous tests.
- **Conditional performance**: recession vs expansion, crisis vs calm.
- **Registration**: every fit writes a `ModelRecord` with production_status
  CANDIDATE / PRODUCTION / FAILED. A model that loses to its baseline is
  registered FAILED and stays visible.

---

## 8. Implementation plan — ordered work packages

| WP | Content | Exit condition |
|---|---|---|
| **WP1** | `ace/state/transforms.py` + `panel.py` — FRED-MD transforms, point-in-time panel | **DONE.** Panel builds as-of any historical date; tests prove no post-date vintage leaks. 89 series across nine blocks, two verified fetch routes, mixed frequency. |
| **WP2** | `ace/state/factors.py` + `state.py` — DynamicFactorMQ, Bai-Ng, MacroState schema | **Factors estimate** (10 over 89 series, converged). The out-of-sample nowcast comparison against a random walk is the OPEN half of this exit condition. |
| **WP3** | `ace/regime/macro_regime.py` — Markov switching on the factors | Regime probabilities; Brier vs climatology; registered |
| **WP4** | `ace/surprise/` — calendar, expectation, standardized surprise | Surprise series for CPI, payrolls, unemployment; provenance says "model expectation" |
| **WP5** | `ace/reaction/conditional.py` — conditional distributions for 2Y, 10Y, NQ, ES, DXY, Gold at 1/5/20d | PIT and coverage reported; compared to unconditional FHS |
| **WP6** | `ace/news_decomp/` — `.news()` wrapper + run diff | Forecast change attributed to named observations |
| **WP7** | Export + product surface | Generated module, gated like every other |

WP1–WP3 are the first vertical slice's spine. WP4–WP6 complete it.

---

## 9. First vertical slice

US only. Growth, inflation, labor. Releases: CPI, payrolls, unemployment.
Markets: 2Y, 10Y, NQ, ES, DXY, Gold. Horizons: 1, 5, 20 days.

```
ALFRED vintages
  → ace/state/panel.build_asof(date)          point-in-time panel
  → ace/state/factors.fit(panel)              DynamicFactorMQ
  → ace/state/state.MacroState                level/momentum/accel/pct/uncert
  → ace/regime/macro_regime.probabilities()   P(regime) + transition matrix
  → ace/surprise/surprise.standardized()      actual vs model expectation
  → ace/causal/local_projection (existing)    transmission, regime-conditioned
  → ace/reaction/conditional.distribution()   P(up), mean, q10/25/50/75/90
  → structured JSON → the product's ACE layer explains it
```

The slice is done when a single command produces that JSON for a historical
date using only information available on that date, with every number carrying
a model id and a validation record — and when the honest answer for the
market-reaction leg is allowed to be a wide distribution centred near zero,
because that is what four prior tests on this data have already found.
