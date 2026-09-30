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

## 2026-09-30 — cycle 5 (PR #5 A01–A15 and B01–B06 closed out; WP3 exit test run)

**Checked.** Cycle 4 left A11 and fourteen other PR #5 findings open. This
cycle closes them, adds the B-series product findings (B01–B06, PR #5/#6),
and runs the WP3 exit test live. Checks at `5095697`:

- `npx tsc --noEmit`: clean.
- `eslint .`: 0 errors, 37 warnings, none in files changed this cycle.
- `test:engine`: 362/362. `test:app`: 75/75. `test:scripts`: 184/201. Its 17
  failures predate this cycle and are not in CI (see Open).
- `pytest ace/tests`: 471 in this workspace. In a clean checkout with a
  fresh venv built from `ace/constraints.txt`: 467 passed, 4 skipped (they
  need the local GDELT cache).
- `npm run build`: ok. Vercel crons in the output: alerts every 5 minutes,
  resolution hourly.
- SSR sweep: all 26 page routes 200.
- Browser checks (Playwright, dark and light, 1400px and 390px): brief,
  learning, scenarios, assets, macro, theses, alerts, watchlists. No
  hydration errors.

### A-series (PR #5), all fixed; replies with evidence are on each thread

| Finding | Commit |
|---|---|
| A01 Nash scan maximised the wrong player's moves | 127d21d |
| A02 ledger graded outcomes past the horizon | f27e69a |
| A03 polls erased Dirichlet concentration | e0b36b7 |
| A04 PCA sample inconsistency, A05 DFM convergence flag | 12636da (cycle 4) |
| A06/A07 competing-risks censoring, CIF step function | 47c4669 |
| A08/A10 Hawkes first-arrival probability, observation clock | 8cf6623 |
| A09 calibration selection reused training labels | f68c9b9 |
| A11 first-print vintages, revision answer key, sealed selection | 40a9157, 015c04a, 2bfb9dc, 07f80d1, 4f3e968 |
| A12/A13 scenario model future labels, frozen family | 9235e23, 1ae82f9 |
| A14 DBN pairing and normalisation | 0b0fd03 |
| A15 zero-weight intervention edge | 30baf68 |

### Found while regenerating A11 evidence (not in the audit)

- **Regime DFM did not converge.** EM hit its 120-iteration cap at a
  criterion of 2.3e-6 against a 1e-6 tolerance, and the corrected A05
  reading rightly reported it. The cap is now 1,000 (EM stops at
  tolerance). Both panels converge, and every level/volatility verdict is
  unchanged (4f3e968).
- **PCA Factor State drivers were in the wrong units.** The driver table
  applied the second standardisation's moments to raw prints. /macro showed
  WALCL at z = 42,515,065 and a 10,632 trade-balance contribution. The fit
  now composes both stages; the largest |z| over 396 driver rows is 4.18.
  Every other figure in the artifact is identical leaf by leaf (4f3e968).
- **Trade scores were boosted twice.** `scoreTrade` added its tape
  adjustments to `trade.score`, and a book is ranked on the server and
  again on the client. It now adjusts the book's own rank (43925b7).
- **Brief overflowed on phones.** Its grid track sized to the longest
  nowrap line (581px on a 390px screen) (51c380f).
- **Percentiles read "32th"** (2735dfc).

### WP3 exit test (B04): run, and not passed

Protocol `wp3-v2` has observable targets (HOUST; VIX, since NFCI was not
published before 2011) at exactly m+6, forward-chained calibration and
as-of climatology. The verdict is read on the untouched last 40% of anchors
at alpha 0.05/4. Housing, DFM and domain PCA: no significant difference
from climatology (skill −0.0047 and −0.0061, both CIs span zero).
Financial: inconclusive, with 18 and 5 confirmation anchors against 20
required. **The exit condition is not met.** The regimes stay descriptive.
Promotion requires a passing evidence manifest (f43c9c1), so nothing can
promote on this. Manifest sha256 `54da8d94…` in
`artifacts/reports/macro_level_regime_validation.json`. This also answers
Phase 10's regime half: the broader domain-PCA factors do no better than
the DFM's.

### B-series (product) and agreed workflow

| Item | Commit |
|---|---|
| B01 /macro renders producer output | 69234e9 |
| B02 exact alert targets, one unit, server-side delivery | 8ebc5bc; webhook SSRF on the connection fbf34a8 |
| B03 per-account desk, versioned merging saves | 9b73570 |
| B04 WP3 target/gates, fail-closed promotion | f43c9c1, evidence 4f3e968 |
| B05 paid compute: signed in, entitled, per-account quota, cache identity | 82191c2 |
| B06 thesis → monitor → review loop | 34d6f04, outcomes on /learning a0a40c9 |
| B06 daily brief | f4e216b, d096f3c; coming up (FRED release calendar, reviews, awaited evidence) 51c380f |
| B06 scenario confirmation and invalidation | 3faad0c |
| B06 ES/NQ/futures and held-name quotes | 9ca5bb4 |
| B06 why this exposure (score components, proxy label, same-driver names) | 43925b7 |
| B06 operate: CI and pinned Python | d749fef; scheduled resolution and /api/health c201f4e |
| B06 buy/use/cancel: Stripe checkout, portal, webhook → entitlements | 5095697 |
| PR #6 B01 light mode | ecf86f7 |

### Open, with reasons

- **Deploy settings.** Nothing is exercised yet against the deployed
  database: `CRON_SECRET`, `OPERATOR_USER_IDS`, the Stripe keys and
  webhook endpoint, and migrations 0008–0010 on Neon. A 5-minute cron needs
  a Vercel plan that allows it.
- **Billing is built but unverified against Stripe.** No Stripe account is
  configured here. The signature scheme, event handling and checkout
  request are unit-tested, not exercised live.
- **FOMC dates** are not in FRED's release calendar and are not shown.
- **`test:scripts`:** 17 of 201 fail on main, predating this cycle. They are
  not in CI until fixed.
- **Phase 10, quad half.** Whether broader factors improve the quad
  classification was not run. The regime half answered no, and the quad's
  positioning and vol tests already failed 0/6. No new model was added
  this cycle.

---

## 2026-09-27 — cycle 4 (Factor State API, news decomposition, and an external audit's PCA/DFM findings)

**Checked:** Phases 8-9 of the Macro Factor Engine brief (the Factor State API
field contract, and `.news()` state-space decomposition), Phase 10's machinery
(built and unit-tested; live run deferred — see below), and every finding in
`Neural-Energies/ripple-radar` PR #5 that lands inside this session's own
work (`ace/factors/`, `ace/state/factors.py`). Findings outside that area are
listed at the end, unaddressed, so they are not lost.

### Phase 8 — Factor State API (`ace/factors/factor_state.py`)

Extends the brief's full field contract (`factor_id`, `factor_name`,
`z_score`, `historical_percentile`, `momentum`, `acceleration`, `direction`,
`volatility`, `uncertainty`, `change_since_previous_run`, `change_1w/1m/3m`,
`top_positive/negative_loadings`, `number_of_active/missing_series`,
`data_coverage`, `data_freshness_days`, `as_of_date`, `last_model_fit`) to
Phase 6/7's global + domain PCA factors — the PRODUCTION 89-series DFM state
contract (`ace.state.state.MacroState`) is untouched. `uncertainty` is
reported as NaN for every PCA factor, on purpose: static PCA has no Kalman
posterior, and inventing one would be exactly the fabricated-confidence
failure mode the brief forbids; `volatility` (trailing realised spread) is
a different, answerable question and is computed. `change_1w` is `None` for
every factor, on purpose too: every fit here is monthly, and a "1-week
change" read off monthly data would be last month's change wearing the wrong
label. `change_since_previous_run` is read from a persisted snapshot
(`artifacts/state/factor_state_snapshot.json`), written after each run.
Wired live into `ace.factors.pca_research.main()`; run on the comprehensive
panel: **92 factor states produced**, drivers (loading x this month's
standardised print) attached from the registry's canonical names. 10 tests.

### Phase 9 — "what changed" news decomposition (`ace/factors/news.py`)

`DynamicFactorMQResults.news()` (Bańbura & Modugno 2014) decomposes a
revision in one OBSERVED series' forecast into contributions from specific
new or revised data points — confirmed by reading the installed statsmodels
(0.15.0) source directly that `impacted_variable` must be an endog series
name, not a latent factor, in this version; `state_index="common"` restricts
the decomposition to the channel running through the shared factor states
(excluding each series' own idiosyncratic term), which is the closest honest
answer this API has to "what moved the factor" without overclaiming a
capability that is not actually exposed. `ace.state.factors.FactorFit` now
retains the fitted `.results` object (additive field, `compare=False`,
`repr=False`) so two point-in-time fits can be compared this way.
`ace/factors/news_report.py` picks, per production-panel block, whichever
series has the largest |loading| on that block's factor (decided by the
fit's own evidence, never by position) and explains what moved it over the
last 7 days. Run live on the production panel (two full DFM refits, ~each
converging by `llf`, one at ~500s): **all 9 blocks produced a decomposition**
— e.g. housing's proxy (HOUST) moved -0.004 (news) and -0.006 (revisions);
credit's proxy (TOTALSL) moved +0.058 mostly from a grouped prior revision.
Artifact: `artifacts/reports/macro_what_changed.json`. 4 tests
(`ace/tests/test_news.py`) plus 2 (`test_news_report.py`).

### Phase 10 — built, unit-tested, live run deferred

`ace/regime/climatology.py` (Brier score vs. a climatology baseline computed
from EACH anchor's own causal history, never the evaluation sample — this is
also WP3's still-open exit condition's missing scorer) and
`ace/regime/level_regime_validation.py` (expanding-window refits of the
production DFM's housing/financial-conditions factors AND their Phase 6/7
domain-PCA counterparts, scored against climatology) are built and pass 6 + 7
unit tests respectively on synthetic data. **The live run is deliberately not
executed this cycle** — see the A11 finding below: it would validate a regime
model against vintage data the same external audit has just shown may not be
genuinely point-in-time, and running an expensive multi-anchor DFM validation
against a foundation already flagged as suspect is not where this cycle's
remaining effort belongs. WP3's exit condition and Phase 10 stay open,
together, pending A11.

### External audit findings addressed: A04 (PCA) and A05 (DFM convergence)

`Neural-Energies/ripple-radar` PR #5 (an external, independently-executed
audit, not this session's own work) reproduced two real defects in code this
project's own Phases 6-7 wrote:

- **A04 (high, confirmed):** the SVD's balanced matrix, Bai-Ng's factor-count
  matrix, and the total-variance denominator were three inconsistently
  row/column-matched objects. Reproduced on a 100x4 synthetic panel: a
  full-rank fit's `explained_variance_ratio` summed to **0.6508046967**, not
  1.0. Fixed in `ace/factors/pca.py` (`_admit_matrix`, `_svd_fit`): balance
  once, RE-STANDARDISE the survivors on their own mean/std (a full-panel mean
  is not the balanced subsample's mean once rows are trimmed away), and feed
  that one matrix to Bai-Ng, the SVD, and the variance sum alike. Regression:
  `test_a_full_rank_fit_explains_exactly_all_of_the_variance` (now sums to
  1.0 to 1e-9) and `test_bai_ng_and_the_svd_see_the_same_admitted_matrix`.
  `macro_pca_research.json` regenerated; the corrected numbers are in
  `ace/MODEL-SCORECARD.md`'s PCA section (global PC1 was reported as 2.3%,
  is actually 8.8%; domain PC1 shares and the PCA-vs-DFM correlation each
  moved by a few points — same qualitative findings, corrected numbers).
- **A05 (medium, confirmed):** `fit_factors`'s `converged` flag read
  `res.mlefit.mle_retvals`, defaulting to `True` whenever `res` had no
  `mlefit` attribute — which `DynamicFactorMQResults` never has, confirmed
  directly against the installed statsmodels. `converged` has been `True` on
  every DFM fit this stack has ever produced, including ones that logged
  non-convergence in the same call. Fixed (`ace/state/factors.py`,
  `_em_converged`): read `res.mle_retvals["iter"] < res.mle_settings["maxiter"]`
  directly, fail CLOSED when either is missing. Regression:
  `test_converged_reads_em_diagnostics_not_a_nonexistent_mlefit_attribute`
  (a starved `maxiter=1` fit and a generous `maxiter=500` fit now actually
  differ) and `test_converged_is_false_when_em_diagnostics_are_missing`.

A byproduct found while regenerating artifacts, not from the audit: `NaN` is
not valid JSON, and `factor_state.py`'s honest `uncertainty: NaN` and
`news.py`'s grouped-revision `weight: NaN` were both being written as bare
`NaN` tokens (Python's `json.dumps` default). `ace/jsonutil.py` (`to_json_safe`,
6 tests) replaces every non-finite float with `null` before every artifact
this cycle writes goes to disk, `allow_nan=False` guarding a future miss.

### Open, NOT addressed this cycle: A11 (high priority) and everything outside `ace/factors/` + `ace/state/factors.py`

**A11 (high, reconfirmed) is the most important open item from PR #5.**
`ace.data.alfred.release_history` fetches `output_type=4` (initial release
only) and never fetches a later revision for an observation already seen.
`ace.state.panel.load_vintages` — the point-in-time foundation EVERY phase
this session has built rests on — calls this same function by default. A
value revised months after first release, even a revision that is by now
itself long-public, is never reflected in any as-of build dated after that
revision: the reverse failure mode from a look-ahead leak, but a real
point-in-time defect either way, reproduced by the audit with an executed
January-100-revised-to-August-180 example. Fixing it means changing what
`release_history` fetches (the full per-observation revision history, not
the first print) and how `as_of` selects among a series' releases — a
foundational change to code `ace.macro.quads` and `ace.macro.revisions` also
depend on, not a bounded single-file fix. Not attempted this cycle. Every
number this session's factor-engine work has ever produced should be read
with this caveat until A11 is resolved.

PR #5 also raised fourteen other findings (A01-A03, A06-A10, A12-A15) in
`src/lib/engine/game.ts`, `forecast-ledger.server.ts`, `probability.ts`,
`ace/survival/competing.py`, `ace/ensemble/members.py`, `ace/cascade/hawkes.py`,
`ace/calibration/calibrate.py`, `ace/models/scenario_probability_model.py`,
`ace/bayesnet/`, and `src/lib/ace/intervene.ts` — Nash equilibrium axes,
forecast-ledger horizon adjudication, Dirichlet posterior persistence,
competing-risks calibration, Hawkes first-arrival probability and
observation-clock handling, cross-fitted calibration, scenario-model
future-label leakage, DBN missing-data handling, and a latent
zero-support intervention edge. **None of these are in this session's work
area and none were investigated or fixed this cycle** — they remain exactly
as the audit left them, open, on PR #5.

---

## 2026-09-27 — cycle 3 (comprehensive macro data registry + static PCA)

**Checked:** implementation of the Macro Factor Engine brief's Phases 1-7 —
audit the existing macro data, build a 256-concept target universe and gap
analysis, build a Macro Data Registry from FRED/ALFRED metadata and measured
publication behaviour, derive a registry-driven comprehensive panel with
duplicate resolution, run static PCA (global and per-domain) with expanding-
and rolling-window stability tests, and compare PCA against the production
`DynamicFactorMQ` fit on the same data.

### Coverage: 39% before, 208/208 live after

99 of 256 target concepts (39%) were served by the 102 series already defined
somewhere in the repo; six families (banking, fiscal, energy, corporate
profits, productivity, demographics) were at zero. Probing every uncovered
candidate against FRED/ALFRED — with `no_such_series`, `licence_limited`,
`vintage`, `observation_only`, `metadata_only` as four distinct outcomes
instead of one "unavailable" bucket — and merging the result with the concept
catalogue and `ace.state.panel`'s own hand-argued transforms produced a
242-record registry, 211-213 panel-eligible depending on the freshness rule
below. Building the resulting panel live: **208/208 series join, nothing
dropped.**

### Defects found by building the registry, not just designing it

- The concept catalogue itself had real errors the duplicate detector caught:
  a nominal and a real series (gross domestic income) listed as substitutes
  for one concept; federal-only spending (FGCE) conflated with all-levels
  spending (GCE); "debt held by the public" conflated with gross federal debt;
  a candidate for capital-goods SHIPMENTS that turned out, against FRED's own
  metadata, to be nondurable-goods new ORDERS. Each was split or corrected
  rather than kept as a weak substitute.
- The redundancy grouping rule was merging real/nominal pairs into one
  "pick one representative" group — exactly the "discard a useful variant
  blindly" the brief forbids. Fixed to merge only genuine interchangeable
  pairs (shared concept, SA/NSA pair, measured near-duplicate).
- Registering a production-panel series' unprobed vintage count (`None`) as
  zero observations excluded all 89 of them from their own registry.
- `PPIITM` (discontinued 2015) and `IOER` (discontinued 2021, superseded by
  `IORB` the next day) were chosen over their live successors by a duplicate-
  resolution rule that measured total observation COUNT, which a long-dead
  series can still win on. Caught by running static PCA on the resulting
  panel: with those two frozen columns among 167, not one of 561 months was
  ever fully complete, and naive listwise deletion returned **zero rows**,
  surfacing only as a division-by-zero. Fixed the duplicate-resolution rule to
  check freshness first, and separately confirmed via FRED metadata that
  `USSLIND`, `USNIM` and a mislabelled-frequency OECD series are also
  discontinued or unsupported and excluded them with stated reasons.

### The coverage metric itself needed a second correction

The first fix — drop a column below 90% coverage before building the balanced
matrix — measured coverage against the FULL 561-month panel window. That
starved four entire domain blocks (banking, commodities, manufacturing,
trade_external) to zero surviving columns, because a commodity index starting
in 2015 is perfectly dense from 2015 onward but covers only 23% of a panel
that starts in 1980 — the full-window measure flagged it as low-coverage
before the overlap-trim step, built specifically to handle a late start, ever
ran. Fixed to measure coverage WITHIN each column's own active range; a
regression test (`test_a_column_that_simply_started_late_is_NOT_dropped_for_coverage`)
encodes the fix directly.

### What static PCA actually found

**A single global PCA across the full comprehensive breadth is not viable.**
164 of 165 monthly series clear the (corrected) coverage floor, but their
DATE-RANGE OVERLAP — the shared history every one of them has, given how
differently they start — is **32 months**. PC1 explains 2.3% of variance and
is not economically legible. This is the direct, measured answer to the
brief's own question about whether one PCA can explain the whole economy at
once: it cannot, once the panel is genuinely comprehensive rather than
curated to already share deep history.

**Domain-level PCA works cleanly on all twelve blocks**, each with 128-183
overlapping months, and produces first components that are legible without
being told what to look for: labor's PC1 (46% of variance) loads on
PAYEMS/USPRIV/SRVPRD/CE16OV — headline and private employment together;
commodities' PC1 (44%) loads on the broad price indices and gasoline; housing's
loads on the 15- and 30-year mortgage rates; credit's loads almost entirely on
revolving and non-revolving consumer credit. Ten of twelve blocks hit the
factor-count search's ceiling (`at_boundary=True`) — the same "boundary hit,
not a selection" finding already documented for the production DFM's own
count — so a domain's total factor count should not be read as a settled
number; PC1's loadings are unaffected by this, since it is the direction of
maximum variance regardless of how many further components a criterion wants.

**Loading stability is high in normal periods and breaks at every crisis.**
Sign-aligned PC1 loading correlation across consecutive windows, on a
67-series deep-history subset (transformed history reaching back to 2000):
mean 0.86 (expanding) / 0.82 (rolling), but EVERY transition with correlation
below 0.55 in both tests lands on a dated macro shock — 2007-01→2009-01 (the
financial crisis, 0.51), 2019-01→2021-01 (COVID, 0.30 expanding / 0.47
rolling), 1999-01→2003-01 (the dot-com bust, 0.54 then 0.41) — while every
other transition correlates above 0.87. This is exactly the crisis-vs-normal
stability test the brief's `<validation>` section asks for, and the factor
structure the data actually has: stable in normal times, genuinely
reorganising during a shock rather than merely getting noisier.

**PCA and DFM substantially agree on the dominant common factor**, on the same
fair (deep-history, monthly-only) subset: sign-aligned correlation of the two
methods' global factor level is 0.82, and the loading correlation — do the two
methods agree on WHICH series drive it — is 0.99 over 67 common series. DFM's
real advantage is not a different answer; it is handling the breadth and
ragged edge PCA cannot use directly.

### A near-miss: fitting DFM on the full comprehensive panel

A first attempt fit `DynamicFactorMQ` on the full 206-series, 41-quarterly
panel. Resident memory grew past 12GB (of 15GB available) before being killed.
The quarterly members' Mariano-Murasawa lag expansion, combined with an
idiosyncratic AR(1) term per series across 206 series, pushes the Kalman
filter's state dimension into the hundreds; EM then iterates that many times
over 561 months. The PCA-vs-DFM comparison runs on the deep-history,
monthly-only subset instead (~67-90 series, the same scale as the 89-series
fit that converged in 468 seconds earlier in this project), and this is a
stated scope limitation, not a silent downsizing — full-panel DFM at this
breadth needs either a longer compute budget or a narrower block specification
than the registry's ~19 economic categories currently produce.

### Coverage after this cycle

89 production-panel series, unchanged; 208-series comprehensive panel proven
to build live end-to-end; 12 domain PCA fits; one honest negative result
(global flat PCA on full breadth); one honest agreement result (PCA vs DFM).
73 new tests across `ace/tests/test_pca.py`, `test_stability.py`,
`test_pca_research.py`, plus the universe-registry regression tests from the
prior cycle's fixes, all green. Full pre-existing suite unchanged.

### Open, with reasons

| Item | Why not this cycle |
|---|---|
| Full comprehensive-panel DFM fit | Needs either a longer compute/memory budget than this session's container allows, or a coarser block specification (fewer than ~19 economic-category factors) to keep the Kalman state dimension tractable. |
| Naming components ("this is the labor factor") | Deliberately not done in code — `ace.factors.pca`'s loadings are reported, not interpreted; a reader names a factor from what actually loads on it, per the brief's explicit instruction that the data decides. |
| Factor State API extension (brief's `<factor_state>` field list) | Scoped as Phase 8, not started this cycle. |
| News decomposition (`.news()` wrapper) | Scoped as Phase 9, not started this cycle. |
| Does the broader factor set improve the existing regime/quad models | Scoped as Phase 10, not started this cycle. |

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
