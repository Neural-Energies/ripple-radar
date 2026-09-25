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
