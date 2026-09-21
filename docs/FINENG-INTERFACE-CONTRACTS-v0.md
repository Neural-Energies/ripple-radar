# FinEng interface contracts v0

**Product:** Ripple Radar  
**Date:** 2026-09-14  
**Status:** **Docs only** — no `src/` kernels, no commits, no npm. UI-bindable + Engine-seam contracts for CoS greenlight.  
**Owners:**

| Lane | Owns |
|---|---|
| **FinEng** | Math kernels, refuse rules, factor weights, mass provenance semantics |
| **Engine** | Wire / join-on-id / persist / graph pass-through; mint `snapshotId` on material change |
| **DS** | Freeze-at-T ledger (`InfoSetSnapshot`, `infoSetHash`), evidence class/direction/weight, Brier semantics |
| **ML** | `llm_proposal` only on analyze/rescore; never writes `calibrated` |
| **UX** | Bind empties / progressive slots; display ×100; never invent mass or BUY-% strings |

**Baselines:** [`MODEL-DESIGN-v0.1.md`](./MODEL-DESIGN-v0.1.md) · [`FREEZE-AT-T-SCHEMA-v0.md`](./FREEZE-AT-T-SCHEMA-v0.md) · [`ENGINE-INTERFACE-CONTRACTS-v0.md`](./ENGINE-INTERFACE-CONTRACTS-v0.md) · [`ENGINE-CAPABILITY-GAP.md`](./ENGINE-CAPABILITY-GAP.md) FinEng §3–§5 · [`MODEL-ROUTING-BUDGETS-v0.md`](./MODEL-ROUTING-BUDGETS-v0.md) (`llm_proposal` path only)

**Recent Engine fact (accepted):** `NodeKind` includes `"crypto"`; BTC/ETH `kind: "crypto"` — **not** commodity. FinEng rank/stress/export must preserve `TradeCategory:"crypto"` + `NodeKind:"crypto"`.

---

## Hard rules

1. **Graph-first.** No ticker-first books. Mode B hydrate that attaches instruments without a governing `CausalLink` path is refused by `rankExposures` / export.
2. **P ≠ importance.** `probability` / scenario mass never copied into `importance`; triage/`marketMoving`/judge `confidence` never become likelihood weights.
3. **Never `BUY X 87%`.** No FinEng/Engine helper may format ``BUY ${ticker} ${p}%`` as a recommendation. Point mass without provenance is not a trade signal.
4. **Provenance** on every exported mass: `heuristic | llm_proposal | calibrated`. `calibrated` **requires** `snapshotId` and/or ledger id (`InfoSetSnapshot.snapshotId`). ML rescore/analyze → `llm_proposal` only.
5. **Ledger mass 0–1, Σ≈1 (±ε).** Desk may display ×100 integers — **display only**, never hash input, never kernel input. `infoSetHash` canonicalizes mass at **fixed 6 decimal places** (see freeze schema).
6. **Crypto first-class:** `TradeCategory:"crypto"` + `NodeKind:"crypto"`. No silent coerce to `commodity` in rank/stress/export inputs.
7. **Refuse post-T.** Any consumer bound to `asOf = T` / `snapshotId` refuses evidence, quotes, prints, or panels with availability **> T**. Delayed stays delayed.

---

## P0 contracts (UI-bindable + Engine seams)

Only the APIs below are P0. Placeholders in §P1/P2 are typed so UX keeps progressive slots reserved — FinEng does **not** claim they ship.

### Shared enums / scales (reuse existing; do not fork)

```ts
/** Already in src/data/types.ts — keep distinct; never copy crowding → confirmation. */
type Crowding = "low" | "emerging" | "medium" | "high" | "saturated"
type Confirmation = "none" | "early" | "confirming" | "strong" | "diverging" | "invalidating"
type Liquidity = "high" | "medium" | "thin"
type TradeCategory = "etf" | "stock" | "futures" | "forex" | "commodities" | "crypto"
type ForecastProvenance = "heuristic" | "llm_proposal" | "calibrated"

/** Ledger / kernel scale. Desk display = round(mass * 100). */
type Mass01 = number // ∈ [0, 1]; family book Σ ≈ 1 ± ε (ε = 1e-6 unless Engine ack says otherwise)

/** Existing ProbabilityAudit shape — FinEng fills; Engine persists. Values on Mass01 in kernel I/O. */
interface ProbabilityAudit {
  previous: Mass01
  updated: Mass01
  evidence: string            // evidence id or batch summary ref
  direction: "up" | "down"
  weight: number              // update feature; not calibrated likelihood
  affectedNodes: string[]     // graph node ids
  rescoredAssets: string[]    // tickers rescored after update
}
```

**Crowding ≠ Confirmation:** separate fields on every `RankedExposure` / trade seam. Rank may *weight* both; it must never *alias* them. Pure-function acceptance: high mentions + flat/adverse tape → high crowding + `none`/`diverging`; low mentions + aligned fundamental+market → low crowding + `confirming`/`strong`.

---

### 1. `ScenarioBook` — discrete family scenarios (UX hero / right-column mix)

UX already reserves a **discrete scenario mix** (Σ≈100 display) — not path charts, not fake fans ([`PHONE-ACCEPTANCE-PACK.md`](./PHONE-ACCEPTANCE-PACK.md) B5/E2).

```ts
interface ScenarioMass {
  scenarioId: string          // stable; Engine overlay/rescore join-on-id
  name: string                // family-appropriate label (not universal bull/base/bear)
  mass: Mass01                // ledger scale
  detail?: string
}

interface ScenarioBook {
  eventId: string
  family?: string             // EventFamily when known; crypto has no family — tags + cryptoHonest only
  scenarios: ScenarioMass[]   // Σ mass ≈ 1
  provenance: ForecastProvenance
  /** Present iff provenance === "calibrated" */
  snapshotId?: string
  asOf?: number               // ms UTC; required when bound to freeze
  infoSetHash?: string        // verify on calibrated consume
}
```

**Refuse**

- `scenarios.length === 0` for an on-radar book export.
- Σ mass outside 1 ± ε after normalize (caller must renormalize or replace from hypothesize templates — Engine seam).
- `provenance: "calibrated"` without `snapshotId`.
- Universal bull/base/bear names when `family` is set to a non-generic family (family-appropriate required).

**Acceptance (no UI)**

- Golden family fixture → `ScenarioBook` with ≥2 rows, Σ∈[1−ε,1+ε], stable `scenarioId`s across a no-op rescore join.
- Display helper (Engine/UX): `deskPct(mass) = round(mass * 100)`; sum of desk pct may be 99–101 — **not** re-fed to hash.

---

### 2. `updateScenarios` → posteriors + `ProbabilityAudit[]` + provenance

```ts
interface EvidenceUpdateItem {
  id: string
  evidenceClass: "narrative" | "fundamental" | "market" | "expectation"
  direction: "up" | "down" | "mixed" | "neutral"
  weight: number
  asOf: number                // ms UTC availability
  delayed?: boolean
}

interface UpdateScenariosInput {
  prior: ScenarioBook         // or FrozenScenarioMass[] + provenance from InfoSetSnapshot
  evidence: EvidenceUpdateItem[]
  /** When set, enforce post-T refuse against this freeze clock */
  asOf?: number
  snapshotId?: string
  graphNodeIds?: string[]     // optional: limit affectedNodes
}

interface UpdateScenariosResult {
  scenarios: ScenarioMass[]   // posterior; Σ ≈ 1
  audits: ProbabilityAudit[]  // one per scenario whose mass moved (or full family — implement choice fixed in tests)
  provenance: ForecastProvenance
  /** Kernel never sets "calibrated" from llm_proposal alone */
}

function updateScenarios(input: UpdateScenariosInput): UpdateScenariosResult
```

**Refuse**

- Any `evidence[i].asOf > input.asOf` (or snapshot `asOf`) — post-T peek.
- In-place mutate of an `InfoSetSnapshot`; updates emit a **new** book; freeze append is Engine/DS.
- Triage disposition / judge `confidence` / `marketMoving` as likelihood.
- Promoting `heuristic` or `llm_proposal` prior → result `provenance: "calibrated"` without ledger calibration path + `snapshotId`.
- Inventing calibrated likelihoods from lexicon class labels (class/direction/weight are **priors / features** only).

**Accept / emit**

- Dirichlet/Bayesian (or documented conjugate) posterior + filled `ProbabilityAudit` (`previous`, `updated`, `evidence`, `direction`, `weight`, `affectedNodes`, `rescoredAssets`).
- Identical `(prior, evidence[])` → identical audits (pure / seeded).
- ML rescore proposals may *feed* as evidence-shaped shifts only if marked `llm_proposal`; they do not bypass audit.

**Acceptance (no UI)**

- Unit: frozen prior π + batch → Σ posterior ≈ 1; audit `previous`/`updated` match before/after per `scenarioId`.
- Unit: evidence with `asOf > T` → throw/refuse code, no partial write.
- Unit: input provenance `llm_proposal` → output provenance ≠ `calibrated`.

---

### 3. `ProbabilityExport` — provenance-gated public mass

```ts
interface ProbabilityExport {
  eventId: string
  /** Book-level mass (e.g. top scenario or event probability) — Mass01 */
  probability: Mass01
  importance: number          // separate field; not derived as copy of probability in this export
  scenarios: ScenarioMass[]
  provenance: ForecastProvenance
  snapshotId?: string         // REQUIRED when provenance === "calibrated"
  ledgerId?: string           // alias OK if Platform uses distinct score/ledger key
  asOf?: number
  infoSetHash?: string
}

function exportProbability(book: ScenarioBook, opts?: { importance: number }): ProbabilityExport
```

**Refuse**

- `provenance: "calibrated"` when `snapshotId` / ledger id missing.
- Any export string matching recommendation pattern `BUY <TICKER> <N>%`.
- Collapsing `importance` into `probability` (or the reverse) in the exported object.

**Acceptance (no UI)**

- Rescore/analyze path can only produce `llm_proposal` (or leave `heuristic` from engine fallback).
- Calibrated export round-trip requires `snapshotId` + matching `infoSetHash` verify (DS algorithm).

---

### 4. `rankExposures` — six-factor vector

```ts
interface ExposureFactorVector {
  distance: number            // causal hop / RippleLevel numeric
  confidence: number          // from governing CausalLink.confidence — Engine passes through
  confirmation: Confirmation  // enum; ≠ crowding
  crowding: Crowding          // enum; ≠ confirmation
  liquidity: Liquidity
  horizon: string             // prose OK at P0; numeric lag moments = later FinEng estimator
}

interface RankedExposure {
  ticker: string
  name: string
  side: "long" | "short"
  category: TradeCategory     // "crypto" preserved for BTC/ETH paths
  nodeKind?: "crypto" | string
  factors: ExposureFactorVector
  score: number               // FinEng-owned aggregate; weights documented in impl pass
  causalPath: string          // Event→…→ticker; never ticker-first
  invalidation?: string
  governingLinkId?: string    // Engine link identity when available
}

interface RankExposuresInput {
  eventId: string
  /** Graph-first book: nodes + links + candidate trades */
  links: Array<{
    source: string
    dest: string
    distance: number
    confidence: number
    /** ticker at expression end when applicable */
  }>
  candidates: Array<{
    ticker: string
    name: string
    side: "long" | "short"
    category: TradeCategory
    nodeKind?: string
    crowding: Crowding
    confirmation: Confirmation
    liquidity: Liquidity
    horizon: string
    distance: number
    causalPath: string
    invalidation?: string
  }>
  asOf?: number
}

function rankExposures(input: RankExposuresInput): RankedExposure[]
```

**Refuse**

- Ticker-first candidates (`causalPath` empty or not event-rooted).
- `category: "crypto"` coerced to `"commodities"` / `nodeKind` coerced to `"commodity"`.
- Writing `factors.crowding` into `factors.confirmation` (or identical enum abuse).
- Using post-T market prints when `asOf` set.

**Acceptance (no UI)**

- Output length = eligible candidates; stable sort under fixed weights.
- Golden: change **only** `crowding` → documented reorder; `confirmation` unchanged on those rows.
- `factors.confidence` equals governing link confidence (Engine seam).
- BTC/ETH row retains `category: "crypto"`.

---

### P1 / P2 placeholders (not P0 implement — UX slot reserve only)

| Type / API | Priority | UX slot | FinEng note |
|---|---|---|---|
| `ScenarioBands { scenarioId, p10, p50, p90, horizon }` | **P1** | Progressive envelope slot ([PHONE E3](./PHONE-ACCEPTANCE-PACK.md)) — keep empty; **do not** paint fake bands | Needs MC/particle + evidence model; no single point “87%” |
| `intervene(graph, { player, move })` / SCM-lite | **P1** | None until Engine `cloneGraph` lands | Engine owns rewrite API; FinEng owns algebra |
| `counterfactual(book, intervention \| scenarioId)` | **P2** | Thesis / CF pointer empty | Depends on intervene + freeze as-of |
| `stress(book, holdings, scenarioWeights)` → loss **bands** | **P2** | Portfolio illustrative only today | Scenario-conditional bands; ≤T returns; no NAV fiction |

```ts
/** P1 — do not implement in P0. UX may reserve empty progressive slot. */
interface ScenarioBands {
  scenarioId: string
  p10: Mass01
  p50: Mass01
  p90: Mass01
  horizon: string
  provenance: ForecastProvenance // never calibrated without ledger
}

/** P1 — signature only. */
declare function intervene(
  graph: unknown,
  op: { player: string; move: string }
): { links: unknown[]; inactivatedEdgeIds: string[] }

/** P2 — signature only. */
declare function counterfactual(
  book: ScenarioBook,
  spec: { intervention?: { player: string; move: string }; scenarioId?: string },
  asOf?: number
): { deltaRanks: unknown; deltaLinkConfidences: unknown }

/** P2 — signature only; emit bands, not BUY-% points. */
declare function stress(
  book: ScenarioBook,
  holdings: Array<{ ticker: string; weight: number }> | "equalWeight",
  scenarioWeights: Mass01[],
  asOf?: number
): { scenarioId: string; lossP10: number; lossP50: number; lossP90: number }[]
```

---

## Alignment table (P0 → partners)

| P0 API | Engine contract | DS `InfoSetSnapshot` | ML `llm_proposal` | UX empty / bind |
|---|---|---|---|---|
| `ScenarioBook` | Stable `Scenario.id`; join-on-id overlay; mass 0–1 in ledger / hash | `scenarios[]` → `FrozenScenarioMass`; `provenance`; `asOf` / `infoSetHash` | Analyze/rescore may propose renames/shifts but **must join id**; proposal ≠ calibrated book | Hero / right-column **discrete mix** (B5/E2); desk ×100 display |
| `updateScenarios` | Persist filled `ProbabilityAudit`; append freeze on material change; no in-place snapshot mutate | Evidence batch class/direction/weight; post-T refuse; new snapshot on freeze | May supply proposal shifts as non-calibrated input only | Scenario strip updates from posterior mass; no confidence→% |
| `ProbabilityExport` | Provenance flag on probability writes; refuse calibrated without ledger id | `snapshotId` + hash verify for calibrated | Success path stamps `llm_proposal`; offline → `heuristic` via `composeFromText` | Show provenance chip / empty calibrated badge until ledger live |
| `rankExposures` | Pass `CausalLink.confidence`; keep crowding≠confirmation fields; crypto kind fidelity | Optional quality labels later (P1); as-of on score | — (no LLM rank) | Dist / confirmation / crowding chips separate (B3); factor vector when bound |
| Crowding ≠ Confirmation enums | Rank API asserts distinct fields ([ENGINE-INTERFACE-CONTRACTS](./ENGINE-INTERFACE-CONTRACTS-v0.md)) | Narrative uniqueness features later | — | Separate chips — never merged “conviction” |

---

## Conflicts vs Engine contracts

| Topic | Finding |
|---|---|
| Crypto `NodeKind` | **Aligned.** Engine contracts + `types.ts` have `"crypto"`; BTC/ETH not commodity. FinEng P0 mirrors that. *(Gap-matrix handshake “Engine current” row still shows pre-pass commodity coerce — stale vs Engine contracts doc; FinEng follows Engine contracts.)* |
| Mass 0–1 + 6dp hash | **Aligned** with freeze schema + Engine locked freeze row. Desk `Scenario.probability` today is display-ish 0–100 — conversion seam is Engine/UX; FinEng kernels speak Mass01 only. |
| Provenance / join-on-id / confidence-into-rank | **Aligned** with [`ENGINE-INTERFACE-CONTRACTS-v0.md`](./ENGINE-INTERFACE-CONTRACTS-v0.md). |
| `ProbabilityAudit` scale | Existing type is bare `number`; FinEng contract fixes kernel I/O as Mass01. No Engine conflict — implement pass must not double-scale (×100 then treat as 0–1). |
| Intervene / bands / stress | Engine marks graph mutate + MC as future; FinEng marks **P1/P2** — **no conflict**. |

---

## Open blockers (CoS)

**None for this contract greenlight.**

Notes (not FinEng blockers):

- DS mass 0–1 + 6dp default awaits Engine/Platform ack — FinEng already matches; escalate only if they reject.
- `snapshotId` mint ownership (Engine vs Platform) is persist wiring — outside FinEng math.
- P0 impl still needs CoS assign (kernels + Engine wire); **docs contract itself is ready**.

---

*FinEng interface contracts v0 — 2026-09-14. Documentation only.*
