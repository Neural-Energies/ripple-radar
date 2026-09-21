# Engine interface contracts v0

**Date:** 2026-09-14  
**Status:** Contract sketch + crypto ontology pass in `src/`. FinEng/DS/ML kernels still unwired. No prices invented.

**Owners:** Engine (compose/graph/live/overlay + ontology). Consumers: FinEng, Data Science, ML/AI.

---

## Locked with other lanes

| Contract | Status | Notes |
|---|---|---|
| `composeFromText` complete fallback | **Live** | Missing key, 45s gap, burned budget, or bad JSON → `source: "engine"`. Graph-first. `provenance` of that book is `heuristic` once the field exists. Never `calibrated`. |
| Judge JSON | **Docs** (`CLUSTER-JUDGE-SCHEMA-v0.md`) | Labels only after cheap `relevance.ts` gate. Engine will not let the judge emit tickers or probabilities. |
| Freeze-at-T | **Docs** (`FREEZE-AT-T-SCHEMA-v0.md`) | Engine mints `snapshotId` on material prob/scenario/evidence change. Append-only. Mass in hash is **0–1**. Desk may display ×100. |
| Provenance | **Contract** | `heuristic` \| `llm_proposal` \| `calibrated`. Analyze/rescore = `llm_proposal`. `calibrated` requires ledger id. FinEng rank refuses ticker-first books. |
| Scenario join-on-id | **Contract** | Overlay/rescore join `Scenario.id`. Do not mint a new set because Grok renamed a row. |
| Graph mutate | **Contract** | Future `cloneGraph` + `intervene({player, move})`. FinEng owns algebra; Engine owns the only rewrite API. |
| Rank | **Contract** | Engine passes `CausalLink.confidence` into rank; FinEng owns weights. Crowding ≠ confirmation as separate fields. |
| EventFamily | **Locked** | No crypto family. Crypto via tags + `cryptoHonest` on the judge. `familyOf(["crypto","liquidity"]) === "other"`. |

---

## Crypto ontology pass (this assignment)

Generic transmission — **no event ids**.

| Change | Where |
|---|---|
| `NodeKind` includes `"crypto"` | `src/data/types.ts` |
| BTC/ETH `kind: "crypto"` (not commodity) | `ontology.ts` `TICKER_META` |
| `TAG_NODE.crypto.kind = "crypto"`; `liquidity` node | `graph.ts` |
| `from: crypto` → liquidity, equity (risk-on), vol, fx | `ontology.ts` `TRANSMIT` |
| `liquidity` → fx | same |
| `rates` → crypto kept (not one-way) | same |
| Lexicon: btc / ether / ethereum / cryptocurrency / stablecoin / digital asset | `LEXICON` |
| Relate bag: `economicVarsFrom` includes crypto + liquidity | `extract.ts` |
| Quotes: existing Yahoo `BTC-USD` / `ETH-USD` — no invented prints | `symbols.ts` (unchanged) |

---

## Seams (call order)

```
relevance gate → (DS embeddings later) → judge labels-only → compose/extract
  → buildCausalGraph (TRANSMIT then tickersForTag)
  → hypothesize scenarios/GT
  → rankTrades (confidence in, FinEng weights later)
  → overlay quotes (no freeze mutate)
  → ML analyze/rescore: llm_proposal or composeFromText
```

Hard nos: no headline→ticker hydrate; no MC without evidence model; no sentiment-as-product; no fake calibrated single-prompt probs.

