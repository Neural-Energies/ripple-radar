# Freeze-at-T / info-set snapshot schema (v0)

**Product:** Ripple Radar  
**Date:** 2026-09-14  
**Status:** Draft sketch / **no implementation** — docs only. FinEng asked DS for this joint contract so `updateScenarios`, IRF, and Brier can refuse post-T peeks.

---

## Owners

| Role | Owner | Owns |
|---|---|---|
| Schema + scoring semantics | **DS** | Field meanings, `infoSetHash` algorithm, label≠calibrated rules, Brier/resolution semantics |
| Consumer contracts | **FinEng** | `updateScenarios` / IRF / Brier refuse rules; Dirichlet / IRF kernels that consume frozen rows only |
| Persist wiring | **Engine** | Append path into the ledger; join-on-id overlays; never mutate scored rows (later) |
| Store | **Platform** | Durable append-only store / keys (later; may own physical persistence) |

DS does **not** implement persist or FinEng math. Engine does **not** redefine scoring semantics. This sketch proposes extensions; it does **not** claim these types already exist in `src/`.

---

## Invariants

1. **Append-only.** Snapshots and scored rows are never rewritten. Forward books may be recomputed; historical ledger rows are immutable.
2. **As-of refuse post-T.** Any consumer that accepts `asOf = T` (or a `snapshotId` frozen at T) **must refuse** evidence, quotes, resolutions, or market prints with timestamp / availability **> T**. Delayed feeds remain delayed (`delayed: true`); delayed-compatible crypto only.
3. **Provenance is first-class.** Scenario mass / probability on a snapshot carries `ForecastProvenance`. LLM numbers alone are never `calibrated`.
4. **Label ≠ calibrated probability; importance ≠ probability.** Triage disposition (`onRadar` | `watch` | `drop` | `duplicate`) is optional snapshot **metadata only** — never a FinEng math input. Judge/confidence labels are not Brier inputs.
5. **Resolution never mutates the snapshot.** `ResolutionRecord` / scored forecast rows **point at** `snapshotId`; they append outcomes and scores.

---

## Alignment with existing types (propose extensions)

Existing (do not abandon):

```ts
// evidence.ts / types today
EvidenceClass = "narrative" | "fundamental" | "market" | "expectation"

ProbabilityAudit {
  previous, updated, evidence, direction, weight, affectedNodes, rescoredAssets
}

// thin precursor — superseded for the ledger by InfoSetSnapshot below
ForecastSnapshot { at, probability, importance, scenarioTop, evidence }

// EvidenceItem already has evidenceClass, direction, weight, delayed, etc.
```

This sketch **extends** the ledger surface. `ForecastSnapshot` remains a compose-time precursor; the append-only ledger uses `InfoSetSnapshot`.

---

## TypeScript-like interfaces (sketch)

```ts
/** How scenario mass / probability on this snapshot was produced. */
type ForecastProvenance = "heuristic" | "llm_proposal" | "calibrated"

/**
 * Optional triage metadata — desk/routing only.
 * NOT an input to FinEng.updateScenarios / IRF / Brier.
 */
type TriageDisposition = "onRadar" | "watch" | "drop" | "duplicate"

/** One evidence item frozen into the info-set at T. */
interface FrozenEvidenceRef {
  id: string
  evidenceClass: EvidenceClass // "narrative" | "fundamental" | "market" | "expectation"
  direction: "up" | "down" | "mixed" | "neutral" // align with existing EvidenceItem direction enums
  weight: number // prior strength / update weight FinEng may consume; not a calibrated likelihood
  delayed?: boolean // true ⇒ delayed-policy feed; crypto only when delayed-policy compatible
  asOf: number // ms UTC; evidence available_time ≤ snapshot.asOf
}

/** Scenario prior mass frozen at T. Ledger scale: 0–1 with Σ priorMass ≈ 1 (±ε). Desk may display ×100 — display only, not hash input. */
interface FrozenScenarioMass {
  scenarioId: string // stable across rescores; Engine join-on-id
  priorMass: number
}

/**
 * Append-only info-set snapshot at freeze time T.
 * snapshotId is the ledger key; never reuse, never overwrite.
 */
interface InfoSetSnapshot {
  snapshotId: string // append-only unique id
  eventId: string
  asOf: number // ms UTC freeze clock T
  infoSetHash: string // see algorithm below
  scenarios: FrozenScenarioMass[]
  evidenceBatch: FrozenEvidenceRef[] // batch ids with class / direction / weight
  probability: number // book-level mass at T; interpret with provenance
  importance: number // ≠ probability
  family?: string // EventFamily when known
  provenance: ForecastProvenance
  createdAt: number // ms UTC wall append time (may differ from asOf)
  /** Optional desk metadata — ignored by FinEng math kernels */
  triageDisposition?: TriageDisposition
}

/**
 * Scored / resolved row. Points at a frozen snapshot; never mutates it.
 */
interface ResolutionRecord {
  scoreId: string // append-only
  snapshotId: string // FK → InfoSetSnapshot.snapshotId
  eventId: string
  outcome: string // resolved scenario id or outcome label
  brier?: number // when scored
  scoredAt: number // ms UTC; may be > snapshot.asOf (resolution arrives later)
  // never: mutate snapshot fields, rewrite priorMass, or backfill post-T evidence into the snapshot
}

/** Alias for learning-ledger consumption (same row shape). */
type ScoredForecast = ResolutionRecord
```

Required FinEng consumption fields (checklist):

| Field | On |
|---|---|
| `asOf` | `InfoSetSnapshot` |
| `infoSetHash` | `InfoSetSnapshot` |
| `scenarioId → priorMass` | `FrozenScenarioMass[]` |
| evidence batch ids + class / direction / weight | `FrozenEvidenceRef[]` |
| `provenance` enum | `InfoSetSnapshot.provenance` |
| append-only snapshot id | `InfoSetSnapshot.snapshotId` |

---

## `infoSetHash` definition

**Purpose:** Content-address the info-set so consumers can detect drift / peeking and bind scores to a specific evidence+prior bundle.

**Canonical input (prose algorithm — no runnable code in this pass):**

1. Collect all `evidenceBatch[].id`, sort lexicographically ascending (UTF-8 byte order).
2. Collect all `scenarios` as pairs `(scenarioId, priorMass)`, sort by `scenarioId` ascending; format each `priorMass` with a fixed decimal canonicalization (e.g. fixed precision, no trailing scientific notation) agreed at implement time.
3. Take snapshot `asOf` as the decimal ms UTC integer string exactly as stored on the row (no scientific notation).
4. Build a canonical string by joining, with a reserved separator that cannot appear in ids (e.g. `\u001f`):
   - `asOf`
   - sorted evidence ids (joined)
   - sorted `scenarioId=priorMass` pairs (joined)
5. Hash that canonical UTF-8 string with a collision-resistant digest (e.g. SHA-256); store lowercase hex as `infoSetHash`.

**Non-inputs to the hash:** `probability`, `importance`, `provenance`, `family`, `triageDisposition`, `createdAt`, `snapshotId`. Those may change labeling/routing without redefining the mathematical info-set; if mass or evidence changes, a **new** snapshot is appended with a new hash.

**Verify on read:** Recompute hash from stored `asOf` + `evidenceBatch` + `scenarios`; mismatch ⇒ refuse consume (treat as corrupt / tampered).

---

## Consumer refuse rules (FinEng)

These apply to **FinEng** kernels that take a frozen snapshot (or `asOf = T`). DS defines the semantics; FinEng enforces at the consumer boundary.

### `FinEng.updateScenarios(prior, evidence[])`

- **Refuse** if any evidence item in the batch has `asOf` / availability **>** snapshot `asOf` (post-T peek).
- **Refuse** if caller attempts to mutate an existing `InfoSetSnapshot` in place; updates produce a **new** posterior book and (when freezing) a **new** append-only snapshot.
- **Refuse** to treat `provenance: "llm_proposal"` or `"heuristic"` inputs as already `calibrated` without a separate calibration path / ledger id.
- **Refuse** triage disposition / judge confidence as likelihood weights.
- Evidence `weight` + `evidenceClass` + `direction` are the intended update features; lexicon classes remain **priors**, not invented calibrated likelihoods.

### IRF / historical-replay

- **Refuse** panel prints, returns, or curve points with timestamp **> T**.
- **Refuse** replay that silently upgrades delayed series to same-session when `delayed: true` was frozen.
- Graph impulse / local projection under as-of must bind to `snapshotId` or equivalent `(eventId, asOf, infoSetHash)`.

### Brier / live calibration

- Score **only** against a frozen `InfoSetSnapshot` via `ResolutionRecord.snapshotId`.
- **Refuse** to recompute Brier after rewriting snapshot probability / scenarios / evidence.
- **Refuse** post-T evidence when attributing skill to the forecast at T.
- Fixture `MODEL_STATS` remains labeled frozen / pedagogical — never merge into live Brier without clear separation.

---

## Migration note

Today’s `ForecastSnapshot { at, probability, importance, scenarioTop, evidence }` is a **thin precursor** written once at compose (`snapshotOf` / `compose.ts`). It lacks:

- append-only `snapshotId`
- `infoSetHash`
- structured `scenarioId → priorMass`
- evidence batch refs with class / direction / weight
- `provenance`
- separation of resolution / scored rows

**This sketch supersedes `ForecastSnapshot` for the learning ledger.** Compose may keep emitting the thin type until Engine wires persist; the ledger contract for FinEng/DS scoring is `InfoSetSnapshot` + `ResolutionRecord`. Do not claim the new types exist in `src/` until an implementation pass.

---


---

## Data Eng — as-of / replay v0 handshake (2026-09-14)

**Alignment:** Data Eng owns append-only `obs_headline` / `obs_quote` + `buildDeskAsOf(T)`. DS owns calibration/learning on info-set I(T).

**Clock contract (accepted):**
- `asOf` / `event_time` / `available_time` stored as **ms UTC** (integer). ET labels are presentation-only.
- Thin `ForecastSnapshot` precursor must freeze into ledger `snapshotId` + `asOf` ms (see `InfoSetSnapshot`).


### Step 1 greenlight (dual clocks only — 2026-09-14)

Joshua/CoS greenlit Data Eng step 1: dual clocks / types / honest `delayed` stamps. **No freeze ledger yet.**

| Surface | Field | Type | Notes |
|---|---|---|---|
| TS `EvidenceItem` / live types | `eventTimeMs` | number | ms UTC; event/print time |
| | `availableTimeMs` | number | ms UTC; ingest watermark; gates as-of |
| | `delayed` | boolean | honest; must not stay hardcoded `false` |
| | `time` | string | ET presentation-only (optional keep) |
| Obs log (if SQL) | `event_time` / `available_time` / `delayed` / `obs_id` | | snake_case OK in store; map ↔ camelCase in TS |
| Not in step 1 | `snapshotId`, `infoSetHash`, scenario masses, Brier rows | | freeze ledger later |

**DS fields required to score without future leak** — see companion note in agent handshake; refuse any obs with `available_time > T` when building I(T).

## Open questions (Engine / Platform)

1. **Who mints `snapshotId` and when?** Engine on material probability/scenario/evidence change vs Platform store on first durable write? Need a single append API so overlay/rescore cannot replace in place.
2. **Physical store & keying:** Platform table/stream shape — partition by `eventId`, secondary by `asOf` / `infoSetHash`? Retention and fixture isolation from live desk rows?
3. **Mass scale & hash precision:** ~~open~~ → **DS proposed default (awaiting Engine/Platform ack):**
   - Ledger stores `priorMass` and snapshot `probability` on **0–1** scale (Σ `priorMass` ≈ 1 ± ε).
   - Desk/UI may show 0–100 integers — **display-only**, never fed into `infoSetHash` or FinEng kernels.
   - `infoSetHash` canonicalizes each mass with **fixed 6 decimal places** (no scientific notation); Engine and FinEng must match this exact formatting.
   - Escalate to CoS only if Engine/Platform cannot accept 0–1 + 6dp.

---

*DS schema sketch for FinEng freeze-at-T consumption. Documentation only — no `src/` edits, no commits in this pass.*
