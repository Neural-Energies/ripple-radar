# Audit log

Append-only. Newest cycle on top. One entry per audit pass.

Each entry records what was checked, what was found, what was fixed, and what
was left open with a reason. A cycle that finds nothing still gets an entry
saying so — an empty log and a healthy repo look identical otherwise.

**Scope of a cycle:** typecheck, lint, the three test suites, a production
build, the SSR route sweep, then a read of the code changed since the previous
entry against `docs/ROADMAP.md` — its non-negotiable invariants first, then its
drift watch, then Now/Next/Later coverage.

---

## 2026-09-26 — cycle 2 (macro panel completeness)

**Checked:** `ace/state/` and `ace/regime/` against the commissioning brief's
data requirements and the roadmap's non-negotiable invariants. 91 FRED/ALFRED
candidate series probed against the live API; two fetch routes verified
empirically; the WP3 regime finding re-run on the completed panel.

**Trigger:** a direct instruction — *"we shouldn't have missing data bc it's
federal government data all of it accessible through api's if we don't have all
the data that is our number 1 priority before anything else."*

**Scope, stated:** this cycle changed only `ace/` — `git status src/` is empty —
so the gates that read the TypeScript app were run as a regression check rather
than as the subject. `tsc --noEmit` exits **0**, against **8 errors** at cycle 1.
The eslint, vite build and SSR sweep were NOT re-run; nothing in `src/`,
`scripts/` or `server/` moved, and a cycle that reports gates it did not run is
worse than one that says which it skipped.

### Finding 1 — one fetch route could not reach a third of the panel

`ace/data/alfred.py` had a single accessor, `release_history`, which asks FRED
for `output_type=4` (first release only). That request returns **HTTP 400 for
every daily market series** — VIX, the whole Treasury curve, breakevens, the
real yield, the Moody's spreads, the overnight repo facility, the S&P 500.

The cause is not an outage. There is no vintage archive for these series
because there is nothing to archive: a close is never revised. The effect was
that the panel had no financial-conditions block, no credit-spread series and
no daily anything, and the gap looked like a design choice rather than a
missing accessor.

**Fixed.** `unrevised_history` reads the standard endpoint and synthesises
`published = obs_date + 1 day` — conservative by a day, in the only direction
that cannot manufacture a backtest. `SeriesSpec.revised` selects the route and
**defaults to True**, so the unsafe path is never reached by omission.

### Finding 2 — the route argument was wrong for one series, and measuring caught it

"A market quote is never revised" is reasoning. `ace/state/route_check.py` turns
it into a measurement, two ways: against ALFRED's first-release archive where
one exists, and against ALFRED as-of snapshots two and four years back where it
does not.

| Series | Overlap | Differing | Verdict |
|---|---:|---:|---|
| DGS2, DGS10, T10Y2Y, T10Y3M, T10YIE, DFII10, BAA10Y, AAA10Y | ~2,500 each | **0** | unrevised across every snapshot |
| BAMLH0A0HYM2 | 786 (archive) + 334 | **0** | identical to its own first release |
| VIXCLS | 2,020 | 2 | 0.099%, max 0.08 vol points |
| RRPONTSYD | 1,991 | 1 | 0.050%, max $0.103bn |
| **DTWEXBGS** | 1,991 | **1,962** | **98.5% — removed from the route** |
| SP500 | — | — | licence refuses both checks; flagged unverifiable |

The broad trade-weighted dollar index looks exactly like a market quote. It is
a **constructed index** whose H.10 basket weights are re-estimated annually and
applied backwards, so it disagrees with its own archive on 91% of days by up to
2.18 index points. Reasoning would have kept it on the unrevised route and it
would have leaked, invisibly, into every financial-conditions statement. It now
reads the archive, at the cost of history before 2019.

A control group confirms the guard is not decoration: initial claims,
continuing claims, the Fed balance sheet, weekly C&I loans and the St. Louis
stress index — all read via ALFRED — disagree with the standard endpoint on
11% to 99.9% of observations. `revised=True` is load-bearing.

`test_every_unrevised_series_carries_a_measurement_or_a_flag` reads the report
back and fails if a series joins the route without a record under
`MAX_UNREVISED_DIVERGENCE` (0.002) or a written reason in `UNVERIFIABLE_ROUTE`.

### Finding 3 — a 504 is not an absence

NFCI and ANFCI were recorded as unreachable after the archive request timed
out. Retried at 240 seconds, FRED answered with its own **504 Gateway
Time-out** — a server-side limit on response size, not a missing archive.
Narrowing `observation_start` to 2005 returns in seconds.

`SeriesSpec.vintage_start` now carries a per-series archive start. Both series
are in the panel. Two limits are recorded separately in the note, because they
are different facts: the 504 (worked around) and the archive's own start of
**2011-05-27**, which no request start changes.

### Finding 4 — quarterly members were about to be misspecified

Real GDP, the employment cost index and the loan officer survey are quarterly.
Stacked into a monthly frame they would have read as monthly series that are
missing two months in three — a different and wrong claim from "quarterly".

`PanelBuild` now carries `frame_q`, and `fit_factors` passes it to
`DynamicFactorMQ` as `endog_quarterly`, which applies the Mariano-Murasawa
aggregation: a quarterly reading is a weighted average of three latent monthly
values. Caught before it shipped, by reading the constructor rather than by a
failing number.

### Finding 5 — `days_behind` understated the fast edge by up to four weeks

A daily yield stamped into the September row reported `days_behind: 25`,
because the field measured distance to the row's month stamp. The 10-year had
printed the day before. The whole reason for including daily series is the fast
edge, and the field was hiding it.

The edge dict now reports `through` (the real print date) and `days_behind`
from it, with `panel_month` alongside for frame alignment. `months_behind`
still comes from the month stamp, because it answers a different question.

### Finding 6 — five of ten blocks cannot see their own newest month

Visible only once the panel was large enough to have slow blocks. The Kalman
smoother's standard error at the ragged edge, in units of each factor's own
historical spread:

| informative | ratio | | uninformative | ratio |
|---|---:|---|---|---:|
| housing | 0.37 | | consumer | 1.00 |
| global | 0.43 | | growth | 1.03 |
| labor | 0.66 | | credit | 1.20 |
| financial | 0.79 | | inflation | 1.30 |
| | | | manufacturing | 1.65 |
| | | | liquidity | 1.84 |

At a ratio of 1.0 the posterior is as wide as the unconditional distribution:
the filter has learned nothing about that month and has reverted to the mean.
The block's `level` then reads as a confident zero — September's growth level
was `+0.00`, consumer `-0.02`, manufacturing `-0.06` — which a surface would
render as "no change" rather than as "no data". The blocks that fail are
exactly the slow-publishing ones, so this is the ragged edge behaving
correctly and the CONTRACT was what needed fixing.

`BlockState` now carries `uncertainty_ratio` and `informative`, an absent
uncertainty counts as uninformative rather than fine, and the state notes name
the blind blocks.

### Finding 7 — the factor count was reported as if it drove the model

`MacroState.factor_count` reported Bai-Ng's k beside a nine-block factor list.
Under the block specification each block already gets a factor, so k changes
nothing until it exceeds the block count — and k=6 against 9 blocks does not.
The number was accurate and misleading at the same time.

`FactorFit.count_binding` records whether the criterion actually shaped the
fit, and the state says so in as many words.

### Finding 8 — the WP3 regime conclusion was right about seven factors and wrong about two

WP3 concluded there is no LEVEL regime in monthly macro data — regimes are
about volatility, not about the level a factor reverts to. That was decided on
the 14-series panel, which had no liquidity, credit, financial-conditions or
housing-finance block in it. Re-running it on the completed panel was the
reason the coverage work came first.

**The original comparison was too weak to answer it.** `fit_axis` scores a
two-state switching-mean-AND-variance model against a single Gaussian, and
nearly every macro factor wins that by hundreds of BIC points. It has to: the
winning model has two things the baseline lacks, and on these factors it is the
variance doing the work. Credit's fitted states separate by **0.004** pooled
standard deviations in mean and by a factor of **10,180** in variance. Inflation
by 0.0001 and 115,701. Those are volatility regimes that pass a level test.

So `ace/regime/mean_vs_variance.py` runs the decisive comparison instead:

> switching mean AND variance **vs** switching VARIANCE ALONE

Both have two states, both let volatility move, and the only difference is one
parameter — whether the mean may move with the state. Plus a persistence floor,
because a state with an expected duration near one month is an outlier bucket.

| factor | mean buys (BIC) | separation | var ratio | durations | verdict |
|---|---:|---:|---:|---|---|
| **housing** | **+151.0** | 2.06 | 5x | 91 / 52 mo | **LEVEL REGIME** |
| **financial** | **+68.4** | 2.06 | 1.5x | 37 / 20 mo | **LEVEL REGIME** |
| growth | +1.7 | 1.11 | 143x | 35 / **1.1 mo** | fails both bars |
| liquidity | -0.5 | 0.26 | 115x | 232 / 131 mo | volatility only |
| consumer | -1.8 | 0.46 | 637x | 19 / 1.6 mo | volatility only |
| labor | -5.1 | 0.34 | 85x | 41 / 1.9 mo | volatility only |
| global | -6.0 | 0.15 | 240x | 83 / 4.3 mo | volatility only |
| credit | -6.3 | 0.004 | 10,180x | 35 / 4.0 mo | volatility only |
| inflation | -6.3 | 0.0001 | 115,701x | 139 / 225 mo | volatility only |
| manufacturing | — | — | degenerate | 263 / 461 mo | **inconclusive** (see Finding 10) |

Ten factors, a global one and one per block. **Six** give the mean a NEGATIVE
BIC — switching variance alone is the better model — and growth gives it +1.7
against a floor of 2.0 while failing the duration floor outright. So of the
nine the test could reach, seven have no level regime and **two do**. Those two
are blocks that **did not exist in the panel the original finding was decided
on**. Financial conditions is the cleanest level regime in the table: a variance
ratio of 1.5 means the two states are almost equally volatile and differ almost
entirely in level.

**The comparison is controlled.** Both panels are built on the same as-of date,
through the same code, with the same seeds; only the series differ. On the
14-series panel the stricter test finds NO level regime at all — six factors,
every one giving the mean a negative BIC (labor -1.6, growth -1.7, global.2
-2.9, consumer -3.3, global.1 -5.6, inflation -6.3), and no separation above
0.49. So the change is the coverage, not the method.

It could not have gone otherwise on that panel: it carried **one** housing
series, too few for `_block_map` to identify a housing factor, and **no**
financial series at all. Neither of the two level regimes had a factor to be
found in. The original finding was correct about the data it had, and was
recorded as a finding about macro data.

Artifact: `artifacts/reports/macro_regime_mean_vs_variance.json`, with both
panels in it. The discriminator is unit-tested on synthetic series whose answers
are known by construction, and one of those tests asserts that a pure volatility
regime STILL WINS the naive one-state comparison — which is the whole argument
for the extra machinery.

### Finding 9 — the taxonomy gate would have named a quad off a single month

`build_regime_state` withheld the four-name taxonomy when an axis was not
mean-separated. Growth on the full panel separates its means by 1.11 pooled
standard deviations, past the 0.50 floor, so it would have passed — and its low
state lasts **1.1 months** with a 143x variance ratio. That is April 2020 given
a state of its own.

`AxisFit.persistent` and `MIN_REGIME_MONTHS` now gate the taxonomy alongside
separation. Checked against the real factor rather than assumed: growth's
low-state variance is 0.128 of the series variance, so the short state is a
genuine finding and not the numerical artefact of Finding 10.

### Finding 10 — a likelihood spike was reporting as the strongest result in the table

The manufacturing factor's low-state variance optimised to **1.9e-33**, and its
two-state BIC came back at **-11,808** against a one-state baseline of 1,162.
Read down the column that is by far the best result on the panel.

It is a broken fit. A Gaussian mixture's likelihood is unbounded: drive one
component's variance to zero on points it passes exactly and the density there
goes to infinity, so BIC improves without limit and means nothing. The row
first looked like a FORMATTING bug — the ratio printed 33 characters and ran
into the next column — which is how it was found.

`MIN_STATE_VARIANCE_FRACTION` (1e-8 of the series' own variance) now detects it
and the verdict reads INCONCLUSIVE rather than a result in either direction. A
degenerate fit cannot establish a level regime and cannot rule one out. The
real factors sit far clear of the floor: growth 0.128, housing 0.188, financial
0.488, manufacturing 0.

### Finding 11 — withholding the taxonomy was swallowing the axis warnings

The per-axis diagnostics — DEGENERATE, fragile optimum, THIN — were built only
on the path that renders a taxonomy. When the taxonomy was withheld they were
dropped, so a fit of pure Gaussian noise reported "the states do not persist"
and never mentioned that the two-state model does not beat a one-state baseline
at all. **The weaker finding hid the stronger one.** Found by a test that
started failing for the right reason after Finding 9's gate went in. The
diagnostics are computed once and carried down both paths.

### Coverage, after

| | count |
|---|---:|
| candidates probed | 91 |
| in the panel | **89** |
| joined on a live build, nothing dropped | **89 / 89** |
| genuine holes | **1** |

The one hole is existing home sales: FRED holds a 13-month rolling window under
NAR licensing, so there is no history to fetch at any price from this API. New
home sales (`HSN1F`) is the federal substitute and is in the panel. The other
two excluded candidates were FRED-MD internal names that are not FRED series
IDs, and both concepts are present under their real IDs. All three are in
`panel.UNAVAILABLE` with the measurement.

### Against the roadmap

- **Invariant 7 (provenance, never a bare number).** Strengthened. Every panel
  member records its fetch route, its native frequency, its print date and its
  staleness; every block records whether its newest reading is informative.
- **Invariant 10 (no `BUY X 87%`).** Untouched. Nothing here produces a
  user-facing number; `ace/` remains offline.
- **Drift watch — "fake metrics / institutional costume numbers on live desk".**
  Checked `src/data/macro-fixtures.ts`, flagged in the previous cycle as a
  possible violation. **It is the opposite**: an explicit list of things NOT
  built, rendered as gaps. Its `nfci` row ("NFCI and ANFCI are not on this
  book") is accurate for the TypeScript macro book, which reads STLFSI4 only —
  it will need updating when WP7 exports the panel to the surface, and not
  before.
- **STOP WORK banner (2026-09-21).** Still in the roadmap, and this cycle's
  work is new implementation. It proceeds on the direct instruction quoted
  under *Trigger* above, which post-dates the banner. Recorded here rather
  than resolved silently: the banner needs an explicit lift or an amendment.

### Open, with reasons

| Item | Why not this cycle |
|---|---|
| WP2's second exit condition — nowcast beats a random walk out of sample | The panel and factors are in place; the out-of-sample comparison is its own piece of work with its own purged walk-forward. Not started. |
| Bai-Ng `kmax` | Still 6, still a boundary hit, and now known to be inert under the block specification. Raising it is only meaningful if the block structure is relaxed. |
| WP3's own exit condition — Brier vs climatology, registered | The regime SPECIFICATION is now settled: housing and financial conditions carry level regimes, the rest are volatility. Scoring those probabilities against climatology and registering the result is the next piece, and it is not done. |
| The manufacturing factor | Its two-state fit is degenerate on the current panel. Whether that is the factor, the block's six members, or the specification is untested. |
| Fit cost | 468 seconds for 89 series, 561 months, 10 factors, converged. Fine for a daily refresh; not fine inside a 300-date historical replay. A replay will need the fit cached or the panel narrowed, and that choice is not yet made. |

---

## 2026-09-25 — cycle 1 (baseline)

**Checked:** `bcc651b` (Add the live macro book, session check, and vol regime)
against `f6df9bf`. Typecheck, eslint, `test:scripts` / `test:app` /
`test:engine`, vite build, SSR sweep of all 13 routes.

### Entering state

| Gate | Result |
|---|---|
| typecheck | **8 errors** |
| eslint | **1 error**, 32 warnings |
| test:engine | **4 failures** / 249 |
| test:app | 75 pass |
| test:scripts | 17 failures / 195 — pre-existing, see *Known and not this cycle's* |

### Finding 1 — the de-fabrication work was reverted (CRITICAL)

`bcc651b` restored `src/lib/engine/compose.ts` and `src/lib/engine/graph.ts` to
pre-honesty versions and deleted the comments explaining why the constants had
been removed. This is a **drift-watch item** under the roadmap's own wording —
*"fake metrics / institutional costume numbers on live desk"* — and it moved
the project backwards against its own Now board, where *"Invariant guards:
provenance on probability/scenario mass"* is the first row.

What came back:

| Value | Restored to | Why it is wrong |
|---|---|---|
| `event.probability` | `clamp(16 + hits*4 + esc*4 - de*3, 8, 82)` | A count of matched articles plus a count of articles containing escalation keywords. Measures coverage, not likelihood — and coverage follows events that already happened, so it peaks when a move is most priced in. It could also disagree with the scenario mix rendered beside it, because the two were computed by different rules. |
| `sentiment[].score` | `36 + hits*6`, `40 + (esc-de)*8`, `50 + mkt*6` | Three hand-tuned formulas on a 0–96 scale. The observations are real; the scale dressed them up as a measurement. |
| `narrativeHeat` | `[]` | Dropped the one real point (the current matched-headline count) rather than keeping it. |
| `link.confidence` | `clamp(0.8 - level*0.08, 0.42, 0.9)` and a bare `0.48` | An authored number on an edge nothing measured. The measured-edge work made this `null` precisely so the UI renders absence. |
| game-theory `sensitivity` | removed | The Nash solve is exact; its payoffs are assumptions. Without the sensitivity pass the equilibrium renders as a finding rather than as an answer conditional on made-up inputs. |
| `scenariosFor({ esc, de })` | re-passed | Escalation keyword counts driving the scenario prior again. |

**The type system caught half of it on its own.** Six of the eight typecheck
errors were `CausalLink.support` missing and `confidence` no longer being
nullable — the compiler refusing the regression. The four engine-test failures
were the anti-fabrication guards doing exactly the job they were written for.

**Fixed.** `graph.ts` restored wholesale (its entire diff in `bcc651b` was the
revert). `compose.ts` fixed surgically, keeping that commit's genuine
improvements — age-aware `lifecycleOf`, the deduped `sourceCount`, the
`provenance` field, the `coreLabel` and `clockOf` changes. The explanatory
comments are back, each now also naming the regression so the next reader sees
it has happened once.

`src/routes/maps.tsx` and `src/components/ripple-chain.tsx` now render `—` and
"unmeasured link" for a null confidence instead of multiplying null by 100.

### Finding 2 — the r* parser could return the wrong column silently (HIGH)

`src/lib/live/macro-hlw.ts` read the NY Fed Holston–Laubach–Williams workbook
and took **column K** as the US natural rate. K is correct today — verified
against the live file, `K5 = "Natural Rate (r*)"`, `K6 = "US"`, latest value
1.009% at 2026-04-01.

It is correct *until the NY Fed adds a country or reorders a section*. The
workbook lays four sections side by side — trend growth, other determinants,
the natural rate, the output gap — each with a US / Canada / Euro Area triple
beneath. One inserted column and K becomes Canada's r*, or an output gap, and
it flows straight into the Taylor rule and prints a policy stance with nothing
to indicate anything moved.

**Fixed.** `rstarColumn()` resolves the column from the sheet's own headers and
returns `null` when it cannot, so the caller drops the policy rule rather than
printing someone else's number. A plausibility band (−2% to 8%) catches the
rest. Verified against the live workbook and against three synthetic layout
changes.

**A latent XML bug surfaced doing it.** The cell regex only knew
`<c …>…</c>`, but header rows are full of empty styled cells written
self-closing — `<c r="D5" s="15"/>`. Treating one of those as an opening tag
pairs the wrong column with the wrong value, which shifted the section header
two columns left against the real file. Fixed with an alternation and pinned by
a test using the real file's shape.

### Finding 3 — the vol premium mixed two as-of dates (MEDIUM)

`src/lib/live/vol-regime.ts` computed realized volatility from the whole S&P
series, ending at `spx.at(-1)`, then subtracted it from spot VIX at
`spot.date` — the newest session where VIX *and* VIX3M both printed. Those are
not always the same day. `premium` could compare today's realized vol against
yesterday's VIX and call the difference a risk premium. The type already
carried `date` and `spxDate` separately, so the mismatch was known; the
subtraction crossed it anyway.

**Fixed.** The index is cut to the vol pair's as-of date before anything is
computed from it. A test asserts that appending a later index close does not
change an earlier read.

### Finding 4 — `lastOfMonth` compared a date it had already rewritten (LOW)

`src/lib/live/macro-regime.ts` kept the last observation per month by comparing
the incoming date against the stored one — but the stored one had already been
stamped to `YYYY-MM-01`, so any observation in the month beat it regardless of
order. Harmless today because `parseFredCsv` sorts ascending, but the rule was
"last row wins" rather than "latest date wins", and those diverge the moment
anything hands it an unsorted series.

**Fixed.** The original observation date is kept for the comparison.

### Finding 5 — `} catch {}` in the token hasher (LOW)

`src/lib/app-data/client.server.ts:281`. The swallow is correct — a token that
does not decode is not an error, it just is not a JWT — but an empty block
reads as a dropped error. **Fixed** with a comment saying so, which is also
what `no-empty` wants.

### Left open, deliberately

**The point-in-time discipline is no longer on `/macro`.** The new macro book
reads `fredgraph.csv?id=…`, which is the **current revised** series. The
validated Python work (`ace/macro/`) exists because a quad built from revised
data is an almanac, not a nowcast — on that sample, 74.2% of real-time labels
survived revision, 72% of the failures flipped the growth axis, and 190 of 302
readings sat close enough to the boundary to be a coin flip. None of that is
disclosed on the new page. This is a product decision, not a defect, so it is
flagged rather than changed: the new book is a legitimate published-rule read,
it is just a *different* claim from the one the Python engine validated.

**Orphaned modules.** `MacroQuadPanel`, `getMacroDetail`,
`macro-detail.server.ts` and `alignRegime` are no longer reachable from any
route. Their tests still run and pass, so they are not rotting silently, but
they are dead weight until someone decides whether the point-in-time read comes
back. Left in place rather than deleted — deleting validated work to tidy a
diff is the wrong default.

**`regimeFlips` is O(2^n) in legs per side.** Five legs is 32 iterations and
fine. There is no guard if the basket grows.

**`volRead.since`** reports `vix[0].date` and the UI reads it as "VIX history
since 1990". If the fetch is ever truncated, the label silently narrows with
it.

### Known and not this cycle's

`npm run test:scripts` fails 17 of 195. Every one is Grok-PWA scaffolding
reading `.grok/skills/og/SKILL.md` and template files that are gitignored, so
they cannot pass on a fresh clone. Identical on a clean stash of every commit
checked so far. Deciding whether that scaffolding stays is a product call;
until it is made, `npm test` is not a usable gate on its own and cycles should
read the three suites separately.

### Exiting state

| Gate | Result |
|---|---|
| typecheck | clean |
| eslint | **0 errors**, 33 warnings |
| test:engine | **258 pass / 0 fail** (+9 new) |
| test:app | 75 pass / 0 fail |
| python | 218 pass / 0 fail |
| build | clean |
| SSR sweep | 13/13 routes, 0 errors |
