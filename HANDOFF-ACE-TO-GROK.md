# ACE handoff — what is wired, what is available, what to watch

**Tip:** `main` @ `42c2536`. typecheck clean · eslint 0 errors repo-wide ·
75 app + 78 engine tests pass · no page errors on any of 11 routes.

This is a wiring map, not a spec. It says what already has a live producer
behind it, so UI work binds to something real instead of a placeholder.

---

## Standing rule

**No pseudo anything.** No fixture, sample, reserved slot, or "frozen
placeholder" standing in for a number. If a producer does not exist, the
surface says so plainly and stays empty — an empty state is the honest
answer, never a reason to fill the space.

Corollaries that have already bitten:
- `appeared` on expected evidence was authored `false` and nothing could flip
  it. Anything that renders a boolean needs a producer that can set it.
- Independent per-row rounding does not close a distribution. Scenario mass
  printed `Σ 101%` for three-scenario families. Use `roundTo100`.
- A badge that describes a fixture must be deleted with the fixture, not kept.

---

## ACE kernels — `src/lib/ace/` (all pure, all deterministic, all tested)

| Module | Exports | What it is |
|---|---|---|
| `probability.ts` | `updateScenarios`, `axisPosition`, `roundTo100`, `PRIOR_STRENGTH` | Dirichlet update. Returns posterior `alpha` + `provenance`. |
| `bands.ts` | `forecastBands`, `betaCdf`, `betaQuantile` | P10/P50/P90 as Beta(αᵢ, α₀−αᵢ) marginals of the posterior. |
| `materiality.ts` | `gateEvidence`, `factKey`, `MATERIAL_MASS_THRESHOLD` | Stops one syndicated fact counting once per outlet. |
| `expected-evidence.ts` | `monitorExpectedEvidence`, `observedShare`, `satisfies` | Tests a structured `watch` against the live book. |
| `intervene.ts` | `intervene`, `playAt`, `severityOf` | Conditions the book on a game-theory cell. |

Two invariants to preserve when binding these:

- **Bands come from `alpha`, never from displayed percentages.** Rounding
  first invents precision the model never had.
- **`intervene` returns a view.** Never write its output back onto the event.
  The tests assert the input book is not mutated.

## Provenance ladder

`heuristic` → `llm_proposal` → `model_based` → `calibrated`

`calibrated` is earned only from the freeze ledger's scored resolutions and
is never set by hand. `overlayForecastClaim` in `src/lib/live/overlay.ts`
decides what a surface may claim: an LLM rescore that moved mass drops the
stored band rather than bracket a number it did not describe, and keeps its
own weaker provenance.

## Live data producers

| Field on `RadarEvent` | Producer | State |
|---|---|---|
| `scenarios` | `ace/probability` via `build.server.ts` | live, Σ=100 |
| `bands` | `ace/bands` from posterior `alpha` | live |
| `provenance` | stamped by the update | live |
| `expectedEvidence[].appeared` | `ace/expected-evidence` monitor | live |
| `horizons`, `knowledge`, `questions` | `engine/hypothesize` | live |
| `relatedEvents` | `relateEvents` | live |
| `disposition`, `modelsDisagree` | none | **unbuilt — leave omitted** |

Ledger queries in `src/lib/live/forecast-ledger.server.ts`, exposed as server
functions in `src/lib/live/desk.ts`:
`getScoredForecasts` · `getSkillSeries` · `getReplayFrames` · `getCalibration`

All four read the append-only freeze ledger and return empty on a young
ledger. That empty is correct — do not seed it.

## Panels — all seven are placed

`engine-panels.tsx` had zero usages for its whole history. Current homes:

- Scenarios: `HorizonPanel`, `ExpectedEvidencePanel`
- Ripple Map: `PipelineStrip`, `ActorsPanel`, `RelatedEventsPanel`, `KnowledgePanel`
- Game Theory: `ImportanceMeter` (as "Book standing")

Nothing in that file is dead. If a panel is moved, move it — do not leave a
second copy unrendered.

## Drill-downs that now exist

- Payoff matrix cell → conditions the book (severity, per-scenario deltas,
  rescored transmission), `clear cell` returns to the engine's read
- Causal link row → label drills to the asset, metric chip walks the chain
- Scenario legend → `/scenarios?event=…&scenario=…`, focused and shareable
- Evidence headline → its source
- Scored ledger row → expands the judge's rationale; book name → that book
- World Tape expressions → `/assets/$ticker`

## Known hazards

1. **Truncated pushes.** `events.tsx` shipped at 21 lines on `main` for
   several commits — a commit deleted 553 lines while adding an import, and
   the follow-up "restore" added one line back. It did not typecheck and the
   route could not render. Recovered in `42c2536`. Run `npm run typecheck`
   before pushing; a merge can re-apply a truncation silently because a
   one-sided deletion does not conflict.
2. **`?event=` is authoritative.** Setting `selectedEventId` alone is
   reverted on the next render by `useEventParamSync`. Use `goToEvent` /
   `goToScenario`.
3. **Overlay reads the book copy.** `overlayScenarios` prefers
   `book?.scenarios`, so anything written only to `ev.scenarios` is ignored.
   Write both, as `build.server.ts` does.
4. **`npm test` runs three groups.** The scripts group fails 17 sandbox tests
   by design; `test:app` and `test:engine` must both be green.

## Open — not built, deliberately

Judge triage (`disposition`), ensemble disagreement (`modelsDisagree`),
isotonic recalibration, historical analogs, and sensitivity analysis have no
producer. They stay omitted rather than rendering a placeholder.
