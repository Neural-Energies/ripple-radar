# ACE Model Scorecard

Every number here came from an executed model on real data. Nothing is
illustrative. Where a model failed, the failure is the entry.

**Data sources.** FRED/ALFRED (authenticated) for a 16-channel daily
cross-asset panel, 2010–2026, and for macro release vintages with publication
timestamps. Yahoo's public endpoint was evaluated and rejected as a training
source: it rate-limits a bulk historical pull too aggressively to depend on.

**Point-in-time discipline.** ALFRED vintages are the reason macro features are
honest. FRED's ordinary endpoint returns today's revised value; ALFRED returns
what was published as of a date. CPI known on 2024-03-11 is 309.685 (January);
on 2024-03-15 it is 311.054 (February), because February printed on the 12th.

---

## Status summary

| Engine | Status | May it drive a user-facing number? |
|---|---|---|
| **Scenario probability (FHS)** | **PASSES — calibrated 4/4 channels** | **Yes.** PIT uniform out of sample. |
| **Volatility forecast (HAR)** | **PASSES — 3/6 channels** | **Yes**, for SP500, DJIA, UST10Y. Withheld elsewhere. |
| **Event cascade (Hawkes)** | **PASSES — 2/3 channels** | **Yes**, for NASDAQ and WTI. |
| **Competing risks (Aalen-Johansen)** | **PASSES** | **Yes** — cumulative incidence by horizon. |
| **Conflict cascade (GDELT Hawkes)** | **PASSES — 15/20 countries, shape unverified** | Partly — that escalation clusters, yes. Not the branching ratio to three digits. |
| Game theory (Nash + Monte Carlo) | **Exact** | Yes — equilibria computed and verified. Payoffs remain an assumption. |
| Regime (Markov switching) | **Validated, descriptive** | Yes — to label the environment. Not as a forecast. |
| Historical analogs | **Validated, descriptive** | Yes — as a distribution of what followed similar states. |
| **Growth/inflation quad** | **Classification validated; positioning FAILED 0/6; vol forecast FAILED 0/6** | Yes, as an environment label with its data lag, margin and revision survival stated. **No** as a positioning signal and **no** as a risk-sizing signal. |
| **Quad revision risk** | **Measured** | **Yes** — 74% of real-time labels survived revision, and the per-margin rates are calibrated. |
| Transmission / Ripple | **Partly validated** | Contemporaneous structure only. No tradeable lag exists in this data. |
| Shock persistence | **FAILED** | No. |
| Event impact (macro) | **FAILED** | No. |
| News → volatility increment | **FAILED — 6/6 channels** | No — subsumed by VIX. |
| Dynamic Bayesian Network | **FAILED — 0/6 channels** | No. |
| Causal impact (SCM + local projections) | **Estimators validated; no forecastable effect** | Yes for same-day co-movement, labelled predictive. No forward claim. |
| Ensemble (stacking / BMA) | **FAILED under multiplicity correction** | No. |
| Prophet (news attention) | **FAILED** | No — loses to a trailing mean. |

**What is wired, and how.** `ace/` runs offline; nothing calls Python on the
request path. Validated results reach the app as GENERATED TypeScript modules
built by a script from a run artifact — measured transmission edges, escalation
base rates, the analog pool, the conflict cascade table, and the growth/
inflation quad. Each generator refuses to emit a result that did not clear its
gate, and each emitted module carries the scope of what it established. A
PRODUCTION status in the registry is still a registry label, not a deployment:
the generator is the deployment, and it is the thing that says no.

---

## 0. What passes

### Scenario probability — calibrated on every channel tested

The engine ACE actually needs. Given a channel and horizon it returns the
probability distribution of the move, and those probabilities are calibrated.

| Channel | Worst interval miss | PIT uniformity (KS) |
|---|---|---|
| SP500 | 4.8% (t-dist: 16.0%) | p = 0.543 ✓ |
| NASDAQ | 5.2% (t-dist: 6.9%) | p = 0.689 ✓ |
| WTI | 4.9% (t-dist: 12.9%) | p = 0.830 ✓ |
| USD_BROAD | 3.1% (t-dist: 8.7%) | p = 0.223 ✓ |

Uniform PIT means the forecast distribution is correctly specified, which
validates every probability read off it at once.

Three defects were found and fixed to get here, each of which had made the
result look worse than the truth: the tail parameter was standardized by
*realized* rather than *forecast* volatility (pinning it at its ceiling);
calibration was tested on 20-day windows sampled daily, which overlap 19/20
and break the independence KS assumes; and bands were centred at zero,
ignoring drift.

Even corrected, a parametric Student-t mis-shaped the centre — 90%/95%
intervals near nominal while the 50% covered only 34–43%. Forecast-vol error
inflates apparent kurtosis, dragging df down and squeezing the middle.
**Filtered Historical Simulation** — rescaling the empirical residual
distribution instead of assuming a shape — fixed it. That is standard practice
in production VaR systems for exactly this reason.

### Volatility forecast — HAR-RV, three of six channels

Run on all six channels, each with its own sealed holdout and its own
block-bootstrap CI on the gap against a *properly scaled* naive forecast.

| Channel | Champion | Holdout R²(log) | Scaled naive | Lift | 95% CI | |
|---|---|---|---|---|---|---|
| SP500 | HAR-RV + VIX | +0.1721 | −0.0386 | **+0.2107** | [+0.0951, +0.4617] | **passes** |
| DJIA | HAR-RV + VIX | +0.1571 | −0.0931 | **+0.2502** | [+0.1222, +0.5194] | **passes** |
| UST10Y | HAR-RV | +0.4661 | +0.3181 | **+0.1480** | [+0.0789, +0.2598] | **passes** |
| NASDAQ | HAR-RV + VIX | +0.2144 | +0.1691 | +0.0453 | [−0.1138, +0.2117] | withheld |
| WTI | HAR-RV + VIX | +0.4077 | +0.3675 | +0.0402 | [−0.0071, +0.0991] | withheld |
| USD_BROAD | HAR-RV + VIX | +0.3198 | +0.2612 | +0.0586 | [−0.0200, +0.1306] | withheld |

On SP500 the model selection ran in full:

| Model | Sealed-holdout R²(log) |
|---|---|
| random walk (scaled naive) | −0.0386 |
| EWMA scaled | −0.0751 |
| HAR-RV | +0.0038 |
| **HAR-RV + VIX** | **+0.1721** |
| LightGBM | +0.1642 |

Two things the six-channel run shows that the single-channel run could not.
VIX earns its place only where it *is* the instrument's implied volatility:
UST10Y's champion is plain HAR-RV, and adding equity implied vol there does
not help. And the three withheld channels are withheld for a specific reason —
each beats naive on the point estimate, but their naive baselines are already
strong (R² 0.17–0.37), so the *gap* CI spans zero. A model that cannot be
distinguished from the cheap alternative does not ship.

**A correction that mattered.** An earlier pass reported trailing vol scoring
R² −0.018 against forward vol and concluded volatility was unforecastable.
Volatility clustering is among the most replicated facts in finance, so that
number meant the setup was wrong — and it was. corr(trailing, forward) is
0.512, but trailing vol's *slope* against forward vol is 0.512, not 1.0. It is
a biased estimator; using it as a point forecast destroys the R². Fit the
scaling and it is 0.26.

### News text — real signal, no incremental value

FRED carries daily news-text-derived indices back to 1985 (Baker/Bloom/Davis
policy-uncertainty and equity-market-uncertainty series). They correlate
0.19–0.29 with forward volatility, which is real.

On SP500:

| Comparison | Holdout R² gap | 95% CI | |
|---|---|---|---|
| VIX over HAR | +0.1313 | [+0.0186, +0.3796] | **passes** |
| news over HAR | +0.0478 | [−0.1385, +0.1463] | not significant |
| news over HAR+VIX | −0.0048 | [−0.2184, +0.1878] | not significant |

Re-run on all six channels, news adds nothing beyond implied volatility on
**every one of them** — and on WTI its increment is significantly *negative*
(−0.2432, CI [−0.3778, −0.0828]): the equity-uncertainty indices actively
mislead about crude.

| Channel | news over HAR+VIX | 95% CI |
|---|---|---|
| SP500 | −0.0048 | [−0.2184, +0.1878] |
| NASDAQ | +0.0275 | [−0.0197, +0.1000] |
| DJIA | −0.0576 | [−0.4265, +0.0774] |
| WTI | −0.2432 | [−0.3778, −0.0828] |
| UST10Y | +0.0346 | [−0.0622, +0.1083] |
| USD_BROAD | −0.0377 | [−0.2247, +0.0807] |

The newspapers and the options market are describing the same uncertainty, and
the options market prices it first. News is not additive here. Six channels
turn a single-channel null into a robust one.

### Prophet — tested on its home ground, failed

Prophet decomposes trend and seasonality, so applying it to returns would be
misapplication. It was tested on news-attention levels instead, where weekly
and yearly structure genuinely exists. Rolling-origin, 24 out-of-sample
forecasts, 5 days ahead:

| Model | MAE | R² |
|---|---|---|
| trailing mean | **0.6661** | −0.1493 |
| random walk | 0.7128 | −0.3873 |
| **Prophet** | 0.7717 | −0.8495 |
| seasonal naive | 0.9900 | −1.5372 |

MAE difference vs best naive +0.1055, CI [−0.1624, +0.4206]. Recorded, not
used. (24 origins is a thin evaluation; the direction is clear but this rules
out a large effect rather than any effect.)

---

## 1. ace_shock_persistence v1 — FAILED

**Target.** P(a ≥1.5σ move extends over the next 5 sessions) — ACE's own
materialization-vs-fade axis.
**Data.** 3,980 shock events, 9 price channels, 2010-10 → 2026-09, base rate 0.4937.

| Model | Out-of-fold BSS |
|---|---|
| base rate | +0.0007 |
| momentum | +0.0005 |
| logistic | −0.0223 |
| LightGBM | −0.0332 |

Sealed holdout: BSS −0.0037, AUC 0.4876, 95% CI **[0.4401, 0.5321]** — straddles 0.50.

**Note.** LightGBM had the *best* out-of-fold AUC (0.5319) and the *worst*
Brier Skill Score. It found faint ranking signal and was badly overconfident.
Accuracy and AUC would have sold this model; calibration refused it.

## 2. ace_macro_impact v1 — FAILED (both targets)

**Data.** 954 macro releases (CPI, core CPI, payrolls, unemployment, industrial
production, retail sales, PPI, housing starts), 2016 → 2026, with ALFRED
publication timestamps.
**Surprise.** Deviation from an AR forecast fitted only on prior vintages — a
recognised proxy, *not* survey consensus, which ACE has no feed for.
First-order: corr(|surprise|, |SP500 1d move|) = +0.109.

| Target | Holdout AUC | 95% CI | BSS |
|---|---|---|---|
| direction | 0.4922 | [0.4128, 0.5966] | −0.0078 |
| magnitude | 0.4712 | [0.3490, 0.5630] | −0.0151 |

**Note.** Magnitude reached out-of-fold AUC 0.5881 — the number that normally
ships a model. The sealed holdout put it at 0.4712. That gap is fitted noise,
and catching it is exactly why the holdout is read once.

**Caveat.** 191-row holdout. These results rule out a *strong* effect, not any
effect. Testing properly needs intraday windows or a real consensus feed — not
more model complexity.

## 3. Ripple transmission — partly validated

Train 2010–2019, test 2020–2026. Of 154 edges significant in train:
**111 survived (72.1%)**, 17 faded, **26 flipped sign (16.9%)**.
Granger-predictive: 29 in train, 16 survived.

The sign flips are economics, not noise: SP500 → UST10Y runs +0.370 then
−0.078; VIX → UST10Y reverses likewise. That is the stock-bond correlation
regime change.

**The load-bearing negative.** Of the 111 survivors, **95 are contemporaneous
and zero hold the same non-zero lag in both periods.** There is no stable
lead-lag structure in these liquid macro channels. "X moves, then Y follows,
and you trade the second leg" is not supported here. Whether it holds in less
liquid second-order names is open — this data cannot answer it.

## 4. Regime engine — validated, descriptive only

Markov-switching variance on SP500 returns, 2016–2026:

| State | Daily vol | Annualized | Expected duration | Persistence |
|---|---|---|---|---|
| calm | 0.64% | ~10% | 59.5 days | 0.983 |
| stressed | 1.93% | ~31% | 21.6 days | 0.954 |

States are labelled *after* estimation by realized variance. Real-time output
uses **filtered** probabilities only; filtered and smoothed differ by up to
0.76 on this data, so using smoothed would be a severe look-ahead.

**Validation, and a correction worth recording.** A first pass fitted the
regime→volatility mapping on the full evaluation set and reported **+0.2633**
incremental R² with a CI excluding zero — a shippable "ACE forecasts
volatility" claim, and in-sample. Refitting strictly backward on 1,491 points:

| Predictor | Out-of-sample R² |
|---|---|
| historical mean | −0.2995 |
| trailing vol | −0.0177 |
| regime only | −0.2327 |
| trailing + regime | −0.0026 |

Incremental **+0.0151**, 95% CI **[−0.5706, +0.2302]**. The verdict flips to
descriptive only.

**What survives honestly:** forward 20d vol is **1.111%/day when flagged
stressed vs 0.844% when calm — a 1.32× separation** out of sample. Real, useful
as context, not a forecast.

## 5. Game theory — exact

Support enumeration + Lemke-Howson, every equilibrium verified by computing
each player's deviation regret. Validated against known answers:

- Prisoner's Dilemma → unique pure (defect, defect), regrets 0, cooperate correctly flagged dominated
- Matching Pennies → unique mixed, exactly 0.5/0.5, **no pure equilibrium**
- Battle of the Sexes → exactly 3: two pure plus mixed (0.6, 0.4)/(0.4, 0.6)

Matching Pennies is the case the app's TypeScript best-response scan gets
wrong: finding no pure equilibrium, it falls back to the actor's best payoff
and reports that as the likely play.

Under payoff uncertainty on the app's weather matrix (σ = 1.5, 600 sims):
Landfall 19%, Glancing 76%, Miss 6%.

**Boundary.** The solver is exact; the payoffs are an assumption. Solving a
game whose payoffs someone invented yields an exact equilibrium of an invented
game.

## 6. Historical analogs — validated, descriptive

Mahalanobis retrieval over a 5-channel state (momentum + volatility), analogs
strictly predating the query with closed forward windows.

On the current state, the nearest analogs are early October 2018 (forward 20d:
−8.6%, −7.6%, −10.2%), but the distribution is wide — p10 −8.09%, median
−0.08%, p90 +2.79%, 38% positive — and **agreement is 0.25**, which the engine
reports rather than calling a direction.

---

## 7. Event cascade (Hawkes) — PASSES on 2 of 3 channels

The ripple thesis stated as a testable claim: does a shock raise the intensity
of the next shock? A self-exciting point process answers it with a number —
the branching ratio α, the expected offspring per event.

| Channel | events | α | half-life | LR vs Poisson | OOS log-lik gain | Ogata KS (test) | cascade multiplier | |
|---|---|---|---|---|---|---|---|---|
| NASDAQ | 253 | 0.349 | 5.7d | p = 2.2e-07 | **+18.1** | p = 0.217 ✓ | 1.54× | **passes** |
| WTI | 233 | 0.276 | 6.5d | p = 0.0002 | **+17.8** | p = 0.733 ✓ | 1.38× | **passes** |
| USD_BROAD | 216 | 0.115 | 11.7d | p = 0.51 | +2.7 | p = 0.908 | 1.13× | withheld |

Three separate checks had to agree, which is why this is trustworthy. The
likelihood-ratio test says the excitation term is real. The **out-of-sample**
log-likelihood gain says it still is on data the fit never saw. And Ogata's
time-rescaling residuals say the fitted intensity is correctly specified: if
it is, the rescaled inter-event times are iid Exp(1), and the KS test does not
reject that on either channel.

α < 1 on every channel, so the process is stationary — shocks amplify and die
out, they do not run away. NASDAQ's 1.54× multiplier means: for every 100
shocks that arrive on their own, 54 more follow as offspring.

USD_BROAD is withheld because its excitation is indistinguishable from a plain
Poisson process. The dollar's shocks arrive; they do not breed.

Validated first on **earthquakes** (USGS, M≥4.5), where the ground truth is
known: α = 0.107, LR = 454.5, Ogata p = 0.187. A Hawkes process that cannot
recover aftershock clustering is not a Hawkes process.

---

## 8. Competing risks (Aalen-Johansen) — PASSES

After a shock, three things can happen: it escalates, it merely continues, or
nothing further happens. These compete — the first one to occur forecloses the
others — and treating a competing event as censoring is the classic error. It
answers "what is P(escalation) in a world where continuation cannot happen",
which is always too high.

4,633 mainshocks, 3,837 train / 796 sealed holdout.

| Horizon | Cause | Predicted | Realized | Error |
|---|---|---|---|---|
| 1d | escalation | 0.0300 | 0.0226 | 0.0074 |
| 1d | continuation | 0.2294 | 0.2236 | 0.0058 |
| 7d | escalation | 0.0469 | 0.0364 | 0.0105 |
| 7d | continuation | 0.3287 | 0.3191 | 0.0096 |
| 14d | continuation | 0.4155 | 0.3844 | 0.0311 |
| 30d | escalation | 0.0753 | 0.0641 | 0.0112 |

**Worst out-of-sample error 3.5%**, against **28.8%** for the naive
Kaplan-Meier treatment that censors the competing cause. That gap is the
entire point of the method.

---

## 9. ace_dbn_event v1 — FAILED on 6 of 6 channels

**The claim.** Tomorrow's probability of a material event (|return| ≥ 2σ)
depends on today's state *across* variables — realized vol, implied vol, news
attention, the curve — not only on whether an event happened today.

**The baseline that matters.** A first-order Markov chain on the target alone.
Beating the base rate would prove nothing here: persistence alone does that,
and it is not what a Bayesian network is for.

States are discretized on an **expanding window** — the threshold that calls a
day "high volatility" is computed only from days before it — and conditional
tables use a Dirichlet prior so an unobserved configuration falls back to the
marginal rather than to a confident zero.

Pooled over six channels, 4,300 sealed-holdout rows:

| Model | parents | configs | BSS | log loss | AUC |
|---|---|---|---|---|---|
| base rate | 0 | 1 | −0.0001 | 0.2068 | 0.509 |
| markov | 1 | 2 | +0.0000 | 0.2063 | 0.531 |
| dbn_core | 3 | 12 | −0.0036 | 0.2397 | **0.550** |
| dbn_full | 5 | 72 | −0.0044 | 0.2281 | 0.535 |

Pooled BSS lift over Markov **−0.0036**, CI **[−0.0105, +0.0028]**. Channels
where the DBN beats Markov with a CI excluding zero: **0 of 6**.

**Why it was not dismissed on the first result.** A single-channel run showed
dbn_core with the best AUC (0.586) and the worst Brier — a model that orders
days correctly and states the wrong number. That is a calibration verdict, not
a structural one. So every arm, the baseline included, was given a calibrator
fitted on walk-forward out-of-fold predictions from the training window and
applied to the sealed holdout. The DBN still keeps its AUC edge (0.550 vs
0.531) and still loses on Brier.

The reliability table says why:

| bucket | n | mean forecast | realized |
|---|---|---|---|
| 0–2% | 382 | 0.000 | **0.039** |
| 4–6% | 3,482 | 0.045 | 0.052 |
| 12–20% | 125 | 0.148 | 0.128 |
| 20–100% | 19 | 0.271 | **0.105** |

Four rows in five, the calibrated DBN just restates the base rate. Where it
does deviate it is wrong in both directions: isotonic maps 382 days to
*exactly zero* and 3.9% of them were stress days, and the confident tail
forecasts 27% where 10.5% occurred.

**What this result is not.** It is not a verdict on Dynamic Bayesian Networks
for ACE's actual purpose. The spec frames the DBN over *event* states —
"hurricane intensifies → P(port closure) → P(logistics disruption)" — and this
run fitted it to *market* states because the GDELT event database was still
backfilling. Daily market state may simply be the wrong substrate: a 2σ day is
close to memoryless, which is why even the Markov baseline barely clears the
base rate (BSS +0.0000). The re-run on GDELT event states is the direct
follow-up.

---

## 10. Causal impact (SCM + local projections) — machinery validated, nothing to forecast

Two parts, because a causal estimator never announces when it is wrong. A
mis-specified adjustment returns a confident number in exactly the shape of a
correct one.

**Part 1 — recover an effect planted on purpose.** Confounded synthetic data
where the naive treated-minus-untreated contrast says **+3.80** and the truth
is **+2.00**:

| Estimator | ATE | error | 95% CI |
|---|---|---|---|
| regression adjustment | +2.0381 | +0.0381 | — |
| inverse propensity weighting | +2.0701 | +0.0701 | — |
| **cross-fitted doubly robust (AIPW)** | **+2.0054** | **+0.0054** | [+1.9314, +2.0794] |

All three refutations pass — a permuted treatment gives −0.010 against +2.038,
an irrelevant covariate moves the estimate 0.0%, and 70% subsets drift 0.4%.
Local projections recover a planted impulse response (1.0 decaying at 0.7)
within 0.12 at every horizon.

The pre-trend test was checked in **both** directions, because a placebo that
cannot fail is worse than no placebo: it passes on an unanticipated shock and
fails on one the market learns about three days early.

**Part 2 — the real question.** For each (shock market → S&P) pair: state the
graph, derive the adjustment set from it, estimate with Newey-West errors, run
the pre-trend test, and correct the eleven horizons for multiplicity.

| Pair | shock days | pre-trend | raw significant | Holm-corrected | beyond same day |
|---|---|---|---|---|---|
| WTI → SP500 | 142 | ok | [0] | [0] | no |
| USD_BROAD → SP500 | 130 | **violated at h=−1** | [0] | [0] | withheld |
| UST10Y → SP500 | 120 | ok | [0, 9] | [0] | no |
| VIX → SP500 | 138 | ok | [0, 6] | [0] | no (h=0 is mechanical) |

**Nothing survives beyond the day of the shock.** The isolated h=6 and h=9
"significances" are what eleven tests at 5% produce — a 43% chance of at least
one false positive per pair — and Holm removes both. VIX → S&P at h=0 is
arithmetic, not a finding: VIX is priced off S&P options.

This is the same answer the transmission engine reached from lagged
correlations (72.1% of edges survive out of sample, **zero** hold the same
non-zero lag in both periods). Two methods, one conclusion: cross-market impact
in liquid macro is a same-day repricing.

**Claim tier: predictive, not causal — 0 of 4 pairs.** The graph ACE actually
believes has a latent common driver (markets share news nobody observes), and
under it no observed adjustment set blocks the backdoor paths. The module says
`NOT IDENTIFIED` and reports what it can honestly deliver: an impulse response
with correct standard errors and a placebo test. Upgrading that to a causal
claim needs an exogenous event feed, an instrument or a discontinuity — not a
better estimator. This is the concrete reason the GDELT event database is
being built.

Registered **VALIDATING**, not promoted: validated infrastructure that found
nothing to forecast is not a forecasting model, and the registry has to say
which.

---

## 11. ace_event_ensemble v1 — FAILED (and the correction that flipped it)

The capstone question: does combining the engines beat the best single engine?
Not "beat the average" — that is true whenever one member is bad and says
nothing.

One target, so the members are commensurable: **P(at least one |move| ≥ 2σ in
the next 5 sessions)**. Four members, each an engine validated separately, each
calibrated on walk-forward out-of-fold predictions before the weights see it.
Weights fitted on those same out-of-fold rows. Sealed holdout scored once.

Pooled over four channels, 4,101 holdout rows:

| Member | BSS | log loss | AUC |
|---|---|---|---|
| base rate | +0.0018 | 0.5188 | 0.519 |
| markov | +0.0022 | 0.5186 | 0.502 |
| hawkes (cascade intensity) | +0.0194 | 0.5152 | 0.606 |
| volatility (HAR→FHS crossing) | +0.0343 | 0.5228 | 0.627 |
| **ensemble** (stacking, log pool) | **+0.0410** | **0.5141** | **0.638** |

The ensemble is the best configuration, and it beats the best single member by
+0.0066, CI [+0.0001, +0.0144]. On an uncorrected reading it also beats the
base rate: BSS +0.0410, 95% CI **[+0.0031, +0.0824]**.

**It does not survive the correction.** Five candidates were compared against
the same base rate on the same holdout; at 5% each that is a one-in-four
chance of a spurious winner. The Bonferroni-corrected 99% interval is
**[−0.0047, +0.0930]** — it includes zero. Registered FAILED.

This is the result the gate exists to produce. A lower bound of +0.0031 on the
fifth of five comparisons is exactly what noise looks like when you go
looking, and the uncorrected version of this table would have shipped a
forecaster whose advantage over "the base rate, every day" is not established.

Two further readings worth keeping:

- The **volatility member carries real information** — AUC 0.627 pooled, 0.695
  on NASDAQ, from a HAR volatility forecast converted to a crossing
  probability through the empirical residual distribution. Its BSS is
  +0.0343 and its corrected interval still spans zero, so it does not ship
  either; but it is the member the stacking weights load onto (0.65–0.94
  across channels), and it is where a future attempt should start.
- **Persistence is worth nothing here.** The markov member scores +0.0022,
  and the base rate +0.0018. Whether a 2σ move happened today tells you
  almost nothing about the next five sessions — the same conclusion the DBN
  run reached from the other direction.

---

## A silent sample-destroying defect — rolling windows over a gappy panel

A cross-asset panel is a union of trading calendars. SP500 has no value on a
US market holiday, WTI none when the NYMEX is shut, and FRED licenses the
index series for only a rolling ten years. `rolling(60, min_periods=60)` over
that panel returns NaN for every window containing a hole — silently, with no
warning and no error.

Measured on the real panel:

| Series | 60-day vol, usable values | 2σ days found |
|---|---|---|
| SP500 naive | **21** | **0** |
| SP500 on its own calendar | 2,452 | 142 |
| NASDAQ naive | 852 | 48 |
| NASDAQ on its own calendar | 4,146 | 253 |

A model reading the naive column would conclude the S&P has no stress days at
all, from a series that has one every eighteen sessions.

Every rolling call in `ace/` was audited. The model runners were already safe
— `volatility_model`, `scenario_probability_model` and `cascade_model` all
call `.dropna()` before rolling, which is why their published results stand.
Two places were not: the new causal module, and the **historical analogs
engine**, whose state matrix had 812 usable rows where it should have had
2,450.

`ace/data/series.py` now makes the correct behaviour explicit and named
(`rolling_std`, `shock_series` — roll on the dates a series was observed, then
reindex), the two call sites use it, and three tests pin it.

While fixing it: the analogs engine's equity leg now prefers whichever index
carries the most history. FRED's ten-year licence on SP500 had been truncating
the analog pool to 2,450 states from 2016; NASDAQ reaches back to 2010 for
**4,060**, so the pool now contains 2011 and 2015 — episodes an engine whose
entire product is "what happened after states like this one" should not be
blind to.

---

## 12. ace_gdelt_cascade v1 — the ripple, where it actually is

Every previous attempt to measure ripple propagation ran on PRICE series and
reached the same negative result by two independent methods: cross-market
transmission in liquid macro is a same-day repricing with no lag surviving out
of sample. That is a real finding about markets, and also a statement that the
price tape was the wrong substrate.

Conflict events are the right one. **10.5M GDELT events**, 2022-01 onward,
filtered to CAMEO quad class 4 (material conflict — assaults, fights, mass
violence, not verbal disapproval), grouped by the country the action occurred
in. Global daily volume is deliberately unused: at that aggregation the series
tracks GDELT's news-ingestion volume rather than real-world intensity and
yields five spikes in three years.

| country | spikes | α | half-life | LR p | OOS gain | multiplier |
|---|---|---|---|---|---|---|
| Lebanon | 52 | 0.566 | 1.2d | ~0 | **+17.1** | 2.31× |
| Iran | 78 | 0.515 | 1.2d | ~0 | +16.3 | 2.06× |
| Syria | 52 | 0.540 | 1.2d | ~0 | +12.7 | 2.18× |
| Pakistan | 62 | 0.261 | 1.0d | 0.0007 | +10.6 | 1.35× |
| Cuba | 52 | 0.385 | 0.9d | 9e-08 | +10.3 | 1.63× |
| West Bank | 54 | 0.401 | 1.3d | 3.3e-07 | +7.6 | 1.67× |
| Nepal | 48 | 0.461 | 1.0d | ~0 | +6.3 | 1.86× |
| Greece | 43 | 0.403 | 1.6d | 2.3e-05 | +4.6 | 1.67× |
| Rwanda | 44 | 0.390 | 1.1d | 8.1e-07 | +3.8 | 1.64× |
| Afghanistan | 49 | 0.332 | 1.1d | 1.2e-05 | +3.8 | 1.50× |
| India | 45 | 0.483 | 1.5d | ~0 | +3.7 | 1.93× |
| Israel | 56 | 0.636 | 1.3d | ~0 | +3.4 | 2.75× |
| Turkey | 50 | 0.434 | 1.7d | 3.8e-07 | +2.9 | 1.77× |
| Niger | 43 | 0.505 | 1.7d | ~0 | +2.4 | 2.02× |
| Brazil | 43 | 0.269 | 1.1d | 0.0019 | +1.7 | 1.37× |

**15 of 20 fitted countries** clear the three per-country checks, on the
complete backfill: 1,685 cached days, 2022-01 to 2026-09, 6.47M material
events across 254 countries. Mean branching ratio **0.439** — for every 100
escalations arriving on their own, ~85 more follow as offspring. Excitation
half-life is near one day everywhere: conflict escalation begets escalation
*fast*.

The branching ratio has been strikingly stable as the sample grew: 0.429 at
four countries, 0.436 at six, 0.491 at eight, **0.439 at fifteen**. A number
that holds while the sample triples is behaving like a real effect.

### Gaza: the gate working, and worth more than the fifteen passes

Gaza passed on partial data and **dropped out on the full window**. It still
fits strongly in sample — LR p = 2.6e-05, α = 0.399, stationary — but its
out-of-sample gain is **−13.8**: it loses badly to Poisson on the holdout.
Extending the window through 2026 put a structural break inside the test
period, and parameters fitted before it do not transfer across it.

A model with only the in-sample test would have shipped Gaza with a confident
1.66× multiplier.

### The shape is unverified — and it is NOT the kernel

The Ogata time-rescaling test needs ~50 residuals; no country has half that in
its holdout. Passing a check that never ran is worse than admitting it cannot
run, so the residuals are **pooled** — correct specification per country
implies Exp(1) residuals in each, so the union is Exp(1) too, and pooling turns
several untestable samples into one testable one.

| pool | n | KS p | mean | verdict |
|---|---|---|---|---|
| train | 189 | **0.0003** | 1.023 | rejected |
| holdout | 83 | **0.0415** | 1.116 | rejected |

Both reject a **continuous** Exp(1) null. The first reading — "the decay is not
exponential, as seismology found before Omori" — was **wrong**, and chasing a
power-law kernel on it would have been wasted work. The residuals say where the
mismatch is:

| quantile | empirical | Exp(1) | ratio |
|---|---|---|---|
| q0.10 | 0.239 | 0.105 | **2.27** |
| q0.25 | 0.335 | 0.288 | 1.17 |
| q0.50 | 0.637 | 0.693 | 0.92 |
| q0.75 | 1.436 | 1.386 | 1.04 |
| q0.95 | 3.174 | 2.996 | 1.06 |

Everything from q0.25 up matches within a few percent. The failure is **entirely
in the lower tail**: Exp(1) expects 9.5% of residuals below 0.1 and **0.0%** are
observed.

That is the daily grid, not the kernel. **47% of inter-event gaps are exactly
one day** — the minimum the calendar allows. The smallest rescaled time is
0.146, and a continuous process would place **13.6%** of its mass below that.
None is reachable here by construction.

A power-law (Omori) kernel would fit this **worse**: it concentrates *more*
mass immediately after a parent event, producing *more* short gaps, when the
data has *too few*.

Correcting crudely for the floor — exponential memorylessness means
`(τ − c) | τ ≥ c` is exactly Exp(1) — does not restore the fit either
(conditional KS p = 1.2e-05, mean 0.876). So **discretization and kernel shape
are confounded at daily resolution and neither is established as the culprit.**

Consequence: the branching ratio is an **approximation of how much one
escalation breeds, not an estimate to quote to three digits**. Every country
registers `CANDIDATE`; none is promoted. Separating the two causes needs
**sub-daily event timestamps** — GDELT 2.0 publishes at 15-minute granularity —
not a different kernel.

### A conservative event definition, stated

A spike day is one whose log event count sits 2σ above its own **trailing**
60-day norm. Standardizing by a trailing window partially removes the very
clustering being measured: a burst raises the bar for the days after it. The
bias runs *against* finding excitation, so these numbers are understated rather
than flattered.

### Selection is by sample size, not by result

7 fitted, 15 excluded by the holdout-size floor, 51 with too few spike days to
fit at all. The fitted set is the top of the **sample-size** ranking, not of
the result ranking — stated so 6 passes out of 73 cannot be read as a search
for six that worked.

### Two gate defects found and fixed during this run

**A check that passed without executing.** The per-country pass condition was
written `gof.get("exponential_by_ks") is not False`, which waves through a
test that returned "unavailable" — while the verdict printed "with correctly
specified intensity". Now tracked separately and tested on the pool.

**The loader ran the machine out of memory.** `load_events` concatenates every
cached day into one frame — ~11M rows of mostly-unneeded text columns at current
coverage — and the OOM reaper killed the run, very likely taking the backfill
sharing the machine with it. Nothing downstream of a daily model needs the rows,
only counts, so `daily_counts_by` reduces each file and drops it: **0.20 GB peak
instead of OOM**, 11 seconds. A test pins that it returns the same numbers as the
frame-based path and keeps the zero-versus-gap distinction.

**A model that stopped qualifying kept its PRODUCTION status.** Retiring only
the models being *replaced* left Pakistan in PRODUCTION on the strength of an
earlier run, after it failed the re-run. The runner now retires any live model
in the family that is not in the current passing set, on the record, with a
reason.

---

## 13. ace_macro_quad v1 — the label holds, both trades built on it do not

The growth/inflation quad — classify the economy by the **rate of change** of
growth and inflation rather than their level, into four regimes. It is the
framework Hedgeye built a business on, and it bundles three claims that are
almost always sold as one:

1. The economy can be classified this way, in real time.
2. Knowing which quad you are in tells you how to be **positioned**.
3. Knowing which quad you are in tells you how much **risk** to carry.

They are separable. They were tested separately. Only the first survived.

### Claim 1 — PASSES, and the point-in-time discipline is the whole thing

320 month-ends classified, 2000-01 to 2026-08, from ALFRED **first-release**
vintages filtered to what had actually been published by each classification
date.

That lag is the model. The publication calendar, measured from the vintage
archive rather than quoted from a manual:

| Series | median lag | p90 |
|---|---|---|
| PAYEMS nonfarm payrolls | 34d | 37d |
| PPIACO producer prices | 43d | 48d |
| INDPRO industrial production | 45d | 47d |
| CPIAUCSL / CPILFESL | 45d | 49d |
| RRSFS real retail sales | 45d | 49d |
| PCEC96 real consumption | 59d | 62d |
| DSPIC96 real disposable income | 59d | 62d |
| real GDP | **119d** | — |

GDP is excluded for that reason: by the time it lands it describes a quarter
that ended four months ago, and a nowcast that waits for it is reading an
almanac. Two spot checks show the discipline is real rather than asserted:

- **2008-10-31 → Quad 3 Stagflation**, not Quad 4. CPI was still +5.05% and
  accelerating in the September print. The deflation everyone remembers shows
  up in the data later than it shows up in the story.
- **2020-03-31 → Quad 3**, growth +0.61% YoY, reading through 2020-02-01. COVID
  had not entered published data yet. Anyone whose backtest says Quad 4 on that
  date scored themselves on data nobody had.

`test_quads.py` pins the property directly: appending a violent revision and
eight further months to the vintage frame leaves an earlier reading
byte-identical.

### The composite is chosen by a criterion, not by convention

"Industrial production and payrolls" is a convention. Eight candidate
specifications were scored instead, on a stated criterion: **the share of
real-time labels that survived contact with the revised data**, measured on a
training window and re-checked on a holdout. Readings from the last 18 months
are excluded — the data has not had time to revise, so they would score as
survivors by default and flatter every candidate equally.

A candidate whose median spell falls below a **two-month persistence floor** is
disqualified outright rather than traded off against survival: it is labelling
months, not regimes.

| spec | train | holdout | median spell | ≥1 quarter |
|---|---|---|---|---|
| **labour** (PAYEMS, CPI, 3mo) | **72.5%** | 78.0% | 2 mo | 41% |
| fast_6m | 69.2% | 72.5% | 2 mo | 46% |
| broad (5 growth, 3 price) | 68.6% | 78.0% | 2 mo | 33% |
| broad_6m | 67.8% | 70.3% | 2 mo | 44% |
| core (core CPI) | 66.3% | 74.7% | 2 mo | 40% |
| fast (INDPRO+PAYEMS, CPI) | 65.9% | 75.8% | 2 mo | 33% |
| production | 64.5% | 76.9% | 2 mo | 34% |
| fast_1m | 64.5% | — | **1 mo** | 10% — **disqualified** |

`labour` won the training window and ranked 2nd of 7 eligible on the holdout,
so the choice held up rather than being the luckiest of eight. It is worth
saying plainly why a single series wins a *revision-survival* criterion:
payrolls revises less than industrial production does, so a narrow composite
partly wins by having less to revise. That is a real property, it is the
property the criterion asks about, and the full table is shipped so a reader
can disagree with the criterion rather than with a hidden choice.

### The finding that undercuts how the framework is presented

**The median spell is two months. Under every specification tested** — the
broadest, the slowest, the core-inflation variant, all of them. Only 33–46% of
completed spells reach a single quarter.

A framework presented as quarterly regimes you position around produces, on
honest point-in-time monthly data, a label that turns over about every two
months. That is not a defect in one composite; it is what the data does.

The reason is visible in the margins: **190 of 302** settled readings sat in
the "knife-edge" bin, with both rates of change inside ±0.25 points of the
boundary. The quad is usually a near-tie.

### Claim 1 comes with an error rate, which is also measured

Every historical reading was re-run on today's revised data, cut to the same
observation months, so the two differ only in how revised the values are.

**74.2% of real-time labels survived.** The per-margin calibration is monotone
and the bin edges were fixed in advance rather than fitted:

| margin | n | survived |
|---|---|---|
| knife-edge 0.00–0.25 | 190 | **62.6%** |
| thin 0.25–0.75 | 83 | 91.6% |
| clear 0.75–2.00 | 24 | 100% |
| decisive 2.00+ | 5 | 100% (too thin to quote) |

And the failures have a direction. **72% of them (56 of 78) flipped the growth
axis** — Q1↔Q4 or Q2↔Q3, which hold inflation fixed — against 15 on inflation.
Growth data revises far more than price data, so the top row of the 2×2 is
where a real-time quad is most likely to be wrong. The framework's own
transitions travel the same axis, because both are driven by the same noise.

### Claim 2 — FAILED, on the baseline that matters

The baseline is **always long the same asset over the same period**, not zero.
Equities drift up, and a rule that is long most of the time inherits that drift
and looks clever. Signs learned on a training window, checked on a sealed
chronological holdout, block-bootstrap intervals (3-month blocks, 1000 draws).

Under the shipped `labour` spec: **0 of 6 channels** beat always-long with a CI
excluding zero; **8 of 12** usable quad cells kept their sign (67%). NASDAQ's
edge of exactly `+0.000` with a CI of `[+0.000, +0.000]` looks like a bug and
is not: every sign the training window learned for NASDAQ was positive, so
"quad positioning" reduced to being long in all four quads. It matched
long-only because it *was* long-only.

Registered **FAILED**. Not promoted.

### Claim 3 — FAILED too, and the way it failed is the interesting part

`ace/models/quad_vol_model.py`. A framework can be useless for direction and
still useful for sizing, so volatility gets its own test rather than inheriting
the returns verdict.

The baseline is **an AR(1) in log realised volatility**, not the unconditional
mean. Volatility is the most persistent quantity in finance, and a quad that
merely recovers "vol was high recently" has discovered nothing. So the test is
incremental — does adding quad dummies to a regression that already has lagged
log vol reduce out-of-sample squared error — with Holm-Bonferroni across the
six channels.

| channel | persistence alone | quad adds | p |
|---|---|---|---|
| NASDAQ | +16.2% | +2.8% | 0.211 |
| SP500 | −0.0% | +3.9% | 0.401 |
| USD_BROAD | +14.4% | +2.1% | 0.570 |
| WTI | +29.3% | −0.6% | 0.610 |
| DJIA | +8.1% | +1.1% | 0.655 |
| UST10Y | +33.9% | +0.7% | 0.710 |

**0 of 6 survive correction.** But the descriptive signature is real and much
more stable than the returns one: **14 of 18 usable cells kept their sign
(78%)**, against 8/12 for returns. Quads 3 and 4 genuinely run hotter across
channels. The conclusion is precise rather than dismissive — the vol signature
exists, and the tape already knows it, so the quad adds nothing you could not
get from last month's realised vol.

Registered **FAILED**, and explicitly retired rather than left as a stale row.

### What went into the product, and what did not

`scripts/generate-macro-quads.mjs` emits two artifacts: a client module with
the live reading and everything needed to qualify it, and a server-side detail
payload with the history, the per-spec scorecards and the survival curves. It
writes `POSITIONING_VALIDATED` and `VOL_FORECAST_VALIDATED` from the runs, and
refuses to emit at all if the live reading is unclassified, the history is too
short, or either verdict is missing — an absent scorecard must never read as a
pass.

A `/macro` route renders the label, its margin and measured survival rate, the
spec vote, the revision confusion matrix, the Kaplan-Meier spell curves, the
composite scorecard and both failed tests in full. It ranks no assets and sizes
no risk, because there is nothing to rank or size by.

A defect worth recording: the first export computed pooled survival over every
comparison while the per-bin rates used only the settled ones, reporting 75.3%
where the honest figure is 74.2%. The TypeScript test asserting that the pooled
rate equals the bins it is made of caught it on the first run.

---

## Registry integrity — a defect found and fixed

`register()` replaces the row for a given `model_id:version`. Models that take
a `--channel` argument but register under one constant id therefore overwrote
each other, and the survivor was whichever channel ran last.

The concrete damage: `ace_volatility_har:v1` read **FAILED** in the registry.
That was USD_BROAD's result, sitting on top of SP500's, DJIA's and UST10Y's
passes. Three validated models were invisible, and had one been promoted, a
later re-run on a worse channel would have taken it out of PRODUCTION with no
retire event and no reason recorded.

Fixed three ways: `register()` now refuses to overwrite a PRODUCTION row and
points at the new explicit `retire()`; `volatility_model` and
`news_volatility_model` register one row per channel, as the cascade and
scenario models already did; and the registry was rebuilt by re-running both
models on all six channels. A stale `t:v0` record marked PRODUCTION — debris
from a test that once wrote to the live registry — was removed.

---

## What this means

Fifteen model families have now been put through the same gate: purged
walk-forward, a sealed holdout read once, out-of-sample calibration, and a
comparison against the *right* baseline rather than a convenient one.

**Passing, with the scope stated:** scenario distribution (FHS, 4/4 channels),
volatility (HAR, 3/6 channels), event cascade (Hawkes, 2/3 channels),
competing risks. **Failing:** shock persistence, macro impact direction and
magnitude, news→volatility increment, Prophet, and the Dynamic Bayesian
Network on market states. **Descriptive only:** regime labelling, historical
analogs, transmission structure. **Validated machinery with nothing to
forecast:** the causal engine — its estimators recover planted effects, and
no market pair produced a response that outlives the day it happened; and the
ensemble — the combination is the best configuration tested and still cannot
be distinguished from the base rate once its five comparisons are corrected
for.

The failures are the evidence that the gate works. A leaky setup does not
return AUC 0.49 — it returns 0.65 and looks fundable. And the passes are
narrow on purpose: HAR ships on three channels and is withheld on three where
it beats naive on the point estimate but not with a CI that excludes zero.

**What ACE can defensibly claim today:** a calibrated distribution of the move
for a given channel and horizon; a volatility forecast on SP500, DJIA and
UST10Y; a measured cascade multiplier on NASDAQ and WTI; cumulative incidence
of escalation vs continuation by horizon; a labelled volatility regime;
genuine historical analogs with honest dispersion; exact game equilibria under
payoff uncertainty; and which markets move together contemporaneously.

**What it cannot claim:** that it forecasts direction, that any lead-lag
relationship is tradeable, that cross-variable state improves a day-ahead
event probability, or that any cross-market impact it measures is causal
rather than contemporaneous co-movement.

Two independent methods now say the same thing about the ripple thesis in
liquid macro: the transmission engine finds no lag that holds across periods,
and local projections find no horizon beyond h=0 that survives multiplicity
correction. Markets reprice together, the same day. Whatever ACE forecasts
that is worth forecasting is therefore not in the price series — it is in the
event stream, which is what the GDELT and feed work is for.

## Reproducing

```bash
pip install -r ace/requirements.txt
export FRED_API_KEY=...
python3 ace/models/scenario_probability_model.py
python3 ace/models/volatility_model.py --channel SP500
python3 ace/models/news_volatility_model.py --channel SP500
python3 ace/models/cascade_model.py
python3 ace/models/competing_risks_model.py
python3 ace/models/dbn_model.py
python3 ace/models/causal_impact_model.py
python3 ace/models/ensemble_model.py
python3 ace/models/gdelt_cascade_model.py
python3 ace/models/quad_model.py --spec labour
python3 ace/models/quad_vol_model.py --spec labour
python3 ace/macro/export_quads.py
python3 ace/models/shock_persistence_model.py
python3 ace/models/macro_impact_model.py
python3 ace/ripple/validate_edges.py
python3 ace/regime/validate_regimes.py
python3 -m pytest ace/tests/ -q
```

All runs are seeded. Artifacts, registry and scorecards land in `artifacts/`.
