# Ripple Radar — Model Design v0.1

Canonical product/engine bible (from Joshua, 2026-09-14).

## Core pipeline

`Information → Narrative → Event probability → Scenarios → Player response → Economic transmission → Bottleneck → Asset discovery → Market confirmation → Reflexivity → Position research`

## Evidence classes

1. Narrative evidence: news, speeches, filings, press releases, search trends.
2. Fundamental evidence: inventories, production, capex, shipping, power demand, orders.
3. Market evidence: price, volume, volatility, open interest, curves, options, relative strength.
4. Expectation evidence: prediction markets, analyst forecasts, implied distributions.

## 24-hour delayed data policy

The initial system is designed around delayed/free information because the target edge is structural and multi-day-to-multi-year, not millisecond headline arbitrage. Same-day primary sources can be ingested where free.

## Scenario probabilities

Probabilities must be auditable and calibrated. The system stores:

- previous probability;
- new evidence;
- evidence direction/weight;
- updated probability;
- affected causal nodes;
- rescored assets.

LLM-generated numbers alone are never treated as calibrated probabilities.

## Game theory layer

For each scenario track:

- players;
- objectives;
- incentives;
- constraints;
- available moves;
- likely best responses;
- credible commitments;
- BATNAs / outside options;
- sequencing;
- repeated-game effects;
- policy or competitor counter-response.

The output changes the causal graph. Example: an OPEC supply response may reduce crude upside while leaving tanker-capacity stress intact.

## Ripple graph

Each causal link stores:

- source node;
- destination node;
- direction;
- causal distance;
- confidence;
- evidence;
- expected lag;
- invalidation condition;
- historical support.

Nodes can represent events, commodities, industries, bottlenecks, companies, ETFs, futures, currencies, rates or crypto assets.

## Progressive learning

Retain forecasts and score them later. Track:

- Brier score / calibration;
- directional accuracy;
- precision/recall for opportunity flags;
- false-positive rate;
- lead time versus consensus;
- causal-link failure rate;
- missed-exposure rate;
- ranking quality by forward-return horizon.

Learning loop:

`Forecast → Observe → Score → Diagnose error → Recalibrate → Update priors`

The model must never rewrite historical predictions after outcomes are known.

## Historical-replay standard

Freeze information at time T, generate scenarios and ranked exposures using only data available by T, then advance the clock. Monster winners such as BWET are case studies, not proof of edge.

## Related docs

- Product narrative: see CoS memory / chat "What Ripple is"
- Advanced engine v1 vision: CoS handoff to Engine / FinEng / Data Science
- UX audit: `REDESIGN-AUDIT.md` at repo root
