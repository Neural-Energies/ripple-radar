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

---

# The materiality gate now asks the registry, not the clock

The gate decided what counted as new evidence with
`item.availableTimeMs <= sinceMs`. That rule is wrong in **both** directions:

- **It rejects late-attaching evidence.** A headline stamped before the last
  freeze but only *attached to this event* afterwards — the cluster grew, or a
  similarity match pulled it in — is genuinely new evidence for this event. The
  clock threw it away.
- **It admits re-syndication.** The same wire item republished with a fresh
  timestamp passes the clock while telling the engine nothing new.

The event registry already records exactly which headline ids an event did not
hold before this poll. `gateEvidence` now takes `newHeadlineIds` and treats it
as authoritative when supplied, withholding everything else as
`not-new-to-event`. The clock remains the fallback for a degraded cycle, and
`noveltyBasis` on the verdict says which rule decided — `"registry"` or
`"timestamp"`.

Registry novelty does **not** bypass the stale or duplicate-fact rules; a test
pins that, and another pins that an empty registry record means "nothing is
new" rather than "the rule is off".

Six tests, including the two that demonstrate the clock getting it wrong in
each direction.

---

# Historical analogs

## The gap

`ace/analogs/historical.py` was validated and descriptive, and the application
exposed **none** of it. The gappy-rolling fix earlier in this session took its
usable pool from 812 states to 4,060, and none of that reached a user.

## What it retrieves

Nearest historical states by **Mahalanobis distance** over a 20-day
momentum/volatility state across NASDAQ, UST10Y, WTI, USD_BROAD and VIX —
4,060 days, 2010-02 to 2026-09. Mahalanobis rather than Euclidean so a
one-sigma move in a quiet channel counts as much as one in a noisy channel, and
correlated channels are not double-counted.

## Two leakage guards, both load bearing

1. **Candidates are restricted to dates whose own forward window has closed.**
   Without it an analog from last week arrives carrying a forward return that
   has not finished happening.
2. **The covariance is estimated on the candidate window only.** Using the full
   sample would let the present shape the metric used to retrieve its own
   analogs — a subtle leak that makes every query look better than it is.

Both are pinned by tests that check every returned analog against the cutoff.

## The port, and why it is trustworthy

The request path cannot call Python, so retrieval is reimplemented in
TypeScript — which is exactly where a validated method quietly stops being the
validated method. So `export_pool.py` also writes **reference answers** for nine
query dates spread across regimes (2013 calm, the 2015 and Feb-2018 vol shocks,
Dec-2018, March 2020, Nov-2021, Sep-2022, Aug-2024, Apr-2025).

The port reproduces them exactly: **0/9 mismatched orderings**, identical
medians, p10/p90 and agreement scores, distances agreeing to 5e-4 (the
precision Python exported). If the two ever diverge the test fails rather than
the product shipping a second metric under the same name.

The linear algebra is tested on its own terms too: covariance matches numpy's
`ddof=1`, the Jacobi eigendecomposition reconstructs its input, and the
pseudo-inverse satisfies `A A⁺ A = A` including on a singular matrix — a
covariance over perfectly correlated channels, which a naive inverse would blow
up into dominating every distance.

## What it refuses to do

It returns a **distribution, never a direction**. On the current state the
nearest analog (2018-10-09, distance 1.39) fell **4.8%**, while the median of
the twenty rose **1.8%** and 75% were positive. A product that printed the
nearest analog would have said something the evidence does not support.

Agreement is reported explicitly — `|2·sharePositive − 1|`, 0 on an even split
and 1 when unanimous. Across the nine reference queries it ranged **0.10 to
0.60**: these analogs mostly *disagree*, and the panel says so in words.

## The caveat that matters most

These are analogs of the **market state**, not of the event. The state knows
nothing about event type, actors, severity or geography — the dimensions the
product spec asks for. Calling them "similar events" would claim a retrieval
the data cannot support, so the panel says "market state" and repeats that it
is retrieval, not causality.

Event-structural analogs need an event corpus with those attributes. That is
what the GDELT backfill is for.

## Where it flows

```
ace/analogs/export_pool.py   → artifacts/reports/analog_pool.json (+ reference answers)
                             → src/lib/analogs/pool.json          (committed, 489 KB)
  src/lib/analogs/retrieval.ts     pure, testable, cross-checked against Python
  src/lib/analogs/pool.server.ts   loads the pool; never leaves the server
  src/lib/analogs/analogs.ts       createServerFn boundary
  src/components/analog-panel.tsx  distribution first, nearest analogs second
```

Verified: the pool is **not** in the client bundle. The browser receives twenty
analogs and a distribution, not 4,060 days of history.

`npm run analogs:export` regenerates.

## Tests

`retrieval.test.ts` (16): the nine reference replays (set, order, distances,
distribution, agreement); no analog dated on or after the query; every analog's
forward window closed before the query; a pre-history query refused; a thin
candidate set refused rather than padded; an unparseable date returns a reason
rather than throwing; quantiles ordered; agreement formula; drivers named,
bounded and sorted; and the three linear-algebra identities.

---

# Conflict cascade in the product

The one place ACE's ripple thesis is supported by data, wired to the UI.

`scripts/generate-cascade-rates.mjs` reads the Hawkes run and emits
`src/lib/ace/cascade-rates.ts`. **Only countries that cleared the gate are
emitted** — a country that failed, or was never fitted, is absent, and the app
renders that absence rather than a default. The generator refuses to emit an
empty table.

## Linking to the event

`cascadesForEntities` matches an event's extracted entities against an explicit
alias list (`hezbollah` → Lebanon, `idf` → Israel, …). Deliberately conservative
and hand-listed rather than fuzzy: a wrong match attaches one country's measured
cascade to another country's event, which is worse than showing nothing because
it reads as evidence. An event about Norway matches nothing, and the panel says
so instead of substituting a global average.

## What the panel claims

The branching ratio renders to **one decimal** and is described in words
("~83 more per 100"). The intensity's exact shape is unverified at daily
resolution, so a three-digit figure would claim precision the residuals do not
support. The panel states plainly that clustering is established and decay
shape is not, and that prices show no such propagation while the event stream
does.

## Tests

`cascade-rates.test.ts` (12): only gate-clearing countries present; every one
beats Poisson in and out of sample; every branching ratio stationary; the
cascade multiplier is consistent with `1/(1−α)`; the caveat travels with the
numbers; entity matching hits the right country and **nothing** for an
unmeasured one.

---

# Probability history is real now

`compose.ts` emitted this as an event's forecast history:

```ts
{ date: "T-3", value: probability - 8 },
{ date: "T-2", value: probability - 4 },
{ date: "T-1", value: probability - 2 },
```

A synthetic ramp. It would have shown a rising trend whatever had actually
happened. It was **never rendered**, which is the only reason it never misled
anyone — and it would have, the moment someone plotted it.

It is now read from the frozen forecast ledger: one append-only row per freeze,
each carrying the scenario mix as it stood. Stable event ids are what make that
accumulate against a single event instead of scattering — which is why this fix
had to wait for the registry.

An event on its first sighting gets an **empty** series. One point is not a
trend and three invented ones are not history.

This is the substrate Forecast Delta needs: "18% → 27%, +9 points, last 6
hours" is now answerable from data rather than from a subtraction.

## Tests

Five, against a live PGLite instance (`probabilityHistoryWith` takes an
injectable connection, as the registry does — the query and its ordering *are*
the behaviour):

- rows come back **oldest-first** with strictly increasing timestamps, so a
  delta read off the series points the right way — inserted deliberately out of
  order to prove the ordering is the query's, not the insert's
- an event with no freezes gets **no** history
- five events cost **one** round-trip, not five — this runs on the live poll
- the window keeps the most **recent** freezes, not the oldest
- a malformed snapshot is skipped rather than breaking the whole series

## Also: `load_events` no longer takes the machine down with it

It holds every row of every cached day — ~13M at full coverage — and was killed
by the OOM reaper, taking the GDELT backfill sharing the machine with it. It now
raises past a 400-day guard, naming `daily_counts_by()` as the fix, and accepts
`start`/`end` to narrow the window by filename before reading. Being killed
tells the caller nothing; raising tells them what to do.

---

# What `compose.ts` was inventing

An audit of every hand-tuned formula left in the composer, and which of them
reached a user.

| field | was | rendered? | now |
|---|---|---|---|
| `probabilityDelta` | `clamp(hits*1.1 + (esc−de), −12, 18)` | **yes, 3 places** | `0` on first sighting |
| `narrativeHeat.news` | `clamp(28 + hits*6, 8, 100)` | no | the headline count |
| `narrativeHeat.social` | `clamp(16 + hits*4, 8, 100)` | no | **absent** |
| `narrativeHeat.search` | `clamp(14 + hits*3, 8, 100)` | no | **absent** |
| `narrativeHeat` T-2/T-1 | hardcoded `{news:18,social:10,search:8}` | no | removed |
| `probabilityHistory` | `probability − 8 / −4 / −2` | no | the ledger |
| `sentiment[].score` | `36 + hits*6`, `40 + (esc−de)*8`, `50 + mkt*6` | no | the observations |

## The one that mattered

`probabilityDelta` renders in three places with an up/down arrow. On first
sighting it was a "change" computed from **how many articles had been
written** — so a heavily covered story displayed a rising forecast having
moved nothing. It is now `0`, which is the honest value: a book seen for the
first time has no prior to have moved from, and the UI already hides a zero
delta. `buildDesk` overwrites it with the real posterior delta once a frozen
prior exists to difference against.

## Social and search were never measured

`social` and `search` were two entire data series derived from a headline
count, for platforms this product does not connect to. They are now optional
on `HeatPoint` and **absent** until a real feed fills them. `news` carries the
count itself, so it means one thing.

## Dead but not harmless

`narrativeHeat`, `sentiment`, `signals`, `takeaways`, `impacts` and
`heatPoint` are computed and rendered **nowhere**. That is why these
fabrications never misled anyone — and the moment someone plotted one, they
would have. The fix was to make them true rather than delete them, because
most are things the product should eventually show.

## Tests

Four in `engine.test.ts`, written against the composer's real signature: a
freshly composed book claims no change at 1, 5 and 20 headlines; attention is a
count with social/search absent; probability history carries no synthetic `T-`
points; sentiment reports observations rather than scores on an invented scale.

---

# The macro regime: a label with a measured error rate

## Three claims sold as one

The growth/inflation quad classifies the economy by the **rate of change** of
growth and inflation rather than their level.

|  | inflation decelerating | inflation accelerating |
|---|---|---|
| **growth accelerating** | Q1 Goldilocks | Q2 Reflation |
| **growth decelerating** | Q4 Deflation | Q3 Stagflation |

Wherever this framework is sold, three claims arrive together: that the economy
can be classified this way in real time, that the quad tells you how to be
positioned, and that it tells you how much risk to carry. They are separable,
they were tested separately, and only the first survived.

## What the classification had to survive

Macro data revises for years and publishes late. Classify March 2020 as Quad 4
using today's figures and you did not nowcast a regime, you read an almanac.

So `ace/macro/quads.py` builds every reading from ALFRED **first-release**
vintages filtered on the *publication* timestamp: a value observed in March but
published in May does not exist on an April classification date, and a later
revision of the same month is a different number that was not known then
either. Real GDP is excluded outright — a ~119-day lag means the print
describes a quarter that ended four months ago.

The discipline shows up in results rather than only in a docstring:

- **2008-10-31 → Q3 Stagflation**, not Q4. CPI was still +5.05% and
  accelerating in the September print.
- **2020-03-31 → Q3**, growth +0.61% YoY through 2020-02-01. COVID had not
  entered published data yet.

320 month-ends, 2000-01 to 2026-08.

## The composite is chosen, not assumed

"Industrial production and payrolls" is a convention. Eight candidates are
scored instead, on a stated criterion — the share of real-time labels that
survived contact with the revised data, measured on a training window and
re-checked on a holdout — with a pre-registered **two-month persistence floor**
that disqualifies a candidate outright rather than letting persistence be
traded off against survival.

`labour` (payrolls + CPI, three-month rate of change) won the training window
at 72.5% and ranked 2nd of 7 eligible on the holdout. The full table ships in
the app, because the honest caveat is that a narrow composite partly wins a
revision criterion by having less to revise — and a reader should be able to
disagree with the criterion rather than with a hidden choice.

## Three measured facts that qualify every reading

**1. Revision risk, calibrated by margin.** Every historical reading was re-run
on today's revised data, cut to the same observation months. 74.2% survived.
The per-margin rates are monotone, with bin edges fixed in advance:

| margin | n | survived |
|---|---|---|
| knife-edge 0.00–0.25 | 190 | 62.6% |
| thin 0.25–0.75 | 83 | 91.6% |
| clear 0.75–2.00 | 24 | 100% |

**190 of 302 readings are knife-edge.** The quad is usually a near-tie, and a
near-tie flips more than a third of the time.

**2. The failures have a direction.** 72% of them flipped the *growth* axis
(Q1↔Q4, Q2↔Q3), against 15 on inflation. Growth data revises far more than
price data, so the top row of the 2×2 is where a real-time quad is most likely
to be wrong — and the framework's own dominant transitions travel the same
axis, because both are driven by the same noise.

**3. The median spell is two months — under every specification tested.** Only
33–46% of completed spells reach a quarter. A framework presented as quarterly
regimes produces, on honest point-in-time monthly data, a label that turns over
about every two months. Spells are measured with Kaplan-Meier so the one still
running contributes to the risk set without being recorded as a short completed
one; treating it as finished, or dropping it, biases every estimate downward.

Because of this, the product ships **occupancy** — the share of the last N
months spent in each quad — alongside the point reading. The window is the
steadier read; the point call is the fresher one; they disagree often, and when
they do it is the point call that is more likely to move.

## What the two forecasting claims failed against

**Positioning.** Baseline: always long the same asset, not zero. 0 of 6
channels beat it with a CI excluding zero. NASDAQ's edge of exactly `+0.000` is
not a rounding artefact — every learned sign was positive, so "quad
positioning" *was* long-only.

**Risk sizing.** Baseline: an AR(1) in log realised volatility, not the
unconditional mean. Volatility is the most persistent quantity in finance, so a
quad that merely recovers "vol was high recently" has discovered nothing. 0 of
6 channels survive Holm correction. But the descriptive signature is real —
**14 of 18 cells kept their sign (78%)**, against 8/12 for returns. Quads 3 and
4 genuinely run hotter. The tape already knows it.

## The gates are generators, not flags

`scripts/generate-macro-quads.mjs` writes `POSITIONING_VALIDATED` and
`VOL_FORECAST_VALIDATED` from the runs. It refuses to emit if the live reading
is unclassified, the history is under 24 months, or **either verdict is
missing** — an absent scorecard must never read as a pass.

It emits two artifacts. `macro-quads.ts` carries the live reading and
everything needed to qualify it, small enough for every page. `macro-detail.json`
carries the history, the per-spec scorecards and the survival curves, and is
fetched server-side by the macro route only — the same split the analog pool
uses.

## What the surfaces render

`MacroQuadPanel` is a full-width band on the desk: the quad, both rates of
change, the data lag, the confidence line, a three-year strip, twelve-month
occupancy, and the line saying it does not position or size risk.

It was a tile in the event-analysis column first. That column is stretched to
the map's height with `overflow-hidden` on every panel, so the band's last
paragraph was silently clipped — the paragraph saying the quad does not
position, which is the one line that must never be the one that gets cut. A
band also matches what this is: macro backdrop, the same whichever event is on
the desk.

`/macro` carries the depth: the live reading with its inputs and their
publication lags, the margin calibration with bin counts, the revision
confusion matrix, the spec vote with every candidate's scorecard, the
Kaplan-Meier curves, occupancy across four windows, and both failed tests in
full. It ranks no assets and sizes no risk.

Confidence grades ("firm", "mixed", "fragile") are a **rendering convention**
applying stated cutoffs to two measured quantities — the margin's survival rate
and the share of specifications agreeing. The components are always shown
beside the word, and it is never presented as a probability.

## A missing provider, found on the way

`/macro` uses `useQuery` for its detail payload, and it would not server-render.
The cause was that `@tanstack/react-query` was a dependency and components
called `useQuery`, but **nothing ever mounted a `QueryClientProvider`**. Every
such call threw "No QueryClient set" — silently on the server, where the render
fell back to a shell, and into the route error boundary on the client.

The historical-analog panel had been one of the casualties. `src/lib/query.ts`
now provides a client, per request on the server (a module-level singleton
would serve one request's data to the next visitor) and as a singleton in the
browser (a new client per render throws the cache away). `/scenarios`
server-renders its analogs for the first time.

## Tests

`ace/tests/test_quads.py` — the 2×2 including its boundary; `known_at` hiding
unpublished months and keeping first releases over revisions; a reading going
unclassified rather than guessing; the regression where appending a violent
revision leaves an earlier reading byte-identical; run-collapsed transitions
with no diagonal; a synthetic V-shaped recovery scanned for months where level
and direction disagree.

`ace/tests/test_macro.py` — a censored spell that is not counted as a death (the
defect the duration module exists to prevent); a conditional exit that stays
conditional; a median reported as `None` when the sample does not contain it;
margin bins tiling the line; calibration excluding unsettled months, with the
flattered figure the test would otherwise have let through; a thin bin reported
but not quotable; confusion rows as distributions; occupancy that surfaces a
tie rather than picking a winner by index order.

`src/lib/ace/macro-quads.test.ts` — 34 tests across three families: the gates
stay tied to their verdicts and stay separate from each other; every reading's
inputs predate the date it classifies and no reading is fresher than its
slowest input publishes; and every qualification stays consistent with the
numbers behind it — survival rising with margin, the live rate coming from the
live reading's own bin, the flip tally accounting for each failure once, spec
agreement counting what the specs actually say, a disqualified spec never
winning, and the pooled rate equalling the bins it is made of. That last one
caught a real defect: the exporter was pooling over a larger sample than the
calibration used, reporting 75.3% where the honest figure is 74.2%.
