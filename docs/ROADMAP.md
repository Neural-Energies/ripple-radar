# Ripple Radar — Delivery Roadmap

**Status:** Living roadmap (v0.28.1)  
**Owner:** Roadmap steward (Ripple Roadmap)  
**Date:** 2026-09-21  
**STOP WORK (Joshua / CoS):** Freeze all new implementation + **Delivery board** (no new tracks). Finish only already-green in-flight commit/push. No new adapters, no UX freestyle, no dual-clock step 2. CoS Claude handoff → `alpha-recon` — **push waits on Joshua GitHub write token**.  
**Repo:** Neural-Energies/ripple-radar  

This document is the **source of truth for sequencing**. It does not replace Model Design, HANDOFF, or gap matrices — it orders work against them. Update when phase exits change; do not invent ticket IDs or fake metrics.

---

## Product one-liner + slogan

**One-liner:** A general-purpose, event-agnostic intelligence engine that continuously discovers world events, constructs a full research object (scenarios, probabilities, game theory, causal graph, asset discovery, crowding, invalidation, lifecycle), and updates it as evidence arrives.

**Slogan:** *Don't trade the headline. Trade what the headline causes next.*

*(Product name remains Ripple Radar; a better name is open — do not bikeshed here.)*

---

## Non-negotiable invariants

1. **Zero hardcoded production events.** Catalog fixtures (`src/data/catalog.ts`) are calibration/pedagogy only — never the live desk default. Empty desk → `EMPTY_EVENT`.
2. **Causal graph first, then assets.** Never start from a ticker list and reverse-engineer a story. Mode B hydrate must not leak headline→ticker.
3. **Family-appropriate scenarios** (weather / policy / commodity / credit / kinetic / corporate / …) — not a universal bull / base / bear.
4. **Importance ≠ probability.** A low-probability event can be extremely important.
5. **Unknown events must construct a complete `RadarEvent`** with no developer intervention.
6. **No fake tickers.** Attach liquid instruments after the graph exists.
7. **LLM / judge labels ≠ calibrated probability.** Provenance must be `heuristic` | `llm_proposal` | `calibrated`. Never treat Grok integers or triage confidence as Brier inputs.
8. **Never rewrite historical predictions** after outcomes are known. Append-only freeze-at-T; resolutions point at frozen snapshots.
9. **24h delayed / free data policy** for structural multi-day edge — not millisecond headline arb. Delayed feeds stay delayed.
10. **No end-to-end “vibes LLM” product; no MC without an evidence model; no sentiment-as-product; no `BUY X 87%`.**

---

## North star — Model Design v0.1 pipeline

`Information → Narrative → Event probability → Scenarios → Player response → Economic transmission → Bottleneck → Asset discovery → Market confirmation → Reflexivity → Position research`

Operational spine (engine knows HOW, world supplies WHICH):  
`Detect → Understand → Hypothesize → Probabilities → Players → Causal graph → Exposures → Markets → Update → Invalidate → Learn`

---

## Current phase (honest)

**Phase: Foundation shipped + advanced engine v1 still mostly gap.**

| Area | Shipped (honest) | Gap (honest) |
|---|---|---|
| Mode A live desk | RSS world tape + Yahoo sparks → cluster → **relevance gate** → compose → relate; empty → `EMPTY_EVENT` | Jaccard over-merge; no embeddings; cluster IDs not durable |
| Mode B Analyze | Grok JSON + `composeFromText` fallback (complete book without key) | Full-object LLM path; hydrate can leak tickers/probs; rescore treats LLM as truth |
| Research object | Family scenarios Σ≈100, graph L0–4, GT matrix, ranked trades, knowledge/invalidation fields | Heuristic probability; `ProbabilityAudit` stub; GT does **not** rewrite graph |
| Learning | `/learning` + fixture `MODEL_STATS` (bannered not-live) | No append-only freeze ledger; no live Brier; overlay mutates in place |
| FinEng math | — | No Bayesian/Dirichlet, IRF, curves/basis, stress, bands (0 Present in gap score) |
| Schemas (docs) | Model Design v0.1; Cluster Judge v0; Freeze-at-T v0; Routing/budgets v0; capability gap matrices | Docs/stubs only — not wired into `src/` |
| Git signal | `0d1e05c` Initial handoff on `main`; dirty tree with relevance gate, UX/docs WIP | Treat uncommitted work as in-flight, not “released” |

**Exit criteria for leaving “foundation”:** provenance flags + join-on-id overlay; freeze-at-T append path; LLM judge labels-only after cheap gates; FinEng `updateScenarios` consuming frozen evidence only; engine tests in CI; delayed flag meaningful.

---

## Delivery board — active tracks (2026-09-14)

### Schedule note
**Freeze Sep 18–21, 2026:** no overnight ship (CoS). Resume normal overnight cadence after.

### Overnight / near-term mission (Joshua out)
**Mission focus:** mock fidelity + live dynamism (honest live desk vs mockups — no costume numbers).
- Joshua out overnight; CoS runs morning **8am brief**.
- Roadmap / CoS: **escalate immediately** any agent inventing metrics or skipping honesty (fake AUM, fake accuracy, hardcoded events, polished lies on the desk).
- Do not expand scope past greenlit tracks while Joshua is out.
- **Vocab lock:** `docs/RESEARCH-VOCAB-KILL-LIST.md` (Research) — Live Desk/World Tape honesty; not a feature epic. QA phone smoke fails on kill-list labels.
- Ops overnight: Data Eng **step 1 complete**; Platform keep `:8080` healthy (desk-sync parked); QA watch typecheck/engine + phone pack; Research vocab lock above. Steps 2–5 still gated.
- Product overnight: **UX fidelity cut landed** (typecheck green); Engine cluster/relevance + map nav (tests 13/13); FinEng P0 contracts CoS-accepted; DS honesty only (no freeze ledger); **ML thin wire landed** (flag default-off).
- Locks: crypto `kind` (no family); judge schema; `llm_proposal` only; mass scale 0–1/6dp in hash; `models disagree` empty until flag; no invented %.

Joshua decides; CoS assigns; Roadmap prevents drift. **No product feature invent on this track.**

| Track | Owner | Status | Notes |
|---|---|---|---|
| **UX mockup fidelity + phone pack** | UX | **OVERNIGHT CUT LANDED** | Fidelity cut **landed** (typecheck green). `PHONE-ACCEPTANCE-PACK.md` + mockups. **Still awaiting Joshua phone pass.** No fake AUM / accuracy / costume events. |
| **Research vocab lock** | Research | **LOCKED** | `docs/RESEARCH-VOCAB-KILL-LIST.md` — Live Desk/World Tape only. Not a feature epic. QA fails phone smoke if kill-list labels ship. |
| **FinEng P0 UI contracts** | FinEng | **CoS-ACCEPTED (docs)** | `docs/FINENG-INTERFACE-CONTRACTS-v0.md` — ScenarioBook / updateScenarios / ProbabilityExport / rankExposures / crowding≠confirmation. **No kernel wire** until CoS opens. UX binds chrome to these. |
| **Capability gap matrix** | Engine / FinEng / DS (read) · Roadmap (track) | **Docs present** | `docs/ENGINE-CAPABILITY-GAP.md` + `/workspace/engine-v1-gap-matrix.md`. Source for Now→Next→Later cuts. |
| **ML routing + budgets** | ML/AI | **THIN WIRE LANDED** | Branch `ml/model-routing-v0` @ `55455de`. `RIPPLE_MODEL_ROUTING` **default-off**. Push/PR blocked on GitHub write token (local-canonical). **Residual:** process-local budgets; judge not on Mode A tape yet. |
| **Data Eng feeds / info-set** | Data Eng / Platform | **STEP 1 SHIP UNIT READY** | Clean branch `data/dual-clock-step1` @ `4998683` (QA verified; typecheck green; `evidence.test.ts` 5/5; no UX/ML mix). **Push waits on Joshua write token.** Steps 2–5 still hold. |
| **Free Data army** | Data Eng · Free Data · Platform · QA | **FRED LANDED · RSS CLEANUP LANDED · STOP** | FRED+ALFRED @ `4782bce`. RSS dual-clock cleanup PR #2 merged @ `73b75f3` (`eventTimeMs`=pubDate, `availableTimeMs`=ingest watermark). Live FRED still needs Joshua `FRED_API_KEY`. **STOP WORK:** no new adapters / no step 2 / no UX freestyle. |
| **Platform desk-sync** | Platform | **Later / verify** | Auth + PGLite→Postgres desk-sync (HANDOFF gap #7). Not a Now invent track. |
| **QA smoke** | QA | **NOW** | Engine tests in `npm run test`; UI smoke; hydrate completeness fixtures; no fake metrics in gates. |
| **Bayesian / MC / advanced math** | FinEng | **LATER — after gap** | Dirichlet/Bayesian + freeze ledger **before** Monte Carlo bands. Hard no: MC without evidence model. |

### Drift watch (ping CoS if seen)
- Random features / scope not on this board
- Fake metrics / institutional costume numbers on live desk
- Hardcoded production events or `if (event === …)` branches
- UI work by FinEng; ML work by UX (wrong lane)
- ML routing default-on without `RIPPLE_MODEL_ROUTING` flag (thin wire must stay flagged)
- Bayesian/MC jumping ahead of freeze/provenance

## Now / Next / Later

Owners by role. No fabricated ticket IDs. Parallel tracks are intentional (UX chrome vs engine math).

### Now — harden the spine + lock contracts

| Workstream | Owner(s) | Intent |
|---|---|---|
| Invariant guards: provenance on probability/scenario mass; drop Mode B tickers not on graph; rescore → `llm_proposal` only; refuse `calibrated` without ledger id | **Engine**, **ML/AI**, **FinEng** (contract) | Stop painting LLM/heuristic `%` as skill |
| Stable `scenario.id` + evidence ids; overlay/rescore **join-on-id** (no replace-set); fill `ProbabilityAudit` shape for FinEng | **Engine** | Unblocks Bayesian updates |
| Cheap gates before any Mode A LLM; keep lexical relevance; prepare cluster seam for embeddings | **Engine**, **Data Science** | Judge never sees soft-news rejects |
| Cluster Judge schema **locked** → implement labels-only judge **after** gates (`onRadar` / `marketMoving` / `confidence` / `why` / `family`) | **ML/AI**, **Data Science**, **Engine** (compose fallback) | `docs/CLUSTER-JUDGE-SCHEMA-v0.md` locked with routing docs; impl still gated |
| Model routing + budgets (task→cheap/deep/rules; analyze fallback; rescore → unchanged prior) | **ML/AI**, **Platform** (durable budget later) | **Landed** on `ml/model-routing-v0` @ `55455de`, flag default-off. Residuals: process-local budgets; judge not on Mode A tape. Push/PR token-blocked |
| Freeze-at-T: ack mass scale (0–1 + 6dp hash); mint `snapshotId`; append-only persist sketch → first durable write | **Data Science** (semantics), **Engine** (append API), **Platform** (store) | See `docs/FREEZE-AT-T-SCHEMA-v0.md` |
| QA smoke: wire `engine.test.ts` into `npm run test`; UI smoke; golden unseen-family cases (weather/policy/credit/corporate) — never assert real-world event ids | **QA**, **Engine** | Safety net for event-agnostic claim; no fake accuracy gates |
| Hydrate completeness / invent-rate offline fixtures (HANDOFF #3) | **ML/AI**, **QA** | Truncated Grok JSON still yields complete book |
| Data Eng spine: step 1 **ship unit** `data/dual-clock-step1` @ `4998683` → push on write token → **WAIT** steps 2–5 | **Platform** (branch), **Data Eng**, **QA** | CoS: ping when Joshua supplies write token |
| UX mockup fidelity + phone acceptance pack — **overnight cut landed**; phone pass still Joshua | **UX** / Joshua | Typecheck green; `PHONE-ACCEPTANCE-PACK.md` + mockups; no engine invent |
| Product naming / CoS go on FinEng+DS impl starts | **Product**, **Ops** / Joshua | Unblock math after contracts ack’d |

### Next — perception, calibration consumption, confirmation depth

| Workstream | Owner(s) | Intent |
|---|---|---|
| Hybrid / embedding clusterer behind cheap gates (no per-event special cases) | **Data Science**, **Engine** (wire) | Fix sparse-day over-merge |
| Richer extraction + causal-first entity linking; thesis-relative stance (A–D remains prior) | **Data Science** | Feed graph, not ticker lists |
| `FinEng.updateScenarios` Dirichlet/Bayesian kernel + real `ProbabilityAudit` (affectedNodes, rescoredAssets) | **FinEng**, **Engine** (wire), **Data Science** (class labels) | Auditable scenario updates |
| Live Brier / calibration from frozen snapshots (fixture `MODEL_STATS` stays labeled frozen) | **Data Science**, **FinEng** (consume), **Platform** | Progressive learning moat |
| Rank factor vector: distance, link confidence, confirmation, crowding, liquidity, horizon — fields stay distinct | **FinEng**, **Engine** | Model Design ranked exposures |
| Crowding ≠ confirmation with market-structure features (OI/volume/options proxies where free/delayed) | **FinEng**, **Data Eng** | HANDOFF gap #6 |
| Crypto first-class: `NodeKind` / category fidelity; TRANSMIT `from:crypto` / risk-on / liquidity **generically**; delayed crypto evidence | **Engine**, **FinEng**, **Data Science** (honest triage) | Sink-off-rates → real transmission |
| Game theory → graph: `intervene(graph, {player, move})` pure API | **Engine**, **FinEng** (SCM-lite) | Model Design OPEC-shape rewrite |
| Relate noise tighten (shared-token false links) | **Engine** | HANDOFF gap #2 |
| HITL desk labels for judge/family/resolution (labels ≠ probs) | **Data Science**, **Product**, **UX** (minimal capture) | Eval fuel later |
| UX World Tape / clusters DTO + desk layout honesty pass | **UX** | Still UX backlog |

### Later — advanced math, replay, portfolio research

| Workstream | Owner(s) | Intent |
|---|---|---|
| Historical replay (full): compose as-of T from frozen info-set (not timeline slider chrome) | **Engine**, **Data Science**, **FinEng**, **Data Eng** | Data Eng owns **I(T) contract draft now (docs only)**; obs log + compose-as-of only **after CoS greenlight**. Never peek post-T |
| IRF / local projections vs graph impulse under as-of | **FinEng** | Regularize hops with data |
| Options / curves / basis (delayed/free) ingest + features | **Data Eng**, **FinEng** | Market evidence class depth |
| Monte Carlo / particle **bands** (only after evidence model exists) | **FinEng** | Uncertainty envelopes — no fake point “87%” |
| Markov / semi-Markov regimes; Hawkes aftershocks | **FinEng**, **Data Science** (labels/times) | Regime-conditioned kernels |
| Counterfactuals + portfolio stress (scenario-conditional **bands**, not NAV fiction) | **FinEng**, **Product** | Position research end of pipeline |
| Adversarial / propaganda reliability features | **Data Science**, **Research** | Defensive — not a mod product |
| Filings / AIS / prediction-market text as evidence classes | **Data Eng**, **Research** | **CoS-gated only** — after I(T) exists post-greenlight; not before |
| Multi-instance durable LLM budget/cache | **Platform**, **ML/AI** | Scale Mode A judge |
| Name / positioning refresh | **Product** | When asked — not a delivery blocker |
| PWA / signed-in desk-sync verify on Postgres | **Platform**, **Ops**, **QA** | HANDOFF gap #7 |

---

## Explicit out-of-scope / freeze list

| Item | Owner if any | Notes |
|---|---|---|
| Institutional UI redesign / mockup implementation | **UX** | `REDESIGN-AUDIT.md` + `docs/mockups/` — UX-owned; roadmap tracks only honesty/data dependencies |
| Restoring catalog `EVENTS` as live desk | — | **Frozen forbidden** |
| Per-event special-case branches (`if (event === 'hormuz')`) | — | **Frozen forbidden** |
| Hardcoded country/player GameCell keys | — | Cells stay `{a, b, label}` |
| Training / fine-tuning / embedding index build in doc-only passes | **Data Science** when CoS assigns | Gap matrices were docs-only |
| End-to-end vibes LLM replacing compose | — | **Frozen forbidden** |
| Monte Carlo before evidence model | **FinEng** | Hard no until Bayesian/evidence path exists |
| Sentiment / narrativeHeat social-search as a market product | — | Omit or label heuristic until real feeds |
| Fake institutional metrics (AUM, Max DD, live accuracy on desk) | **UX** / all | Red flags in redesign audit |
| Chat / “Ask Ripple” / auto-rescore every poll | — | Analyze + manual rescore + rate limits stay |
| World GIS / geo map without geocoder | **UX** | Region string only |
| Inventing crypto EventFamily without delayed-policy honesty | **Data Science**, **Engine** | Prefer tags + `TradeCategory:"crypto"` until honest |
| Exotic / new delayed evidence classes before I(T) exists (post-greenlight) | **Data Eng** | **Frozen until CoS gates** — docs → greenlight → then maybe new classes |

---

## Open conflicts / decisions needed from Joshua (Chief of Staff)

1. **Go / no-go on implementation** of FinEng kernels + DS freeze persist after docs handshakes (gap matrices say “no impl until CoS assigns”).
2. **Freeze-at-T remaining:** Mass scale **0–1 + 6dp** + Engine mints `snapshotId` on material change — **acked** (Engine/FinEng/DS). Still open: physical store shape / retention / fixture isolation; **freeze ledger impl** still CoS-gated.
3. **Mode B policy:** Keep full-object Grok analyze as optional deep path with strict hydrate guards, or narrow Analyze to proposal fields only (graph always engine)?
4. **24h delayed enforcement:** Soft-label delayed evidence vs hard-refuse same-session confirmation in rank/overlay?
5. **Crypto priority:** Raise “first-class transmission” into Now, or keep Next after Bayesian + freeze?
6. **UX vs engine capacity:** Confirm UX redesign stays parallel and must not block freeze/provenance P0s.
7. **Product name:** Defer indefinitely vs schedule a naming decision?
8. **CI bar:** Require `engine.test.ts` in `npm run test` before any FinEng merge?
9. **ML routing wire:** Thin wire **landed** (`ml/model-routing-v0` @ `55455de`, `RIPPLE_MODEL_ROUTING` default-off). Still open: GitHub push/PR when write token exists; Mode A judge on tape; durable budgets; §8 product Qs / default-on policy.
10. **Phone acceptance pass:** Run `docs/PHONE-ACCEPTANCE-PACK.md` on device — overnight fidelity cut **landed**; phone pass still Joshua.
11. **Data Eng IMPLEMENTATION:** Step 1 ship unit ready — `data/dual-clock-step1` @ `4998683`. **Need Joshua write token to push.** Steps 2–5 still gated.
12. **Free/delayed adapters:** FRED+ALFRED **landed** @ `4782bce`. **Submit `FRED_API_KEY`** for live macro. Other P0s + step 2 hold.
13. **GTM pricing lock:** Pricing pending Joshua before Sales quotes anything (CoS brief delivered; not an eng invent track).
14. **Land `docs/` on GitHub:** **Blocked on GitHub write token** (CoS). Until then `/workspace/ripple-radar/docs/` is canonical (incl. ROADMAP, MODEL-DESIGN, `docs/data/*`). Still docs→wait; no adapters until greenlight.

---

## Change log

| Version | Date | Change |
|---|---|---|
| v0 | 2026-09-14 | Initial living roadmap — anchored to Model Design v0.1, HANDOFF/AGENTS, capability gap matrices, Cluster Judge / Freeze-at-T / Routing schema docs. No fabricated metrics or ticket IDs. |
| v0.1 | 2026-09-14 | Delivery board: UX phone pack in flight; gap matrix tracked; ML routing/budgets NOW (docs+stub, wire blocked on CoS/Joshua §8); Data Eng feeds; Platform desk-sync later; QA smoke; Bayesian/MC later after gap. Drift watch list. |
| v0.2 | 2026-09-14 | Data Eng sequence locked: I(T) replay v0 → non-blocking UX/demo → RSS/Yahoo time stamps + append-only obs log → CoS-gated new evidence classes → feature materialization after I(T). Exotic feeds blocked before replay. |
| v0.3 | 2026-09-14 | UX phone pack → READY (await Joshua phone pass). ML routing docs done-for-now; DS Cluster Judge schema locked; thin wiring still CoS/Joshua-gated. Roadmap steward seated in Product + Ops + Delivery. |
| v0.4 | 2026-09-14 | Data Eng: FEED-INVENTORY done draft; ASOF-REPLAY-v0 design-only; DS+QA delayed-evidence pass in Ops; no new feed adapters until CoS greenlight post-doc. Flag: Model Design present locally, missing on remote GitHub. |
| v0.5 | 2026-09-14 | **Correction:** Data Eng sequence rewritten to CoS-canonical — FEED-INVENTORY in progress → I(T) contract draft only → hard WAIT on obs log/schema/clock/adapters until CoS greenlight; don’t block UX/demo; new classes + feature materialization only post-greenlight. Removed any I(T) implementation-in-progress language. |
| v0.5.1 | 2026-09-14 | Data Eng: DS+QA delayed-evidence pass locked; confirm local `docs/data/` paths; decision #12 (remote docs commit) still open; docs→wait unchanged. |
| v0.5.2 | 2026-09-14 | FEED-INVENTORY includes DS §5c calibration diet; Data Eng still docs→WAIT. |
| v0.5.3 | 2026-09-14 | CoS: docs push blocked on GitHub write token; `/workspace/ripple-radar/docs/` remains canonical until then. |
| v0.6 | 2026-09-14 | Data Eng design pack CoS-approved (FEED-INVENTORY + ASOF-REPLAY-v0). Impl still gated — Joshua decides go/hold on rollout step 1 (dual clocks + types). |
| v0.7 | 2026-09-14 | Joshua greenlit as-of IMPL **step 1 only** (dual clocks on ingest: types + stamps). Data Eng owns. Obs log / buildDeskAsOf / adapters still gated. |
| v0.8 | 2026-09-14 | Joshua out overnight. Mission = mock fidelity + live dynamism. Escalate inventing metrics / honesty skips to CoS. CoS 8am brief. |
| v0.9 | 2026-09-14 | ML thin wire **CoS-greenlit** — in flight on checkout behind `RIPPLE_MODEL_ROUTING` (Cloud Agents unavailable). PR/commit pending from ML/AI. |
| v0.10 | 2026-09-14 | Ops overnight sync: Research vocab kill-list locked (`RESEARCH-VOCAB-KILL-LIST.md`); Platform `:8080` healthy / desk-sync parked; Data Eng dual-clock step 1 mid-flight (typecheck red until stamps done); QA honesty gates on. |
| v0.11 | 2026-09-14 | Product overnight: FinEng P0 contracts CoS-accepted (`FINENG-INTERFACE-CONTRACTS-v0.md`); Engine cluster tighten shipped (13/13); mass-scale 0–1/6dp + snapshotId mint acked; freeze ledger + FinEng kernels still gated; UX fidelity cut in flight. |
| v0.12 | 2026-09-14 | Data Eng dual-clock step 1 **landed** (typecheck green, engine 13/13, honest delayed). Vocab kill-list in phone smoke. Step 2+ still gated. |
| v0.13 | 2026-09-14 | ML thin wire **landed** — `ml/model-routing-v0` @ `55455de`, `RIPPLE_MODEL_ROUTING` default-off. Push/PR token-blocked. Residuals: process-local budgets; judge not on Mode A tape. |
| v0.14 | 2026-09-14 | Data Eng step 1 **DS+QA PASS**; CoS: clean local branch `data/dual-clock-step1` (no UX/ML mix); push token-blocked; step 2 still hold. |
| v0.14.1 | 2026-09-14 | Note: Joshua received readiness/sales/pricing brief; pricing lock still pending before Sales quotes — tracked as Joshua decision, not eng scope. |
| v0.15 | 2026-09-14 | UX overnight fidelity cut **landed** (typecheck green). Phone pass still awaiting Joshua. |
| v0.16 | 2026-09-14 | Dual-clock ship unit: `data/dual-clock-step1` @ `4998683` (QA verified). Push blocked on Joshua write token. Step 2 hold. |
| v0.17 | 2026-09-14 | Track Free Data army: `docs/data/FREE-SOURCES-ARMY-v0.md` incoming; adapters CoS-gated **per source**. |
| v0.18 | 2026-09-14 | Joshua greenlit free/delayed **catalog** expansion (Ripple Free Data). Adapters still CoS per-source; Data Eng wires only after gate; step 2 hold. |
| v0.18.1 | 2026-09-14 | Free Data: catalog + **top 5 P0** first; no adapter code until CoS per-source greenlight. |
| v0.19 | 2026-09-14 | FREE-SOURCES-ARMY-v0 catalog landed (docs only). P0: FRED/ALFRED, Treasury XML, EIA, EDGAR, BLS. Hard nos locked. Adapters still CoS-named only. |
| v0.20 | 2026-09-21 | **FRED+ALFRED adapter greenlit** (Joshua). Other free-data P0s hold. Freeze Sep 18–21: no overnight ship. |
| v0.21 | 2026-09-21 | FRED+ALFRED **in flight** (Free Data + Data Eng). `FRED_API_KEY` with Joshua; `:8080` up; other P0s + step 2 hold. Overnight Sep 20–21 quiet. |
| v0.22 | 2026-09-21 | Ownership: Data Eng owns `fred.server.ts`; Free Data catalog-only. **Blocked on Joshua `FRED_API_KEY`.** |
| v0.23 | 2026-09-21 | FRED PR #1 QA **PASS**; CoS greenlit merge after nits. Track as landed **when merged**. Key still for live. |
| v0.25 | 2026-09-21 | FRED+ALFRED **landed** on `main` @ `4782bce`. Live still needs Joshua `FRED_API_KEY`. Other P0s + step 2 hold. |
| v0.25.1 | 2026-09-21 | CoS: RSS `availableTimeMs` soft follow-up parked as dual-clock **step-1 cleanup** (Data Eng when free) — not step 2 / no obs log. |
| v0.26 | 2026-09-21 | RSS dual-clock cleanup **in flight** (Data Eng bc-5f1df3e0): `availableTimeMs`=ingest watermark ≠ published. Not step 2. |
| v0.27 | 2026-09-21 | RSS dual-clock cleanup **PR #2** QA CLEAR — merging. Not step 2. |
| v0.28 | 2026-09-21 | RSS dual-clock cleanup **landed** @ `73b75f3`. **STOP WORK** (Joshua): freeze new impl; no adapters / step 2 / UX freestyle. CoS → alpha-recon handoff. |
| v0.28.1 | 2026-09-21 | Delivery board frozen (no new tracks). `alpha-recon` handoff push waits on Joshua GitHub write token. |

---

*Related:* [`MODEL-DESIGN-v0.1.md`](./MODEL-DESIGN-v0.1.md) · [`RESEARCH-VOCAB-KILL-LIST.md`](./RESEARCH-VOCAB-KILL-LIST.md) · [`FINENG-INTERFACE-CONTRACTS-v0.md`](./FINENG-INTERFACE-CONTRACTS-v0.md) · [`PHONE-ACCEPTANCE-PACK.md`](./PHONE-ACCEPTANCE-PACK.md) · [`data/FEED-INVENTORY.md`](./data/FEED-INVENTORY.md) · [`data/ASOF-REPLAY-v0.md`](./data/ASOF-REPLAY-v0.md) · [`data/FREE-SOURCES-ARMY-v0.md`](./data/FREE-SOURCES-ARMY-v0.md) · [`ENGINE-CAPABILITY-GAP.md`](./ENGINE-CAPABILITY-GAP.md) · [`CLUSTER-JUDGE-SCHEMA-v0.md`](./CLUSTER-JUDGE-SCHEMA-v0.md) · [`FREEZE-AT-T-SCHEMA-v0.md`](./FREEZE-AT-T-SCHEMA-v0.md) · [`MODEL-ROUTING-BUDGETS-v0.md`](./MODEL-ROUTING-BUDGETS-v0.md) · [`../HANDOFF.md`](../HANDOFF.md) · [`../AGENTS.md`](../AGENTS.md) · [`../REDESIGN-AUDIT.md`](../REDESIGN-AUDIT.md) (UX-owned)
