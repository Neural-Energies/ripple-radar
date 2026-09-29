# Ripple / Alpha Recon macro-engine audit

**Verdict: the published arithmetic is mostly internally consistent, but the claim of an independently validated, point-in-time macro regime engine fails this audit.** The historical construction is a first-release-only composite, revision comparison can change the observation window and membership, and specification eligibility sees the holdout. These defects require a fresh run before interpreting the percentages as genuine as-of revision reliability.

Audit date: 2026-09-25. Source: [Neural-Energies/ripple-radar](https://github.com/Neural-Energies/ripple-radar), audited HEAD `bcc651bd204bd9cfe74afd64eae1fbe86bbd8946`. The reported upgrade is commit `f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1`. Relevant Python macro code and generated macro artifacts are unchanged between these commits. Artifact timestamp: `2026-09-25T18:11:00.571735+00:00`.

The newer HEAD replaced the `/macro` route with a different live macro view. This report audits the engine and artifacts behind the requested historical figures; it does not certify the replacement live system.

## What could actually be verified

| Reported result | Evidence and verdict |
|---|---|
| 74.2% revision survival | **Arithmetic verified:** 224/302 = 74.1722%. The four saved bin counts sum to this. This is not an independent reconstruction from raw vintages. Interpretation is compromised by findings 1–3. |
| Margin bins | **Arithmetic verified:** knife-edge 119/190 = 62.6316%; thin 76/83 = 91.5663%; clear 24/24 = 100%; decisive 5/5 = 100%, correctly marked unusable. Edges are [0,.25), [.25,.75), [.75,2), [2,∞). |
| 190/302 knife-edge | **Verified from saved counts:** 62.9139%. Margin is `min(abs(growth_roc), abs(inflation_roc))`: at least one axis is close to zero. Documentation saying **both** axes lie within ±.25 is wrong. The live example itself has margins .0595 and .539. |
| 72% growth-axis flips | **Verified with a wording correction:** 56/78 = 71.7949% are growth-only flips; 15 are inflation-only and 7 flip both. Any growth involvement is 63/78 = 80.7692%. These counts do not establish that growth data generally revises more, or that revision noise causes observed transitions. |
| Labour 72.5% training score | Saved score is .7251 with 211 training observations, consistent with **153/211 = 72.5118%**. Holdout .7802 with 91 observations is consistent with **71/91 = 78.0220%**. It has the highest saved training survival among eligible candidates. Raw comparisons are unavailable. |
| Labour rank 2/7 holdout | **Misleading tie handling:** broad and labour both have 71/91. Labour is **tied first**, not uniquely second. Stable sorting gives broad precedence because it was inserted earlier. |
| Current 5/8 agreement | **Recounted:** fast, broad, core, labour and production say Q1; fast_1m, fast_6m and broad_6m say Q2. Includes the disqualified fast_1m; excluding it gives 5/7. These highly overlapping candidates are not eight independent votes. |
| 52nd percentile agreement | Saved value .5188. Code computes fraction of historical modal shares **≤ .625**, an upper empirical percentile including ties. At n=320 this is consistent with 166/320 = .51875. **Not fully recomputable:** only the last 120 historical agreement rows were retained. This is not a probability the label is correct. |
| Kaplan–Meier median 2 months | **Independently recomputed from all 116 saved spells:** 115 completed and one censored; total 320 months. KM survival after month 1 is .681034 and after month 2 is .410367, so median is 2. The curve arithmetic agrees with the artifact. Boundary/gap caveats below remain. |
| Every specification has median 2 months | **False:** fast_1m has median **1** and was disqualified. The other seven saved medians are 2. Only the chosen spec's full spell table is retained for independent recalculation. |
| 33–46% reach a quarter | Approximately correct **for completed spells of the seven eligible specs**, not all eight, and not a KM probability. Saved eligible range .3285–.4574; fast_1m is .1005. Labour independently gives 47/115 = **40.8696%**. KM reaching at least 3 months is about 41.04%, a different statistic. |
| 12-month Q3 occupancy 58%, four switches | **Recomputed:** Sep 2025–Aug 2026 labels are `3,3,3,3,3,4,4,3,3,2,2,1`; Q3 is 7/12 = 58.3333%, with four switches. This is a trailing completed-month label summary, not today's revised economic history. |
| Volatility 0/6 after Holm | **Recomputed from saved p-values and inspected correction:** p=.211, .401, .570, .610, .655, .710. None passes even unadjusted .05; all six error-reduction intervals include zero. Regression and bootstrap results cannot be recreated without original inputs. |
| Volatility sign consistency 14/18 | **Independently recounted** from non-null saved cell flags. Descriptive only. SP500 and DJIA Q3/Q4 ratios are below one in both periods, so “Q3/Q4 genuinely run hotter across channels” overstates—and partly contradicts—the results. |

## Material findings and exact remediation

### 1. High severity, high confidence: first-release history is not a coherent historical as-of vintage

[alfred.py:74–83](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/data/alfred.py#L74) requests `output_type=4`. [quads.py:275–287](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/macro/quads.py#L275) takes the first release per observation forever. FRED documents type 4 as [initial release only](https://fred.stlouisfed.org/docs/api/fred/series_observations.html#output_type).

A January value first released as 100 and revised to 180 in August still returns 100 for a classification the following January. I executed that exact case. The revision was already public; using it at the later decision date would not be hindsight. The existing `test_known_at_keeps_the_first_release_not_the_revision` explicitly enforces the wrong interpretation for an as-of series.

This construction can be an intentional, implementable first-print index. But its YoY changes splice values from different release vintages and potentially different benchmark/base histories. It cannot substantiate the stronger claim “the series as it stood then,” and its choppiness cannot automatically be generalized to the macro framework.

**Fix:** preserve complete ALFRED revision intervals, or fetch snapshots with `realtime_start=realtime_end=decision_date`. For each observation, select the latest release effective on or before that decision, never a future release. Change the test to expect 100 before August and 180 afterward. If retaining a first-print experiment, name it separately and compare it with coherent as-of snapshots before drawing regime conclusions.

### 2. High severity, high confidence: revision comparison can manufacture flips with zero revisions

[revisions.py:151–155](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/macro/revisions.py#L151) cuts all final series at `max(growth_through, inflation_through)`. [final_reading_at](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/macro/quads.py#L436) also reconstructs membership from all final inputs rather than preserving the historical contributors.

Executed counterexample: real-time growth covers May and inflation June. With identical historical values in both datasets, real-time growth RoC is +10 and the final comparator advances growth to June, where RoC is −10. It reports **Q2→Q3, failed survival**, despite no revision at all. Broad specs are particularly exposed because slow growth and faster inflation have different latest months. Availability of final series missing from the historical composite can also change membership.

**Fix:** store each real-time axis's effective observation month, contributing series and exact observation dates used for its YoY/lookback calculation. Recompute revised values on that same mask, separately for each axis. Fail comparison when a required counterpart is missing. Add a zero-revision invariant across staggered publication calendars and changing availability. Recompute all eight scores and bins; actual impact on the published labour 74.2% is unknown without raw inputs.

### 3. High severity, high confidence: holdout is not sealed from selection

[revisions.py:238–261](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/macro/revisions.py#L238) computes persistence eligibility over **all dates**, including holdout and the unsettled tail. The lag tie-breaker likewise uses all settled observations (`score_spec`, line 215). Only the primary survival score uses the training slice.

A synthetic execution with a high-survival candidate that is persistent during training but choppy in holdout excludes it based on that holdout behavior. Thus holdout labels can change which candidate is selected. Historical training survival also uses the current final vintage: suitable for a retrospective comparison, but it does not prove the spec could have been selected at the historical split with the answer key available then.

“Pre-registered” is not established by a pinned constant or unit test. The supplied development narrative describes adding the persistence rule after examining persistence results; no earlier registration is present in the inspected evidence.

**Fix:** use a common explicit calendar cutoff; calculate eligibility, lag tie-breakers and all tuning on training dates only. Freeze candidates, thresholds, bin definitions and selection before evaluating holdout. For a historical deployment simulation, train on revision outcomes available by the training cutoff, with maturity/embargo rules, not today's final answers. For a retrospective study, label it as such. Use a new untouched evaluation period after these design changes.

For rank reporting, implement competition ranking `1 + count(score > chosen_score)` and expose tied names. Labour is tied first with broad on the saved sample. Report calibration as descriptive in-sample frequencies unless evaluated on separate data; 24/24 is not proof of a 100% future survival probability.

### 4. Medium severity, high confidence: cached “current” data never refreshes

[alfred.py:43–54](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/data/alfred.py#L43) reuses any existing cache indefinitely. Current-vintage requests have no retrieval date in their key; first-release archive requests also use an unchanging end date. A later export can advance its timestamp and 18-month settling cutoff while using an older answer key/archive.

**Fix:** make the source cutoff explicit in request/cache identity, store retrieval timestamp and input hashes, and use either deliberate immutable snapshots or a documented refresh policy. Base maturity on the answer-key snapshot date. Provide an as-of replay command. This is a proven refresh defect; the age of the original run's cache is not known.

### 5. Medium severity, high confidence: volatility alignment permits the wrong horizon and incomplete targets

[quad_vol_model.py:99–105](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/models/quad_vol_model.py#L99) removes missing-volatility months; lines 280–289 then shift by one remaining row. Executed missing-February example pairs January with March as a supposedly one-month forecast. A current month with at least 15 daily moves also qualifies before month-end and can enter the preceding month's target. The September 25 run is exposed to this path; its actual inclusion requires the missing raw inputs to confirm.

**Fix:** create the full month-end calendar, retain NaNs through the shift, and remove invalid aligned pairs afterward. Exclude incomplete target months using a fixed data cutoff. Preserve calendar gaps in resampling/bootstrap design. Add explicit missing-month and partial-month fixtures. Return evaluation similarly needs completed-month target filtering.

### 6. Medium severity, high confidence: tested and displayed specifications are not bound together

[export_quads.py:284–339](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/macro/export_quads.py#L284) accepts fixed-name scorecards without checking their selected spec, data cutoff or input identity. The returns scorecard omits its spec. The generator discards the volatility spec. The package command explicitly tests labour before running automatic selection, so a future winner can differ from the already-tested spec.

**Fix:** select and freeze the spec first; run both evaluations with that manifest. Include complete spec, date splits, source snapshots, target definitions, hashes and seed in both scorecards and the exported artifact. Reject mismatches and stale evidence. The volatility registry currently hashes labels alone, not the evaluated market inputs. No mismatch is proven for this run; the safeguards are absent.

### 7. Medium severity: the volatility interpretation exceeds the evidence

The AR(1) and augmented OLS fits use training rows only, conditional on the supplied spec, and Holm step-down is implemented correctly. These are strengths.

However, [quad_vol_model.py:213–225](https://github.com/Neural-Energies/ripple-radar/blob/f6df9bf0b52bcbd6a27f1a761d8f61cf0741e6d1/ace/models/quad_vol_model.py#L213) measures train **and holdout** conditional volatility against the **training** unconditional log-vol mean. A general holdout volatility-level change can affect sign consistency without any change in regime effects. The ratios are exponentiated log-mean differences, not arithmetic mean-volatility ratios. The cells share assets, dates and labels, so 18 cells are not 18 independent replications.

**Fix:** retain the existing statistic only with its exact benchmark label. For regime-effect stability, compare within-period conditional contrasts or fitted effects with uncertainty and a prespecified test. Replace “the signature is real,” “genuinely hotter,” and “adds nothing” with: **“14/18 eligible cell signs matched relative to the training benchmark; no incremental forecasting improvement was detected in this evaluation.”** The fixed three-month block bootstrap and percentile-tail p-values are approximate; test null calibration and block-length sensitivity before treating marginal future results as decisive.

## Censoring, settling, ties and edge cases

- **Unsettled months:** pooled survival, calibration and confusion now call the same `settled()` helper. For this artifact, the 302 settled months end February 2025; 18 later classified months are excluded. This fixes the earlier denominator mismatch. Eighteen months is a maturity assumption, not evidence that all series have become final.
- **KM:** risk sets include censored spells at tied event times; the final spell is not counted as a death. The saved pooled curve is arithmetically correct. `share_ge_quarter` is explicitly a completed-spell fraction. Statements that dropping an unfinished spell necessarily biases every estimate downward are too categorical.
- **First spell:** January 2000's one-month Q1 spell is treated as a completed full spell even though its onset before the sample boundary is not established. Extend warm-up history to locate onset or exclude/handle that boundary spell explicitly.
- **Gaps:** `runs()`, `transitions()` and `occupancy()` drop unclassified months first. Executed `[Q1, missing, Q1, Q2]` becomes a single two-observation Q1 spell across a three-month span. Define gap/censoring behavior and calendar-window coverage explicitly. The saved labour history has 320 classified months; no interior labour gap is indicated in this run.
- **Monthly changes:** `_yoy()` uses a 12-row shift, and RoC uses positional offsets after dropping missing values. Reindex to a complete monthly calendar and require the actual t−12 and t−lookback observations. This is a gap-handling vulnerability, not a quantified correction to the published run.
- **Occupancy ties:** the six-month artifact correctly flags a Q2/Q3 tie, and the panel checks that flag. `dominant` still contains one representative, so consumers must honor `tied`. The reported 12-month result is not tied.
- **Agreement ties:** `spec_agreement()` and `agreement_history()` silently choose one modal label on equal counts. Return all leaders plus a tie flag; do not label one the consensus. The current 5–3 vote is unaffected.
- **52nd percentile:** the algorithm includes equal observations and mixes dates with differing candidate availability. Document the empirical-CDF convention and candidate count; preserve all rows or a full share-frequency table for audit. Agreement does not require the 18-month revision maturity filter, because it is comparing contemporaneous labels rather than final outcomes.

## Tests and reproduction limits

Fresh execution in Python 3.12 using existing NumPy 2.5.3, pandas 3.0.5 and pytest 9.1.1:

- `python -m pytest ace/tests/test_macro.py ace/tests/test_quads.py -q`: **40 passed**.
- `node --experimental-strip-types --test src/lib/ace/macro-quads.test.ts`: **34 passed**.
- `python -m pytest ace/tests -q`: **collection blocked** by missing `networkx` and `sksurv`. The historical “218 tests passed” statement was not independently reproduced. No dependencies were installed.
- Scratch execution reproduced the zero-revision false flip, ignored already-known revision, holdout-dependent eligibility and missing-label gap behavior. Independent count/product-limit arithmetic checked bins, flips, occupancy, KM, votes, Holm and sign totals.

The focused suite covers useful invariants: future releases cannot alter prior readings, bin boundaries, shared settling filters, basic KM censoring, occupancy ties, and consistency of exported aggregates. It does **not** establish correct historical-vintage semantics, a like-for-like revision comparator, holdout-isolated selection, calendar-aligned volatility targets, or scorecard provenance. No tests exercise the quad volatility/return runner functions. Some tests pin results rather than general invariants: empirical margin calibration need not be monotone in every future sample, and the first-release test currently enforces the methodological problem above.

The repository excludes `artifacts/`: raw ALFRED responses, market observations, original scorecards and the original panel JSON are missing. No `FRED_API_KEY` was available. Generated detail retains only 120 history/agreement rows, although all 116 selected-spec spells survive. Consequently, the raw 74.2%, candidate scores, all-spec durations, full 52nd percentile, regression fits and bootstrap statistics could not be regenerated from original observations. Refreshing today's data would not substitute for recovering the exact source snapshot.

The original audit did not modify production source, tests or configuration. This follow-up publishes the audit and records Joshua's requested review/fix/verification loop; the corrections below remain open until independently verified.

## Adjacent return-test issues

The return runner percentage-changes Treasury yields and compares this with “always long,” which is not the return on a long Treasury instrument (`quad_model.py:71–82`). It also applies training signs even when cells fail the stated minimum-observation eligibility (`:120`, `:135–136`). Use tradable total-return instruments or explicitly label yield/index changes, and gate actions using training-only sample sufficiency. These are additional reasons not to promote the failed positioning model.

The documentation's GDP-lag explanation also confuses start-of-period dating with delay after quarter-end: 119 days after January 1 is roughly late April, not four months after March 31. Correct the lag basis before using it as a reason to exclude a series.

**Safe interpretation:** these artifacts describe a particular first-release label experiment with internally consistent summaries. They do not yet validate an as-of macro regime model or its claimed reliability. The failed forecast gates should remain closed pending corrected, reproducible evaluation.

