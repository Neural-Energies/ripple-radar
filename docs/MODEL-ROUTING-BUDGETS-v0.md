# Model routing + budgets (v0)

**Product:** Ripple Radar  
**Date:** 2026-09-14  
**Status:** Design sketch — **docs first**; thin TypeScript stub at `docs/stubs/routing-v0.ts` (not wired into `src/`). No training. No fake confidence scores.  
**Owner:** Ripple ML/AI  
**Partners:** DS (judge labels / cheap gates), Engine (compose fallback + call sites), FinEng (provenance consume), Platform (durable budgets later), UX (hero `models disagree` empty), Roadmap (track)  
**Baseline:** [`MODEL-DESIGN-v0.1.md`](./MODEL-DESIGN-v0.1.md), [`CLUSTER-JUDGE-SCHEMA-v0.md`](./CLUSTER-JUDGE-SCHEMA-v0.md), [`ENGINE-CAPABILITY-GAP.md`](./ENGINE-CAPABILITY-GAP.md) §A

---

## 1. Goals

1. Decide **which path** handles each task: deterministic rules vs cheap LLM vs deep LLM.
2. Bound **latency and cost** so Mode A tape never stalls the desk.
3. Degrade honestly when **offline / no `XAI_API_KEY` / budget exhausted**.
4. Keep **label ≠ calibrated probability** — ordinal judge confidence is routing only.

Non-goals this pass: training, embedding clusterer, FinEng calibration kernels, UI chrome, live API evals.

---

## 2. Task classes

| Task id | When | Input | Output contract | Default path |
|---|---|---|---|---|
| `gate` | Every cluster / headline before any LLM | text + tags | keep / soft-reject (`relevance.ts`) | **Deterministic** |
| `cluster` | Mode A tape merge | headlines | clusters | **Deterministic** (lexical Jaccard today; DS embeddings later — still not LLM) |
| `judge` | After gate keep | cluster + evidence titles | [`ClusterJudgeLabel`](./CLUSTER-JUDGE-SCHEMA-v0.md) | **Cheap LLM** (optional dual-sample) |
| `analyze` | Mode B user “Analyze this event” | free text + related tape | complete `RadarEvent`, `provenance: llm_proposal` or `heuristic` | **Deep LLM** → engine fallback |
| `narrative` | Optional blotter copy on rescore / research | book + live headlines/quotes | short narrative / takeaway, `llm_proposal` | **Cheap or deep LLM** (budgeted) |
| `rescore` | Optional book refresh | book + live evidence | proposal shifts only, `provenance: llm_proposal` | **Deep LLM** → **unchanged prior** (not calibrated write) |
| `ensemble_probe` | Optional when judge `confidence` would be high-stakes | same as judge | disagreement flag for UX `models disagree` | **2× cheap LLM** (same schema) |

**Deterministic forever (never route to LLM):** soft-news reject, ontology `familyOf` fallback when judge omits/fails family, liquid ticker attach, graph TRANSMIT hops, FinEng math kernels, freeze-at-T ledger writes.

---

## 3. Routing matrix

### 3.1 Model classes (logical — map to xAI ids in config)

| Class | Role | Candidate (v0) | Typical max_tokens | Temp |
|---|---|---|---|---|
| `rules` | No model | — | 0 | — |
| `cheap` | Triage judge, dual-sample, short narrative | `grok-4.5` **or** smaller/faster id when available — config key `RIPPLE_MODEL_CHEAP` | 400–700 | 0.1–0.2 |
| `deep` | Full analyze book, rescore proposal | `grok-4.5` — config key `RIPPLE_MODEL_DEEP` (today’s hardcoded id) | 1800–2400 analyze / 700 rescore | 0.2–0.25 |

Until a distinct cheap model id exists, `cheap` and `deep` may point at the same model **but still use different budgets, token caps, and prompts**. Routing is about **path policy**, not only vendor SKU.

### 3.2 Decision table

| Task | If gate reject | If no `XAI_API_KEY` | If budget deny | If timeout / HTTP / parse / schema fail | Success provenance |
|---|---|---|---|---|---|
| `gate` | n/a | rules | rules | rules | — |
| `cluster` | n/a | rules | rules | rules | — |
| `judge` | **never call** | engine heuristic disposition (`watch` or omit chip) | same | engine heuristic; no fake `very_high` | label only (not calibrated) |
| `analyze` | n/a | `composeFromText` → `source: engine`, `heuristic` | same | same | `llm_proposal` if model OK |
| `narrative` | n/a | skip / empty string | skip | skip | `llm_proposal` copy only |
| `rescore` | n/a | **unchanged prior** (`provenance: unchanged` / leave book) | unchanged prior | unchanged prior | `llm_proposal` proposal only |
| `ensemble_probe` | never | skip (no disagree chip) | skip | skip / treat as no disagreement | disagreement bool only |

### 3.3 Router API (sketch)

```ts
type RouteTask =
  | "judge"
  | "analyze"
  | "narrative"
  | "rescore"
  | "ensemble_probe"

interface RoutePlan {
  task: RouteTask
  class: "rules" | "cheap" | "deep"
  model: string | null // null ⇒ rules / offline
  maxTokens: number
  temperature: number
  timeoutMs: number
  schemaVersion: string // e.g. "cluster-judge/v0" | "analyze/v0" | "rescore/v0"
  allowEnsemble: boolean
}

function route(task: RouteTask, ctx: { hasXaiKey: boolean; budgetOk: boolean }): RoutePlan
```

Soft-news / `keep: false` clusters are **filtered before** `route("judge")` is invoked (Engine + DS gates).

---

## 4. Cost + latency budgets

### 4.1 Per-path targets (v0 — single process; durable later)

| Task | Latency budget (p95 wall) | Min gap / concurrency | Token budget (in+out, soft) | Daily soft cost cap (share) |
|---|---|---|---|---|
| `gate` / `cluster` | &lt; 5 ms CPU | unlimited | 0 | 0 |
| `judge` | ≤ 8 s | 1 in-flight global **or** 20/min shared LLM pool | ≤ 1.2k | ~40% of LLM budget |
| `ensemble_probe` | ≤ 12 s (2× cheap parallel) | only if first judge `confidence` ∈ {high, very_high} **and** disposition ∈ {onRadar, watch} | 2× judge | counted in judge share |
| `analyze` | ≤ 28 s (matches today’s timeout) | **45 s** min gap (today) → keep; stamp **only on accepted model result** | ≤ 4k | ~35% |
| `narrative` | ≤ 8 s | share analyze/rescore pool | ≤ 800 | ~5% |
| `rescore` | ≤ 25 s | **90 s** per `eventId` (today) | ≤ 1.5k | ~20% |

**Offline / no key:** all LLM shares = 0; desk runs gate → cluster → compose only. Mode B analyze still returns a **complete** event via engine. Rescore returns unchanged prior (no hard error once stub lands — today’s hard fail is a gap to close).

### 4.2 BudgetGate (sketch)

```ts
type BudgetDenyReason = "no_key" | "cooldown" | "concurrency" | "daily_cap" | "offline"

interface BudgetDecision {
  allow: boolean
  reason?: BudgetDenyReason
  retryAfterMs?: number
}

// Pure + injectable clock; process-local Maps OK for v0 stub.
function allow(task: RouteTask, key: string, now: number): BudgetDecision
```

Under deny: follow §3.2 — **never invent confidence**; prefer engine / unchanged / skip.

### 4.3 Shared pool

Mode A `judge` and Mode B `analyze`/`rescore` share one process-local LLM semaphore (v0 size = 1). Prefer **analyze** (user-initiated) over background judge when both contend; queue or skip judge with heuristic fallback.

---

## 5. Label schema alignment (DS)

**Locked emit:** [`CLUSTER-JUDGE-SCHEMA-v0.md`](./CLUSTER-JUDGE-SCHEMA-v0.md)  
**Handshake frozen 2026-09-14:** DS confirmed no field changes; ML/AI routing rules accepted (no confidence→desk %, ensemble only `onRadar`|`watch`, conservative disagree merge, `cryptoHonest` only when delayed-policy compatible, `schemaVersion: cluster-judge/v0` on every label). Docs only until CoS go.

ML/AI router commitments:

| Field | Routing use |
|---|---|
| `schemaVersion: "cluster-judge/v0"` | Reject mismatched payloads → engine heuristic |
| `disposition` | UX chip; ensemble only for `onRadar` \| `watch` |
| `marketMoving` | Optional escalate to deep narrative later — **not** probability |
| `family` | If missing/invalid → Engine `familyOf` |
| `confidence` | Ordinal only: `low` \| `medium` \| `high` \| `very_high`. High/very_high may trigger `ensemble_probe`. **Never** mapped to desk `%` |
| `why` | Eval / desk tooltip; truncated |
| `cryptoHonest?` | Must be true to treat crypto narrative as first-class; else ontology-only |

Ensemble disagreement (UX muted `models disagree`):

- Run second cheap judge with same schema.
- Disagree if `disposition` differs **or** `family` differs **or** `marketMoving` differs.
- On disagree: keep **more conservative** disposition (`drop` &lt; `duplicate` &lt; `watch` &lt; `onRadar`), set confidence down one ordinal step (floor `low`), set `modelsDisagree: true` for hero chip.
- **Never** raise confidence because two samples agreed.

---

## 6. Offline / no-key behavior (acceptance)

| Path | Required behavior |
|---|---|
| Live desk build | Completes via RSS + compose; no throw |
| Judge | Skipped; disposition empty or heuristic `watch` without claiming model |
| Analyze | Complete `RadarEvent`, `source: "engine"` / `heuristic` |
| Rescore | Unchanged prior (target); today’s API error is **debt** tracked in gap matrix D.2 |
| UX | Empties for disposition / models-disagree / provenance — no invented values |

---

## 7. Thin stub

See `docs/stubs/routing-v0.ts` — pure `route()` + `allow()` with injectable clock. **Not imported** by `src/` until CoS greenlights implementation.

---

## 8. Open questions (escalate via CoS if product/taste)

1. Prefer skip-judge (empty chip) vs heuristic `watch` when offline?  
2. Same model id for cheap+deep until a smaller SKU exists — OK?  
3. User-initiated analyze preempting Mode A judge — OK as v0 policy?

---

## 9. Hand-off

| Lane | Ask |
|---|---|
| DS | Confirm judge schema lock still current; co-own eval fixtures later |
| Engine | Call `route` only after `keep`; preserve `composeFromText` completeness |
| FinEng | Consume `llm_proposal` only; ignore judge confidence as likelihood |
| UX | Keep muted `models disagree` empty until `modelsDisagree` exists |
| Roadmap | Track: routing doc ✅ → stub ✅ → wire behind flag (blocked on CoS) |
| QA | Later: unit tests for deny→fallback matrix (no live key) |

*Drafted 2026-09-14 by Ripple ML/AI. Docs + stub only.*
