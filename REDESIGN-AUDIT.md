# Ripple Radar — Institutional UX/UI Redesign Audit

Audit only. No application code was changed for this document.
Date: 2026-09-14.
Visual target: attached mockups (Live Desk, Assets, Scenarios/Game Theory, Event Causal Map, World Tape). Treat those as workstation density and layout language — **do not hardcode events, tickers, AUM, or metrics shown in them**.

Recent work already in the tree (uncommitted relative to `0d1e05c`) and must be preserved, not reverted:

- Map-first desk (`src/components/dashboard.tsx` default tab `"Ripple Map"`; Analyze/Pipeline/Desk loop collapsed under Desk tools).
- Relevance gate (`src/lib/engine/relevance.ts`; wired in `cluster.ts` + `build.server.ts`).
- Map node → asset (`src/components/ripple-map.tsx` `navTarget` / `resolveNodeTicker`).
- Docs route (`src/routes/docs.tsx`).
- Transmission popup (`TransmissionPanel` in `dashboard.tsx`).
- Kauai / weather-only gate (`relevance.ts` `weatherOnly` — local forecast with no energy/ag/shipping hop is dropped).

---

## CURRENT PRODUCT MODEL

Ripple Radar is an **event-agnostic macro intelligence engine**, not a canned-event dashboard.

**Slogan (product, not chrome):** Don't trade the headline. Trade what the headline causes next.

**What it actually does today**

1. **Ingest a world tape.** `src/lib/live/build.server.ts` pulls generic RSS (BBC/NYT/CNBC/Fed/Defense One/OilPrice/CoinDesk/Google News, etc.) and Yahoo Finance spark quotes for `DESK_TICKERS` (`src/lib/live/symbols.ts`). Cache: quotes 12s, news 40s. Poll client: 15s (`src/lib/live/provider.tsx`).

2. **Gate noise.** `filterMarketRelevantHeadlines` / `filterMarketRelevantClusters` (`src/lib/engine/relevance.ts`) keep only items with a transmission path to liquid markets. Soft news (sports, crime, celebrity) and weather-only (Kauai-style local forecast) are dropped. This is why a Kauai police/scam or sports headline should not become the lead book.

3. **Cluster → compose a full `RadarEvent`.** `clusterHeadlines` (`src/lib/engine/cluster.ts`) greedy-clusters by Jaccard + entity overlap. `composeFromCluster` (`src/lib/engine/compose.ts`) then runs extract → `buildCausalGraph` → `hypothesize` (family scenarios, game theory, knowledge, expected evidence, horizons, importance) → `rankTrades`. `relateEvents` (`src/lib/engine/relate.ts`) attaches up to 3 related books.

4. **User-defined books (Mode B).** Analyze bar (`dashboard.tsx` `AnalyzeBar`, duplicated on `/events`) calls `runAnalyze` → `analyze.server.ts` (Grok JSON, 45s rate limit) with fallback `composeFromText`. Result is a `DeskBook` with `payload` in Zustand (`src/lib/store.ts`). Instant book on `/events` can open a **thin shell with no payload**.

5. **Desk overlay.** `overlay.ts` merges live quotes, evidence, rescore shifts onto the constructed book. Empty desk uses `EMPTY_EVENT` (`placeholder.ts`) — **never catalog `EVENTS`** (there is no `EVENTS` export in `catalog.ts` anymore; fixtures are `MODEL_STATS`, `DEFAULT_PORTFOLIO`, `SEED_ALERTS`, `LEVEL_META`).

6. **Trader objects on the book.** Causal graph (nodes level 0–4 + `CausalLink`s with direction, distance, confidence, lag, invalidation), family-correct scenarios summing to 100, 2-player game matrix (`GameCell {a,b,label}`), ranked trades with crowding/confirmation/causalPath, evidence trail, knowledge/questions/invalidation, related events.

7. **Blotter (signed-in).** Watchlists, alerts, custom scenarios, selected event, desk books persist locally (`zustand/persist` key `ripple-radar-v2`) and optionally to `desk_state` (`src/lib/desk-sync.ts`) when authenticated.

**What a trader can do in the current UI**

- Watch a scrolling quote tape + one headline (`live-tape.tsx`) and a stacked dashboard of the selected book (`/`).
- Open `/events` to filter clustered tracks, paste Analyze text, or click a headline into the draft box (does **not** open the cluster as a book).
- Open `/maps` for the same ripple SVG + a causal-links table.
- Open `/scenarios` and `/game-theory` for the same book's scenarios/matrix, with a **separate event-chip row** on each page.
- Browse `/assets` ranked for the selected shock; click a map node or ticker to `/assets/$ticker`.
- Manage `/watchlists`, `/alerts`, `/portfolio` (illustrative), `/learning` (fixture calibration), `/docs`.

**Two Zustand stores**

| Store | File | Role |
|---|---|---|
| `useApp` | `src/lib/store.ts` | `selectedEventId`, watchlists, alerts, customScenarios, deskBooks, commandOpen. Persisted. |
| `useLive` | `src/lib/live/provider.tsx` | desk snapshot, status, rescores, alert hits, analyzing/rescoring. Not persisted. |

`useActiveEvent()` only runs on `/` (`src/routes/index.tsx`). Other routes read `selectedEventId` but do **not** auto-heal a stale id except via `liveGetEvent` falling back to `all[0]`.

There is **no URL param** for the active event. Selection is Zustand-only (plus cloud desk_state when signed in).

---

## CURRENT UX PROBLEMS

Tied to files. These are why the product feels like a demo dashboard rather than an institutional workstation.

### 1. Dual, inconsistent navigation

`src/components/app-shell.tsx`:

- `TOP_NAV` (9 items): Dashboard, Events, Scenarios, Assets, Game Theory, Learning, Docs, Portfolio, Alerts. **Missing Maps and Watchlists.**
- `SIDE_NAV` (10 items): Live Overview, Event Feed, Ripple Maps, Scenario Lab, Asset Explorer, Game Theory, Model Learning, Docs, Portfolio, Watchlists. **Missing Alerts.** Different labels for the same routes.
- Plus a sticky `LiveTape` strip, plus `LiveStatus` under it, plus a slogan `<blockquote>` in the sidebar footer.
- Command palette (`command-palette.tsx`) is a third copy of the page list (`PAGES`).

Result: two chrome systems, overlapping labels, no grouping, ~52px header + tape + status eating vertical space before the book starts. Mockups show **one** grouped left rail + a utility top bar.

### 2. Dashboard is a kitchen sink (`src/components/dashboard.tsx`, ~1000 lines)

Default "Ripple Map" tab still stacks, in order:

1. EventHero (badges, title, 7 tabs)
2. Map + ImpactBars + ProbabilityChart + Market Reaction + Narrative Heat
3. AnalyzeBar + collapsible Desk tools (PipelineStrip, DeskLoop, CommandCenter)
4. Transmission + Reflexivity
5. Horizon + Related + Actors
6. Scenario + Game Theory + Trades (compact)
7. ModelPanel (fixture `MODEL_STATS`) + Evidence + PortfolioPanel (fixture `DEFAULT_PORTFOLIO`)

Then six other tabs (Research, Key Takeaways, Timeline, Related Assets, Sentiment, Sources) hide the map and re-show overlapping research. Key Takeaways duplicates Research questions/invalidation. Related Assets duplicates the compact trades panel.

The map is "first" but not **dominant**. Mockup Live Desk is a 12-column workstation: developing-now strip, map as the stage, analysis column, exposures/evidence footer — not a long scroll of every panel.

### 3. Active event is not a first-class, route-synced object

- `selectedEventId` lives in Zustand; routes `/maps`, `/scenarios`, `/game-theory` each render their own chip row to change it (`events.map` buttons — `/scenarios` even labels chips by **region**, not title).
- Clicking a related book (`RelatedEventsPanel`) only `setSelectedEventId` — stays on the same route, no URL, no hero update guarantee if the user copied a link.
- `/events` "Open on dashboard →" navigates to `/` after set; `/game-theory` "Back to desk" is a text link. No shared EventContext chrome.
- Command palette event items always `to: "/"` — cannot land on maps/scenarios with that book selected via URL.

### 4. World tape is not a workflow

Clustering exists in the engine and is thrown away at the UI boundary:

- `build.server.ts` `discover()`: `clusterHeadlines` → `composeFromCluster` → `relateEvents`. `LiveDesk` stores `liveEvents` + `headlines`. **`Cluster` is not on `LiveDesk`.**
- `/events` "World tape" is a 12-row list; click copies title into Analyze draft, it does **not** select the cluster/book.
- Headlines on the status line show only `desk.headlines[0]`.
- No cluster explorer, no landscape, no "open book from this cluster".
- Developing-now (`CommandCenter`) is buried inside collapsed Desk tools and only shows 5 events.

### 5. Charts that look live but are synthetic

| Chart | Component | Backing | Truth |
|---|---|---|---|
| Event Probability area | `ProbabilityChart` ← `event.probabilityHistory` | `compose.ts` synthesizes T-3/T-2/T-1 as `probability-8/-4/-2` | Not a time series |
| Narrative Heat | `HeatChart` ← `event.narrativeHeat` | `compose.ts` invents `social` and `search`; news is `28+hits*6` | No social/search feed |
| Model Learning | `LearningChart` / `CalibrationChart` | `MODEL_STATS` in `catalog.ts` | Frozen fixture, shown on live desk |
| Balanced ripple donut | `Donut` | `DEFAULT_PORTFOLIO` | Static weights, not holdings |
| Max DD | `/portfolio` | hardcoded `−8%` | Fake |
| Sentiment bars | `event.sentiment` | derived from hit counts / tone / session move | Heuristic, not a sentiment product |
| Scenario "path" lines in mockup | — | **no field** | Cannot render |

ImpactBars (`event.impacts` from node.impact) and Yahoo `changePct` / `spark` **are** real enough to keep.

### 6. Research objects are buried or duplicated

Buried behind tabs or other routes, despite being the product:

- Transmission + invalidation (now a popup — good — but the list is still below the fold on the map tab).
- Knowledge / expected evidence (`engine-panels.tsx`) only on Research tab.
- Game theory likely-play is a cramped table on the desk and a full page that does not share layout with scenarios (mockup combines them).
- Crowding vs confirmation on trades is tiny badges in the trades list; mockup Event Causal Map puts them in the **hero** (Crowding / Confirmation chips). `RadarEvent.crowdingState` / `confirmationState` exist (`types.ts`, set in `compose.ts`) but EventHero does not show them.
- Importance vs probability: EventHero shows `imp N` and the probability chart is a side card. Mockup treats them as paired hero metrics (e.g. 68% and 8.7/10). We have integer 8–99 importance, not a 10-scale — **do not fake 8.7/10**.

### 7. Assets / Portfolio / Watchlists / Alerts are four products

- `/assets` is a table (good, ranked for selected shock) with no exposure scatter. Scatter **can** be built from real fields: `distance` (x) vs `score` (y), `change` as color, `crowding` as size.
- `/portfolio` paints `DEFAULT_PORTFOLIO` + EW session % of `event.trades` + fake Max DD. There is no blotter of user weights.
- `/watchlists` is a real client blotter (Zustand) but not visible on the assets page.
- `/alerts` is a real rule list with `evaluateAlerts` (`live/alerts.ts`) but the header bell only goes to `/alerts`; no inline firing strip on the desk (mockup "Active Alerts" rail).

Mockup "Assets & Portfolio" merges explorer + watchlists + alerts + a **fake $12.4M donut**. Merge the **real** pieces; do not invent AUM.

### 8. Chrome density vs. phone screenshots of the current app

Current mobile (attachments of the live preview): hamburger, dual "Desk tools", truncated event pills, map legend competing with the graph, transmission as a long list. Institutional target is a dense dark workstation (IBM Plex already in `styles.css`). Redesign should be **desktop-first workstation**; keep the existing mobile hit targets (`ripple-map.tsx` `MIN_HIT_R`, transmission dialog) but stop laying the product out as a stacked marketing page.

### 9. Copy and coach marks on the live desk

- Sidebar slogan quote (`app-shell.tsx` `Quote`).
- PipelineStrip "How to reason — not which events" lives on the live desk (collapsed, still in the way).
- Docs (`/docs`) correctly says "no coach marks on the live screens" — the desk still has them.
- Analyze placeholder examples ("A pipeline is hit. FOMC hikes 50bp…") are fine as input hints, not as events.

### 10. Event chip rows and region-as-identity

`/scenarios` chips show `e.region` — two weather events in "US" collide. `/maps` and `/game-theory` truncate titles in max-w chips. This is a symptom of no global event picker.

---

## PROPOSED INFORMATION ARCHITECTURE

**One nav system:** left rail only, grouped. Delete `TOP_NAV`. Top bar becomes utilities, not pages.

### Left rail groups

```
DESK
  Live Desk          /                 selected book's workstation
  World Tape         /events           stream → clusters → open book
                     (optional alias /tape later; do not add a third route now)

RESEARCH
  Ripple Map         /maps             causal graph + node inspector + links
  Scenarios          /scenarios        family scenarios + probability audit
  Game Theory        /game-theory      players + matrix + likely play
                     (scenarios + game theory may share a layout chrome
                      with subviews, but keep both routes)

MONITOR
  Assets             /assets           exposures for the selected shock
  Watchlists         /watchlists
  Alerts             /alerts
  Portfolio          /portfolio        only if it becomes "ranked expressions
                                       for this book", not fake AUM

MODEL
  Learning           /learning         fixture calibration, clearly labeled
  Docs               /docs             how to use; no coach marks on desk
```

Drop from chrome (keep routes): none of the current routes need to die on day one. **Do** stop putting Portfolio/Learning/Docs in the primary operator path. Learning and Docs belong under MODEL, last. Login stays unshell'd (`__root.tsx` `ShellGate`).

**Command palette `PAGES`** must match this grouping (same labels, same order).

### Top utility bar (not a second nav)

Left → right, single 40–44px row (`app-shell.tsx` header + merge `LiveStatus` into it; keep or kill the marquee `LiveTape` — see World Tape):

1. Logo → `/`
2. Live pill (`useLive.status`) + ET clock (`clock.ts` already) + session flags NY/LDN/TYO/FUT (already on `LiveDesk.sessions`)
3. **Active event control** — title, lifecycle, importance, probability; opens a compact switcher of `useLiveEvents()` sorted by importance. This replaces every per-page chip row.
4. Quote tape: either a compact 6–8 names derived from **the selected book's tickers** (not the hardcoded `TAPE` array in `live-tape.tsx`) or move the universe tape exclusively onto World Tape.
5. Search → existing `setCommandOpen` / ⌘K
6. Alerts bell with firing count (`useAlertHits`)
7. `AuthSlot`

**Do not** implement mockup "Global / US / China / Gulf / Russia" and "Oil / Gold" filter chips unless they filter **live** `event.region` / `event.commodities` lists derived from current books. No hardcoded geo/commodity taxonomies in the chrome.

**Do not** add an "Ask Ripple" LLM chat. Analyze already exists.

### Main canvas contract

- **Live Desk `/`:** developing-now strip (top, always visible, not inside Desk tools) + ripple map stage + right analysis column (importance, probability **level**, scenario mix as a **bar of current scenario.probability**, market reaction from quotes) + bottom exposures + evidence. Analyze is a compact bar, not a hero.
- **World Tape `/events`:** three panes — headline stream, cluster explorer, event preview / open book. Analyze form stays here as Mode B.
- **Ripple Map `/maps`:** map + node inspector (hover/click already partly in SVG) + causal links table. No second copy of the whole desk.
- **Scenarios + Game Theory:** one visual family (mockup combines them). Keep routes; share a research-header (active event) and tab or two-pane layout: scenarios left/top, matrix + "what this does to the book" right/bottom. "What this does" = existing `gt.insight` + likely cell (`readMatrix`) + which scenario names move — **not** a new fake path chart.
- **Assets:** scatter (distance × score) + table + watchlist/alert side rails using **real** Zustand lists. No $12.4M donut.
- **Learning / Docs:** remain explanatory. Label MODEL_STATS "frozen calibration class, not this desk's live Brier".

---

## PROPOSED ACTIVE-EVENT WORKFLOW

**Invariant:** there is exactly one selected research object at a time. Every DESK/RESEARCH/MONITOR view reads it. Switching it is a desk action, not a page-local chip.

### State

Keep `useApp.selectedEventId` (already persisted + cloud-synced). Add **URL search `event`** on the routes that are views of a book:

- `/` `/maps` `/scenarios` `/game-theory` `/assets` `/portfolio`
- Optional on `/assets/$ticker` (asset is primary; event remains context)

`/events` (World Tape) may use `?event=` when previewing a cluster/book, and `?cluster=` if clusters are surfaced.

### Sync rules

1. On navigation, if `search.event` is a known id → `setSelectedEventId`.
2. If `search.event` missing → write current `selectedEventId` into the URL (`replace: true`) so links are shareable.
3. If id unknown (tape rotated the cluster id) → `useActiveEvent` already heals to `events[0]`; write the healed id to URL.
4. Related-event click, Developing-now click, command-palette event pick, World Tape "open book" all: `setSelectedEventId` + navigate to Live Desk **or** stay on current research view while updating `?event=`. Prefer **stay on current view** when already on RESEARCH; go to `/` when opening from World Tape.

### UI that must share the event

Replace local chip rows in:

- `src/routes/maps.tsx`
- `src/routes/scenarios.tsx`
- `src/routes/game-theory.tsx`

with the utility-bar event control. `EventHero` on the desk becomes thinner (lifecycle, subtype, importance, crowdingState, confirmationState, title, summary, rescore). Crowding/confirmation belong here — they are already on `RadarEvent`.

### Minimal plumbing

- TanStack Router `validateSearch` `{ event?: string }` on those routes (copy the pattern from `assets.tsx` `q`).
- A 20-line `useEventParamSync()` hook used by `AppShell` or each route — **do not** introduce a new global store.
- Command palette event items should set id and `to` = current path or `/`.

No backend change. Cluster ids are already stable-ish (`ev-` + hid) for the session; they are not durable primary keys — URL share across days is best-effort.

---

## PROPOSED WORLD-TAPE / CLUSTER WORKFLOW

Today the pipeline is Stream → **hidden Cluster** → Event. The UI jumps from a raw headline list to a fully composed book. The mockup World Tape is the missing middle.

### Three panes (single route `/events`)

**A. Live headline stream** (already `desk.headlines`, already relevance-filtered)

- Columns: time, source, title, tone, stamped `eventIds`.
- Clicking a headline **highlights its cluster** (via `eventIds`), does not dump text into Analyze unless the user explicitly "Analyze this headline".
- Keep Analyze + Instant book as a Mode B strip above or below — Instant book without payload should be visually secondary (it produces an empty-ish shell).

**B. Cluster explorer** (needs a small data plumbing change)

`Cluster` (`src/lib/engine/cluster.ts`) already has: `id, title, headlines, entities, tags, tone, significance, sources, newest, oldest`.

`LiveDesk` does **not** currently carry clusters. Minimal plumbing:

- Add `clusters: Cluster[]` (or a client DTO: id, title, significance, sources, headlineCount, entities, tags, tone, newest, eventId) to `LiveDesk` in `types.ts`.
- `discover()` already has them in memory — return them from `buildDesk()` instead of dropping them after `composeFromCluster`.
- Do not fetch extra APIs.

Cluster card (real fields only): title, `headlines.length`, `sources`, `significance`, `tone`, `tags`/`entities`, age from `newest`. Sort by significance (already). Click → preview.

**Cluster landscape** (optional, only if axes are real): x = recency (`newest`), y = `significance`, size = `headlines.length`, color = `tone`. **Do not** invent "narrative vs market" axes.

**C. Event preview → open book**

If the cluster has a composed `liveEvents` row with the same id (`composeFromCluster` uses `cluster.id`): show title, importance, probability, lifecycle, top 3 trades, 3 evidence lines, "Open on desk". That call sets `selectedEventId` and navigates to `/`.

Do **not** auto-open every cluster as the active desk book. The desk shows the selected book; the tape is the observatory.

### What not to copy from the World Tape mockup

- KPI tiles "412.7 mln / 284 headlines / 23 clusters / 2 high importance" unless counted from `desk.headlines.length`, `clusters.length`, and `events.filter(importance ≥ threshold).length`.
- "Fed officials signal higher…" as a hardcoded preview.
- Source logos / fake sentiment donuts on the preview.

---

## PROPOSED CHART SYSTEM

Rule: **a chart ships only if every series is a real field produced by compose/live overlay/Yahoo, or is explicitly labeled fixture.** Prefer current-state encodings (bars, matrix, map) over fake history.

### Keep / restyle (real)

| Visual | Source field | Notes |
|---|---|---|
| Ripple map SVG | `event.nodes`, `event.links` | Already the product. Make it the desk stage. Keep node→asset. |
| Impact bars | `event.impacts` ← node.impact | Current snapshot, not a time series. Fine. |
| Market reaction list | `event.marketReaction.change` overlaid with `quotes[ticker].changePct` | Prefer live quote; show quote state (live/last). |
| Sparklines | `LiveQuote.spark` | Session path. Real. |
| Scenario probability bar / stacked bar | `event.scenarios[].probability` | Current mass, sums ~100. **Not** a path-over-time chart. |
| Horizon bars | `event.horizons[]` | Real constructed field. |
| Importance vs probability meters | `event.importance`, `event.probability` | Pair them. Do not rescales to 8.7/10. |
| Game matrix + Nash/likely | `event.gameTheory` + `readMatrix` / `isNash` | Keep. Heatmap coloring of cells from `{a,b}` is OK (those numbers are constructed, same as today's table). |
| Evidence list | `event.evidence` | Not a chart. Primary. |
| Source counts | `event.sources[]` | A bar of counts is truthful; a "source diversity" index is not unless defined. |
| Asset scatter | `AssetRecord.distance` × `score`, color `change`, size/crowding | Real. |
| Asset table | existing `/assets` | Real. |
| Watchlist marks | Zustand + Yahoo last | Real. |
| Alert hits | `evaluateAlerts` | Real. |
| Developing-now strip | `useLiveEvents()` sorted by importance | Real. |

### Relabel as fixture (do not put on Live Desk)

| Visual | Source | Treatment |
|---|---|---|
| Accuracy / Brier / lead time / calibration | `MODEL_STATS` (`catalog.ts`) | `/learning` only, copy: "Frozen class-level calibration. Not this book's live skill." |
| Scored forecast ledger | `MODEL_STATS.scoredForecasts` | Same. Generic shipping-lane / cartel wording is already event-agnostic — keep it that way. |
| `DEFAULT_PORTFOLIO` donut | `catalog.ts` | Remove from Live Desk `PortfolioPanel`. On `/portfolio`, either drop the donut or label "illustrative distance mix, not your capital". |
| Max DD `−8%` | `portfolio.tsx` | Delete. |

### Remove from the live desk (synthetic / misleading)

| Visual | Why |
|---|---|
| `ProbabilityChart` area of T-3…Now | `compose.ts` backfills from current probability. A single number + delta (`probability`, `probabilityDelta`) is honest. |
| `HeatChart` news/social/search | No social, no search API. News count **today** can be `evidence.filter(kind==news).length` as a scalar, not a 3-series chart. |
| Sentiment 0–100 gauges | Heuristic of hits/tone/move. Show as labeled heuristics on Research if at all, not "Narrative Sentiment" product. |
| Scenario path line charts (mockup) | No `scenario.probability` history. `prevProbability` is a single previous snapshot after rescore/shift — enough for a delta badge, not a line. |
| World map of events | No lat/lng. `event.region` is a string from `regionFromText`. A region tag is enough. |
| Portfolio AUM / % Equities 42% (mockup) | No holdings. |

### Optional truthful substitutes

- Probability **delta** badge using `probabilityDelta` / scenario `audit.previous → updated` after rescore (`overlayScenarios`).
- Evidence arrival: `event.timeline` (from clustered headlines' pub dates) as a vertical list — already exists, currently a tab.
- Confirmation: session `changePct` vs node.direction (already `confirmationOf` in `discover.ts`).

---

## FILES EXPECTED TO CHANGE

Redesign implementation (future; not done in this audit). Engine math stays; chrome and a little live DTO plumbing move.

### Shell / IA

- `src/components/app-shell.tsx` — single grouped rail; utility top bar; remove Quote; merge LiveStatus.
- `src/components/live-tape.tsx` — either selected-book tickers or World Tape only; delete hardcoded `TAPE` universe as the global chrome.
- `src/components/command-palette.tsx` — match grouped nav.
- `src/components/logo.tsx` — keep; compact in rail.
- `src/styles.css` — already institutional dark; tighten spacing/radius toward mockup density, no new palette required.
- `src/routes/__root.tsx` — only if shell composition changes.

### Desk / research views

- `src/components/dashboard.tsx` — **largest cut**. Map-first workstation; pull ModelPanel/PortfolioPanel/Heat/ProbabilityChart off the live canvas; surface crowding/confirmation on hero; Developing-now always visible; Analyze compact.
- `src/components/engine-panels.tsx` — reuse on desk right column / research tab; PipelineStrip off the live desk (Docs/Learning only).
- `src/components/ripple-map.tsx` — keep navigation; restyle to match causal-map mockup (node inspector already a hover card — promote).
- `src/components/charts.tsx` — stop using HeatChart/ProbabilityChart/LearningChart/Donut on the desk; keep ImpactBars; add a simple scenario stacked bar if needed.
- `src/routes/index.tsx` — likely still `<Dashboard />` + event param sync.
- `src/routes/events.tsx` — World Tape three-pane; stop using headline click as Analyze-draft-only.
- `src/routes/maps.tsx` — drop chip row; inspector layout.
- `src/routes/scenarios.tsx` — drop region chips; share research header; do not add fake path charts.
- `src/routes/game-theory.tsx` — drop chip row; optional combined layout with scenarios.
- `src/routes/assets.tsx` — scatter + table; optional watchlist/alert rails.
- `src/routes/assets.$ticker.tsx` — keep; ensure event context from global id.
- `src/routes/portfolio.tsx` — strip fake DD/donut or relabel.
- `src/routes/alerts.tsx` / `watchlists.tsx` — keep; maybe embed summaries on assets/desk.
- `src/routes/learning.tsx` — fixture labeling.
- `src/routes/docs.tsx` — update IA names (Live Desk / World Tape) once chrome lands.

### Minimal data plumbing (not engine rewrites)

- `src/lib/live/types.ts` — `clusters?` on `LiveDesk`.
- `src/lib/live/build.server.ts` — return clusters from `discover`/`buildDesk`.
- `src/lib/live/provider.tsx` — `useLiveClusters()` selector; event-param-friendly `useActiveEvent`.
- `src/lib/store.ts` — probably unchanged except maybe UI prefs; **do not** add a second selected-event store.
- `src/lib/desk-sync.ts` — already persists `selectedEventId`; URL is extra, not a replacement.

### Engine (touch only if UI needs a field that is almost there)

- `src/lib/engine/cluster.ts` / `relevance.ts` / `compose.ts` / `graph.ts` / `hypothesize.ts` / `relate.ts` / `analyze.server.ts` — **no redesign-driven rewrites**. Do not add social/search. Do not persist fake history.
- Optional later: stop writing synthetic `probabilityHistory` / `narrativeHeat` in `compose.ts` so the UI cannot accidentally chart them.

### Do not churn

- `src/data/types.ts` unless adding a cluster DTO type (Cluster can stay in engine and be mapped).
- Auth, PGLite, migrations, `ontology.ts` transmission rules (Kauai gate lives in relevance, keep it).
- `src/data/catalog.ts` fixtures — do not reintroduce `EVENTS`.

---

## DATA GAPS

Desired mockup pixels that **cannot be truthfully rendered** with current fields/feeds.

| Mockup desire | Missing truth | Honest substitute |
|---|---|---|
| Probability history spark (days) | Only synthesized T-3…Now; `forecasts[]` is a single snapshot at compose time | Show current `%` + `probabilityDelta`; after rescore, scenario audit previous→updated |
| Narrative heat: news / social / search | RSS only. No social, no search API | Headline count on the cluster/book; omit social/search |
| Importance 8.7/10 | Integer ~8–99 (`importanceOf`) | Display `importance` / 99 or raw 0–99. Do not mint a 10-scale |
| Crowding "Moderate" / Confirmation "Elevated" as hero | Enums exist (`crowdingState`, `confirmationState`) but are coarse and derived from mentions+session move, not positioning data | Show the enum; do not invent "Elevated" |
| World map dots | `region` is a string; no coordinates | Region chip |
| Cluster KPIs in millions of "impressions" | No such metric | `headlines.length`, `sources`, `significance` |
| Cluster landscape "market vs narrative" | No such axes | Recency × significance if clusters are exposed |
| Scenario path charts (4 lines vs time) | No per-scenario history | Current stacked bar + prevProbability delta |
| Payoff heatmap as a separate market product | Matrix cells are constructed payoffs, not estimated utilities from data | Color the existing matrix; keep insight string |
| "$12.4M portfolio" / sector mix | No positions, no NAV | Ranked expressions + user watchlists |
| Max DD / session P&L as strategy performance | EW average of Yahoo `%` on suggested names is not P&L | Session move per ticker, not a portfolio statistic |
| "Market Neutral" desk regime | No regime model | Omit, or derive a label only from live `confirmationState` across books with a documented rule |
| Source diversity chart | Counts exist; a diversity **index** does not | Bars of `event.sources` |
| Historical replay that actually freezes information | `/learning` slider uses `timeline` or fixture scoredForecasts; it does not recompute the book as-of | Leave on Learning as UX sketch; do not put on Live Desk |
| Live Brier/accuracy of this engine | `MODEL_STATS` is frozen; `forecasts[]` is not scored on resolution | Learning page only |
| Ask Ripple chat | Analyze is a one-shot JSON construct | Keep Analyze; no chat thread |
| Region/commodity filter chips (US, China, Gulf, Oil, Gold) | Would need a stable facet list from current events | Dynamically list `event.region` / `commodities` values present **today** |
| Persistent cluster ids across process restarts | `ev-` + hash of entities/title; tape rotation changes membership | Session-scoped; don't promise permalinks |

**Crowding / confirmation depth:** `discover.ts` uses headline mention counts + session `%`. HANDOFF already flags market-structure as thin (no volume, OI, options). UI may show the enum; it must not look like a positioning product.

**Instant book** (`/events` without `runAnalyze`) stores `{id,title,region,note}` with **no payload** → `openBook` in `overlay.ts` calls `composeFromText`. That is a real book, but weaker than Grok analyze. UI should distinguish "engine book" vs "model book" (`analyze.server.ts` already returns `source: "model" | "engine"` — currently discarded at `runAnalyze`).

---

## RED FLAGS

Ideas that would violate product invariants. Do not implement even if the mockup shows them.

1. **Hardcoding mockup events.** Israel–Iran strikes, Fed-officials-signal, Hormuz, Taiwan, Red Sea, rare earths as default books. `AGENTS.md` / `HANDOFF.md`: zero hardcoded production events. Mockups are costume; the engine supplies WHICH.

2. **Restoring catalog `EVENTS` as the live desk default.** `EMPTY_EVENT` is the empty state. Fixtures stay in `catalog.ts` for calibration.

3. **`if (event === 'hormuz')` or country-locked game keys.** Game cells stay `{a,b,label}`. Players come from `playersFor` / Grok, not a US/China/Iran table. The mockup matrix with United States / China flags is a drawing.

4. **Fake metrics that look institutional.** AUM, Max DD −8%, social/search heat, 8.7/10, "412.7 mln", live 61% accuracy on the desk, Market Neutral index without a spec.

5. **Starting from tickers and painting a graph backwards.** Assets page scatter is **distance vs score from the selected shock**, not a free-floating universe to invent a story from. Causal graph first (`graph.ts`).

6. **Universal bull/base/bear scenarios** to match a pretty four-card layout. Families stay weather/policy/commodity/credit/kinetic/corporate (`hypothesize.ts` `scenariosFor`).

7. **Collapsing importance into probability** (or the reverse) to get a single hero number.

8. **Bypassing the relevance / weather gate** so the tape looks "busy" (Kauai scams, sports, celebrity). Empty-ish tape on a quiet market day is correct.

9. **A second nav** (keeping TOP_NAV + SIDE_NAV) or renaming routes without deleting the duplicate chrome.

10. **New LLM surfaces** (Ask Ripple, auto-rescore every 15s, chat). Analyze + manual Rescore already exist; 45s rate limit is load-bearing.

11. **Inventing tickers** not in `TICKER_META` / Yahoo map.

12. **Treating `probabilityHistory` / `narrativeHeat` as market data** in the redesign. If charts need history, persist real snapshots first (`forecasts[]` is the intended freeze — HANDOFF gap #5). Until then, don't chart it.

13. **World map / geo GIS** without a geocoder. Region string only.

14. **Per-page selected event** (local React state) that desyncs from `selectedEventId`.

15. **Coach marks, slogan blocks, and PipelineStrip on the operator canvas.** Docs exist.

---

## ANSWERS TO THE 10 IDENTIFY QUESTIONS

### 1. What does the product do?

A general-purpose engine that turns a live world tape (or a pasted shock) into a **research object**: causal ripple, family scenarios, game theory, ranked second-order exposures, crowding/confirmation heuristics, invalidation, lifecycle. The trader is supposed to fade the crowded first print and trade the transmission. See CURRENT PRODUCT MODEL.

### 2. What is live vs fixture?

**Live / constructed at runtime**

- RSS headlines, Yahoo quotes/sparks, session clocks (`build.server.ts`, `clock.ts`).
- Clusters, composed `RadarEvent`s, relatedEvents, trades ranked with live `%` (`cluster`, `compose`, `discover`, `overlay`).
- Desk books from Analyze (`analyze.server.ts` / `composeFromText`).
- Watchlists, alerts, custom scenarios, selectedEventId (Zustand ± `desk_state`).
- Alert evaluation against live tape (`live/alerts.ts`).

**Fixture / synthetic (must not impersonate live skill)**

- `MODEL_STATS`, `DEFAULT_PORTFOLIO`, `SEED_ALERTS` (`catalog.ts`).
- `probabilityHistory`, `narrativeHeat.social/search`, much of `sentiment` (`compose.ts`).
- Portfolio Max DD −8%.
- Hardcoded `TAPE` ticker list in `live-tape.tsx` (quotes are live; membership is a canned universe).
- Learning replay when it falls back to `scoredForecasts`.

**Empty, not fixture:** `EMPTY_EVENT`, `EMPTY_HEADLINES`, `EMPTY_QUOTES`.

### 3. What is duplicated?

- Top nav vs side nav vs command palette page lists (`app-shell.tsx`, `command-palette.tsx`).
- Event chip switchers on maps / scenarios / game-theory.
- Analyze form on dashboard and `/events`.
- Scenarios + game theory + trades: desk panels **and** dedicated routes.
- Research tab vs Key Takeaways (questions + invalidation).
- Trades compact on map tab vs Related Assets tab vs `/assets` vs `/portfolio` table.
- Evidence on desk EvidencePanel vs `/events` story panel vs Sources tab.
- Transmission list vs `/maps` causal links table vs popup (the popup is the right pattern — table belongs on Maps).
- LiveStatus region + EventHero region + status headline.

### 4. What information is buried?

- Causal transmission and invalidation (below the fold; popup helps).
- Knowledge, expected evidence, horizons (Research tab / tertiary panels).
- `crowdingState` / `confirmationState` (not on the hero).
- Developing-now (inside collapsed Desk tools).
- Cluster objects (never sent to the client).
- Related events (small panel; click doesn't change route).
- Quote state live vs last (`assets.$ticker` shows it; desk market-reaction does not).
- Analyze source model vs engine (dropped in `runAnalyze`).
- Docs — good content, but the live desk still explains itself instead of pointing here.

### 5. What nav is unnecessary?

- The entire `TOP_NAV` once a grouped rail exists.
- Sidebar slogan.
- Separate chrome entries for "Live Overview" vs "Dashboard" (same `/`).
- Putting Learning, Docs, Portfolio, Alerts as equal peers of the desk. Alerts stay as a bell; Portfolio/Learning/Docs recede into MONITOR/MODEL.
- Seven EventHero tabs. Replace with desk layout + RESEARCH routes. Keep Research as an on-desk column or a single "Book" drawer, not seven modes.

### 6. What global state exists?

- `useApp`: selectedEventId, watchlists, alerts, customScenarios, deskBooks, commandOpen, hydrated (`store.ts`). Persisted `ripple-radar-v2`. Cloud: `desk_state`.
- `useLive`: desk, status, error, rescores, hits, analyzing, rescoring (`provider.tsx`). Session only.
- Router: `assets` search `q`; **no event search param**.
- No React context for the active event besides those stores + `useActiveEvent` on `/` only.

Redesign should add URL `event` sync, not a third store.

### 7. Which interactions can stay purely client-side?

- Nav grouping, tab/layout, command palette, event switcher UI, map hover/inspector, transmission dialog, scenario expand, watchlist pin, alert pause/create, custom scenario add, filters/sorts on assets and events, scatter encodings, collapsing Analyze, keyboard ⌘K.
- `selectedEventId` changes (already client; URL write is client).
- Chart removal/relabel.

Needs existing server functions (do not reinvent): `getLiveDesk`, `analyzeEvent`, `rescoreBook`, `loadDesk`/`saveDesk`, auth.

Needs **small** extra server DTO: attach clusters to `LiveDesk`.

### 8. What is the minimal plumbing?

1. Grouped rail + utility bar (`app-shell.tsx`).
2. `?event=` sync hook + delete per-page chips.
3. Desk layout cut in `dashboard.tsx` (map stage, developing-now, honest metrics, no fixture widgets).
4. Pass `clusters` through `LiveDesk`; rebuild `/events` as stream → cluster → book.
5. Assets scatter from existing `distance`/`score`.
6. Relabel/remove synthetic charts.
7. Align command palette.

That is the redesign. Not a new engine, not new feeds, not a chat.

### 9. What should NOT be implemented (from mockups or temptation)?

See RED FLAGS. Short list: hardcoded Israel–Iran/Fed stories; AUM donut; social/search heat; probability history area; world GIS; Ask Ripple; bull/base/bear; importance 8.7/10; dual nav; PipelineStrip on the desk; bypassing relevance/weather gates; fake live calibration.

### 10. What is already done and must survive the redesign?

Do not "clean up" these — they are the product catching up to itself:

| Work | Where |
|---|---|
| Map-first default tab, Analyze/pipeline collapsed | `dashboard.tsx` `TABS`, `DeskTools` |
| Relevance gate + weather-only drop | `src/lib/engine/relevance.ts`, `cluster.ts`, `build.server.ts` |
| Map node click → `/assets/$ticker` or `?q=` | `ripple-map.tsx` `navTarget`, `instruments.ts` `resolveNodeTicker` |
| Docs route as the place for legend/how-to | `src/routes/docs.tsx` |
| Transmission popup (mechanism, lag, kill, ticker) | `TransmissionPanel` |
| Kauai/local weather not becoming the book | `weatherOnly` in `marketRelevanceOf` |
| Event-agnostic compose/graph/hypothesize | `src/lib/engine/*` |
| Empty desk ≠ catalog events | `placeholder.ts`, `overlay.ts` |
| Auth-gated blotter sync | `desk-sync.ts`, `DeskSync` |
| IBM Plex dark tokens | `styles.css` |

The redesign is **chrome, IA, honesty of charts, and exposing clusters**. It is not a rewrite of how events are constructed.

---

## IMPLEMENTATION ORDER (for the team that codes next)

1. IA chrome (`app-shell`, command palette, kill dual nav). Zero engine risk.
2. Active-event URL sync + delete chip rows.
3. Live Desk layout pass (`dashboard.tsx`) — remove fixture charts/panels; hero crowding/confirmation; developing-now visible.
4. World Tape three-pane + `LiveDesk.clusters`.
5. Assets scatter; portfolio honesty; Learning/Docs copy.
6. Visual density pass (spacing, type, map inspector) against mockups **without** copying their events.

Stop condition for each PR: an unseen event still produces a full `RadarEvent`; live desk on a random day shows clustered tape, not a fixture; `npm run typecheck` passes; no new hardcoded country/player/ticker tables in UI.
