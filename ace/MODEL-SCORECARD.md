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
| Regime (Markov switching) | **Validated, descriptive** | Yes — to label the environment. Not as a forecast. |
| Game theory (Nash + Monte Carlo) | **Exact** | Yes — equilibria are computed and verified. Payoffs remain an assumption. |
| Historical analogs | **Validated, descriptive** | Yes — as a distribution of what followed similar states. |
| Transmission / Ripple | **Partly validated** | Contemporaneous structure only. No tradeable lag exists in this data. |
| Scenario probability | **FAILED** | No. |
| Event impact | **FAILED** | No. |

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

## What this means

Three predictive targets were tested against real data with purged
walk-forward, sealed holdouts and out-of-sample calibration. **All three
failed.** Two descriptive engines and one exact solver passed.

That is not a defect in the pipeline; it is the pipeline working. A leaky
setup does not return AUC 0.49 — it returns 0.65 and looks fundable.

**ACE's defensible claim today** is structural: it labels the volatility
regime, retrieves genuine historical analogs with honest dispersion, solves
games exactly under payoff uncertainty, and maps which markets move together.
It has **no validated ability to forecast direction, magnitude, or scenario
outcome**, and nothing in the product may imply otherwise until a model passes
the gate.

## Reproducing

```bash
pip install -r ace/requirements.txt
export FRED_API_KEY=...
python3 ace/models/shock_persistence_model.py
python3 ace/models/macro_impact_model.py
python3 ace/ripple/validate_edges.py
python3 ace/regime/validate_regimes.py
python3 -m pytest ace/tests/ -q
```

All runs are seeded. Artifacts, registry and scorecards land in `artifacts/`.
