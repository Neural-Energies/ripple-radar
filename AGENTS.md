# Alpha Recon — agent instructions

Read `HANDOFF.md` and `README.md` first. They are the source of truth for architecture and product invariants.

## Product

Event-agnostic macro intelligence engine. Discovers world events from live tape (or user text) and constructs a full research object: causal graph, second/third-order exposures, scenarios, game theory, crowding, invalidation, lifecycle.

Slogan: **Don't trade the headline. Trade what the headline causes next.**

## Hard rules

- Production code has **zero hardcoded events, players, graphs, or research conclusions**.
- `src/data/catalog.ts` is fixtures/calibration only — never the live desk default.
- Causal graph **first**, tickers **second**.
- Scenario families follow the event (weather / policy / commodity / credit / kinetic / corporate) — not a universal bull/base/bear.
- Importance and probability are different numbers.
- Unknown events must construct a complete `RadarEvent` with no developer intervention.
- No fake tickers. No `if (event === 'hormuz')` branches. Game cells are `{ a, b, label }`.

## Stack

React 19, TanStack Start/Router/Query, Zustand, Tailwind v4, Better Auth, PGLite preview / Postgres prod, RSS + Yahoo quotes, optional `XAI_API_KEY` (Grok) for user-defined analyze.

Auth is ON. Any server function that reads or writes per-user data uses `authMiddleware` and `context.userId`.

## Layout

- Engine: `src/lib/engine/`
- Live tape / desk: `src/lib/live/`
- Types: `src/data/types.ts`
- UI: `src/components/`, routes in `src/routes/`

## Commands

```
npm run dev          # 0.0.0.0:8080 via scripts/with-app-env.mjs
npm run typecheck
npm run test
npm run build
```

## Style

- Match existing file style. No drive-by refactors.
- Don't add comments or docs on code you didn't change.
- Prefer editing an existing module over creating a new helper for a one-off.
- Keep ontology/transmission rules generic; put new domain knowledge in `ontology.ts` / `extract.ts`, never in a page component.
