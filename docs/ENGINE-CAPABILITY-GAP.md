# Engine capability gap matrix

**Product:** Ripple Radar (Neural-Energies/ripple-radar) — advanced Ripple engine v1  
**Date:** 2026-09-14  
**Purpose:** Cross-owner capability gaps for CoS handoff. Documentation only in this pass (no training, no feature implementation).

**Owners legend**

| Abbrev | Owner | Typical slices |
|---|---|---|
| DS | Ripple Data Science / NLP / Learning | §1 Perception, §2 Triage, §6 Learning moat, adjacent evidence/as-of/adversarial/HITL |
| Engine | Engine | Clustering/compose/pipeline wiring, causal graph runtime |
| FinEng | Financial Engineering | Markets, instruments, confirmation, calibration consumption |
| UX | UX | Out of scope for this matrix |
| ML/AI | Ripple ML/AI (LLM systems) | Model routing, prompt/tool schemas, LLM eval harnesses, hallucination controls, ensemble disagreement, rate limits, fallback-to-engine; partner DS (judge features) & FinEng (never treat LLM as calibrated) |

**Hard rules:** zero hardcoded production events; catalog fixtures only; causal graph first; importance ≠ probability; label ≠ calibrated probability.

---

## Data Science / NLP / Learning

**Owner:** Ripple Data Science  
**Scope of this pass:** Documentation only — **no model training, no feature implementation.** Gap matrix for CoS handoff §1 Perception, §2 Triage, §6 Learning moat, plus adjacent DS items.  
**Coordinate with:** Engine (clustering/compose/pipeline), FinEng (markets/calibration consumption). UX out of scope.  
**Hard rules (inherited):** zero hardcoded production events; catalog fixtures only; causal graph first; importance ≠ probability; label ≠ calibrated probability.

Crypto narratives: **in scope only when delayed-policy compatible and data-honest** (CoinDesk RSS + `BTC`/`ETH` ontology tags already exist). Do not invent crypto-specific event branches or treat LLM narrative heat as calibrated edge.

---

### §1 Perception

| Capability | Current state (file pointers) | Gap | Priority | Depends on | Notes / constraints |
|---|---|---|---|---|---|
| Embedding clusterer | `src/lib/engine/cluster.ts` — greedy lexical Jaccard on unigrams+bigrams (`tokenize.ts`) + proper-phrase entity overlap; merge at `bestSim >= 0.2`; second-pass `mergeSimilar` at `sim >= 0.32` or `(sharedEnt >= 2 && sim >= 0.14)` / `(sharedEnt >= 1 && tagOverlap >= 2 && sim >= 0.16)`. Caps to 10 clusters; stamps via `stampHeadlineClusters`. **No embeddings.** | Semantic near-duplicates and paraphrase merges miss; sparse days over-merge on shared names (HANDOFF §Known gaps #1). Need embedding (or hybrid lexical+embedding) clusterer with tunable thresholds — **no per-event special cases**. | P0 | Cheap market-relevance gate (`relevance.ts`); Engine cluster API contract | Keep lexical path as cheap pre-gate. Embedding model choice/ops is DS; wiring into `clusterHeadlines` is Engine. Never train on live desk PII or rewrite historical cluster IDs. |
| Event extraction | `src/lib/engine/extract.ts` — ontology/lexicon: `ALIAS` canonicalize, `properPhrases`, `familyOf`/`subtypeOf` from `Tag`s, `extractClaims` = title→Claim slice. Ontology lexica in `ontology.ts` (`tagsFromText`, `toneOf`). | No structured event schema beyond title/entities/family/tags; weak argument roles (who/what/where/when/magnitude); no cross-sentence or multi-doc extraction. Claims are headline copies, not fact frames. | P0 | Ontology families stay event-agnostic; catalog fixtures for eval only | Causal-first: extract entities/relations that feed graph, not ticker lists. Unknown events must still extract without developer intervention. |
| Narrative frames | Tone only (`toneOf` escalate/deescalate lexica); `narrativeHeat` field on `RadarEvent` exists in `types.ts` but compose fills thin sentiment proxies; rescore can return a free-text `narrative` (`live/rescore.server.ts`). | No frame inventory (supply-shock / policy-shift / kinetic-escalation / fade / crowding-print, etc.) grounded in evidence spans. Risk of LLM free-text treated as structure. | P1 | Family-appropriate scenarios (`hypothesize.ts`); §2 judge family label | Frames label structure, not probability. Crypto frames only when tape/data support them. |
| Stance & source reliability (thesis-relative) | `src/lib/live/evidence.ts` — `reliabilityOf` static source letter grades **A–D** (Fed/Treasury/EIA… vs Reuters/BBC… vs CNBC/CoinDesk…); `direction` = headline tone. Duplicate fingerprint demotes strength. | Grades are source-tier, **not** stance toward the active thesis. No source×claim agreement, no time-decayed reliability, no conflict graph. | P0 | EvidenceItem schema; duplicate marking | Keep A–D as prior; add thesis-relative stance as separate feature. Label ≠ calibrated prob. CoinDesk tier C is fine for crypto tape honesty, not edge. |
| Entity linking (causal-first) | `canonicalize`/`resolveEntities`/`splitEntities` in `extract.ts` + `properPhrases` heuristics; relate uses shared entity strings (`relate.ts`). No KB / Wikidata / LEI linking. | Ambiguous names collide (person vs energy story — HANDOFF over-merge); no causal-role typing (actor / bottleneck / geography / instrument). Linking must prefer causal graph nodes over ticker reverse-lookup. | P0 | Causal graph (`graph.ts`); TRANSMIT ontology | Entity link → graph node before asset attach. Fixtures in `catalog.ts` for eval only — never production defaults. |
| Optional later: filings / AIS / prediction-market text | `EvidenceKind` includes `"filing"`; `expectedEvidenceFor` *mentions* AIS/filings/inventories as observe text; ingest is RSS headlines only (`live/build.server.ts`, incl. CoinDesk). No SEC/AIS/PM parsers. | Non-news modalities absent. Needed for fundamental class and lead vs consensus, but **not** blocking §1 lexical→embedding upgrade. | P2 | Delayed-policy / data contracts; FinEng for PM odds if any | Ingest as evidence classes (`fundamental` / `expectation`); never hardcode venues as events. Prediction-market text only when as-of honest. |

---

### §2 Triage

| Capability | Current state (file pointers) | Gap | Priority | Depends on | Notes / constraints |
|---|---|---|---|---|---|
| Cheap gates before LLM | `relevance.ts` — `marketRelevanceOf` / `filterMarketRelevantClusters` (`MARKET_RELEVANCE_THRESHOLD = 2`); soft-news cues vs transmission tags; cluster.ts applies gate to singles and final list. Significance heuristic in `cluster.ts`. | Gates are lexical/tag only; no rate/cost budget object; no explicit “pass to judge” queue separate from desk top-10. | P0 | Ontology `MARKET_CORE_TAGS` / `SOFT_NEWS_CUES` / `TRANSMIT` | **LLM cluster judge must run AFTER cheap gates.** Do not call judge on soft-news rejects. |
| LLM cluster judge (`onRadar` / `marketMoving` / `confidence` / `why` / `family`) | No judge module. Mode B analyze (`analyze.server.ts`, Grok JSON) builds full books from user text; Mode A auto path is compose-from-cluster without an LLM triage step. `familyOf` is tag-rule, not judged. | Missing structured judge outputs: `onRadar`, `marketMoving`, `confidence`, `why`, `family`. Today importance/significance heuristics ≠ triage decision. | P0 | Cheap gates; EventFamily union in `extract.ts`; Engine compose contract | **Judge label ≠ calibrated probability.** Confidence is ordinal/self-report for routing, not Brier. Locked emit: [`docs/CLUSTER-JUDGE-SCHEMA-v0.md`](./CLUSTER-JUDGE-SCHEMA-v0.md). Include **crypto narratives only when delayed-policy compatible / data-honest** (feed+ontology already present). Family must stay family-appropriate for scenarios. |
| Importance vs probability vs label | `importanceOf` + scenario probs in `hypothesize.ts`; `RadarEvent.probability` / `importance` separate fields; docs/scenarios copy already warn LLM numbers ≠ calibrated. | Triage still risks collapsing “marketMoving” into probability. No explicit type separation in a judge schema. | P0 | §6 calibration ledger | Enforce in schema/docs: importance ≠ probability; judge label ≠ calibrated prob. |

---

### §6 Learning moat

| Capability | Current state (file pointers) | Gap | Priority | Depends on | Notes / constraints |
|---|---|---|---|---|---|
| Freeze at T | `ForecastSnapshot` in `src/data/types.ts`; `snapshotOf` in `hypothesize.ts`; `compose.ts` sets `forecasts: [snapshot]` once at compose. `DAILY_LOOP` in `pipeline.ts` lists “Freeze forecast snapshot” / “Resolve completed” / “Calibration”. | Snapshot is a single compose-time blob (prob/importance/top scenario/evidence string) — **not** an append-only ledger keyed by T with info-set hash. No resolve→score job. Learn stage in `stageOf` only maps lifecycle→`"learn"`. | P0 | Persist layer (Engine/infra); clock/as-of | Never rewrite history: append snapshots; resolutions point at frozen T. |
| Live Brier / calibration | `/learning` (`src/routes/learning.tsx`) renders `MODEL_STATS` from `src/data/catalog.ts`; `scoredForecasts[].frozen: true`; UI badges: “not this desk’s live Brier”. Charts are fixture. | No live Brier, reliability diagrams, or family-stratified calibration from desk snapshots. | P0 | Freeze-at-T ledger; resolution labels | Fixture stays for pedagogy; live metrics must be clearly separated. |
| Link hit / missed exposure / lead vs consensus | Trade/graph fields exist (`causalPath`, distances); crowding/confirmation enums on types; market feed thin (HANDOFF #6). No scored link-hit or lead-time vs consensus series. | Moat metrics undefined in code: link hit-rate, missed exposure, lead vs consensus/print. | P1 | FinEng market confirmation; freeze ledger | Score only against frozen T info-set — no peeking. |
| Never rewrite history | Catalog `MODEL_STATS` and type `frozen: true` encode the rule for fixtures; live path can overwrite in-memory compose output on rebuild (`build.server.ts` cache). | No immutable forecast store; rebuild can drop prior snapshots. | P0 | Persistence design | Recalculate forward books freely; **do not mutate** scored rows. |
| Recalibrate by family | `EventFamily` in `extract.ts`; scenarios are family-appropriate in `hypothesize.ts`. Calibration fixture is global buckets only. | No per-family (policy / physical / credit / tech / fx / weather / kinetic / commodity / corporate / crypto-honest) calibration curves or isotonic maps. | P1 | Live scored ledger; family labels from §2 | Recalibrate by family; avoid one global curve washing sparse families. Crypto family only when data-honest. |

---

### Adjacent DS

| Capability | Current state (file pointers) | Gap | Priority | Depends on | Notes / constraints |
|---|---|---|---|---|---|
| Expectation evidence features | `classifyText` → `evidenceClass: "expectation"` via lexicon (`fedwatch`, `odds`, `implied`, …) in `evidence.ts`; `expectedEvidenceFor` templates in `hypothesize.ts` with `appeared: false` always. Strength prior: expectation=2 vs fundamental=3. | No feature vector (dispersion, surprise vs prior, time-to-print); `appeared` never flips from live tape; expectation vs narrative often confusable. | P1 | §1 extraction; freeze-at-T | Features for update/invalidate — not standalone signals to trade. |
| Info-set / as-of | `clock.ts` quote freshness (`quoteState(asOf)`); evidence `time` via clock helper; learning replay slider is **UX sketch** and “does not recompute the book as-of that date”. `EvidenceItem.delayed` always `false` in `headlineToEvidence`. | No first-class info-set ID / as-of cutoff for research objects; delayed policy flag unused; replay does not mask post-T evidence. | P0 | Freeze-at-T; FinEng delayed quotes if any | Every scored forecast must declare as-of. Delayed feeds stay delayed. |
| Adversarial / propaganda detection | None. Tone lexica and source tiers only. | No coordinated amplification, claim-copy networks, or state-media stance vs thesis. Duplicate fingerprint is near-exact title only. | P2 | Stance/reliability; clustering | Defensive feature for reliability — not a content-mod product. Prefer precision; avoid political hardcoding. |
| HITL desk labels | Desk persist/analyze overlay (`live/desk.ts`, `overlay.ts`); alerts kinds include narrative/scenario; no analyst label schema for onRadar / family / resolution / link-hit. | No human-in-the-loop labels feeding learning moat or judge eval. | P1 | Freeze ledger; auth userId for attribution | Desk labels are **labels**, not calibrated probs. Use for training/eval later — **not in this pass**. |

---

### DS P0 summary (this slice)

1. Embedding (or hybrid) clusterer behind cheap gates — fix sparse-day over-merge without event special cases.  
2. Richer event extraction + causal-first entity linking (beyond alias/proper-phrase).  
3. Thesis-relative stance (keep A–D as prior only).  
4. LLM cluster judge **after** cheap gates; schema separates onRadar/marketMoving/confidence/why/family from probability.  
5. Append-only freeze-at-T snapshots + live Brier/calibration (fixture remains labeled frozen); never rewrite history; as-of/info-set on every score.

### Cross-owner handshake — FinEng (2026-09-14)

FinEng §3–§5 depends on DS for honest math consumption. Accepted (docs only; no impl until CoS go):

| FinEng need | DS owner row | Contract |
|---|---|---|
| Freeze-at-T / as-of ledger before IRF / Brier / historical-replay consumption | §6 Freeze at T, Live Brier, Never rewrite history; Adjacent Info-set / as-of (all P0) | Append-only snapshots keyed by T + info-set hash; every scored row declares `asOf`; FinEng may consume only ≤T; Engine/Platform persist |
| Evidence class labels for Dirichlet / Bayesian scenario updates | Adjacent Expectation evidence features (P1); §1 extraction class fidelity; existing `EvidenceClass` in `evidence.ts` | Stable class/direction/weight on evidence batches FinEng `updateScenarios` ingests; lexicon classes stay priors — improve quality, do not invent calibrated likelihoods here |
| Crypto-honest triage only when delayed-policy compatible | §2 LLM cluster judge; crypto note in DS header | Judge may surface crypto narratives only with delayed/data-honest tape; label ≠ calibrated prob; FinEng keeps `TradeCategory:"crypto"` fidelity on consume |

DS does **not** own IRF/Dirichlet kernels, rank math, or stress — FinEng does. DS does **not** implement until CoS assigns.

**Freeze-at-T schema sketch (docs only):** [`docs/FREEZE-AT-T-SCHEMA-v0.md`](./FREEZE-AT-T-SCHEMA-v0.md) — joint DS/FinEng contract for append-only `InfoSetSnapshot` (`asOf`, `infoSetHash`, scenarioId→priorMass, evidence batch class/direction/weight, provenance, snapshotId) so `updateScenarios` / IRF / Brier refuse post-T peeks. No impl in this pass.

### Out of scope this pass

- Model training, fine-tuning, or embedding index build  
- Feature implementation / PR code beyond this matrix  
- UI work  
- Engine/FinEng owned slices except as explicit dependencies  

*Last verified against repo paths on 2026-09-14.*

---

## FinEng — Advanced engine §3 Causal & scenario · §4 Markets · §5 Decision

> **NO IMPLEMENTATION YET.** Documentation-only gap matrix. No code, no commits, no npm installs, no UI/UX ownership.

**Owner:** Ripple FinEng  
**Primary baseline:** [`docs/MODEL-DESIGN-v0.1.md`](./MODEL-DESIGN-v0.1.md) (canonical Model Design v0.1, 2026-09-14).  
**Secondary vision slice:** CoS formal handoff Advanced engine FinEng §3–§5 (Bayesian/Dirichlet, Markov/semi-Markov, MC/particle bands, SCM/do-calculus-lite, Hawkes; VAR/LP vs graph impulse; options/curves/basis; crowding≠confirmation; lead-lag; CRYPTO first-class; ranked exposures; thesis cards; counterfactuals; portfolio stress; Never BUY X 87%).  
**Verified against codebase:** 2026-09-14 (read `types.ts`, `graph.ts`, `hypothesize.ts`, `compose.ts`, `discover.ts`, `overlay.ts`, `rescore.server.ts`, `evidence.ts`, `game.ts`, `ontology.ts`, `portfolio.tsx`, `learning.tsx`, `HANDOFF.md`).

### Status legend

| Status | Meaning |
|---|---|
| Missing | No module / type / runtime path |
| Stub | Type or field exists; logic empty, synthetic, or LLM-only |
| Partial | Heuristic or half of the contract; not Model Design–grade |
| Present | Meets Model Design v0.1 intent for v1 (none claimed below) |

### Explicit non-goals (FinEng)

- No UI work; no UX ownership (`REDESIGN-AUDIT.md` / routes stay UX).
- No training pipelines, embedding indexes, or DS judge implementation.
- No inventing fake Brier/accuracy/backtest numbers; fixture `MODEL_STATS` stays labeled frozen.
- No hardcoded production events; catalog fixtures calibration-only; causal graph before tickers; never Headline→ticker reverse story.

### Model Design v0.1 → FinEng ownership map

| Model Design section | FinEng stake | Code locus today |
|---|---|---|
| Scenario probabilities | Auditable updates; never LLM-alone as calibrated truth | `ProbabilityAudit` + `auditOf` stub; `compose` heuristic `probability`; Grok `rescore` overwrites |
| Ripple graph | Link math (lag distributions, impulse, confidence); crypto as node/asset class | `buildCausalGraph` hops 0–4; `expectedLag: string`; BTC/ETH in `TICKER_META` |
| Progressive learning | Consume freeze/score outputs; ranked-exposure quality; never rewrite history | Single `forecasts: [snapshot]`; `/learning` = `MODEL_STATS` fixture |
| Evidence classes | Market/expectation features for confirmation & update weights | Lexicon `classifyText`; `delayed: false` always |
| Game theory | Player branches → graph rewrite (SCM-lite) | Family `GameTheory` matrix + `readMatrix`; no do-operator |
| Historical-replay | As-of impulse / stress under frozen info-set | No replay engine; portfolio route illustrative |
| 24h delayed data | Options/curves/basis when free/delayed; structural edge | Yahoo spark quotes live-ish; no curve/options/basis series |

---

### §3 Causal & scenario

Maps primarily to Model Design **Scenario probabilities**, **Ripple graph**, **Game theory**, **Progressive learning**.

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| 3.1 | Bayesian / Dirichlet scenario updates | Stub | `hypothesize.normalize` forces family templates → Σp≈100; `auditOf` sets `previous=updated=p`, empty `affectedNodes`/`rescoredAssets`; `composeEvent` prior `clamp(16+hits*4+esc*4-de*3,8,82)`; `overlayScenarios` + `rescore.server` apply Grok `scenarioShifts` without likelihood model | No Dirichlet prior / conjugate update; no evidence likelihood by `EvidenceClass`; audit schema matches Model Design fields but is not populated by a Bayesian step. Rescore is LLM point mass, violating “LLM-generated numbers alone are never treated as calibrated probabilities.” | Engine: evidence stream + scenario ids stable across rescores; DS: freeze-at-T + class labels; FinEng: update kernel | Given frozen prior π and evidence batch with class/direction/weight, `updateScenarios` returns posteriors summing to 1 (±ε), fills `ProbabilityAudit` (previous, evidence, direction, weight, updated, affectedNodes, rescoredAssets). Unit test: identical evidence → identical audit; LLM rescore path cannot bypass audit (may propose, must not write calibrated truth). |
| 3.2 | Markov / semi-Markov regimes | Missing | `Lifecycle` enum + `lifecycleOf` heuristic; no transition matrix | No regime state machine (calm / stress / crisis / fade) with holding-time or semi-Markov sojourn; lifecycle ≠ regime math | Engine lifecycle events; DS regime labels optional; FinEng transition / hazard params | `RegimeModel` exposes P(i→j) and optional dwell; scenario or confirmation kernels condition on regime; golden test: synthetic sojourn series recovers known transition counts within tolerance. |
| 3.3 | Monte Carlo / particle filters (bands, not fake points) | Missing | Scenario `range` is prose; `horizonsFor` emits point `%`; `probabilityHistory` synthesized T-3…Now | No particles, no predictive bands, no uncertainty envelopes. Point `%` on desk invite fake precision. | Engine scenario ids; DS as-of clock; FinEng sampler | For one book, sampler returns scenario-weight trajectories + quantiles (e.g. p10/p50/p90) over horizon grid; **no** single “BUY X 87%” export. Deterministic seed → bit-stable bands in test. |
| 3.4 | SCM / do-calculus-lite player branches | Partial | `gameTheoryFor` + `GameCell {a,b,label}`; `readMatrix` Nash/likely; Model Design requires graph rewrite on player response (OPEC example). Links may carry `scenarioDependence` string only | Matrix is payoff narrative, not structural causal model. No `do(player=move)` that mutilates edges / recomputes transmission. No credible-commitment / sequencing / repeated-game effects beyond prose fields on `players[]`. | Engine graph mutate API; FinEng intervention algebra; DS optional player-move extraction | `intervene(graph, {player, move})` returns new link set + listed inactivated edges; test: supply-response intervention reduces crude upside link confidence while preserving tanker bottleneck link (Model Design OPEC example shape) without ticker hardcoding. |
| 3.5 | Hawkes aftershocks | Missing | Cluster stamps + relate; no self-exciting process | No intensity λ(t) for aftershock / secondary print clustering; narrative heat is not a Hawkes fit | DS cluster times; FinEng Hawkes fit/predict; Engine optional intensity feature on evidence | Fit univariate Hawkes on synthetic burst timestamps; predict elevated intensity window; reject constant-rate null on burst fixture (likelihood ratio test threshold fixed in test). |

---

### §4 Markets

Maps to Model Design **Evidence classes** (market/expectation), **Ripple graph**, **24h delayed data**, **Historical-replay**.

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| 4.1 | VAR / local projections vs graph impulse | Missing | Graph “impulse” = hop `impact`/`confidence` heuristics in `graph.ts`; ontology `TRANSMIT` lags are prose | No reduced-form VAR/LP estimated impulse-response to compare or regularize against structural graph hops. Cannot say whether hop-2 equity response matches LP at horizon h. | DS/FinEng panels with as-of; Engine graph edge ids; FinEng LP/VAR | Given frozen panel to T, `graphImpulse(edge,h)` and `localProjection(ticker,h)` both return numeric IRF; test asserts API symmetry and that peeking post-T data is rejected when as-of set. |
| 4.2 | Options / curves / basis (delayed/free) | Missing | Evidence lexicon lists curves/options keywords; `TICKER_META` spot/ETF/futures proxies; Yahoo sparks in `build.server` — no vol surface, no futures curve, no basis series | Model Design market evidence explicitly includes curves/options/OI. Delayed-policy allows free/24h-lag series; none ingested or typed. | Delayed data adapters; Engine evidence attach; FinEng curve/basis features | Ingest ≥1 delayed curve **or** options summary per supported asset class; `EvidenceItem` with `evidenceClass:"market"` and `delayed:true`; feature extractors emit term/basis/skew scalars usable by confirmation kernel. No realtime arb requirement. |
| 4.3 | Crowding ≠ confirmation | Partial | Types: separate `Crowding` / `Confirmation` enums on `TradeIdea`/`RadarEvent`. Live: `crowdingOf(mentions, absMove, headline)` vs `confirmationOf(change, expectedDir, headlineMove)` in `discover.ts`; score mixes both with penalties/boosts. HANDOFF gap #6: market-structure feed thin | Correctly separated in types and heuristics, but both are tape/mention proxies — not positioning, OI, or options crowding; confirmation is session move vs node direction, not multi-class evidence concordance. Risk: UI readers treat high crowding as confirmation. | FinEng: structure features; DS: narrative uniqueness; Engine: keep fields distinct in rank API | Pure function test matrix: (high mentions, flat/adverse price) → crowded + none/diverging; (low mentions, fundamental+market align) → low crowding + confirming. Rank API docs/assert: crowding never copied into confirmation field. |
| 4.4 | Lead–lag | Stub | `CausalLink.expectedLag` / `TradeIdea.horizon` / `TICKER_META.lag` are **prose strings** (“days–weeks”); no numeric lag dist; no cross-corr estimator | Cannot estimate or validate lead–lag between bottleneck and expression; Model Design lag field is qualitative only in code | FinEng lag estimator; Engine store numeric lag moments; DS as-of | `estimateLeadLag(x,y,asOf)` → lag peak in hours + confidence; graph write path accepts numeric lag moments alongside prose; replay test forbids using post-T prints. |
| 4.5 | CRYPTO first-class with eq / FX / rates / commodities | Partial | Model Design: nodes may be crypto assets. Code: `TradeCategory` includes `"crypto"`; `TAG_NODE.crypto`; `BTC`/`ETH` in `TICKER_META` (`category:"crypto"`); CoinDesk RSS; `liquidityOf` treats crypto as high. Graph kind maps crypto tag → `kind:"commodity"` | Crypto is ontology-present but not first-class parity: no crypto-native evidence class weighting, basis/funding/OI features, or regime coupling to FX/rates. Kind collapse to `commodity` loses asset-class fidelity for ranking/stress. | Engine node kind fidelity; FinEng crypto market features under delayed policy; DS crypto-honest triage | Crypto node/trade round-trips with `category:"crypto"` (not coerced to commodity in rank/stress inputs); delayed crypto market evidence attaches like eq/FX/rates/commodities; unit test: rates→crypto TRANSMIT edge participates in impulse/rank without special-case event ids. |

---

### §5 Decision

Maps to Model Design **Position research** (pipeline end), **Progressive learning** (ranking quality), **Historical-replay**, **Scenario probabilities** (anti–fake-calibration).

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| 5.1 | Ranked exposures (distance, confidence, confirmation, crowding, liquidity, horizon) | Partial | `rankTrades`/`scoreTrade` use score ± confirmation boost − crowding penalty + liquidity category default; `distance` from node level; link `confidence` not in rank; horizon prose | Rank is heuristic score, not multi-key sort/scorecard over the six Model/vision factors. Confidence on links unused in trade rank. Portfolio page shows Dist/Score/Horizon but not full factor vector. | Engine stable trade ids + link confidence; FinEng rank function; DS optional quality labels | `rankExposures(book)` returns stable ordering with explicit factor vector `{distance, confidence, confirmation, crowding, liquidity, horizon}`; golden fixture: changing only crowding reorders under documented weights; confidence drawn from governing `CausalLink`. |
| 5.2 | Thesis cards | Stub | `TradeIdea.reason` / `causalPath` / `invalidation`; `AssetRecord.thesis` from blurb; no structured card object | No first-class thesis card: claim, causal path, evidence classes supporting, invalidation, horizon, crowding/confirmation, counterfactual pointer | Engine research object fields; FinEng card schema | `ThesisCard` type + builder from `RadarEvent`+trade; required fields validated in test; catalog fixture event yields ≥1 card with non-empty invalidation and path Event→…→ticker (never ticker-first). |
| 5.3 | Counterfactuals | Missing | Game likely-cell prose; `scenarioDependence` optional string; no CF engine | No structured “if player move / if scenario k” exposure diff vs baseline book | §3.4 intervene; Engine graph clone; FinEng diff | `counterfactual(book, intervention\|scenarioId)` → Δranks / Δlink confidences; test: CF output references only pre-T evidence when as-of set. |
| 5.4 | Portfolio stress | Missing | `/portfolio` illustrative ranked expressions (explicitly not AUM/NAV/PnL); `DEFAULT_PORTFOLIO` catalog slices unused as stress engine | No shock→PnL/factor stress under scenario weights or graph impulse; no multi-asset covariance / scenario-conditional loss | Ranked exposures; scenario weights; delayed returns; FinEng stress | `stress(book, holdings\|equalWeight, scenarioWeights)` → scenario-conditional loss bands (not a point “87%”); historical-replay mode uses only ≤T returns. |
| 5.5 | Never BUY X 87% (no fake calibrated point probs / LLM point probs as truth) | Partial (policy) / Missing (enforcement) | Model Design + HANDOFF + learning copy forbid treating LLM/fixture as live skill; yet `compose` emits integer `probability`, scenarios show `%`, `rescore` returns LLM `probability`/`scenarioShifts` applied as truth; `auditOf` is identity stub | Product still surfaces point probabilities without calibration contract or band semantics. No API guard that marks LLM numbers as `uncalibrated_proposal`. | FinEng calibration consumer + band exports; DS live Brier ledger; Engine provenance flags | Any public research-object export that includes scenario mass must carry `provenance: heuristic\|llm_proposal\|calibrated` and, for calibrated, a ledger id. Test: rescore LLM path sets `llm_proposal` and cannot set `calibrated`. Ban format: no helper may format `BUY ${ticker} ${p}%` as recommendation string in engine/FinEng libs. |

---

### Coordination notes (Engine · Data Science · FinEng)

**Types / contract (`src/data/types.ts`)**  
- Extend usage of existing `ProbabilityAudit` (do not abandon) — FinEng fills weight/affectedNodes/rescoredAssets; Engine persists.  
- Promote `expectedLag` to dual representation: keep prose for desk, add numeric moments for math (Engine owns schema migration; FinEng owns estimators).  
- `EvidenceItem.delayed` must become meaningful under Model Design 24h policy (DS/Engine ingest; FinEng filters features by delayed flag).  
- Crypto: preserve `TradeCategory:"crypto"` through graph→rank→stress; avoid silent coerce to commodity in FinEng inputs.

**Events / evidence streams**  
- Engine: stable `scenario.id`, link identity, as-of clock on `RadarEvent` / snapshots.  
- DS: freeze-at-T ledger, resolution labels, evidence class quality, judge labels ≠ probability.  
- FinEng: consumes evidence batches + quotes/curves; emits audits, ranks, bands, stress — never writes resolution outcomes backward (Progressive learning invariant).

**Interfaces (sketch, not implemented)**  
- `FinEng.updateScenarios(prior, evidence[]) → {scenarios, audits}`  
- `FinEng.rankExposures(event, marketState) → RankedExposure[]`  
- `FinEng.intervene / counterfactual / stress` as pure functions over frozen graphs  
- Engine wires; DS supplies labels/features; FinEng owns math kernels.

**P0 interface contracts (docs only, 2026-09-14):** [`docs/FINENG-INTERFACE-CONTRACTS-v0.md`](./FINENG-INTERFACE-CONTRACTS-v0.md) locks UI-bindable seams — `ScenarioBook`, `updateScenarios` → posteriors + `ProbabilityAudit[]` + provenance, `ProbabilityExport` (no `calibrated` without `snapshotId`/ledger id), `rankExposures` factor vector `{distance, confidence, confirmation, crowding, liquidity, horizon}` with Crowding ≠ Confirmation enums, crypto `TradeCategory`+`NodeKind` fidelity, and P1/P2 placeholders (`ScenarioBands`, intervene/counterfactual, stress) so UX keeps progressive slots empty. Aligns Engine wire / DS freeze ledger / ML `llm_proposal` / UX empties. No `src/` impl in this pass.

**HANDOFF alignment**  
- Known gap #5 (learning/calibration) and #6 (crowding/confirmation thin feed) are shared DS∩FinEng — FinEng does not own freeze ledger, does own consumption for rank/calibration gates.

---

### FinEng consumer refuse rules (mirror of `docs/FREEZE-AT-T-SCHEMA-v0.md`)

**Status:** Docs only — contract accepted 2026-09-14. No `src/` kernels yet.

FinEng owns enforcement at the consumer boundary. DS owns schema/hash/scoring semantics; Engine owns append/persist later.

| Kernel | Refuse | Accept / emit |
|---|---|---|
| `updateScenarios(prior, evidence[])` | Evidence `asOf` > snapshot `asOf`; in-place mutate of `InfoSetSnapshot`; triage disposition / judge confidence as likelihood; treating `heuristic`/`llm_proposal` mass as `calibrated` without ledger id | Dirichlet/Bayesian posterior + filled `ProbabilityAudit`; new append-only snapshot when freezing; evidence `weight`+`class`+`direction` as update features (priors, not invented likelihoods) |
| IRF / historical-replay / `localProjection` | Panel prints/returns/curves with ts > T; silent upgrade of `delayed:true` to same-session; unbound impulse (no `snapshotId` or `(eventId, asOf, infoSetHash)`) | Numeric IRF bound to frozen info-set; ≤T data only |
| Brier / calibration consume | Recompute after rewriting snapshot mass/evidence; post-T evidence attributed to forecast-at-T; merging fixture `MODEL_STATS` into live Brier | Score only via `ResolutionRecord.snapshotId`; verify `infoSetHash` on read (mismatch ⇒ refuse) |
| `rankExposures` / `stress` / bands | Ticker-first books (Mode B headline→ticker without graph); crypto coerced off `TradeCategory:"crypto"`; export format `BUY ${ticker} ${p}%` | Factor vector ranks; scenario-conditional **bands**; provenance on any exported mass |

**Mass scale (DS proposed default, awaiting Engine/Platform ack):** ledger `priorMass`/`probability` on **0–1**; desk 0–100 display-only; `infoSetHash` uses **fixed 6 decimal places**. FinEng matches Engine canonicalization once ack'd. See `FREEZE-AT-T-SCHEMA-v0.md` open Q3.

**Pointer:** full types + hash algorithm in [`docs/FREEZE-AT-T-SCHEMA-v0.md`](./FREEZE-AT-T-SCHEMA-v0.md).

---

### FinEng capability score summary

| Section | Capabilities scored | Missing | Stub | Partial | Present |
|---|---:|---:|---:|---:|---:|
| §3 Causal & scenario | 5 | 2 | 1 | 1 | 0 |
| §4 Markets | 5 | 2 | 1 | 2 | 0 |
| §5 Decision | 5 | 2 | 1 | 2 | 0 |
| **Total** | **15** | **6** | **3** | **5** | **0** |

*(3.4 Partial; 3.1 Stub; 3.2/3.3/3.5 Missing. 4.3/4.5 Partial; 4.4 Stub; 4.1/4.2 Missing. 5.1/5.5 Partial; 5.2 Stub; 5.3/5.4 Missing.)*

### Blockers / notes

1. **Model Design v0.1 is in-repo** at `docs/MODEL-DESIGN-v0.1.md` — use it as primary baseline (this section does). CoS §3–§5 remain the advanced-math vision checklist.  
2. No FinEng math modules exist under `src/lib/` (no MC/particle/Markov/Bayesian/Hawkes/VAR/LP/stress packages) — verified by path search.  
3. Live calibration path absent; do not cite `MODEL_STATS` numbers as desk skill.  
4. Freeze-at-T schema sketch landed: `docs/FREEZE-AT-T-SCHEMA-v0.md`. FinEng consumer refuse rules mirrored above. Persist/append still Engine/Platform — required before honest IRF/Brier.

*FinEng section last verified against repo + Model Design v0.1 on 2026-09-14. Documentation only — no implementation in this pass.*

---

## ML/AI — LLM systems (routing · schemas · evals · controls)

> **NO IMPLEMENTATION YET.** Documentation-only gap matrix. No training, no feature PRs, no UI.

**Owner:** Ripple ML/AI  
**Primary baseline:** [`docs/MODEL-DESIGN-v0.1.md`](./MODEL-DESIGN-v0.1.md) — especially *Scenario probabilities* (“LLM-generated numbers alone are never treated as calibrated probabilities”) and delayed-data honesty for crypto narratives.  
**Code loci today:** `src/lib/engine/analyze.server.ts` (Mode B Grok JSON → `hydrate` → else `composeFromText`); `src/lib/live/rescore.server.ts` (optional Grok rescore); inline megastring prompts; in-memory rate gaps; single model `grok-4.5`.  
**Coordinate with:** Data Science (cheap gates + judge *labels* / freeze-at-T features); FinEng (calibration consumption, provenance `llm_proposal` vs `calibrated`); Engine (compose/hydrate contracts, engine fallback completeness); QA (regression gates for LLM paths). UX out of scope.

**Hard rules (inherited + ML-specific):**
- Judge / analyze / rescore **labels and proposals ≠ calibrated probability**.
- Analyze path **must** degrade to a complete `RadarEvent` via engine (`composeFromText`) when key missing, rate-limited, timeout, or bad JSON.
- No hardcoded production events in prompts or fixtures used as live defaults.
- Crypto narratives only when delayed-policy compatible / data-honest.
- No UI chrome.

### Status legend

| Status | Meaning |
|---|---|
| Missing | No module / type / runtime path |
| Stub | Exists as inline string, Map, or permissive cast |
| Partial | Half the contract (e.g. analyze falls back; rescore does not) |
| Present | Meets Model Design + HANDOFF for v1 (none claimed below) |

---

### §A Model routing & budgets

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| A.1 | Multi-tier model router | Missing | Hardcoded `model: "grok-4.5"` in analyze + rescore | No cheap/fast vs deep tier; no task→model map (triage judge vs full book vs rescore) | Cost/latency budget object; DS cheap gates | `route(task)` returns `{model, maxTokens, temperature, timeoutMs}` for `judge` / `analyze` / `rescore`; unit test: soft-news reject never invokes any LLM tier. |
| A.2 | Rate / cost budget object | Stub | Analyze: process-global `MIN_GAP_MS=45_000`; rescore: per-event `90_000`; in-memory `Map`s | Not multi-instance safe; no token/cost accounting; no shared budget with Mode A judge | Platform process model; Engine call sites | `BudgetGate.allow(task, key)` pure + injectable clock; under burst, excess calls return engine/cached path without throwing; test with fake clock. |
| A.3 | Durable cache / fingerprint | Stub | Analyze fingerprint = first 280 chars lowercased; rescore fingerprint = headline ids + rounded prob | Process-local only; analyze cache hit still labeled `source: "model"` | Platform cache (optional); provenance flags | Cache entries store `{source, modelId, promptHash, asOf}`; identical fingerprint returns same provenance; no silent upgrade of engine→model. |

---

### §B Prompt / tool / triage schemas

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| B.1 | Versioned prompt + JSON schema module | Stub | Megastring prompts inline in `analyze.server.ts` / `rescore.server.ts`; `response_format: json_object` only | No shared schema types; no prompt version id; hydrate is permissive casts | `RadarEvent` / `RescoreResult` types; Engine hydrate contract | `schemas/analyze.v1` + `schemas/rescore.v1` + `schemas/judge.v1` with required fields; prompt embeds `schemaVersion`; reject/repair path tested on fixtures with omitted horizons/knowledge/expectedEvidence (HANDOFF #3). |
| B.2 | LLM cluster judge schema | Missing | DS gap §2: no judge module; Mode A is compose-only | Need structured `{onRadar, marketMoving, confidence, why, family}` **after** cheap gates; confidence ordinal for routing, not Brier | DS gates (`relevance.ts`); EventFamily union | Judge JSON validates against schema; missing family → engine `familyOf` fallback; **never** writes `RadarEvent.probability` as calibrated. Crypto family only when feed+ontology honest. |
| B.3 | Hydrate completeness / repair | Partial | `hydrate` falls back field-wise to `composeFromText` base; scenario Σ not enforced; fake ticker default `"SPX"` | Incomplete Grok JSON can pass; liquid-instrument check absent; scenario probs may not sum ~100 | Engine `hypothesize` fillers; FinEng provenance | Given truncated model JSON, output is complete `RadarEvent`; scenarios renormalized or replaced from hypothesize; tickers not in liquid set dropped or remapped — never invent. |
| B.4 | Rescore proposal provenance | Stub | Rescore applies LLM `probability` / `scenarioShifts` as desk truth | Violates Model Design: LLM numbers alone ≠ calibrated. FinEng 5.5 needs `llm_proposal` | FinEng update kernel; Engine overlay | Rescore returns `provenance: "llm_proposal"`; overlay/audit path cannot set `calibrated` from this call alone. |

---

### §C Hallucination & disagreement controls

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| C.1 | Post-hoc instrument / ontology checks | Missing | Prompt says “Invent no fake tickers”; hydrate defaults unknown ticker to `SPX` | No allowlist check against `instruments` / `TICKER_META`; silent SPX pollution | Engine liquid helpers | Every model ticker validated; invalid → strip trade or substitute from graph attach; fixture with `FAKE` ticker never survives hydrate. |
| C.2 | Evidence grounding (no invented sources) | Partial | Rescore prompt: “Do not invent sources”; analyze attaches related tape loosely | No span/id grounding required in JSON; free-text narrative can cite absent sources | EvidenceItem ids; DS stance later | Model outputs that reference headline ids must subset provided evidence ids; otherwise strip claim or mark `ungrounded`. |
| C.3 | Ensemble / disagreement signal | Missing | Single completion per call | No dual-sample or cheap-vs-deep disagreement for triage confidence | Router A.1; budget A.2 | Optional `disagree(task)` runs two cheap samples (or cheap+deep); high disagreement → engine path or lower confidence, never higher calibrated prob. |

---

### §D Fallback-to-engine & parity

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| D.1 | Analyze → engine fallback | Present (behavior) / Stub (ops) | Missing key, rate gap, HTTP error, JSON parse → `composeFromText`; returns `source: "engine"` | Behavior is correct; not covered by golden eval suite; cache mislabels | Engine compose completeness | Golden: no `XAI_API_KEY` still yields full RadarEvent (family scenarios Σ≈100, graph L0+, liquid tickers, knowledge, expectedEvidence, invalidation). |
| D.2 | Rescore → engine / no-op parity | Missing | No key → hard error; API fail → error string | Asymmetry with analyze; desk has no deterministic degrade | Engine prior book; FinEng leave probs untouched | Without key or on failure: return prior book unchanged with `provenance: "unchanged"` (or heuristic refresh), **never** wipe scenarios. |
| D.3 | Timeout / abort hygiene | Partial | `AbortSignal.timeout(28000/25000)` | No typed error taxonomy; lastCall advanced before success on rescore (cooldown burns on fail path after set) | Budget gate | Failures classified `timeout|http|parse|schema`; rate stamp only on accepted model result. |

---

### §E Eval harness (LLM systems)

| # | Capability | Status | Current locus | Gap | Depends on | Suggested v1 acceptance (testable, no UI) |
|---|---|---|---|---|---|---|
| E.1 | Offline JSON completeness suite | Missing | `engine.test.ts` covers engine; no analyze hydrate fixtures | Cannot regress HANDOFF #3 | Catalog fixtures **calibration-only**; QA gates | Fixture pack of truncated/malformed Grok JSON → hydrate completeness assertions; no live API required. |
| E.2 | Judge / triage eval | Missing | No judge | Need labeled onRadar/family set (HITL later; synthetic now) | DS labels; QA | Precision/recall on synthetic judge fixtures; confidence calibration deferred to FinEng/DS Brier — judge eval is agreement with labels only. |
| E.3 | Hallucination / ticker invent rate | Missing | None | No metric for fake tickers or ungrounded citations | C.1–C.2 | Batch replay of N analyze fixtures reports invent-rate = 0 under validator. |
| E.4 | Fallback quality vs model | Missing | None | Unknown whether engine fallback is “good enough” on held-out text | Engine tests; Research family sanity | Side-by-side structural checks (not Brier): both paths emit required fields; family-appropriate scenario names (Research). |

---

### ML/AI P0 summary (this slice)

1. Versioned **analyze / rescore / judge schemas** + hydrate repair (HANDOFF #3).  
2. **Provenance**: LLM outputs are `llm_proposal` only — FinEng owns calibrated write path.  
3. **Router + budget** in front of any Mode A judge; gates first (DS).  
4. **Rescore parity** with analyze fallback / unchanged prior.  
5. **Offline eval harness** (completeness, invent-rate, fallback structural quality) — no live key required for CI.

### Explicit non-goals (ML/AI)

- UI / UX ownership.  
- Embedding training / clusterer math (DS).  
- Bayesian calibration kernels / Brier ledger math (FinEng / DS freeze).  
- Replacing engine ontology with prompt lore.  
- Treating narrative heat or judge confidence as desk probability.

### Coordination notes

| Partner | Contract |
|---|---|
| Data Science | Cheap gates before any LLM; judge schema fields; freeze-at-T features. ML owns call/routing/schema validation. |
| FinEng | Consume `llm_proposal` only; audit/update kernels write `calibrated`. ML never formats `BUY $T $p%`. |
| Engine | `composeFromText` remains complete without XAI; hydrate repair may call hypothesize fillers. |
| QA | Wire E.1–E.3 into regression gates once fixtures land. |
| Research | Family/scenario realism review of judge+analyze fixtures — not code ownership. |

*ML/AI section drafted 2026-09-14 against `analyze.server.ts`, `rescore.server.ts`, HANDOFF.md, Model Design v0.1, and DS/FinEng gap slices. Documentation only — no implementation in this pass.*

---

## Engine — compose / graph / live / overlay + integration seams

> **NO IMPLEMENTATION YET.** Documentation only. Engine owns pipeline quality and wiring of DS/FinEng/ML outputs onto the spine. Does not own UX chrome, DS models, or FinEng kernels.

**Owner:** Ripple Engine  
**Baseline:** [`docs/MODEL-DESIGN-v0.1.md`](./MODEL-DESIGN-v0.1.md) + product narrative (Event → graph → exposures → instruments).  
**Verified against:** local clone 2026-09-14 including uncommitted `relevance.ts` / cluster+build wiring. Working notes: `/workspace/engine-v1-gap-matrix.md`.

### Status legend

Same as FinEng: Missing / Stub / Partial / Present.

### What actually runs

- **Mode A (live desk):** `build.server.ts` RSS + Yahoo sparks → `clusterHeadlines` → relevance gate → `composeFromCluster` (extract → `buildCausalGraph` → hypothesize → `rankTrades`) → `relateEvents`. `ENGINE_STEPS` / `DAILY_LOOP` are labels (`pipeline.ts` `stageOf`), not a runner.
- **Mode B (Analyze):** `analyze.server.ts` Grok JSON hydrates onto `composeFromText`. Overlay (`overlay.ts`) merges quotes + optional Grok `rescore` and **mutates** probability/scenarios in place (does not append frozen snapshots).
- Empty desk → `EMPTY_EVENT`, never catalog `EVENTS`. `npm run test` still **omits** `src/lib/engine/engine.test.ts`.

### Engine-owned spine (vs Model Design)

| # | Capability | Status | Current locus | Gap | Depends on |
|---|---|---|---|---|---|
| E.1 | Detect / cluster + cheap relevance gate | Partial | `cluster.ts` Jaccard greedy `bestSim >= 0.2` then `mergeSimilar`; `relevance.ts` `MARKET_RELEVANCE_THRESHOLD = 2` | Over-merge on sparse days; no embeddings; gate is lexical. Cluster IDs not frozen across rebuilds. | DS embeddings + judge **after** gate; Engine keeps lexical pre-gate |
| E.2 | Graph-first composition (no headline→ticker) | Partial | `compose.ts` builds graph then `tickersForTag`; Mode B Grok may return tickers/nodes/probs in one JSON | Mode A order is correct. Mode B / hydrate can leak headline→ticker. Unknown events still get SPX fallback. | Engine hydrate guard; DS extraction; FinEng does not reverse-story from blotter |
| E.3 | Probability ≠ importance | Partial | Separate fields; `importanceOf` still mixes `probability * 0.15`; compose `probability = clamp(16+hits*4…)` | Heuristic prior, not evidence-updated. Grok rescore overwrites integer `%` as truth. | FinEng `updateScenarios` + provenance; Engine persist audit |
| E.4 | Scenario ids + ProbabilityAudit | Stub | `Scenario.id` exists; `auditOf` sets `previous=updated=p`, empty `affectedNodes` / `rescoredAssets`. Overlay/rescore fill previous/updated only | **No stable evidence/scenario identity across rescore.** Overlay replaces scenarios rather than joining on `id`. Audit is identity. | Engine: stable ids + join-on-id overlay (this handshake); FinEng fills audit; DS freeze-at-T |
| E.5 | Game theory → graph rewrite | Missing (behavior) | `gameTheoryFor` **after** `buildCausalGraph`; `readMatrix` is UI-only | GT does not mutate links. No `intervene(graph, {player, move})`. | Engine graph mutate API; FinEng SCM-lite |
| E.6 | Ripple links | Partial | `CausalLink` schema matches Model Design (source/dest/direction/distance/confidence/evidence/lag/invalidation/historicalSupport) | Confidence unused in `rankTrades`. `expectedLag` is prose. `historicalSupport` stock sentence. | FinEng lag/confidence estimators; Engine store + pass into rank |
| E.7 | Crowding ≠ confirmation | Partial | Separate enums; both driven by Yahoo `%` + RSS mentions in `discover.ts`; event-level copied from `trades[0]` | Fields distinct; features are not. Rank mixes both. | FinEng structure features; Engine keep fields distinct in rank API |
| E.8 | Freeze forecasts / never rewrite history | Stub | `forecasts: [snapshot]` once at compose; overlay **replaces** probability/scenarios | Rebuild/rescore drops prior snapshots. No as-of / info-set id. | DS ledger; Engine persist append-only; Platform store |
| E.9 | 24h delayed / free data | Missing (policy) | `EvidenceItem.delayed` always `false`; quotes 12s / news 40s | Desk is same-session tape, not delayed structural edge. | Data Eng ingest flags; Engine honor `delayed` in overlay confirmation |
| E.10 | LLM probs ≠ calibrated; no vibes-LLM product | Partial (policy) / violated (Mode B) | Analyze/rescore write Grok integers onto `event.probability` | Hard-no is not enforced. Sentiment bars in compose are displayed as product. | Engine provenance flags; ML/AI routing labels-only; FinEng bands |

### Crypto (Engine ontology / graph / tickers)

**2026-09-14 pass (assigned):** first-class node kind + bidirectional TRANSMIT. Still no funding/basis/OI (FinEng). No crypto `EventFamily` (DS lock).

| Claim | Status | Note |
|---|---|---|
| BTC/ETH in `TICKER_META` + CoinDesk RSS + `DESK_TICKERS` | Present | Quotes via Yahoo `BTC-USD`/`ETH-USD` — no invented prints. |
| `NodeKind` includes `"crypto"` | Present | `TAG_NODE.crypto.kind = "crypto"`; BTC/ETH `kind: "crypto"`. Not coerced to commodity. |
| TRANSMIT | Partial | `rates→crypto` plus `crypto→liquidity/equity/vol/fx` and `liquidity→fx`. No event-id hops. Residual: no estimated beta / lead-lag (FinEng). |
| Family / bag / relate | Partial | **No crypto family** (`familyOf` crypto tags → `other`). `economicVarsFrom` now includes crypto + liquidity so relate bags are not empty. |
| Relevance | Partial | `"crypto"` in `MARKET_CORE_TAGS`; lexicon extended (ether/ethereum/stablecoin). No extra score boost. |
| Confirmation / crowding | Missing (crypto-native) | No funding/basis/OI/ETF-flow. BTC session `%` still treated like equity. |

Cross-asset rows keep `category:"crypto"` through graph → rank → stress.

### Handshake — FinEng asks (accepted, docs only)

| FinEng need | Engine current | Engine contract (when CoS assigns) |
|---|---|---|
| Stable evidence/scenario ids across rescore | `Scenario.id` exists; overlay/rescore do not join on it | Overlay/rescore **join on `scenario.id`**; evidence items keep stable ids; never mint a new scenario set because Grok renamed a row |
| Graph mutate / intervene API for SCM-lite | Graph is built once in `buildCausalGraph`; immutable thereafter | Pure `cloneGraph` + `intervene(graph, {player, move})` returning new links + inactivated edges. Compose stays graph-first; GT/SCM write **through** this API, not a second graph |
| Link confidence into rank | `CausalLink.confidence` written; `rankTrades` / `scoreTrade` ignore it | Rank factor vector includes governing link confidence (FinEng 5.1). Engine passes `confidence` through; FinEng owns weights |
| Crypto node kind not coerced to commodity | `TAG_NODE.crypto.kind === "commodity"`; `NodeKind` has no `"crypto"` | Add `NodeKind: "crypto"` (or preserve `TradeCategory:"crypto"` on the node). Round-trip rank/stress without commodity coerce. TRANSMIT: add `from:crypto` / risk-on / liquidity **generically**, no event ids |
| Provenance flags on probability writes | `event.probability` is a bare int; `auditOf` is identity; Grok path unmarked | `provenance: heuristic \| llm_proposal \| calibrated` on probability/scenario mass. Rescore LLM path **cannot** set `calibrated`. Engine persist; FinEng/DS fill |

### Integration seams (where DS/FinEng plug in)

1. **Cluster** — DS embeddings + labels-only triage after `relevance.ts`. Engine does not let the judge emit tickers or probabilities.
2. **Extract** — DS frames/stance/linked entities into `familyOf` / `playersFor`. **No crypto EventFamily** (DS lock); crypto is tags + `cryptoHonest` on the judge.
3. **Graph** — FinEng hops/confidence/lag moments replace canned strings **after** tags, **before** `tickersForTag`. `intervene` is the only graph rewrite.
4. **Scenarios** — FinEng `updateScenarios` writes real `ProbabilityAudit` (including `affectedNodes` / `rescoredAssets`). Overlay **appends** `ForecastSnapshot`.
5. **Rank / confirm** — FinEng crowding/confirmation/lead-lag features; Engine `rankTrades` stays the sorter; fields stay distinct.
6. **Live overlay** — quotes may refresh confirmation **without** mutating frozen forecasts. Replay = compose as-of T, not a timeline slider.
7. **Invariant guards (Engine)** — drop Grok tickers not on the graph; refuse calibrated flag on LLM path; freeze on material update; no MC until evidence model exists.

### Sequencing (do not start)

UX mockups parallel → this matrix → embeddings + LLM triage (labels only) → Bayesian + replay freeze → MC + Markov → richer confirmation (incl. crypto first-class). Hard nos unchanged: no end-to-end vibes LLM; no MC without evidence model; no sentiment-as-product; no fake calibrated single-prompt probs.

**Interface contracts:** [`docs/ENGINE-INTERFACE-CONTRACTS-v0.md`](./ENGINE-INTERFACE-CONTRACTS-v0.md). Crypto ontology pass is in `src/` (kind + TRANSMIT + bags + tests). Overlay/provenance/freeze append still unwired.

*Engine section last verified 2026-09-14. FinEng/DS math still docs-only until CoS greenlights those kernels.*
