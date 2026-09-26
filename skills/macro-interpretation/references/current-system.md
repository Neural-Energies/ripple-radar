# Current system map

Repo: `Neural-Energies/ripple-radar`. The path `systematic-portfolio-research` is not mounted here. Update this file if a module moves. Do not treat the `/macro` workstation figures as model output; they are the October 2024 design comp in `src/components/macro/mirror.tsx` and `src/data/macro-fixtures.ts`.

## Python (`ace/`)

| Area | File | What it already does |
|---|---|---|
| Quad, point-in-time | `ace/macro/quads.py`, `revisions.py`, `durations.py`, `export_quads.py` | Growth/inflation rate-of-change quads from ALFRED first prints. Refuses GDP because of the publication lag. Spec choice is measured, not tasted. |
| ALFRED / FRED | `ace/data/alfred.py`, `ace/data/fred_market.py`, `ace/datasets/macro_event_impact.py` | Vintages and market series for the impact set. |
| Markov regimes | `ace/regime/markov.py`, `validate_regimes.py` | `MarkovRegression`. Real-time path uses filtered probabilities only. A test asserts filtered ≠ smoothed. |
| Local projections | `ace/causal/local_projection.py` | Jordà regressions per horizon, Newey-West bandwidth ≥ h, negative horizons as a placebo. |
| Other causal | `ace/causal/estimate.py`, `dag.py`, `refute.py` | Cross-section and refutation. Not a substitute for the horizon path. |
| Transmission | `ace/ripple/transmission.py`, `edge_calibration.py`, `validate_edges.py` | Cross-market edges. Sign flips across 2010–19 vs 2020–26 are why regime conditioning exists. |
| Macro impact | `ace/models/macro_impact_model.py` | Event-to-market impact model. |
| Scenarios | `ace/scenarios/distribution.py`, `ace/models/scenario_probability_model.py` | Scenario distributions. Do not bolt a second scenario engine beside these. |
| Calibration and scores | `ace/calibration/calibrate.py`, `ace/metrics/classification.py`, `ace/metrics/bootstrap.py` | Calibration and classification metrics. |
| Walk-forward / leakage | `ace/validation/walkforward.py`, `leakage.py` | The existing backtest and leakage checks. New forecasts go through these. |
| Vol and quads | `ace/models/quad_model.py`, `quad_vol_model.py`, `ace/volatility/har.py` | Quad-conditioned and HAR volatility. |
| Analogues | `ace/analogs/historical.py` | Historical analogue pool. |
| Registry | `ace/registry/registry.py` | Model registry. New production models register here. |
| Point-in-time features | `ace/features/pit.py` | Feature alignment. Use it instead of a new as-of helper. |

Tests live in `ace/tests/`, including `test_macro.py`, `test_quads.py`, `test_causal.py`.

## TypeScript desk

| Area | File | What it already does |
|---|---|---|
| FRED client | `src/lib/live/fred.server.ts` | Live FRED pulls. One client. |
| Regime book | `src/lib/live/macro.server.ts`, `macro-regime.ts` | YoY and second-derivative quad, basket, flips. |
| Monitors | `src/lib/live/macro-monitors.ts` | Sahm, CFNAI-MA3, Chauvet, STLFSI, T10Y3M. |
| Policy | `src/lib/live/macro-hlw.ts`, `macro-models.ts` | NY Fed HLW r*, Taylor gap. Missing r* stays missing. |
| Vol regime | `src/lib/live/vol-regime.ts` | VIX term structure, realized vol, variance premium. Not a GARCH fit. |
| Session check | `src/lib/live/session-check.ts` | Tape versus the quad pattern. |
| ACE detail | `src/lib/ace/macro-detail.ts`, `macro-format.ts` | How the desk reads ACE macro output. |
| Contracts | `docs/ENGINE-INTERFACE-CONTRACTS-v0.md`, `docs/FINENG-INTERFACE-CONTRACTS-v0.md`, `docs/ENGINE-CAPABILITY-GAP.md` | What the engine is allowed to claim. Importance is not a probability. |

## Not built

No dynamic-factor nowcast, no state-space news decomposition, no consensus-surprise history with vintages, no conditional return distribution object for 2Y/10Y/NQ/ES/DXY/gold, no persisted "previous run vs this run" attribution. Those are the slice. They attach to the modules above.
