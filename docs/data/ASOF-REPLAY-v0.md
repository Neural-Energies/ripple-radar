# As-of / information-set replay — v0 contract (DESIGN ONLY)

**Owner:** Ripple Data Eng (ingest clocks + `buildDeskAsOf` when greenlit)  
**Consumers:** DS (scoring / FREEZE-AT-T), FinEng, QA (leak gates), Engine  
**Status:** design-approved (CoS 2026-09-14) — **no schema, no obs log, no EvidenceItem timestamp code** until separate IMPLEMENTATION greenlight  
**Date:** 2026-09-14  
**Aligns:** [`docs/MODEL-DESIGN-v0.1.md`](../MODEL-DESIGN-v0.1.md); [`docs/FREEZE-AT-T-SCHEMA-v0.md`](../FREEZE-AT-T-SCHEMA-v0.md); [`docs/data/FEED-INVENTORY.md`](./FEED-INVENTORY.md) §5

---

## Problem

`buildDesk()` sets `LiveDesk.asOf = Date.now()`. Quotes carry Yahoo print time; headlines use RSS `pubDate`. `EvidenceItem.delayed` is hardcoded `false`. No durable observation log → cannot freeze I(T) for progressive learning (Model Design: never rewrite historical predictions).

## Definitions

| Term | Meaning |
|---|---|
| `event_time` | ms UTC — when the world fact / print occurred (RSS pubDate; Yahoo `regularMarketTime`) |
| `available_time` | ms UTC — when it entered **our** info-set (ingest watermark). Never earlier than first fetch sighting |
| `as_of` / T | Query freeze clock (ms UTC). ET labels are presentation-only |
| I(T) | All observations with `available_time ≤ T` |

**Invariant:** replay(T) ⊆ I(T). **Event-time-only filters are a fail** (QA).

## Observation log (proposed — not implemented)

### Every obs (headline + quote) — DS §5b

- `obs_id` — stable, append-only  
- `event_time` — ms UTC  
- `available_time` — ms UTC (**gates** as-of)  
- `delayed` — bool (RSS default true; crypto only when delayed-honest)  
- Headline: `source`; optional `evidence_class` / `direction` / `weight` in v0  
- Quote: `symbol`, price/ret fields already used  

If provider omits event_time: `event_time = available_time` + `event_time_inferred = true`.

### Desk I(T) / learning snapshot — DS §5b + FREEZE-AT-T

- `snapshotId`, `eventId`, `asOf` (= T ms), `infoSetHash` (or hash inputs)  
- `scenarios[]` `{ scenarioId, priorMass }` Σ≈1 @ 0–1 / 6dp  
- `evidenceBatch[]` — ids with `available_time≤T` only  
- `probability`, `importance` (≠), `provenance`, `createdAt`  

Also in I(T) v0: masses+provenance at T; ids that fed the book.  
Derived book fields (`marketReaction`, heat, sentiment): same I(T) or omit (QA).

**Hard refuse:** `available_time > T` in I(T); never mutate scored snapshots (scores point at `snapshotId`).

## API (proposed — not implemented)

```
getObservations({ asOf, kinds?, tickers?, sources? })
buildDeskAsOf(asOf) -> LiveDesk   // LiveDesk.asOf === asOf
assertNoFutureLeak(asOf, desk)     // headlines + quotes + evidence
```

Live path becomes write-obs then `buildDeskAsOf(now)` — only after greenlight.  
Overlay/rescore as-of join: **deferred (live-only)** until explicitly scheduled.

## Delayed flag (design)

- `delayed = true` when inherently delayed source (RSS), or `kind` in {filing, data}, or `available_time - event_time ≥ 15m`  
- Session spark may be `delayed = false` only inside existing `quoteState` “live” band — still free/delayed product policy; no paid live edge  

## Out of scope until separate CoS greenlight

Filings / pred-market / on-chain / crypto-depth adapters; replay UI; feature store; history backfill.

## QA gates (locked — wire after greenlight only)

1. Future-leak: `available_time` > T never in `buildDeskAsOf(T)` (event_time-only = fail)  
2. Monotonic: T0→T1 only adds obs with `available_time` in (T0, T1]  
3. Identity: `buildDeskAsOf(T).asOf === T`  
4. Cold-start / empty obs log: live desk still builds (degraded OK)  
5. Schema: `EvidenceItem` exposes `eventTimeMs` + `availableTimeMs`; `delayed` not hardcoded false  
6. Path trigger: `src/lib/live/**`, `EvidenceItem` in `src/data/types.ts`, new obs/as-of modules  
7. Runner: fix `npm test` Node 20 (glob + strip-types) before treating CI as real  

## Rollout after CoS greenlight (not before)

1. Types + stamp dual clocks on ingest (behavior-neutral)  
2. Append-only store (Platform DDL)  
3. `getObservations` + `buildDeskAsOf` + `assertNoFutureLeak`  
4. QA leak tests + DS snapshot handshake  
5. Feature materialization on I(T)

## Changelog

- 2026-09-14 — draft from live layer  
- 2026-09-14 — DESIGN ONLY; DS/FREEZE-AT-T alignment; CoS sequencing correction  
- 2026-09-14 — DS §5b + QA amendments locked (gates 1–7; derived fields; overlay deferred)  
- 2026-09-14 — CoS DESIGN SIGN-OFF; impl still gated  
