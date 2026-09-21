# Live Desk / World Tape — research vocab kill-list (overnight)

**Owner:** Ripple Research  
**Audience:** Ripple UX (copy + labels), QA phone smoke  
**Date:** 2026-09-14  
**Scope:** Label rules only. No UI redesign. Aligns with Model Design v0.1 + `REDESIGN-AUDIT.md`.

Trader test: if a label implies calibrated edge, social heat, or a time series we don’t have — kill it.

---

## Kill on Live Desk (`/`)

| Do not say / show | Why | Say instead (if shown) |
|---|---|---|
| Naked scenario / event `%` as truth | Heuristic or LLM proposal; not calibrated | `% (heuristic)` or `% (proposal)` until ledger exists |
| “BUY X 87%” / recommendation strings | Fake precision; Model Design ban | Ranked exposure + path + invalidation |
| Probability history spark (T-3…Now) | Synthesized backfill in `compose.ts` | Current level + `probabilityDelta` only |
| Narrative Heat (social / search) | No social or search feed | Headline / cluster count only, or omit |
| Calibration / Brier / lead-time on desk | `MODEL_STATS` is frozen fixture | `/learning` only: “Frozen class calibration — not this book’s live skill” |
| Importance as `8.7/10` | Integer ~8–99 | Raw importance or `/99` — never mint a 10-scale |
| Crowding = Confirmation (same chip / same meaning) | Distinct enums; crowding ≠ confirmation | Separate chips: Crowding \| Confirmation |
| “Elevated confirmation” / positioning language | Session move + mentions only, not OI/positioning | Enum as-is; no invented tiers |
| Sentiment 0–100 / “Narrative Sentiment” product | Hits/tone heuristic | Omit on desk; Research tab only if labeled heuristic |
| Scenario path line charts | No per-scenario history | Stacked bar of current scenario mass (Σ≈100) |
| Portfolio / AUM / “your capital” on desk | Illustrative / catalog | Off Live Desk; `/portfolio` must say illustrative if kept |
| PipelineStrip coach (“How to reason…”) on live canvas | Pedantic on the trading surface | Docs / Learning only |
| Hardcoded universe tape as global chrome | Not the selected book | Book tickers on desk; universe tape on World Tape only |

---

## Kill on World Tape (`/events`)

| Do not say / show | Why | Say instead |
|---|---|---|
| Headline click = “the event” | Headline ≠ cluster ≠ book | Stream → **cluster** → open book |
| Fake KPI tiles (412.7 mln / invented cluster counts) | Only real counts from desk | Headlines / clusters / high-importance from live arrays |
| Cluster axes “market vs narrative” | No such features | Recency × significance only (if landscape shown) |
| Analyze draft as the only World Tape action | Mode B is secondary | Open composed book when cluster maps to a live event |

---

## Keep / prefer (trader-shaped)

- **Binding** vs **narrative premium** (physical / commodity / kinetic books)
- **First print** ≠ **bottleneck** (graph distance language)
- **Importance ≠ probability** (paired, never collapsed)
- **Crowding ≠ confirmation** (hero chips OK when enums exist)
- **Family scenarios** (landfall/glancing/miss; hawkish/hold/on-consensus/dovish) — never universal bull/base/bear
- **Proposal ≠ calibrated** (provenance until freeze-at-T + live Brier)
- Slogan OK in chrome: *Don’t trade the headline. Trade what the headline causes next.*

---

## Crypto honesty

- Do not label CoinDesk RSS / narrative heat as crypto **market confirmation**
- Crypto second-order OK when ontology + delayed data support it; never “edge from narrative”

---

## Handoff

- UX: apply on Live Desk + World Tape copy in the overnight mock+dynamism pass  
- QA: phone pack — flag any kill-list violation as copy fail, not engine fail  
- Data Eng dual-clock step 1: no conflict; when `delayed` is honest, UI must not imply realtime arb on delayed evidence  
- Roadmap: track as research vocab lock for overnight demo — not a feature epic

*Docs only. No product invent.*
