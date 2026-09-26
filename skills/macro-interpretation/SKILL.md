---
name: macro-interpretation
description: >
  Build Ripple's macro interpretation and market-reaction engine in the
  existing repository. Use this whenever the user mentions macro state, regime
  probabilities, nowcasts, FRED or ALFRED, economic surprise, consensus,
  transmission, local projections, VAR, dynamic factor models, What Changed,
  ACE explanations of the economy, CPI or payrolls or FOMC scenarios, or
  market reaction distributions. Also use it when they ask to extend the macro
  book, add a quant model, or turn the macro dashboard into real forecasts.
  Do not invent probabilities. An LLM may explain model output and must not
  create it.
metadata:
  short-description: "Quant macro state, surprise, transmission, and forecasts — no invented numbers"
user-invocable: true
---

# Macro interpretation engine

Ripple answers what the economy is doing, what the market expected, what changed, and how that has transmitted. It is not a trading-signal product and not a place to invent numbers.

The quantitative system produces every forecast, probability, regime weight, and return distribution. An LLM may only narrate a structured object those models already emitted.

## Before any code

1. Read [references/current-system.md](references/current-system.md). Re-check the files if the repo has moved. The Windows path `systematic-portfolio-research` is not this sandbox; the live tree is `Neural-Energies/ripple-radar`, Python under `ace/`, desk math under `src/lib/live/`.
2. Read [references/gap-and-reuse.md](references/gap-and-reuse.md) before adding a model that a listed project already implements.
3. Extend the module that already owns the job. Do not add a second quad, a second Markov switch, or a second local projection.
4. Do not redesign the macro UI. Fixture screens stay labeled as the comp. Do not bind fixture figures to a new model and present them as live.

## Hard rules

- No hardcoded probabilities, confidence scores, or asset arrows in production output.
- No lookahead. Markov regimes use filtered probabilities, never smoothed. Quads use ALFRED vintages already in `ace/macro/quads.py`. Historical replay sees only data published by that date.
- Missing data stays missing. Do not fill a hole with a plausible number.
- A model that cannot beat its baseline in [references/validation.md](references/validation.md) does not ship.
- Every production result carries the provenance block in [references/schemas.md](references/schemas.md). A result without `model_name`, `as_of_date`, and `data_version` is not production.
- ACE text may quote fields from the structured payload only. If a field is absent, the sentence is absent.

## Order of work

Do not build all nine modules at once. The first vertical slice is the United States only.

| Step | Do this | Stop when |
|---|---|---|
| 1 | Point-in-time macro state for growth, inflation, labor | Levels, momentum, and drivers come from series already in FRED/ALFRED, with a freshness timestamp |
| 2 | Regime probabilities, not one label | Filtered probabilities, previous vs current, drivers. Reuse `ace/regime/markov.py` |
| 3 | Surprise vs consensus for CPI, payrolls, unemployment, FOMC | `actual - consensus` and a historical std, real-time, no future revision |
| 4 | Transmission to 2Y, 10Y, NQ, ES, DXY, gold at 1, 5, and 20 days | Reuse `ace/causal/local_projection.py`. Report coef, SE, and pre-treatment check |
| 5 | Conditional distributions, not up/down | `probability_positive`, mean, median, q10, q90, from the estimated responses |
| 6 | What changed vs the previous persisted run | Deltas attributed to named observations. No attribution without a stored prior run |
| 7 | ACE paragraph | Rendered only from that JSON |

Schemas for steps 1–7 are in [references/schemas.md](references/schemas.md). Validation for each is in [references/validation.md](references/validation.md).

## Where new code goes

| Concern | Extend | Do not create |
|---|---|---|
| Point-in-time growth/inflation quad | `ace/macro/quads.py`, `revisions.py` | A second quad classifier |
| Real-time regime | `ace/regime/markov.py` | A smoothed-probability regime |
| Impulse responses | `ace/causal/local_projection.py` | A one-horizon beta |
| Event impact on assets | `ace/models/macro_impact_model.py` | A parallel impact model |
| Desk FRED fetch and monitors | `src/lib/live/fred.server.ts`, `macro.server.ts`, `macro-monitors.ts` | A second FRED client |
| Policy rule and r* | `src/lib/live/macro-hlw.ts`, `macro-models.ts` | A made-up Taylor gap |
| ACE narration | `src/lib/ace/` consumers of structured JSON | Free-text forecasts |
| UI | Existing `/macro` routes | A new visual system |

Research notebooks stay out of the inference path. Inference functions are pure enough to test without the network. Network fetches live next to the existing FRED and ALFRED loaders.

## External code

Classify before copying. Open the `LICENSE` file in that repo. If the license is missing, academic-only, or unclear, reimplement the method and do not paste the code. Record the class in the reuse matrix: REUSE, ADAPT, REIMPLEMENT, RESEARCH, or REJECT.

Statsmodels is BSD-3. Prefer it for `DynamicFactorMQ`, state-space news, and `MarkovRegression` over a from-scratch filter. ACE already wraps `MarkovRegression` and Jordà local projections; extend those wrappers.

## Done means

A test can rebuild the slice from a frozen vintage and get the same object. The object has state, regime probabilities, surprises, transmission, distributions, and attribution. ACE's paragraph contains no number that is not in that object. Existing quad, monitor, and local-projection tests still pass.
