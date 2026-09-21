# Cluster judge JSON schema (v0)

**Product:** Ripple Radar  
**Date:** 2026-09-14  
**Status:** Draft lock for ML/AI routing — **docs only / no implementation**  
**Owners:** DS (field semantics + labels); ML/AI (prompt/router/versioning); Engine (cheap gates before call; compose fallback)

## Placement

LLM cluster judge runs **after** cheap gates (`relevance.ts` / significance). Soft-news rejects never reach the judge.

## Emit contract (one object per cluster / candidate)

```ts
type TriageDisposition = "onRadar" | "watch" | "drop" | "duplicate"

/** Ordinal routing confidence — NOT a calibrated probability. */
type JudgeConfidence = "low" | "medium" | "high" | "very_high"

type EventFamily =
  | "physical" | "policy" | "credit" | "tech" | "fx"
  | "weather" | "corporate" | "kinetic" | "commodity" | "other"

interface ClusterJudgeLabel {
  /** Schema version for ML/AI router. */
  schemaVersion: "cluster-judge/v0"

  clusterId: string

  /** World Tape / hero disposition chip. No % on this field. */
  disposition: TriageDisposition

  /** Separate from disposition — market-moving vs merely on radar. */
  marketMoving: boolean

  family: EventFamily

  confidence: JudgeConfidence

  /** Short human rationale (desk / eval). Not a probability. */
  why: string

  /**
   * Optional. Crypto narratives only when delayed-policy compatible / data-honest.
   * Prefer ontology/tags + TradeCategory:"crypto" over inventing a crypto EventFamily.
   */
  cryptoHonest?: boolean
}
```

## Hard rules

1. **Label ≠ calibrated probability.** `confidence` and `disposition` must never be written as `provenance: calibrated` or fed as Brier inputs.
2. **Importance ≠ probability.** Judge does not emit desk `probability` / scenario masses.
3. **Provenance of any LLM scenario shifts elsewhere** stays `llm_proposal` (ML/AI / FinEng).
4. **UX:** tape shows `disposition` only; no judge %; crypto is not a tape badge.
5. **Fallback:** if judge fails / rate-limited, Engine `composeFromText` / engine path remains complete (`provenance: heuristic`).

## Non-emits

- Scenario masses, Brier, IRF, crowding/confirmation, calibrated probs  
- Fan-chart / MC bands  
- Free-form “BUY X N%”

*Locked for ML/AI schema versioning 2026-09-14. No `src/` edits in this pass.*
