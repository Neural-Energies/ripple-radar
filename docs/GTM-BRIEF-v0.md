# Ripple Radar — GTM brief v0

**Owner:** Ripple CEO Office  
**For:** Joshua (decision) via Chief of Staff  
**Date:** 2026-09-14  
**Status:** CoS overnight lock 2026-09-14 (Joshua authorized CoS to decide while he sleeps — not a Joshua quote): **thought leadership only** until freeze-at-T and provenance are real. Thesis drafts allowed; no product claims, no demos. Draft ≠ publish. Live posts still need Joshua confirm via CoS. No traction metrics — none exist.

Sources: README, HANDOFF, MODEL-DESIGN-v0.1, ROADMAP v0.5, engine-v1 gap matrix, roadmap draft notes, `docs/PRODUCT-RESEARCH-ICP-COMPETITORS-v0.md` (hypotheses), `docs/MESSAGING-HOUSE-v0.md`. No interviews, no WTP study, no pipeline.

---

## Sell-ready line (proposed)

Ripple Radar is the event-driven macro workstation: world tape becomes an event book, then a causal graph, then ranked second- and third-order exposures.

**Slogan (already in product):** Don't trade the headline. Trade what the headline causes next.

**Category:** Institutional event-driven macro workstation. Not a news app. Not a Bloomberg replacement. Not a buy/sell signal.

**One sentence vs the alternatives**

- Bloomberg / the Terminal: they give you data, news, and a place to work. They do not build the ripple — event → graph → exposures — as a research object.
- News apps / briefing products: they stop at the headline. We refuse headline → ticker.
- Macro research shops: they ship a narrative PDF. We are a living engine for whatever shows up (event-agnostic, not a canned-event dashboard).

---

## What we can honestly say today

**Can say**

- The thesis and information architecture exist: tape → cluster → event → graph → exposures.
- A live desk prototype clusters RSS + delayed-ish Yahoo sparks into event books (heuristic compose, not a sold product).
- Invariants are the product: zero hardcoded production events; graph before tickers; importance ≠ probability; unknown events must still construct a full book.
- Target edge is structural and multi-day, not millisecond headline arb (24h delayed / free data policy in Model Design).

**Cannot say (do not let Sales / Marketing / Social say these)**

- Calibrated probabilities, Brier, live edge, or “the model is right X% of the time.” `/learning` numbers are fixtures.
- Clients, AUM, design-partner logos, waitlist size, or any traction figure. There are none on file.
- “Crypto first-class.” Tickers exist; transmission does not.
- Replacement for Bloomberg, Reuters, or an OMS.
- Game theory “rewrites the causal graph” as if it does that in code today. It does not.
- Same-session confirmation as product. Policy is delayed structural edge; live path is still same-session quotes.

Until freeze-at-T (append-only forecasts) and provenance flags exist, any external demo is a **research prototype**, not a probability product.

---

## ICP v0 (hypothesis — not validated)

**Primary (first 10 conversations)**  
Event-driven / global macro PMs and senior analysts at multi-strategy and macro funds who already pay for a Terminal, already live in news, and currently jump from headline to the obvious ticker by hand.

**Job to be done**  
“A shock just hit. I need the second-order book in minutes: who moves, through what bottleneck, what would invalidate, what is crowded vs confirmed.”

**Economic buyer**  
PM / head of macro / CIO-lite. Not IR, not a retail growth loop.

**Anti-ICP**

- Anyone who wants `BUY X 87%`.
- Anyone shopping for a cheaper Terminal or a news app.
- Millisecond / same-session news arb desks (wrong edge thesis).
- Crypto-native shops who need funding/basis as confirmation (we do not have it yet).

Product Research owns interview plans and competitor teardown (`docs/PRODUCT-RESEARCH-ICP-COMPETITORS-v0.md`). This ICP is a starting bet, not a finding. Research outline landed 2026-09-14 — hypotheses only.

---

## Positioning table

| They sell | We sell |
|---|---|
| Bloomberg / Terminal | Data, functions, execution, the kitchen sink | The research object the Terminal does not assemble |
| News apps, alerts, X | Speed to headline | Speed to *what the headline causes next* |
| Macro notes / expert networks | Opinion, once | An event-agnostic engine that rebuilds the book as evidence arrives |
| Quant “signal” shops | A number | A graph + scenarios + invalidation; numbers are calibrated only when freeze-at-T says so |

**Wedge:** second-order exposures ranked by causal distance, not by how obvious the ticker is.

---

## GTM phases

| Phase | When | What | What we refuse |
|---|---|---|---|
| **0 — Thought leadership** | **LOCKED (CoS overnight, 2026-09-14)** until freeze-at-T + provenance | Thesis content only (slogan, event→graph→exposures as an *idea*, why headline→ticker fails). Marketing/Social may draft. No product claims, no demos, no screenshots. | Outreach, Type B/design-partner invites, live-edge screenshots, costume %, traction |
| **1 — Founder-led design partners** | After honesty gates *or* with explicit prototype framing + NDA | 3–5 conversations Joshua owns. Demo the IA, not fake calibration. CS writes success criteria before a second meeting. | Logos, case studies, published win rates |
| **2 — Paid pilots** | After freeze-at-T path exists and delayed flag is meaningful | Packaging + price as experiment. Product Research captures WTP. | Annual enterprise theater before we can score forecasts |
| **3 — Repeatable GTM** | After 2–3 scored pilots | Marketing site, social cadence, Sales scripts against real objections | Invented metrics, Bloomberg-killer copy |

Honesty gates that should bound Phase 1 → 2 (from Roadmap, not invented): provenance on probabilities; freeze-at-T append; LLM judge labels-only (not full-object vibes as truth); delayed flag meaningful; engine tests in CI.

---

## Pricing / packaging

**Not set. Do not publish a number.**

Working hypothesis only (for Product Research to kill or keep):

- Not per-seat Bloomberg mimic. Package the *desk* (event book + graph + ranked exposures), not a data firehose.
- Design-partner: free or cost-recovery, time-boxed, success criteria in writing.
- Paid pilot: quarterly, small N, kill-criteria explicit (if we cannot freeze forecasts, we do not collect ARR theater).
- Later: firm vs team vs desk — after WTP interviews, not before.

BizDev: no binding partner commitments without Joshua via Chief of Staff.

---

## Company decisions already on the table (not GTM-owned)

From Roadmap / CoS notes — for Joshua, not for this office to call:

1. UX phone pass (`PHONE-ACCEPTANCE-PACK.md`) — READY, awaiting Joshua.
2. Mode B policy (full-object deep LLM vs proposal-only).
3. Delayed confirmation: label vs hard refuse.
4. Crypto priority: Now vs Next.
5. CoS greenlight for FinEng + freeze persist (docs exist; code wait).
6. Naming: still open; do not bikeshed in GTM. Sell the line, not a rename.

---

## Thought leadership (Phase 0 — locked)

**Allowed as thesis (not product):** the slogan; event → causal graph → exposures as a way to think; graph-before-tickers; importance ≠ probability; structural / multi-day vs millisecond arb; why news apps stop too early.

**Forbidden until freeze-at-T:** product claims, demos, desk screenshots, calibrated probs / Brier / live edge, traction/AUM/logos, crypto first-class, Terminal replacement, GT rewriting the graph, same-session confirmation as product, outreach, Type B / design-partner invites.

Any public post still requires Joshua confirm via CoS. Draft ≠ publish.

## Coordination

CEO Office owns this brief. CoS overnight lock is the company record (do not quote Joshua). CoS relays to GTM. Sales discovery/demo packs stay internal. Marketing owns thesis drafts against the messaging house. Social does not post live without CoS→Joshua. Product Research ICP outline is in (`docs/PRODUCT-RESEARCH-ICP-COMPETITORS-v0.md`) — hypotheses only; thesis content must not invent ICP stats.
