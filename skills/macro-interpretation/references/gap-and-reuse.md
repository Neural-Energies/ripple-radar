# Gap and reuse

Open the upstream `LICENSE` before copying any file. "Not verified" means reimplement the method. Do not paste.

## Gaps against the nine modules

| Module | Already here | Missing |
|---|---|---|
| 1 Macro state | Quad from ALFRED; FRED monitors; HLW/Taylor | Latent growth, inflation, labor factors with percentile, uncertainty, drivers, freshness. No `DynamicFactorMQ`. |
| 2 Regime | Filtered Markov regression; deterministic quad label | A probability vector over expansion / reflation / inflationary slowdown / disinflationary slowdown / soft landing / contraction / recovery, with previous, delta, drivers. Taxonomy can change if the fit says so. |
| 3 Expectations | Lexicon tags for "expectation" text. Not a state. | Consensus, prior, revision, funds futures, SOFR, curve, breakevens, real yields. Level separate from surprise. |
| 4 Surprise | None as a scored object | `actual - consensus`, divided by historical surprise std, for CPI, payrolls, unemployment, FOMC. Real-time. |
| 5 Transmission | Jordà local projections; edge validation | Those projections on 2Y, 10Y, NQ, ES, DXY, gold at 1, 5, 20 days, regime-conditioned once the probabilities exist. |
| 6 Reaction | Scenario distribution helpers | `probability_positive`, mean, median, q10, q90 from the responses. Not an arrow. |
| 7 Event scenarios | `ace/scenarios/distribution.py` | Pre-release bins whose conditional reactions come from the same estimated responses. |
| 8 What changed | UI copy and fixture cells | A diff against the previous persisted run, attributed to observations. Statsmodels news is the method to study, not a number to type in. |
| 9 ACE | Narration and detail formatters | A schema check that every number in the paragraph is a field on the payload. |

## Reuse matrix

| Source | Capability | Class | Why | Improves |
|---|---|---|---|---|
| statsmodels `DynamicFactorMQ` | Mixed-frequency factor nowcast, EM, missing data | ADAPT | BSD-3. Call it; do not reimplement EM. | Module 1 |
| statsmodels state-space news | Forecast revision attributed to each new observation | ADAPT | Same license. Read the news weights. | Module 8 |
| statsmodels `MarkovRegression` | Filtered regime probabilities | REUSE | Already wrapped in `ace/regime/markov.py`. | Module 2 |
| FRED-MD / Bai-Ng | Large monthly factor panel and factor-count selection | REIMPLEMENT | Data terms, not a library to vendor. Use the series list and the selection rule. | Module 1 |
| MacroPy | BVAR, conditional forecasts, IRFs | RESEARCH | License not verified this pass. Study the BVAR only if local projections lose to it on the slice. | Module 5, later |
| elenev/localprojections | Jordà LPs, interactions, horizons | REJECT as code | ACE already has the estimator with Newey-West and negative horizons. License not verified. | Nothing until that file is shown to be wrong |
| knightianuncertainty/regimes | Bai-Perron, CUSUM, rolling ADL | RESEARCH | License not verified. Use only if filtered Markov probabilities fail the validation plan. | Module 2 |
| SecondOrderEdge recession ensemble | Expanding window, Brier, calibration, attribution | REIMPLEMENT | Borrow the validation shape, not the recession product. License not verified. | Validation, not a new recession model |
| fred-us-macro-open-data | Actual, forecast, previous, release time | RESEARCH | Possible surprise seed. Confirm redistribution terms before loading it. | Module 4 |
| MIDAS GDP notebooks | ADL-MIDAS, Almon weights, daily to quarterly | RESEARCH | Academic. No code copy until the license allows it. | Module 1, later |
| Monetary-policy surprise papers / mpshock | Target and path surprises, event windows | RESEARCH | Identification notes. Do not vendor unpublished or unclear-license series as if they were ours. | Module 4, FOMC only |

Add a row to this file when a license is actually read. Change REJECT or RESEARCH only after that.
