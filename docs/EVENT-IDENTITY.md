# Event identity and the event registry

## The defect this fixes

An event's id was a hash of its entities plus the first 40 characters of its
**newest** headline (`cluster.ts`, `clusterHeadlines`). Headlines sort
newest-first, so every fresh wire item about an ongoing story minted a brand-new
id. Probed on a three-headline Lebanon story, adding one more headline moved the
id from `ev-fcj3qg` to `ev-aztugp`.

That is not cosmetic. `buildDesk` fetches the previous forecast by event id and
skips the Bayesian update when it finds none:

```ts
const prior = priors.get(ev.id);
if (!prior) continue;   // first sighting: the composed book IS the prior
```

For any story that was actually developing, the id had already changed, so the
prior never resolved. The consequences, all of them silent:

| Capability | Status before | Why |
|---|---|---|
| Dirichlet posterior update | never executed | prior lookup always missed |
| Forecast Delta (18% → 27%) | impossible | no continuous series per event |
| Automatic probability updates | never ran | same lookup |
| Calibration / Brier | crippled | snapshots scattered across single-use ids |
| Resolution evidence join | broken | `headline_archive.event_ids` pointed at dead ids |

The Dirichlet kernel, materiality gate, credible bands and freeze-at-T ledger
were all correctly implemented. They were unreachable.

## The model

A cluster is **per-poll**. An event is **persistent**. The registry maps the
first onto the second and records how it decided.

```
RSS → clusterHeadlines() → per-poll clusters (ids change every poll)
                                ↓
                        event registry  ── matches onto ──▶  events table
                                ↓                             (id assigned once)
                        clusters with PERSISTENT ids
                                ↓
                   compose → prior lookup → posterior → freeze
```

An event's id is assigned once at first sighting and **never recomputed from
content**, because content is exactly what changes.

## Matching

Three passes, in `event-identity.ts` (pure, no database):

1. **Fingerprint** — a structural signature of sorted entities plus the most
   specific tokens. Never headline text. Covers a story that is simply still
   running.
2. **Similarity** — entity Jaccard (weight 0.65) blended with token Jaccard, for
   a story whose entity set has drifted. Requires `entityOverlap >= 0.34` **and**
   `combined >= 0.42`. A cluster with no entities falls back to token overlap
   alone against a much stricter `0.6`, because vocabulary on its own merges any
   two stories in the same domain.
3. **New** — mint an id.

Assignment is greedy best-first, and each event takes at most one cluster per
cycle. Letting two clusters land on one event would fuse two stories into a
single forecast series with nothing downstream able to detect it.

**Matching is deliberately conservative.** Over-merging is the worse failure: it
corrupts a forecast series silently. A missed match only costs a duplicate
event, which is visible and recoverable. Israel/Lebanon and Israel/Gaza share
one entity of five — Jaccard 0.2, below the floor — and stay separate.

An event not seen for **72 hours** is over. A later story about the same actors
opens a new event, or "Israel/Lebanon" would become one immortal event
accumulating forecasts across unrelated flare-ups.

## Provenance

Every attachment records how it happened — `fingerprint`, `similarity` (with its
score), or `new` — plus the entities that drove it. A relationship asserted by
the matcher is stored as an assertion and is never presented as an observed
fact.

`event_observations` records **every poll**, not just ones that brought news.
The difference between "still running, nothing new" and "three new items
arrived" is exactly what a probability-change alert must key off, and it cannot
be recovered later from a headline total — re-syndication and real development
look identical from a count.

`RadarEvent.identity.newEvidence` is a counted fact: the headline ids this event
did not already hold.

## Tables

| Table | Holds |
|---|---|
| `events` | identity, fingerprint, vocabulary, first/last seen, counters |
| `event_evidence` | one row per (event, headline) with attachment provenance |
| `event_observations` | one row per poll per event, with new-evidence count |

`first_seen` is immutable. Title and vocabulary refresh on each observation,
because a story's best description improves as it develops.

## Failure behaviour

If the registry is unreachable the poll degrades to per-poll ids and sets
`degraded: true`. On a degraded cycle the ledger freeze is **skipped entirely** —
a snapshot written under an ephemeral id can never be matched to an outcome,
never scored, and would sit in the calibration set as permanent unresolved
noise. Headline archiving still runs; it is safe and still useful.

If the matching pool saturates (500 live events) the registry logs a warning:
older live events fall out of matching and would duplicate silently otherwise.

## Performance

Writes are batched into three statements per poll. The first cut issued one
query per event plus one per new headline; 25 events with 200 headlines cost 225
sequential round-trips on the live desk path. A test pins the bound at ≤6.

## Tests

- `event-identity.test.ts` — 19 tests, pure matching. Includes the regression,
  over-merge resistance, dormancy, contested-event ordering.
- `event-registry.test.ts` — 12 tests against a real PGLite instance, driven
  through `resolveAndRecordWith` with a live connection rather than a mock. The
  SQL *is* most of this module's behaviour; a test that stubbed it would pass
  while the upsert and the new-evidence diff were both wrong.

The decisive one is `END TO END: the forecast prior is findable on the next
poll` — it freezes a snapshot under poll 1's id, then runs the exact query
`buildDesk` uses and asserts the prior comes back.

## Still open

- Scenario **priors** remain a hand-tuned keyword formula
  (`hypothesize.ts`: `clamp(16 + esc*6 + hits*2 - de*4, 8, 42)`). Identity makes
  the *update* real; the prior it updates is still invented. That is the next
  block.
- The materiality gate keys off `sinceMs` (time) rather than the registry's
  exact new-headline set, which is now strictly better provenance.

---

# Measured transmission edges

## The defect

The Ripple graph's 42 transmission edges each carried a hand-authored
`confidence` (`0.82`, `0.74`, …) and a lag label (`"hours–days"`). The graph
rendered those numbers to the user as confidence. They were not measurements.

## What was measured

`ace/ripple/edge_calibration.py`, run against the 16-channel FRED panel from
2010, 30% chronological holdout:

| status | edges | meaning |
|---|---|---|
| `unmeasured` | **34** | no daily market proxy for at least one end |
| `measured` | 6 | both ends proxy; holdout coupling clears the floor |
| `no_material_coupling` | 1 | proxies exist; relationship indistinguishable from zero |
| `degenerate` | 1 | both ends proxy to the same series |

**Mean |asserted − measured| confidence on the 6 measurable edges: 0.372.**

Specifics worth stating:

- `rates→equity` shipped at `0.62`. Its sign holds in **17%** of holdout
  bootstrap resamples. That edge is close to noise.
- `inflation→fx` shipped at `0.55`. Holdout |r| = 0.047 — below the floor.
- `rates→duration` both proxy to UST10Y. Unguarded this returns r = 1.0 and
  renders as the strongest link in the graph. The calibrator refuses it.
- **Zero** sign flips. Where the data can speak, the ontology's *directions*
  are right. It is the magnitudes that were invented.
- **Zero** edges have a lagged horizon surviving multiplicity correction. Every
  lag label in the graph is unsupported by this data, which is consistent with
  the transmission-edge study (72.1% of edges survive out of sample, none with
  a stable non-zero lag) and the local-projection study (no horizon beyond h=0
  survives Holm correction on any pair).

## What "confidence" now means

**Sign stability out of sample**: the fraction of block-bootstrap resamples of
the held-out period in which the contemporaneous relationship keeps the sign it
had in training. It answers "if I rely on this arrow, how often does it point
the way the graph says?"

It is **not a strength**. `coupling` (holdout |r|) carries strength, and the two
must be shown together — a weak relationship can have a perfectly stable sign.
`energy→inflation` has coupling 0.124 and sign stability 1.00; displaying only
the second would be worse than displaying neither.

Confidence is reported **only** when status is `measured`. An unmeasured edge
carries `null`, and the UI renders the label (`asserted`, `inferred`,
`no coupling`, `self-edge`) instead of a number.

## Where it flows

```
ontology.ts (structure)
   → scripts/export-transmit-edges.mjs
   → ace/ripple/edge_calibration.py        measurement
   → artifacts/reports/transmission_edges.json
   → scripts/generate-transmission-evidence.mjs
   → src/lib/engine/transmission-evidence.ts   (GENERATED — do not hand-edit)
   → graph.ts   attaches support/coupling/confidence to every CausalLink
   → ripple-map.tsx (dashed stroke when not measured), maps.tsx (label, not %)
   → intervene.ts   weights measured edges above asserted ones
```

`npm run edges:measure` re-runs the whole chain.

## Unmeasured edges are not deleted

34 edges stay in the graph. "No daily market proxy for shipping insurance" is
not the same claim as "shipping insurance transmits nothing", and deleting them
would make the graph *less* true. In `intervene.ts` they carry
`ASSERTED_WEIGHT = 0.3` — explicitly below any measured edge that cleared the
floor, explicitly above zero, and named so nobody mistakes it for a measurement.

## Tests

`transmission-evidence.test.ts` (11) pins the invariants that stop drift:
every ontology edge has a verdict; no stale verdicts survive an ontology change;
only measured edges carry a number; a measured edge cleared the floor it was
measured against; degenerate edges are caught, not measured; no edge claims a
lag it did not earn.

`intervene.test.ts` gains 4 covering the weighting: asserted below measured,
above zero; `no_material_coupling` and `degenerate` weigh nothing; a measured
edge outranks an asserted one whatever the ontology claimed.

## Limits

Six measurable edges is a small base, and it is small because the panel is
small. The honest way to grow it is more daily series with real history — not a
looser floor. FRED licenses its index series for ten years and its credit
spreads for two, which is why several natural proxies are absent. CoinGecko's
free tier caps at 365 days, too shallow for a holdout split, so every crypto
edge stays unmeasured.
