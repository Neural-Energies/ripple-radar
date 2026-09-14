# Ripple Radar — Grok bot handoff

Read this before changing anything. Product purpose and the dynamic-engine directive are the source of truth. This file is the current implementation map.

## Product in one line

A **general-purpose, event-agnostic intelligence engine** that continuously discovers world events, constructs a full research object (scenarios, probabilities, game theory, causal graph, asset discovery, crowding, invalidation, lifecycle), and updates it as evidence arrives.

Trader slogan: *Don't trade the headline. Trade what the headline causes next.*

Name is still Ripple Radar. A better name is open.

## Non-negotiable invariants

1. **Zero hardcoded production events.** No Hormuz / Taiwan / Red Sea / rare-earth / FOMC default on the live desk. `src/data/catalog.ts` fixtures are calibration only.
2. **Causal graph first, then assets.** Never start from a ticker list and reverse-engineer a story.
3. **Family-appropriate scenarios.** Weather is landfall / glancing / miss. Policy is hike / hold / cut. Commodity is full / partial / harassment / fade. Not always bull / base / bear.
4. **Importance ≠ probability.** A 10% event can be extremely important.
5. **Unknown events must work.** "Chile nationalizes Atacama lithium brine" or "Germany bombs Russia" must construct a full object with no developer intervention.
6. Do not invent fake tickers. Attach liquid ones after the graph exists (CL, HO, RB, BWET, TSM, NVDA, TLT, UUP, KRE, BTC, JPY, HG, ITA, JETS, VIX, SPX, GC, TNX, …).

## Two discovery modes

| Mode | Entry | Path |
|---|---|---|
| A — auto | RSS world tape | `build.server.ts` → `clusterHeadlines` → `composeFromCluster` → `relateEvents` |
| B — user | "Analyze this event" | `analyze.server.ts` (Grok JSON) → fallback `composeFromText` |

Live desk never falls back to catalog `EVENTS`. Empty desk uses `EMPTY_EVENT` from `src/lib/engine/placeholder.ts`.

## Pipeline (engine knows HOW, world supplies WHICH)

Detect → Understand → Hypothesize → Probabilities → Players → Causal graph → Exposures → Markets → Update → Invalidate → Learn

Visualized as `PipelineStrip` on the desk (`src/lib/engine/pipeline.ts`). Daily loop copy lives on `/learning`.

## Engine modules (`src/lib/engine/`)

| File | Job |
|---|---|
| `tokenize.ts` | `hid`, tokens, proper phrases |
| `ontology.ts` | STOP, ESCALATE/DEESCALATE, LEXICON, TAGS, TRANSMIT hops, TICKER_TAGS, tone |
| `extract.ts` | entities, claims, family, industries, commodities, economic vars, subtype |
| `cluster.ts` | greedy headline clustering (Jaccard + entity overlap) |
| `graph.ts` | `buildCausalGraph` — core + TRANSMIT levels 1–4, then ticker attach |
| `hypothesize.ts` | family scenarios, game theory, expected evidence, knowledge, horizons, importance |
| `relate.ts` | event relationships (correlated / dependent / reaction_to) — requires shared entity or same family |
| `compose.ts` | orchestrates extract → graph → hypothesize → trades |
| `analyze.server.ts` | user-defined Grok call (`grok-4.5`, JSON), 45s rate limit, engine fallback |
| `game.ts` | generic 2-player matrix helpers (`GameCell {label, a, b}`) |
| `placeholder.ts` | `EMPTY_EVENT` |
| `pipeline.ts` | step list + daily loop |
| `instruments.ts` | liquid instrument helpers |
| `engine.test.ts` | engine unit tests |

## Live layer (`src/lib/live/`)

| File | Job |
|---|---|
| `build.server.ts` | RSS feeds + Yahoo spark quotes, cluster, compose, relate, cache (quotes 12s / news 40s) |
| `overlay.ts` | merge Grok-analyzed desk books onto live events (`overlayEvent`, `markDuplicates`) |
| `desk.ts` | persist optional analyzed payload |
| `discover.ts` | rank trades from graph + quotes |
| `rescore.server.ts` | optional Grok rescore |
| `provider.tsx` | `useActiveEvent`, analyzing flag, `runAnalyze` |
| `alerts.ts` / `symbols.ts` / `clock.ts` / `evidence.ts` | desk utilities |

Feeds are generic world/business/defense/energy/Fed/crypto RSS — not event-specific.

## Data model

`src/data/types.ts` is the contract. A `RadarEvent` includes:

- identity: id, title, region, theme, eventType, eventSubtype, summary, entities, organizations, people
- scoring: probability, importance, lifecycle, crowding, confirmation, reliability
- graph: nodes (level 0–4), links, trades
- research: scenarios, gameTheory, questions, knowledge (`known|likely|uncertain|unknown|critical`), expectedEvidence, invalidation, horizons, forecast snapshot
- evidence + relatedEvents

When you add a field, thread it through `compose.ts`, `analyze.server.ts` hydrate, and `overlay.ts`.

## UI

| Route | What |
|---|---|
| `/` | Desk: AnalyzeBar, PipelineStrip, CommandCenter, EventHero, RippleMap, Research tab |
| `/events` | Discovery vs monitoring, lifecycle filter, importance sort, analyze form |
| `/maps` | Causal / ripple map |
| `/scenarios` | Scenario book |
| `/game-theory` | 2-player matrix + player cards |
| `/assets` `/assets/$ticker` | Exposure universe |
| `/alerts` `/watchlists` `/portfolio` | Desk tools, cross-device sync when signed in |
| `/learning` | Daily pipeline + calibration copy |
| `/login` | Better Auth |

Key components: `src/components/dashboard.tsx`, `engine-panels.tsx`, `ripple-map.tsx`, `live-tape.tsx`.

Auth is ON (per-user watchlists / alerts / desk sync). Server functions that touch user data must use `authMiddleware` and `context.userId`. Preview uses PGLite; production uses `DATABASE_URL`.

## How to run

```bash
npm install
cp .env.example .env          # XAI_API_KEY optional
npm run dev                   # 0.0.0.0:8080
npm run typecheck
npm run test                  # includes src/lib/engine/engine.test.ts if wired; currently scripts + app-data/auth tests
node --experimental-strip-types --test src/lib/engine/engine.test.ts
```

Grok analyze degrades to `composeFromText` when `XAI_API_KEY` is missing — that path **must** still produce a complete event.

## Known gaps / next work

1. **Cluster quality.** Sparse news days over-merge on shared names (e.g. a person + an energy story). Thresholds live in `cluster.ts` (`jaccard >= 0.32` or `sharedEntCount >= 2 && sim >= 0.14`). Tune, do not special-case events.
2. **Relate noise.** `relate.ts` still occasionally links unrelated clusters that share a token (weather town named "Hurricane"). Tighten, keep generic.
3. **Grok JSON completeness.** Hydrate path in `analyze.server.ts` must survive missing horizons / knowledge / expectedEvidence. Prefer filling from `hypothesize.ts` rather than dropping fields.
4. **Quote coverage.** Yahoo spark batch in `build.server.ts` — add instruments via ontology/TICKER_TAGS, not per-event lists.
5. **Learning / calibration.** `/learning` is mostly explanatory. Persist forecast snapshots and score them after resolution.
6. **Crowding / confirmation.** Fields exist on trades; market-structure feed is thin (price/volume only).
7. **PWA / sync.** Installable; desk-sync debounce exists. Verify signed-in path against Postgres, not only PGLite.
8. **Tests.** Add compose/cluster/graph/hypothesize cases for *unseen* families (weather, policy, credit, corporate) — never assert a specific real-world event id.
9. **Name.** Product still "Ripple Radar". User asked for a better name (macro/prediction software). Don't bikeshed unless asked.

## What "done" looks like for a change

- An event the developer has never seen still produces: title, family-correct scenarios summing to 100, causal graph with level-0 core and hops, liquid tickers, game theory, knowledge states, expected evidence, invalidation, importance **and** probability.
- Live desk on a random day shows clustered tape events, not a fixture.
- `npm run typecheck` passes. Engine tests pass. No new hardcoded country/player/ticker tables in UI.

## Do not

- Restore catalog `EVENTS` as the default active book.
- Add `if (event === 'hormuz')` branches.
- Hardcode Iran / US / China as `GameCell` keys — cells are `{ a, b, label }`.
- Start from tickers and paint a graph backwards.
- Commit `.env`, `.grok/app-env.json`, or API keys.

## Origin

Built in Grok App Builder (TanStack Start sandbox). This GitHub repo is the handoff surface. Sandbox-only files (`startup.sh`, `.grok/`, preview scripts) are gitignored or platform-specific; keep `scripts/with-app-env.mjs` because `npm run dev` depends on it.
