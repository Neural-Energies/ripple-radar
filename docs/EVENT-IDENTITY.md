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

---

# The scenario prior

## The defect

Every probability the product displayed traced back to `hypothesize.ts`:

```ts
const material = clamp(16 + esc * 6 + hits * 2 - de * 4, 8, 42);
const partial  = clamp(26 + hits * 2, 14, 44);
const noise    = clamp(24 - esc * 3 + de * 4, 8, 40);
```

`hits` is a count of headlines. `esc` and `de` are counts of keywords. The
constants — 16, 6, 2, 4, 26, 24, 3 — were authored. The Dirichlet update
downstream is real and correct; it was updating an invented prior.

Two specific problems beyond "the numbers are made up":

1. **Coverage volume is not probability.** The formula added 2 points of
   materialization mass per headline, so a heavily covered story looked more
   likely purely for being heavily covered — and coverage peaks *after* a move
   is already priced.
2. **It ignored the horizon.** A 24-hour book and a 30-day book got the same
   prior. Those are different questions.

## The replacement

An Aalen-Johansen competing-risks fit on **4,633 market shocks**, scored once on
a sealed holdout: worst out-of-sample error **3.5%** against **28.8%** for the
naive Kaplan-Meier treatment that censors the competing cause. It answers
exactly what ACE's families ask — after a shock, does this escalate, merely
continue, or neither — and it answers it **by horizon**.

| horizon | escalation | continuation | neither |
|---|---|---|---|
| 1d | 3.0% | 22.9% | 74.1% |
| 7d | 4.9% | 34.3% | 60.8% |
| 30d | 7.5% | 51.1% | 41.4% |

Mapped to the book: `material` ← escalation, `partial` ← continuation, and
`noise`/`fade` share the residual.

**The behavioural change is large and in the honest direction.** `material` now
runs 3–7% inside a week where the authored formula had a floor of 16% and a
ceiling of 42%. The old prior was systematically overconfident about things
materializing.

## What is still not measured, and says so

The fit distinguishes **three** outcomes. Books have **four** families, and the
split of the residual between "narrative premium only" and "actively eases" is
not something this model speaks to. Those rows are tagged `residual`: the *size*
of their shared mass is empirical, the *split* is the legacy ratio, and the
basis string says exactly that.

The reference class is a transfer too — the curves were measured on market
shocks (|return| ≥ 2σ), not news events. Every prior carries that sentence
rather than burying it.

## Source ranking

| source | meaning |
|---|---|
| `empirical_ledger` | resolved forecasts for this class in our own ledger — not yet available |
| `reference_class` | the validated competing-risks curves at this horizon |
| `residual` | empirically sized mass on a split the model does not make |
| `insufficient` | nothing qualifies; **no probability is offered** |

`weakestSource` reports the book's real standing rather than its best part.
Below the 0.5-day floor the curves were fit over, the engine returns
`insufficient` with zero probabilities — reading the curve there would be
extrapolation dressed as data.

## A latent kernel bug this surfaced

Writing the insufficient path exposed `roundTo100([0,0,0,0])` returning
`[1,1,1,1]` — it fell through `total || 1` and handed an arbitrary point to
each row. The **posterior update calls the same kernel**, so a degenerate weight
vector anywhere would have had mass invented for it. Fixed at the root: zero
total mass returns zeros, because that is the absence of a distribution, not a
distribution to close.

## Dead parameters removed

`esc` and `de` no longer drive anything, so they are gone from `scenariosFor`'s
signature. A parameter that does nothing is a lie about what produces the
number.

## Where it flows

```
artifacts/reports/ace_competing_risks_v1_scorecard.json   (validated run)
  → scripts/generate-base-rates.mjs
  → src/lib/ace/base-rates.ts        (GENERATED — refuses a model that failed its gate)
  → src/lib/ace/prior.ts             ranked sources, provenance, insufficient
  → hypothesize.ts                   scenariosFor
  → Scenario.prior                   { source, basis, probability }
  → scenarios.tsx                    source chip; hover gives the full basis
```

`npm run baserates:generate` regenerates. The generator **refuses to emit** if
`passes` is false on the source run.

## Tests

`prior.test.ts` (17): curves monotone and inside the simplex; interpolation
between knots; clamping instead of extrapolation outside the grid; mass closes
to 100 for 3- and 4-row books; the prior moves with horizon; modelled rows cite
the model; residual rows are flagged; the reference-class transfer is stated;
`insufficient` offers nothing to display.

`probability.test.ts`: the 360-case sweep was re-pointed from `esc`/`de` — which
no longer drive anything — onto the horizon, which does. Plus: the prior does
**not** move with article count, it **does** move with horizon, every row states
its source, and `roundTo100` no longer invents mass.

---

# Game-theory payoff sensitivity

## The defect

`readMatrix` solves for pure-strategy Nash best responses **correctly**. What it
solves over is a matrix of authored integers:

```ts
cell("Max leverage, self-harm", 3, -3)
```

Those are ordinal judgements about actor preferences, not measurements. Nothing
in the product said so, and an equilibrium read off assumed payoffs rendered
exactly like one read off known payoffs.

That matters because **equilibria are not continuous in payoffs**. A single cell
moving one step can relocate the mutual best response entirely, and a reader had
no way to tell a robust answer from a knife-edge one.

## The measurement

Re-solve the matrix with every payoff jittered, and report how often each answer
survives. Default ±1 — one full preference step on the scale the payoffs are
authored on: enough to flip a genuinely marginal ordering, not enough to invent
a different game. The magnitude is itself an assumption and travels with the
result.

Measured on all ten live family matrices, 400 draws, seeded:

| family | primary holds | set unchanged | no equilibrium | verdict |
|---|---|---|---|---|
| weather | 100% | 100% | 0% | robust |
| corporate | 89% | 89% | 0% | robust |
| physical | 84% | 84% | 0% | robust |
| kinetic | 84% | 84% | 0% | robust |
| other | 84% | 84% | 0% | robust |
| fx | 76% | 75% | 4% | leaning |
| tech | 75% | 75% | 19% | leaning |
| commodity | 75% | 67% | 12% | leaning |
| policy | 50% | 45% | **45%** | knife edge |
| credit | 43% | **0%** | 4% | knife edge |

`policy` loses its equilibrium entirely in 45% of perturbations. `credit`'s
equilibrium **set never survives a ±1 jitter at all**. Both were previously
shown with a confident "likely cell" and no caveat.

## Primary vs set stability

The first cut graded the verdict on exact set equality, and a test fixture
exposed why that is wrong: a matrix can have a rock-solid primary equilibrium
alongside a second one that flickers. The set then matches 27% of the time while
the leading cell appears in **100%**. Calling that "knife edge" understates a
firm answer as badly as "robust" would overstate a fragile one.

So the verdict grades `primaryStability` — how often the leading equilibrium
cell appears — and `equilibriumStability` (exact set match) is reported
alongside it. Both are in the type; the UI shows the first and the note carries
both.

## Determinism

Seeded xorshift. An analyst who reruns a book must get the same stability
number, or the number is not evidence. A test pins it, and a second test pins
that different seeds genuinely draw different samples — compared on the share
vector, because an all-ties game returns the same coarse summary under every
seed and those agreeing would prove nothing.

## UI

One chip beside the likely cell: `robust` / `leaning` / `knife edge` / `no
stable equilibrium`, plus "holds in N% of ±1 payoff perturbations" and the
no-equilibrium share when it exceeds 10%. Hover gives the full note. No layout
change.

## Tests

`game-sensitivity.test.ts` (13): determinism under a fixed seed; genuine
variation across seeds; a strictly dominant equilibrium is unmoved; a
tie-decided game is reported fragile; a firm primary is not demoted by a
flickering secondary; stability rises as jitter shrinks; zero jitter reproduces
the baseline; `perturb` moves payoffs within the bound and never the labels;
shares are proportions and ordered; the note always states the payoffs are
assumptions; a dominated strategy never reaches equilibrium; one draw does not
divide by zero.
