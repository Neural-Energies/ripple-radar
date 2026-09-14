# Ripple Radar

Event-agnostic macro intelligence for institutional desks.

> **Don't trade the headline. Trade what the headline causes next.**

Ripple Radar watches the world tape, clusters emerging shocks, and builds the **ripple** — causal graph, second- and third-order exposures, scenarios, game theory, crowding, invalidation — across equities, ETFs, futures, FX, rates, commodities, and crypto.

It is a **general-purpose engine**, not a dashboard of canned events. Hormuz, Taiwan, FOMC, yen intervention, a lithium brine disruption, a tropical storm — the same pipeline constructs a full research object for whatever shows up.

## What a trader can do

- Watch live headlines cluster into events as they develop
- Open an event book: causal map, scenarios, probabilities, game-theory matrix
- Drop a thesis in **Analyze this event** and get the full object without waiting for the tape
- Rank exposures by distance from the shock, not by how obvious the ticker is
- Keep watchlists, alerts, and desk state across devices (signed-in)

## Stack

React 19 · TanStack Start/Router/Query · Zustand · Tailwind v4 · Better Auth · PGLite (preview) / Postgres (prod) · Yahoo Finance quotes · RSS world tape · optional xAI Grok for user-defined events

## Run

```bash
npm install
cp .env.example .env   # optional XAI_API_KEY
npm run dev            # http://localhost:8080
```

```bash
npm run typecheck
npm run test
npm run build
```

## Repo map

| Path | Role |
|---|---|
| `src/lib/engine/` | Discovery, ontology, clustering, causal graphs, scenarios, Grok analyze |
| `src/lib/live/` | RSS + Yahoo ingestion, overlay, desk, rescore |
| `src/data/types.ts` | `RadarEvent` and every research object field |
| `src/data/catalog.ts` | **Fixtures / calibration only** — never the live desk |
| `src/components/` | Desk UI (dashboard, ripple map, engine panels) |
| `src/routes/` | Pages: desk, events, maps, scenarios, game theory, assets, alerts, watchlists |
| `HANDOFF.md` | Architecture, invariants, known gaps — start here if you are taking the repo |

## Invariant

Production code contains **zero hardcoded events, players, assets, graphs, or research conclusions**. Ontology and transmission rules live in `src/lib/engine/ontology.ts`. Everything else is discovered or constructed at runtime.

## License

Private. All rights reserved.
