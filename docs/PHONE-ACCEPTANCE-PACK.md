# Ripple Radar — Phone Acceptance Pack (UX)

Date: 2026-09-14  
Owner: Ripple UX  
Audience: Joshua (phone test) + Chief of Staff + Ripple Research (vocab)  
Scope: Visual / IA fidelity vs institutional mockups. **No engine invent.** Live `RadarEvent` / clusters / quotes only.

Mockup targets (layout language only — ignore costume events/AUM/8.7/10):
- Live Desk, World Tape, Event Causal Map, Scenarios/Game Theory, Assets
- Files: `docs/mockups/` (large desktop PNGs are targets; phone screenshots of the tunnel are current-app bugs, not design targets)

Product filter: Event → causal graph → exposures → instruments. Map as identity. Probability ≠ importance. Crowding ≠ confirmation.

---

## How to phone-test

1. Open the live desk on phone (tunnel / preview). Desktop-first is intentional — phone is **acceptance of honesty + IA**, not a second layout system.
2. Work one Active Event across Live Desk → World Tape → Map → Scenarios → GT → Assets.
3. For each checklist item: **Pass / Fail / N/A** + one-line note.
4. Failures that are taste/product → @Chief of Staff only (do not freestyle).

---

## A. Shell (all surfaces)

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| A1 | Single grouped left rail (Desk / Research / Monitor / Model) — no duplicate top page nav | | |
| A2 | Assets under **Research** (locked taste) | | |
| A3 | No rail slogan / coach marks on operator chrome | | |
| A4 | Utility bar: live pill + clock/sessions + active event control + ⌘K/search + alerts + auth | | |
| A5 | No utility-bar quote chips (quotes live on book / World Tape) | | |
| A6 | `?event=` stays coherent when switching research views | | |
| A7 | Docs hold how-to; live desk does not explain the product with PipelineStrip slogans | | |

---

## B. Live Desk `/`

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| B1 | **Developing now** always visible (importance-sorted live books) | | |
| B2 | Thin hero: lifecycle / region / subtype; **importance** and **probability** both visible and not collapsed | | |
| B3 | Crowding and Confirmation are **separate** chips (not one merged badge) | | |
| B4 | Dominant Ripple Map stage (map is product identity) | | |
| B5 | Right column: scenario **discrete mix** (family scenarios sum ~100) — not a fake fan/path chart | | |
| B6 | Market reaction from live quotes / book fields; honest empty if none | | |
| B7 | Footer: exposures + evidence (+ transmission) discoverable without 7-tab archaeology | | |
| B8 | No MODEL_STATS / DEFAULT_PORTFOLIO / Narrative Heat / synthetic probability history on desk | | |
| B9 | Compact Analyze (Mode B) — not a marketing hero | | |
| B10 | Reserved empties (no invented values): disposition/`onRadar`, muted `models disagree`, prob **provenance** when field exists | | |

---

## C. World Tape `/events`

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| C1 | Three panes: headline stream \| cluster explorer \| event preview | | |
| C2 | KPIs only from real counts (headlines / clusters / high-importance) — no fake millions | | |
| C3 | Headline click **highlights cluster**, does not dump into Analyze | | |
| C4 | Open book → Active Event + Live Desk | | |
| C5 | Mode B Analyze secondary/collapsed | | |
| C6 | Reserved: disposition chip only (`onRadar`\|`watch`\|`drop`\|`duplicate`) — **no %** on triage | | |
| C7 | No ensemble / MC / crypto tape badges | | |

---

## D. Causal Map `/maps`

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| D1 | Research header shows Active Event (title, imp, prob) — no local chip row | | |
| D2 | Map-first + persistent node inspector on select | | |
| D3 | Causal links table present and dense | | |
| D4 | Node → asset navigation still works | | |
| D5 | No source-diversity / narrative-heat / fake history charts | | |

---

## E. Scenarios + Game Theory

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| E1 | Shared research chrome / Active Event | | |
| E2 | Discrete scenario mix bar (current mass) — **not** path-over-time lines | | |
| E3 | Reserved progressive slot for p10/p50/p90 later — not painted as fake envelopes | | |
| E4 | GT: players + matrix + insight / likely play (“what this does”) from real fields | | |
| E5 | No country-flag hardcodes / bull-base-bear forcing | | |

---

## F. Assets (spot-check)

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| F1 | Scatter from real distance × score (or honest empty) | | |
| F2 | No $AUM donut / fake Max DD | | |
| F3 | Causal path / crowding columns readable on phone scroll | | |

---

## Remaining visual gaps (known, honest)

Do **not** fail phone acceptance solely for these — they are documented non-goals until fields exist:

1. World Tape cluster mosaic (mockup 2-col cards) — current dense list + optional landscape is enough.
2. Live Desk / Map mockup extras: source-diversity donut, narrative heat, probability history area — synthetic; omitted.
3. Scenario path charts over time — no history field; discrete strip only.
4. Hero `models disagree` / disposition chips — **reserved empty** until DS/ML flags ship (ML/AI confirmed).
5. p10/p50/p90 envelopes — Scenarios progressive slot only after FinEng ships.
6. Phone is not a second IA — density targets desktop 1440–1920; phone checks honesty + navigation, not pixel-match.

---

## Vocab coordination (Ripple Research)

Please align trader-facing labels with this pack (write-up only; Research owns critique):

| UI label (current / reserved) | Meaning | Avoid |
|------------------------------|---------|--------|
| Live Desk | Active book workstation | Dashboard / Overview |
| World Tape | Headlines → clusters → events observatory | News feed / Event feed |
| Ripple Map | Causal graph levels 0–4 | Network doodle |
| Developing now | Live books ranked by importance | Trending stories |
| Importance vs Probability | Separate meters | Single “score” |
| Crowding vs Confirmation | Separate chips | Merged “conviction” |
| Scenario mix | Discrete family mass Σ≈100 | Fan chart / path |
| Disposition (`onRadar`…) | DS triage label | Probability % |
| Models disagree | ML ensemble flag (empty until flag) | Fake confidence |
| Provenance | heuristic / llm_proposal / calibrated | “AI says 87%” |

Research: feed preferred synonyms / kill-words into this table via CoS if you want Joshua to lock vocab.

---

## Blockers / taste (route via Chief of Staff only)

- None blocking this pack. Phone test is Joshua’s.
- If Joshua wants pixel-closer World Tape mosaic or inspector chrome after phone pass → CoS assigns next UX cut.

---

## Status

- Desktop mockup density baseline: **landed** (shell, Live Desk, World Tape, Maps, Scenarios/GT; typecheck clean).
- This document: **acceptance checklist** for Joshua’s phone pass.
- Empty reserved chrome: paint only when Engine/DS/ML fields exist — do not invent.
