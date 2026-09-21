# Alpha Recon — Claude handoff

**Date:** 2026-09-21  
**From:** Grok Bot Chief of Staff (Joshua Dawson / Neural-Energies)  
**Stop state:** All specialist bots frozen. Push/create-repo blocked on GitHub write token at handoff time.

## What this product is

**Working name was Ripple Radar. Joshua wants the next repo called `alpha-recon`.**

One-liner: event-agnostic market intelligence desk. Continuously discovers world events, builds a full research object (scenarios, probabilities, game theory, causal graph, exposures, crowding vs confirmation, invalidation, lifecycle), and updates as evidence arrives.

**Slogan:** Don't trade the headline. Trade what the headline causes next.

**Not:** a news app, Bloomberg replacement, BUY/SELL signal, or calibrated-probability product (yet).

## Non-negotiables

1. Zero hardcoded production events. Catalog fixtures are calibration only.
2. Causal graph before tickers. Never headline → ticker first.
3. Importance ≠ probability.
4. Family-appropriate scenarios (not always bull/base/bear).
5. Unknown events must still build a complete research object.
6. No invented tickers / fake AUM / costume metrics.
7. Crowding ≠ confirmation (separate fields/chips).
8. LLM/judge labels ≠ calibrated probability. Provenance: heuristic | llm_proposal | calibrated.
9. Never rewrite historical forecasts after outcomes (freeze-at-T append-only — schema exists, ledger not built).
10. Free/delayed data policy for structural multi-day edge — not millisecond arb.

## Repo / code map (source: `/workspace/ripple-radar`)

- Stack: React 19, TanStack Router/Start, Zustand, Tailwind v4, Recharts/Radix
- Live desk: `src/lib/live/` (RSS + Yahoo spark → cluster → compose → relate)
- Engine: `src/lib/engine/`
- Dev: `npm install && npm run dev` → `:8080` (vite allows `*.trycloudflare.com` for phone tunnel)
- Env: see `.env.example` — optional `XAI_API_KEY`, `FRED_API_KEY`, `DATABASE_URL`, `RIPPLE_MODEL_ROUTING`

### Already on GitHub `Neural-Energies/ripple-radar` `main` (as of 2026-09-21)

- Initial handoff `0d1e05c`
- FRED+ALFRED delayed macro ingest PR #1 @ `4782bce` (dual clocks, `delayed=true`, empty without `FRED_API_KEY`)
- RSS dual-clock cleanup PR #2 @ `73b75f3` (`eventTimeMs`=pubDate, `availableTimeMs`=ingest watermark)

### Local-only / not fully pushed (dirty tree on `ml/model-routing-v0`)

UX fidelity cut + ML routing thin wire + docs bible were largely on the box; some docs commits exist locally but diverged from `origin/main`. **Claude should reconcile local WIP with `origin/main@73b75f3` before continuing.**

Key local artifacts to preserve:

- UX: map-first desk, World Tape three-pane, Crowding≠Confirmation chips, phone pack, Assets under Research, `/docs` route
- ML: `RIPPLE_MODEL_ROUTING` default-off (`55455de` on branch `ml/model-routing-v0`)
- Docs: `MODEL-DESIGN-v0.1.md`, `ROADMAP.md`, `PHONE-ACCEPTANCE-PACK.md`, `FREE-SOURCES-ARMY-v0.md` / `FREE-SOURCES-ARMY` catalog, FinEng contracts, GTM packs, ICP outline
- Dual-clock step 1 worktree also at `/workspace/ripple-radar-dual-clock` branch `data/dual-clock-step1`

## Status board at freeze

| Track | Status |
|---|---|
| UX mock fidelity | Landed locally; phone pass still awaits Joshua |
| ML routing | Thin wire behind flag, default-off |
| Data Eng dual clocks | On main (FRED + RSS) |
| As-of step 2 (obs log / buildDeskAsOf) | **HOLD** |
| Free Data army | Catalog done; **only FRED greenlit**; Treasury/EIA/EDGAR/BLS hold |
| GTM | Thought-leadership drafts only; no publish/outreach |
| Desk sync / Postgres | Later |
| Freeze-at-T ledger | Schema only — not implemented |

## Pricing (CoS recommendation — Joshua not locked)

- Design partner: $0
- Paid pilot: $18k–$25k / quarter / desk
- Desk ARR later: $72k–$120k / year after WTP
- Refuse enterprise logos before freeze-at-T

## What Claude should do first in `alpha-recon`

1. Create/clone `alpha-recon` from the reconciled Ripple Radar tree (or rename after push).
2. Bring `origin/main` + local UX/ML/docs WIP onto one clean `main`.
3. Keep invariants; no costume metrics.
4. Ask Joshua for: `FRED_API_KEY` (live macro), GitHub write if still blocked, phone pass.
5. Do **not** open as-of step 2 or new free adapters without CoS/Joshua greenlight.
6. Prefer product fidelity + live dynamism over GTM.

## Contact / ownership

- Founder/decision: Joshua Dawson (Neural-Energies)
- Prior CoS: Grok Bot Chief of Staff — stopped per Joshua “push and stop work”
