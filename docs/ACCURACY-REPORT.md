# Do Ripple Radar's event-to-market calls work?

**Verdict: it isn't proven.** On 26 real events from 2023 through early 2026, the deterministic engine's directional calls hit **52.1%** of the time from the prior close to the event-session close (139 of 267 calls). A 95% Wilson interval is **46.1% to 58.0%**. That sits on a coin flip. Equal-weighting each event instead of each ticker gives **48.8%**. The same books, read three sessions out, hit **48.0%**.

A naive card that was written down before the prices were scored — hot CPI is risk-off, a cut is risk-on, an oil cut lifts crude — did as well or better on the six-asset basket. The engine's own ranking of names inside a book has essentially no rank correlation with the later signed return (mean Spearman **0.03**).

What the sample does show is narrower. Every CPI print produced the **same** book. Hot payrolls, cold payrolls, and rate hikes produced one shared book. An oil-cut headline did go long crude, and two of the three cuts in this set were followed by higher crude that session. NVIDIA's May 2023 guide, which the engine read only as "semiconductors, so up," was followed by a **+24.4%** day in the stock. Those are fixed reflexes of the ontology. They are not a reader of the surprise, and the pre-specified rates slice of CPI, payrolls, and FOMC calls hit **49.3%** (35 of 71).

The optional Grok path was not run. There is no `XAI_API_KEY` in this environment, and the point of the replay was the engine that actually ships as the fallback. Nothing in `src/lib/engine` was changed to move these numbers.

## How a headline becomes a call

The live desk clusters RSS headlines and builds a book with `composeFromCluster`. A typed event, and the fallback when Grok is absent, uses `composeFromText`. Both end in `buildCausalGraph`. This replay calls `composeFromText` with the release text and **no quotes**. Quotes would let `rankTrades` reward names that had already moved, which is confirmation after the fact, not a forecast.

The steps that decide direction:

1. `tagsFromText` walks `LEXICON` in `src/lib/engine/ontology.ts`. "cpi" becomes `inflation`. "fomc" and "rate" become `rates`. "opec" and "oil" become `energy` / `crude` / `policy`. Words that are not in the lexicon, including "payroll," "jobs," "Tesla," "tariff," and "Hamas," add nothing.
2. `toneOf` counts `ESCALATE` and `DEESCALATE` substrings. More escalation words than de-escalation words yields tone `up`. The reverse yields `down`. A tie is `neutral`. The match is `String.includes`, not a word boundary.
3. The first tags become level-1 nodes. `TRANSMIT` then adds later hops. A hop whose edge is `direction: -1` is marked `down`. A level-1 node is `mixed` when the tone is `down`, and `up` otherwise. Later hops do not flip when the tone is `down`.
4. A trade is **short only when the node direction is `down`**. `mixed` and `up` are both **long**. `tradeFrom` in `src/lib/engine/graph.ts`.
5. The score is `92 - index * 4 - (level - 1) * 3`, then clamped. Impact is `86 - level * 12 - i`. Neither number is an expected return. The horizon string on a trade ("minutes–days", "days–weeks") is the instrument's lag label, not a sized forecast.
6. If the text matches no tag, the graph falls through to equities and emits long `SPX`, `QQQ`, and `IWM`.

`marketRelevanceOf` can keep a headline off the live desk. `composeFromText` still builds a book. This report scores both: every forced book, and the subset the desk gate would have kept.

The book's probability on these headlines was **3** for the macro prints and **5** for the others. It does not vary with the surprise, so it was not used as a weight. Importance sat in a tight band (about 32 to 62) and was not treated as a return forecast either.

## Method

Catalog: `scripts/replay-eval/events.json` (29 events). Predictor: `scripts/replay-eval/predict.ts`. Prices: `scripts/replay-eval/prices.mjs`. Scorer: `scripts/replay-eval/score.mjs`. Frozen output: `scripts/replay-eval/out/results.json`.

Each text is a lead or a decision sentence that was public at the release. Sentences that describe the later price move were left out. Where a Reuters poll is cited, it labels the naive card only. It is not pasted into the engine text.

**Clock.** The cash session is the SPY session that contains the release if the release is before 16:00 America/New_York, and the next SPY session otherwise. Weekend OPEC, the Hamas attack, and the Iran strike therefore land on the next cash session. NVIDIA and Tesla, released after the close, land on the next session. The 2 April 2025 tariff announcement is stamped at 16:00 ET, so the scored session is 3 April. The minute the remarks began was not re-checked past the calendar date.

**Horizons**, all from Yahoo daily closes unless noted:

| Horizon | Window |
|---|---|
| Event session (eod) | Prior SPY close → event-session close |
| Next session | Event-session close → next close |
| Three sessions | Event-session close → close three sessions later |
| Cumulative three | Prior close → close three sessions after the event session |
| About one hour | Last completed 60-minute bar at or before the release, to the bar that finishes about an hour later |

A call hits when the close-to-close return has the predicted sign and the absolute return is at least **5 basis points**. Smaller moves are flats and drop out of the hit rate. They are counted separately in the JSON.

**Basket.** The user asked for NQ/ES, gold, crude, the dollar, and the 10-year. The scorer maps the engine's own tickers onto that basket:

| Basket leg | Yahoo series | Engine tickers that count |
|---|---|---|
| S&P | `SPY` | `SPX`, `ES`, `SPY` |
| Nasdaq | `QQQ` | `QQQ`, `NQ` |
| 10-year yield | `^TNX` | `TNX` as-is; else `TLT`, `ZN`, or `ZB` with the sign flipped, because those are prices |
| Dollar | `DX-Y.NYB` | `UUP` as-is; else `EUR` flipped (`EURUSD`) |
| Gold | `GLD` | `GC`, `GLD` |
| Crude | `CL=F` | `CL`, `USO`, `BZ` |

If the mapped tickers disagree, that leg abstains. No call is a coverage miss, not a wrong call. `SPX` is not copied onto `QQQ`.

**Prices.** Yahoo Finance chart v8, fetched 2026-10-17T14:20:44Z. Daily bars from 1 Dec 2022 through 17 Oct 2026 for every symbol the books named, plus the basket. Sixty-minute bars from 20 Oct 2024 forward for the basket and `ZN=F`. A probe of 60-minute history in 2023 returned HTTP 422, which matches Yahoo's retention, so earlier hours are marked unavailable rather than filled. FRED `DGS10` is a sign check on the 10-year: on 25 event sessions where both `^TNX` and `DGS10` moved, the signs agreed **25 of 25**.

**Naive cards**, fixed in `NAIVE_RULES` inside the scorer before this fetch was joined:

| Card | Rule |
|---|---|
| Hot inflation | SPY down, QQQ down, 10-year up, dollar up, gold down, crude up |
| Cool inflation | the opposite |
| In-line inflation, FOMC hold, "changed little" payrolls | abstain |
| Hot labor | payrolls rose and unemployment did not: equities down, 10-year up, dollar up, gold down |
| Cold labor | unemployment rose: equities down, 10-year down, dollar down, gold up |
| Hawkish FOMC | the decision sentence says "raise": same shape as hot inflation, crude abstains |
| Dovish FOMC | the decision sentence says "lower": the opposite. The December 2024 dots were not used to relabel the cut |
| Oil cut | crude up, gold up, 10-year up, equities down |
| Geopolitical shock | equities down, 10-year down, dollar up, gold up, crude up |
| NVIDIA guide | NVDA, QQQ, and SPY up |
| Tesla miss | TSLA, QQQ, and SPY down |
| Tariffs | equities down, 10-year down, dollar up, gold up |
| Coin flip | 50%, the null. No simulated coin paths were generated |

The hot-labor / cold-labor split is a verb rule on the BLS lead, not a poll, except the July 2024 print, where Reuters' 175,000 forecast is also cited. CPI cards are hot or cool only where a Reuters poll was fetched for this run. The other CPI rows still score the engine; the naive card abstains.

## Event list

Engine text is the lead in `events.json`. The source is what was public at release.

| Id | When (release) | What was fed | Source | Naive card |
|---|---|---|---|---|
| cpi-2023-02-14 | 14 Feb 2023 08:30 ET | CPI-U rose 0.5% in January; 6.4% over 12 months | [BLS](https://www.bls.gov/news.release/archives/cpi_02142023.htm) | abstain (poll not archived) |
| cpi-2023-07-12 | 12 Jul 2023 08:30 ET | CPI-U rose 0.2% in June; 3.0% over 12 months | [BLS](https://www.bls.gov/news.release/archives/cpi_07122023.htm) | cool. Reuters poll 0.3% and 3.1% ([Reuters](https://www.reuters.com/markets/us/us-consumer-prices-rise-modestly-june-core-inflation-slowing-2023-07-12/)) |
| cpi-2023-11-14 | 14 Nov 2023 08:30 ET | CPI-U unchanged in October; 3.2% over 12 months; energy fell 2.5% | [BLS](https://www.bls.gov/news.release/archives/cpi_11142023.htm) | abstain (poll not archived) |
| cpi-2024-04-10 | 10 Apr 2024 08:30 ET | CPI-U increased 0.4% in March; 3.5% over 12 months | [BLS](https://www.bls.gov/news.release/archives/cpi_04102024.htm) | hot. Reuters poll 0.3% and 3.4% ([Reuters](https://www.reuters.com/markets/us/us-consumer-prices-rise-more-than-expected-march-2024-04-10/)) |
| cpi-2024-09-11 | 11 Sep 2024 08:30 ET | CPI-U increased 0.2%; 2.5% over 12 months | [BLS](https://www.bls.gov/news.release/archives/cpi_09112024.htm) | cool. Reuters poll 0.2% and 2.6% ([Reuters](https://www.reuters.com/markets/us/view-small-aug-cpi-rise-seen-sealing-25-bp-cut-next-week-2024-09-11/)) |
| cpi-2025-02-12 | 12 Feb 2025 08:30 ET | CPI-U increased 0.5% in January; 3.0% over 12 months | [BLS](https://www.bls.gov/news.release/archives/cpi_02122025.htm) | abstain (poll not archived) |
| cpi-2026-01-13 | 13 Jan 2026 08:30 ET | CPI-U increased 0.3% in December; 2.7% over 12 months | [BLS](https://www.bls.gov/news.release/archives/cpi_01132026.htm) | abstain. Reuters: in line ([Reuters](https://www.reuters.com/business/us-consumer-prices-increase-expected-december-2026-01-13/)) |
| nfp-2023-10-06 | 6 Oct 2023 08:30 ET | Payrolls rose 336,000; unemployment unchanged at 3.8% | [BLS](https://www.bls.gov/news.release/archives/empsit_10062023.htm) | hot labor |
| nfp-2024-02-02 | 2 Feb 2024 08:30 ET | Payrolls rose 353,000; unemployment remained 3.7% | [BLS](https://www.bls.gov/news.release/archives/empsit_02022024.htm) | hot labor |
| nfp-2024-08-02 | 2 Aug 2024 08:30 ET | Unemployment rose to 4.3%; payrolls edged up 114,000 | [BLS](https://www.bls.gov/news.release/archives/empsit_08022024.htm) | cold labor. Reuters poll 175,000 ([Reuters](https://www.reuters.com/markets/rates-bonds/view-soft-us-payrolls-number-opens-door-september-fed-cut-2024-08-02/)) |
| nfp-2026-01-09 | 9 Jan 2026 08:30 ET | Payrolls +50,000 and unemployment 4.4% "changed little" | [BLS](https://www.bls.gov/news.release/archives/empsit_01092026.htm) | abstain |
| fomc-2023-03-22 | 22 Mar 2023 14:00 ET | "decided to raise the target range … to 4-3/4 to 5 percent" | [Fed](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230322a.htm) | hawkish |
| fomc-2023-07-26 | 26 Jul 2023 14:00 ET | "decided to raise the target range … to 5-1/4 to 5-1/2 percent" | [Fed](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230726a.htm) | hawkish |
| fomc-2023-12-13 | 13 Dec 2023 14:00 ET | Inflation "has eased"; "decided to maintain the target range" at 5-1/4 to 5-1/2 | [Fed](https://www.federalreserve.gov/newsevents/pressreleases/monetary20231213a.htm) | hold (abstain) |
| fomc-2024-09-18 | 18 Sep 2024 14:00 ET | "decided to lower the target range … by 1/2 percentage point" | [Fed](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240918a.htm) | dovish |
| fomc-2024-12-18 | 18 Dec 2024 14:00 ET | "decided to lower the target range … by 1/4 percentage point" | [Fed](https://www.federalreserve.gov/newsevents/pressreleases/monetary20241218a.htm) | dovish. Dots were not fed |
| opec-2023-04-02 | Sun 2 Apr 2023 | OPEC+ oil output cuts of around 1.16 million barrels per day | [Reuters](https://www.reuters.com/business/energy/sarabia-other-opec-producers-announce-voluntary-oil-output-cuts-2023-04-02/) | oil cut. Cash session 3 Apr |
| opec-2023-06-04 | Sun 4 Jun 2023 | Saudi output to 9 million bpd in July from around 10 million | [Reuters](https://www.reuters.com/business/energy/opec-meets-debate-production-quotas-new-cut-sources-2023-06-04/) | oil cut. Cash session 5 Jun |
| opec-2023-11-30 | Thu 30 Nov 2023 22:12 UTC | Voluntary cuts totalling about 2.2 million bpd | [Reuters](https://www.reuters.com/markets/commodities/opec-ministers-meet-discuss-additional-oil-output-cuts-2023-11-30/), [OPEC](https://www.opec.org/pr-detail/39-30-nov-2023.html) | oil cut. After the cash close, so session is 1 Dec |
| geo-2023-10-07 | Sat 7 Oct 2023 dawn | Hamas attack, gunmen and rockets from Gaza | [Reuters](https://www.reuters.com/world/middle-east/how-hamas-attack-israel-unfolded-2023-10-07/) | geopolitical. Cash session 9 Oct |
| geo-2024-01-12 | overnight into 12 Jan 2024 | US and British strikes on Houthi forces after Red Sea shipping attacks | [Reuters](https://www.reuters.com/world/us-britain-carry-out-strikes-against-houthis-yemen-officials-2024-01-11/) | geopolitical |
| geo-2024-04-13 | Sat 13 Apr 2024 night | Iran launched drones and missiles at Israel | [Reuters](https://www.reuters.com/world/middle-east/iran-launches-drone-attack-israel-expected-unfold-over-hours-2024-04-13/) | geopolitical. Cash session 15 Apr |
| nvda-2023-05-24 | after the close, 24 May 2023 | Revenue $7.19 billion; outlook $11.00 billion ± 2% | [NVIDIA](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2024) | long NVDA, QQQ, SPY. Session 25 May |
| tsla-2024-07-23 | after the close, 23 Jul 2024 | Lowest margin in more than five years; auto gross margin 14.6% vs 16.3% estimates | [Reuters](https://www.reuters.com/business/autos-transportation/tesla-revenue-sees-surprise-rise-second-quarter-revenue-2024-07-23/) (filed before the 24 Jul open) | short TSLA, QQQ, SPY |
| deepseek-2025-01-27 | US open, 27 Jan 2025 | DeepSeek launched a free assistant that uses less data at a fraction of the cost | [Reuters](https://www.reuters.com/technology/chinas-deepseek-sets-off-ai-market-rout-2025-01-27/) launch clause only. The selloff sentences, and the name Nvidia, were not fed | abstain, so a short-Nvidia story is not scored after the fact |
| tariff-2025-04-02 | stamped 16:00 ET, 2 Apr 2025 | 10% baseline tariff and a 34% tariff on China | [Reuters](https://www.reuters.com/world/us/us-businesses-brace-more-pain-liberation-day-tariffs-loom-2025-04-02/) | growth-uncertainty card. Session 3 Apr |
| ctrl-superbowl-2024-02-11 | night of 11 Feb 2024 | Chiefs beat the 49ers 25-22 in overtime | [NFL](https://www.nfl.com/super-bowl/) | abstain. Session 12 Feb |
| ctrl-oscars-2024-03-10 | night of 10 Mar 2024 | Oppenheimer won the Oscar for best picture | [Oscars](https://www.oscars.org/oscars/ceremonies/2024) | abstain. Session 11 Mar |
| ctrl-iphone-2023-09-12 | 12 Sep 2023, 10:00 Pacific | Apple unveiled the iPhone 15 and iPhone 15 Pro | [Apple](https://www.apple.com/newsroom/2023/09/apple-debuts-iphone-15-and-iphone-15-plus/) | abstain |

## Results

### The books repeat

Five signatures cover all 29 events.

| The book the engine actually emitted | Events that shared it |
|---|---|
| Long TIP, TNX, UUP, BTC, VIX, KRE, ZN, ZB. Short TLT, ETH, SPX, XLF | All **seven** CPI prints. Hot, cool, and in-line |
| Long TNX, TLT-short, BTC, VIX. Short ETH, SPX, UUP, KRE, plus a second KRE line | Both hot payrolls, the cold August 2024 payrolls, the "changed little" January 2026 payrolls, both 2023 hikes, and the December 2024 cut |
| Long TNX, TIP, BTC, VIX. Short TLT, ETH, SPX, UUP | December 2023 hold and the September 2024 50bp cut |
| Long CL, BZ, TNX, and the energy complex | April 2023 and November 2023 OPEC cuts. The June 2023 Saudi cut is the same idea with a slightly different tag list (`oil` is not in that sentence, so `crude` never fires) |
| Long SPX, QQQ, IWM | Hamas, Tesla, DeepSeek, the China tariff, and all three controls |

A level-1 `mixed` node still trades long, so the December 2023 tone (`down`, because "eased" is a real de-escalation word and also because "increased" is not in that sentence) and the September 2024 tone (`neutral`) produce the same sides.

### Hit rates

Non-control events only, unless the row says controls. "Event-equal" is the average of per-event hit rates, so a 12-name book does not outvote a 3-name book. The binomial p-value treats calls as independent. They are not — twelve names on one CPI day share one shock — so the p-value is too flattering. The Wilson interval has the same limit. Read both as descriptive.

| Sample | Horizon | Hits | Hit rate | Event-equal | Wilson 95% | Mean signed return |
|---|---|---:|---:|---:|---|---:|
| Engine book, 26 events | Event session | 139/267 | 52.1% | 48.8% | 46.1–58.0 | +0.51% |
| Engine book | Next session | 146/264 | 55.3% | 55.7% | 49.3–61.2 | +0.45% |
| Engine book | Three sessions ahead | 128/265 | 48.3% | 50.3% | 42.4–54.3 | −0.05% |
| Engine book | Cumulative three | 130/271 | 48.0% | 44.3% | 42.1–53.9 | +0.37% |
| Engine book, desk gate kept (23 events) | Event session | 136/258 | 52.7% | 50.9% | 46.6–58.7 | +0.57% |
| Engine book, three controls, forced | Event session | 1/9 | 11.1% | 11.1% | 2.0–43.5 | −0.19% |
| Basket, engine calls | Event session | 38/75 | 50.7% | 50.6% | 39.6–61.7 | −0.19% |
| Basket, naive card | Event session | 52/94 | 55.3% | 55.9% | 45.3–65.0 | +0.81% |
| Basket, naive card | Cumulative three | 56/93 | 60.2% | 61.1% | 50.1–69.6 | +0.77% |
| Basket, both called something | Event session, engine | 32/56 | 57.1% | 56.1% | 44.1–69.2 | +0.01% |
| Basket, both called something | Event session, naive | 31/56 | 55.4% | 58.3% | 42.4–67.6 | — |
| About one hour, in-session bars only | Engine book | 4/7 | 57.1% | — | 25–84 | — |

Dropping the NVIDIA session, the book hit rate is **50.8%** (130 of 256) and the mean signed return is **+0.28%**. The +0.51% figure is carried by that one guide.

Pre-specified slices, event-session, engine's own names:

| Slice | Hits | Hit rate | Wilson 95% |
|---|---:|---:|---|
| CPI + payrolls + FOMC, rates names only (TNX, TLT, ZN, ZB, TIP) | 35/71 | 49.3% | 38.0–60.7 |
| CPI books, all names | 41/83 | 49.4% | — |
| Payroll books | 20/46 | 43.5% | — |
| FOMC books | 35/58 | 60.3% | — |
| OPEC names | 17/35 | 48.6% | — |
| OPEC crude only (CL, BZ, USO) | 4/6 | 66.7% | 30–90 |
| Geopolitical books | 17/25 | 68.0% | 48–83 |
| Tech books | 9/17 | 52.9% | 31–74 |
| Tariff book | 0/3 | 0% | — |

The FOMC 60% is the standing "yields up, equities down" book. It fit the two hike days in the sense that equities fell, and it fit 18 Dec 2024 because that cut sold off and yields rose. The engine did not represent a cut. The naive dovish card was long equities and short yields that day and was wrong. On 13 Dec 2023 the same engine book was short the S&P into a **+1.4%** session and long yields into a **−4.1%** yield-index move. August 2024 payrolls are the same story from the other side: unemployment rose, yields fell **4.6%** on the `^TNX` index, the S&P fell **1.9%**. The engine was still long yields (miss) and short the S&P (hit), because the text tags `rates` and nothing in the lexicon says "this print was soft."

### Per event, event-session book

Hits are directional calls with a real close outside the 5bp band. `keep` is the live-desk relevance gate.

| Event | Session | Gate | Book hits | Cumulative 3 | What happened on the main leg |
|---|---|---|---:|---:|---|
| CPI Jan 2023 | 14 Feb 2023 | keep | 4/11 | 6/12 | 10-year index +1.2% (long hit). S&P flat, inside the band |
| CPI Jun 2023 | 12 Jul 2023 | keep | 5/12 | 4/12 | S&P +0.8%, 10-year −3.0%. The shared CPI book was short equities and long yields. Both missed. Crude +1.2%. The engine named no crude |
| CPI Oct 2023 | 14 Nov 2023 | keep | 5/12 | 6/12 | S&P +1.9%, 10-year −4.1%. Same book, same misses |
| CPI Mar 2024 | 10 Apr 2024 | keep | 7/12 | 7/12 | S&P −1.0%, 10-year +4.4%, dollar +1.1%. Same book, those three hit. This is the cited hot print |
| CPI Aug 2024 | 11 Sep 2024 | keep | 6/12 | 5/12 | S&P +1.0% (short missed). 10-year +0.2% (long hit). Cited as cool on the year-on-year poll |
| CPI Jan 2025 | 12 Feb 2025 | keep | 6/12 | 3/12 | S&P −0.3%, 10-year +2.2%. Shared book hit both |
| CPI Dec 2025 | 13 Jan 2026 | keep | 8/12 | 7/12 | In-line print. S&P −0.2% (short hit), 10-year −0.4% (long missed) |
| Payrolls Sep 2023 | 6 Oct 2023 | keep | 5/12 | 4/12 | S&P +1.2% (short missed), 10-year +1.4% (long hit) |
| Payrolls Jan 2024 | 2 Feb 2024 | keep | 3/12 | 5/12 | S&P +1.1% (short missed), 10-year +4.4% (long hit) |
| Payrolls Jul 2024 | 2 Aug 2024 | keep | 9/12 | 9/12 | S&P −1.9% (short hit), 10-year −4.6% (long missed). Best book score in the set, with the yield call wrong |
| Payrolls Dec 2025 | 9 Jan 2026 | keep | 3/10 | 7/12 | "Changed little." S&P +0.7% (short missed), 10-year −0.3% (long missed) |
| FOMC hike Mar 2023 | 22 Mar 2023 | keep | 9/12 | 8/12 | S&P −1.7% (short hit), 10-year −2.9% (long missed) |
| FOMC hike Jul 2023 | 26 Jul 2023 | keep | 4/10 | 3/11 | S&P flat. 10-year −1.6% (long missed). Nasdaq −0.3% (short hit) |
| FOMC hold Dec 2023 | 13 Dec 2023 | keep | 7/12 | 7/12 | S&P +1.4% (short missed), 10-year −4.1% (long missed). Naive card abstained |
| FOMC −50bp Sep 2024 | 18 Sep 2024 | keep | 7/12 | 3/11 | S&P −0.3% (short hit), 10-year +1.2% (long hit). Naive dovish card missed both |
| FOMC −25bp Dec 2024 | 18 Dec 2024 | keep | 8/12 | 9/12 | S&P −3.0% (short hit), 10-year +2.5% (long hit). Same book as a hike. Naive dovish card missed |
| OPEC+ Apr 2023 | 3 Apr 2023 | keep | 6/11 | 5/11 | CL=F **+6.3%** (long hit). 10-year −1.8% (long missed). S&P +0.4%, and this book was long equities via the energy hop, so that hit for a different reason than the naive short |
| Saudi cut Jun 2023 | 5 Jun 2023 | keep | 6/12 | 6/12 | CL=F +0.6% (long hit) |
| OPEC+ Nov 2023 | 1 Dec 2023 | keep | 5/12 | 4/12 | CL=F **−2.5%** (long missed) |
| Hamas | 9 Oct 2023 | drop | 3/3 | 2/3 | No tags. Long SPX, QQQ, IWM. S&P +0.6%, so the fallback was "right." Gold +1.8% and crude +4.3% were unnamed |
| Houthi strikes | 12 Jan 2024 | keep | 10/11 | 8/12 | Shipping and defense longs mostly rose (BWET, tankers, ITA). The word "strikes" also tagged `labor`. Crude +0.9% was unnamed. The S&P was +0.07%, and this book did not call it |
| Iran strike | 15 Apr 2024 | keep | 4/11 | 3/11 | Long ITA and long CL both missed (ITA down, CL −0.3%). S&P −1.2% and the book was long SPX. Gold +1.9% was unnamed |
| NVIDIA guide | 25 May 2023 | keep | 9/11 | 9/11 | NVDA **+24.4%** (30.54 to 37.98). TSM, SMH, AMD, AAPL, QQQ, SPX longs hit. The text never says the guide beat a consensus. The tag `nvidia` is enough to go long |
| Tesla Q2 | 24 Jul 2024 | drop | 0/3 | 0/3 | No tags for Tesla or a margin miss. Long SPX, QQQ, IWM. S&P −2.3%, QQQ −3.6%. TSLA itself was not named |
| DeepSeek | 27 Jan 2025 | drop | 0/3 | 0/3 | Same equity fallback. QQQ **−2.9%**, S&P −1.4%. NVDA was not in the text, so NVDA was not named |
| China tariffs | 3 Apr 2025 | keep | 0/3 | 0/3 | Tag `china` has no liquid ticker, so the book is again long SPX, QQQ, IWM. S&P **−4.9%**, QQQ −5.4% |
| Super Bowl | 12 Feb 2024 | drop | 1/3 | 2/3 | Long equities. One Russell call hit; S&P and Nasdaq did not |
| Oscars | 11 Mar 2024 | drop | 0/3 | 1/2 | "Oppenheimer" contains the substring `war`, so tone is `up`. Still the equity fallback. 0 of 3 that session |
| iPhone 15 | 12 Sep 2023 | drop | 0/3 | 0/3 | Equity fallback. S&P −0.6% |

### Ranking and magnitude

Across 22 events with at least four scored names, the Spearman correlation between the engine score and the signed event-session return averages **0.027**. The three highest scores earned a mean signed return of **+0.49%**. The rest of the book earned **+0.66%**. Higher on the list was not the better call.

There is no magnitude forecast to score. Impact and score are functions of list position and hop depth. A +24% NVDA day and a +0.2% yield day can sit in books whose scores look the same.

### One hour

Sixty-minute bars exist in this cache from 20 Oct 2024. Counted windows are those whose last completed bar ended within 90 minutes of the release and whose span is 30 to 150 minutes. That left **7** book calls on three releases: 12 Feb 2025 CPI, 13 Jan 2026 CPI, 9 Jan 2026 payrolls, and 18 Dec 2024 FOMC. Four hit. The December FOMC hour is the only one with a real in-session tape: `^TNX` was up and TLT was down over the hour, which matches the standing rates book, while the book's long `ZN` (bond **price** up) lost money over that same hour. Seven calls do not support an intraday claim. Hours for 2023 and most of 2024 were not available and are not in the hit rate.

## Baseline

On the six-asset basket, where each system is allowed to abstain:

- Engine event-session hit rate **50.7%** (38/75). Mean signed return **−0.19%**.
- Naive card **55.3%** (52/94) that session, and **60.2%** (56/93) cumulative over three sessions.
- On the 56 basket legs where **both** made a call, the engine hit 32 and the naive card hit 31 that session. Three sessions out, the engine hit 26 and the naive card hit 31.

The naive card is a small set of hand rules. Its cumulative 60% still has a Wilson interval that starts at 50.1%, and its calls inside one event move together. It is a yardstick, not a strategy this report is endorsing. The engine does not clear that yardstick.

The coin-flip yardstick is 50%. The engine's headline 52.1% book rate has a p-value against one half of about **0.50** under an independence assumption that is already too kind. There is no evidence here of a directional edge.

Coverage is the other half of the comparison. The naive geopolitical card called gold and crude on 7 Oct 2023 and 13 Apr 2024. Gold was up both Mondays (+1.8%, +1.9%). Crude was up hard on 9 Oct (+4.3%) and flat-to-down on 15 Apr. The engine called neither gold nor, on the Hamas headline, crude. The naive NVIDIA card and the engine agreed, because both went long and the stock rose 24%. The naive Tesla card went short the stock. The engine never named TSLA.

## Bugs left unfixed

These showed up in the replay. They were not patched. Patching them would change the numbers this report is about.

1. **`toneOf` matches substrings.** On every CPI lead, `increased` contains `ease` and `eased`, and `Urban` contains `ban`. Recorded hits were `deescalate: ["ease", "eased"]` and `escalate: ["ban"]`. Tone is therefore `down` for a hot print and a cool print alike. "Oppenheimer" contains `war`, so the Oscar control is tone `up`. "strikes" contains the lexicon key `strike`, so the Houthi headline is tagged `labor`.
2. **`mixed` trades as long.** De-escalation on a level-1 node does not flip the trade. That is why the December 2023 hold and the September 2024 cut share a book.
3. **No surprise channel.** The lexicon has no notion of above-consensus or below-consensus. Seven CPI releases, four payroll releases, two hikes, and one cut collapsed into two books.
4. **Unrecognized shocks become long equities.** Hamas (no `war` / `missile` / `oil` in the sentence used), Tesla, DeepSeek (Nvidia was deliberately not added), and a China tariff (the tag `china` has no instrument, so the equity fallback still runs) all emitted long SPX, QQQ, and IWM. The tariff passed the relevance gate. The S&P fell 4.9% on the scored session.
5. **The CPI book contradicts itself on rates.** It is long `TNX` and short `TLT` (yields up, bond prices down) and also long `ZN` and `ZB` (note and bond prices up). The first matching spec wins in the basket map, so the basket records "yields up" and hides the futures. The trade list a desk would read contains both.
6. **Duplicate `KRE`.** On the payroll/hike book the graph attaches KRE to two nodes with directions `down` and `up`. The trade list emits KRE twice, both short, because `nodes.find` keeps the first node. Recorded on seven events.
7. **OPEC is family `policy`.** `familyOf` returns `policy` when the tag `policy` is present, and the word "OPEC" sets that tag, before the energy branch is considered. The trade list still comes from the tags. Scenarios were not what this study scored.

## What could not be tested

- **Grok / `analyze.server.ts`.** No API key. The JSON prompt asks a model for directions and for six to eight trades. That path can disagree with `composeFromText`. It was not measured. Treating an unscored model call as the product's accuracy would have been a made-up result.
- **One-hour returns before 20 Oct 2024**, and most cash names even after that, because the pre-release bar is the prior afternoon (`stale_pre`) and those windows were excluded. The 4/7 figure is the entire intraday test.
- **A punchier RSS headline** than the official lead. The product's tape is headlines, and a different sentence can change tags. This run used the official sentence so the information set is the release, not a later wrap. A headline that added "Nvidia" to DeepSeek would have flipped that book to long semiconductors on a day the complex fell. That sentence was not the one scored, and it is labeled here so the omission is visible.
- **Costs, sizing, overlap, and a portfolio.** This is a sign test of named calls. It is not a P&L.

## Limitations

- Twenty-six non-control events. Calls inside an event are one shock. The effective sample is closer to the number of events than to 267.
- The event-session return for an 08:30 print is the whole cash day, which is mostly the reaction. For a 14:00 FOMC it also includes the morning, which is before the statement. The one-hour window was meant to isolate that, and the data mostly are not there.
- Yahoo continuous futures roll. A one-to-three day window rarely lands on a roll. It can. `CL=F` on 3 Apr 2023 going from 75.67 to 80.42 is the right order of magnitude for that Monday's jump, and FRED agreed with `^TNX` on sign, but a front-month roll remains a caveat.
- `BWET` had no Yahoo close on the April 2023 session, so that call is absent, not a miss and not a hit.
- Several naive CPI cards abstain because the poll page was not archived. The engine was still scored on those days. The baseline comparison is therefore on fewer CPI surprises than the engine sample.
- Wording is part of the instrument. Another honest sentence from the same release could change a tag. The sentences are in `events.json` so that choice can be audited.

## Plain-English verdict

The engine does not read an event and then predict the cross-asset move. It reads a short list of words, attaches a fixed map of tickers, and almost always goes long unless a transmission edge is marked negative. Hot CPI, cool CPI, and an in-line CPI produced one book. A strong payrolls print and the weak August 2024 print produced one book. A rate hike and the December 2024 cut produced one book. On that evidence the directional hit rate is a coin flip, the ranking does not rank, and there is no magnitude to be right about.

A few reflexes match the usual story: an oil-cut sentence goes long crude, and two of three cuts here were followed by higher crude that session; a semiconductor sentence goes long the complex, and NVIDIA's guide was a genuine up day. The geopolitical and earnings shocks that did not contain the right keyword became a long equity index, including into the April 2025 tariff session. The live-desk gate would have dropped the three controls, and also Hamas, Tesla, and DeepSeek, which is an abstention rather than a correct call.

**It isn't proven.** The sample is large enough to see that the books do not change when the surprise changes, and far too small to rescue a 52% hit rate whose uncertainty band covers a coin flip. The naive card, which does change with the kind of surprise, was at least as accurate on the basket. That is the honest state of the deterministic engine as of this run.

## Reproduce

```bash
npm run replay:eval          # re-download Yahoo and FRED, then score
npm run replay:eval:offline  # score the committed cache
node --test scripts/replay-eval/score.test.mjs
```

`replay:eval:offline` reruns the engine, so a change in `composeFromText` or the ontology will change `out/predictions.json` and the hit rate. The price cache stays the file fetched on 2026-10-17. The scorer tests use toy closes and do not stand in for the hit rates above.
