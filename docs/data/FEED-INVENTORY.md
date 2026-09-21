# Feed inventory — Ripple Radar (v0)

**Owners:** Ripple Data Eng (ingest / as-of) · Ripple Free Data (official-API catalog / ranking)  
**Status:** design-approved (CoS 2026-09-14) — still no **new** adapters / obs-log / `buildDeskAsOf` until separate IMPLEMENTATION greenlight  
**Path:** `docs/data/FEED-INVENTORY.md`  
**Date:** 2026-09-14  
**Gap spine:** [`docs/MODEL-DESIGN-v0.1.md`](../MODEL-DESIGN-v0.1.md) (canonical)  
**Live behavior:** `src/lib/live/build.server.ts`, `evidence.ts`, `clock.ts`, `types.ts`, `HANDOFF.md`  
**Related:** [`docs/FREEZE-AT-T-SCHEMA-v0.md`](../FREEZE-AT-T-SCHEMA-v0.md) (DS), [`docs/data/ASOF-REPLAY-v0.md`](./ASOF-REPLAY-v0.md) (Data Eng design)

---

## 1. Live sources (today)

### 1.1 World tape — RSS (narrative-class)

Coded in `FEEDS` inside `src/lib/live/build.server.ts`:

| Source key | URL (as coded) | Notes |
|---|---|---|
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` | Geo |
| BBC Business | `https://feeds.bbci.co.uk/news/business/rss.xml` | Macro |
| NYT World | `https://rss.nytimes.com/services/xml/rss/nyt/World.xml` | Geo |
| NYT Business | `https://rss.nytimes.com/services/xml/rss/nyt/Business.xml` | Macro |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | Geo |
| OilPrice | `https://oilprice.com/rss/main` | Energy narrative |
| CNBC World | `https://www.cnbc.com/id/100727362/device/rss/rss.html` | Macro / markets narrative |
| CNBC Markets | `https://www.cnbc.com/id/15839069/device/rss/rss.html` | Markets narrative |
| Defense One | `https://www.defenseone.com/rss/all/` | Defense / kinetic |
| Guardian | `https://www.theguardian.com/world/rss` | Geo |
| Guardian Business | `https://www.theguardian.com/uk/business/rss` | Macro |
| Reuters World | `https://feeds.reuters.com/Reuters/worldNews` | Wire (availability not guaranteed) |
| Reuters Business | `https://feeds.reuters.com/reuters/businessNews` | Wire |
| Fed | `https://www.federalreserve.gov/feeds/press_all.xml` | Policy primary |
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss/` | Crypto **narrative** only |
| Google News | `https://news.google.com/rss/search?q=when:1d+(markets+OR+geopolitics+OR+%22central+bank%22+OR+%22supply+chain%22+OR+sanctions+OR+hurricane+OR+semiconductor)&hl=en-US&gl=US&ceid=US:en` | Catch-all; demote weight (DS §5c P2) |

**Mechanics:** parallel fetch; ≤20 items/feed; title dedupe; top 80 by `pubDate`; in-memory only; id = hash(title+source+published+link). Missing pubDate → `event_time = available_time` (inferred). Chrome UA is sent (not an identifying SEC-style UA).

### 1.2 Quotes — Yahoo spark (market-class, free/delayed-ish)

- `https://query1.finance.yahoo.com/v7/finance/spark` (`range=1d`, `interval=5m`)
- Universe: `DESK_TICKERS` (`symbols.ts`), batches of 12
- Kept: last, prevClose, change, changePct, spark, exchange, print `asOf` (`regularMarketTime`)
- `quoteState`: live &lt;20m / last &lt;26h / stale
- **ToS risk:** unofficial JSON; keep as the **existing** tape only. Do not add more unofficial quote vendors. Prefer FRED / Treasury official series for rates/commodities confirmation after greenlight.

### 1.3 Classification today

`evidence.ts` maps **title heuristics** → `EvidenceClass` (`narrative` | `fundamental` | `market` | `expectation`). No dedicated adapters per class.

`headlineToEvidence` now stamps dual clocks and sets `delayed` via `computeDelayedFlag` with `inherentlyDelayed: true` for the RSS path (RSS default delayed = true). **Not** hardcoded `false` anymore. Quotes carry `eventTimeMs` / `availableTimeMs` on `LiveQuote`. Still no durable obs log / `buildDeskAsOf`.

---

## 2. TTLs and freshness

| Layer | Policy | Persistence |
|---|---|---|
| Quote cache | `QUOTE_TTL = 12s` | Process memory |
| News cache | `NEWS_TTL = 40s` | Process memory |
| Fetch timeouts | news 7s / spark 8s | — |
| Desk status | live vs degraded from quotes + headlines + session flags | Ephemeral |

Restart loses tape. No durable delayed archive yet → historical-replay claims are not product-ready.

---

## 3. asOf semantics (today)

| Surface | Today |
|---|---|
| `LiveDesk.asOf` | `Date.now()` at build (wall clock) |
| `LiveQuote.asOf` | Yahoo print time; also `eventTimeMs` + `availableTimeMs` |
| `LiveHeadline.published` | RSS pub time; also `eventTimeMs` + `availableTimeMs` (ingest watermark = fetch instant) |
| Dual clocks on objects | **Present** on headline/quote/evidence DTOs |
| Durable I(T) | **Absent** — no obs log, no `buildDeskAsOf(T)` |
| `EvidenceItem.delayed` | RSS path: `computeDelayedFlag` (inherently delayed) |

**Model Design requirement:** freeze information at T; only data available by T; never rewrite historical predictions.  
**Target invariant (design):** I(T) = { obs \| `available_time` ≤ T }. Event-time-only filters leak publication lag.  
Implementation of the **ledger** is **blocked** until IMPLEMENTATION greenlight. Adapter **code** is also gated; this file may still catalog official feeds (docs only).

---

## 4. Gaps vs MODEL-DESIGN-v0.1

Mapped to the four evidence classes + delayed policy + historical-replay + crypto-as-node + progressive learning.

| Model Design requirement | Live coverage today | Gap |
|---|---|---|
| **1. Narrative** — news, speeches, filings, press, search | News RSS + Google News search RSS; Fed press | **Filings** adapter absent; speeches/press beyond RSS thin; search = Google News proxy only |
| **2. Fundamental** — inventories, production, capex, shipping, power, orders | Title heuristics only | **No fundamental delayed feeds** (EIA/FRED/BLS/etc.) |
| **3. Market** — price, volume, vol, OI, curves, options, RS | Yahoo spark last/prev/spark only | **No volume/vol/OI/curves/options/RS** depth; crowding market-structure thin (HANDOFF) |
| **4. Expectation** — prediction markets, analyst forecasts, implied distributions | Title heuristics (“odds”, “fedwatch”, …) | **No pred-market / forecast / implied-distribution adapters** |
| **24h delayed / free policy** | Free RSS + Yahoo; same-day free OK | Flag honest on RSS; no policy enforcement across ingest; Yahoo not officially delayed |
| **Historical-replay / freeze at T** | Clocks on DTOs only | No obs log, no `buildDeskAsOf(T)` — see ASOF + FREEZE-AT-T docs |
| **Progressive learning never rewrites history** | Fixture `/learning` only | Needs append-only snapshots (DS ledger) fed by honest I(T) |
| **Crypto as first-class node class** | CoinDesk narrative + liquid tickers in ontology | **No delayed crypto market / on-chain** depth; narrative ≠ market confirmation |
| **Feature materialization for DS/FinEng** | None | After I(T) exists (post-greenlight) |

### Priority for docs track (not a build order)

1. Honest inventory (this file) + delayed-evidence pass with DS/QA  
2. As-of / I(T) **contract** aligned to FREEZE-AT-T (design only)  
3. **Wait for CoS greenlight** before stamps / obs log / adapter **code**  
4. Stay non-blocking for UX mockup / demo desk  
5. New delayed adapters (filings, pred markets, on-chain, crypto depth) — **CoS-gated only** after docs  
6. Feature materialization after I(T)

---

## 5. Delayed-evidence pass — DS + QA (**LOCKED** design)

Status: DS §5b + QA confirm/amendments accepted. Docs only until CoS/Joshua sign-off.

### 5a. Must be as-of-correct for historical replay (v0)

- Headlines + quotes used in compose / cluster / book  
- Evidence on `RadarEvent` / `LiveBook`  
- Forecast / info-set snapshots used for scoring / ModelStats (`snapshotId` + `asOf` ms UTC)  
- Desk status derived from those inputs  
- **Add (QA):** derived book fields from those inputs — `marketReaction`, heat, sentiment — same I(T) or omit  
- **Add (QA):** returned desk must pass `assertNoFutureLeak(asOf, desk)` over headlines, quotes, and evidence  
- **Add (QA):** when overlay/rescore join as-of builds, their inputs too — until then, overlay/rescore stay **explicitly deferred (live-only path)**

**Hard refuse:** any obs with `available_time` > T inside I(T). Snapshots append-only; score rows point at `snapshotId` — never mutate.

### 5b. DS fields to score without future leak (v0)

**On every obs (headline + quote):** `obs_id`, `event_time` ms, `available_time` ms (gates as-of), `delayed`; headlines need `source`; quotes keep `symbol`/price; `evidence_class` / `direction` / `weight` optional in v0.

**On desk I(T) from `buildDeskAsOf(T)`:** `snapshotId`, `eventId`, `asOf` ms, `infoSetHash` (or hash inputs), `scenarios[{scenarioId,priorMass}]` Σ≈1 @ 0–1 / 6dp, `evidenceBatch` with `available_time≤T` only, `probability`, `importance`, `provenance`, `createdAt`.

**Also in I(T) v0:** only ≤T obs; masses+provenance at T; ids that fed the book.  
**Not in v0:** filings / PM / on-chain / crypto depth / feature store / UI scrubber.

Aligns `docs/FREEZE-AT-T-SCHEMA-v0.md`.

### 5c. DS calibration-feed priority (v0 Brier diet)

**Principle:** For v0 Brier, prioritize durable dual-clock obs of **today’s RSS+Yahoo** over new adapters. Minimum viable diet: persist current tape → freeze I(T) → thin resolved Brier by family → then expand feeds under CoS. Don’t build feature store or exotic feeds before freeze ledger.

| Priority | What | Notes |
|---|---|---|
| **P0** | Fed / primary policy RSS + Yahoo `DESK_TICKERS` + **persist all current tape** | Dual-clock obs first |
| **P1** | Wire / energy / defense RSS + CoinDesk | CoinDesk = delayed-honest crypto **narrative** only |
| **P2** | Demote Google News weight; filings + pred markets | Only **after** I(T) |
| **P3** | On-chain / crypto depth | Later |

Docs only until CoS greenlight.

### 5d. Deferred (OK)

Filings / pred-markets / on-chain / crypto-depth adapters; UI scrubber; feature store; pre-instrumentation backfill; overlay/rescore as-of join (live-only until scheduled).

### 5e. CI gate set (post CoS sign-off / impl only)

1. Future-leak: `available_time` > T never in `buildDeskAsOf(T)` (**event-time-only filter = fail**)  
2. Monotonic: T0→T1 only adds obs with `available_time` in (T0, T1]  
3. Identity: `buildDeskAsOf(T).asOf === T`  
4. Cold-start / empty obs log: live desk still builds (degraded OK)  
5. Schema: `EvidenceItem` exposes `eventTimeMs` + `availableTimeMs`; `delayed` not hardcoded false  
6. Path trigger: PRs touching `src/lib/live/**`, `EvidenceItem` in `src/data/types.ts`, and any new obs/as-of modules  
7. Runner prerequisite: fix `npm test` for Node 20 (glob + strip-types) so the gate is real — do not block on Grok sandbox script chrome fails  

---

## 6. Non-goals

- Implementing schema / obs log / EvidenceItem timestamp **ledger** before IMPLEMENTATION greenlight  
- New feed **adapter code** before IMPLEMENTATION greenlight  
- UI / live-edge / paid ultra-low-latency  
- Blocking UX mockup work  
- Hostile scraping, robots/ToS violations, inventing live prints  

---

## 7. Next actions

1. ~~DS/QA delayed-evidence pass~~ — **locked** (§5a–5e, incl. calibration diet)  
2. ~~CoS design sign-off~~ — done; awaiting separate **IMPLEMENTATION** greenlight (Joshua)  
3. Roadmap: keep **docs → wait** (v0.4); open decision #12 docs commit to remote when ready  
4. Data Eng: stand down ingest/ledger **code** until greenlight  
5. **Free Data:** ranked official-API catalog locked in §8 (this revision) — Platform secrets listed, no keys in repo  

**Changelog**

- 2026-09-14 — initial inventory from live layer; gaps vs CoS class list (pre-bible path)  
- 2026-09-14 — **re-diffed against `docs/MODEL-DESIGN-v0.1.md`**; status corrected to docs-only / CoS-gated impl  
- 2026-09-14 — §5 locked: DS §5b fields + QA must-list / CI amendments (gates 1–7)  
- 2026-09-14 — §5c DS calibration-feed priority (P0–P3 Brier diet); deferred→§5d; CI→§5e  
- 2026-09-14 — CoS DESIGN SIGN-OFF; impl still gated  
- 2026-09-14 — Free Data: filled coded RSS URLs; corrected dual-clock/`delayed` vs live code; added §8 ranked official adapters (docs only) + §9 rejects + §10 Platform secrets  

---

## 8. Ranked official adapter proposals (docs only)

**Policy:** Model Design 24h delayed/free — structural multi-day edge, not millisecond arb. Same-day **primary** sources OK where free. Prefer official APIs and licensed-public feeds. No paid live edge. No inventing prints.

**Build order vs ranking:** §5c still wins for **code**: persist today’s RSS+Yahoo → I(T) ledger **before** any new adapter. This table is the post-ledger wiring order, ranked by **value to the four evidence classes** minus **ToS / rate-limit / as-of-honesty / secret / live-edge risk**. Scores 1–5.

**Stamp rule for every future adapter:** `event_time` = provider timestamp (or vintage/period end); `available_time` = our first ingest sighting (never earlier); `delayed` per ASOF-REPLAY-v0. If provider omits event_time: `event_time = available_time` + `event_time_inferred = true`.

### 8.1 Ranked list (wire after I(T), unless noted)

| Rank | Adapter | Class | Official surface | Auth | Delay / as-of | Value | Risk | Why rank | Recommend |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **FRED + ALFRED vintages** | fundamental + market + calendar | `https://api.stlouisfed.org/fred/` — `series/observations`, `series/vintagedates`, `releases/dates`. Docs: `https://fred.stlouisfed.org/docs/api/fred/` | Free `api_key` (32-char). Platform: `FRED_API_KEY` | Publication lag by series. **Vintage dates are the honest available_time for revisions** — unique among free macros | 5 | 1 | Fills rates, FX, CPI, unrate, WTI (`DCOILWTICO`), VIX (`VIXCLS`), T10Y2Y, DTWEXBGS without Yahoo. 120 req/min documented. Attribution/ToS: St. Louis Fed | **yes-now (docs)** |
| 2 | **Treasury par yield curve XML** | market | `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=2026` and daily file `https://home.treasury.gov/sites/default/files/interest-rates/yield.xml`. Docs: `https://home.treasury.gov/treasury-daily-interest-rate-xml-feed` | none | Daily official close — inherently delayed, dual-clock clean (`record date` vs ingest) | 5 | 1 | Honest curve vs Yahoo `^TNX` last. Complements FRED DGS* | **yes-now (docs)** |
| 3 | **EIA Open Data v2** | fundamental | `https://api.eia.gov/v2/{route}/data?api_key=`. Docs: `https://www.eia.gov/opendata/documentation.php`. Register: `https://www.eia.gov/opendata/register.php`. Bulk zip (no key): `https://api.eia.gov/bulk/` | Free `api_key` in **query string only**. Platform: `EIA_API_KEY` | Weekly petroleum / gas inventories, production, power — publication lag days. Never live prints | 5 | 1 | Primary fill for inventories/production/power. Key auto-suspends if hammered; cache + throttle | **yes-now (docs)** |
| 4 | **SEC EDGAR `data.sec.gov`** | narrative (filings) | `https://data.sec.gov/submissions/CIK##########.json`; tickers `https://www.sec.gov/files/company_tickers.json`; XBRL companyfacts. Official: `https://www.sec.gov/search-filings/edgar-application-programming-interfaces` | none. **Required** identifying `User-Agent: Neural-Energies RippleRadar contact@…`. Fair access ≤10 req/s | Filings as disseminated (seconds–minutes processing). `filingDate` / `acceptanceDateTime` = event_time; ingest = available_time | 5 | 2 | Closes filings gap. Risk is UA/rate 403s if we ship a browser UA. Use bulk zips for backfill | **yes-now (docs)** — after I(T) per §5c P2 |
| 5 | **BLS Public API v2** | fundamental | `POST https://api.bls.gov/publicAPI/v2/timeseries/data/`. Docs: `https://www.bls.gov/developers/api_signature_v2.htm`. Register: `https://data.bls.gov/registrationEngine/` | Free `registrationKey`. Platform: `BLS_API_KEY` | CPI, payrolls, PPI — scheduled monthly/weekly, delayed by construction. Release calendar via FRED `releases/dates` | 4 | 1 | Official labor/inflation. Registered: 500 queries/day, 50 series/query, 20 years/query | **yes-now (docs)** |
| 6 | **Treasury Fiscal Data** | fundamental | Base `https://api.fiscaldata.treasury.gov/services/api/fiscal_service` — `v2/accounting/od/debt_to_penny`, DTS cash `v1/accounting/dts/deposits_withdrawals_operating_cash`. Docs: `https://fiscaldata.treasury.gov/api-documentation/` | none (open; commercial OK) | Daily/monthly government finance. `record_date` vs ingest | 4 | 1 | TGA / debt / official FX rates. No key | **yes-now (docs)** |
| 7 | **CFTC COT (PRE)** | market (positioning / crowding) | Socrata: `https://publicreporting.cftc.gov/resource/kh3c-gbw2.json` (disaggregated combined), `jun7-fc8e.json` (legacy combined). Story: `https://publicreporting.cftc.gov/stories/s/r4w3-av2u` | none (reasonable use) | Weekly, delayed by design. `report_date` / `as_of_date` vs ingest | 4 | 2 | Only free official OI/positioning. Crowding gap in HANDOFF. Socrata SoQL `$limit`/`$where` | **yes-now (docs)** |
| 8 | **Federal Register API v1** | narrative (policy / sanctions / rules) | `https://www.federalregister.gov/api/v1/documents.json`. Docs: `https://www.federalregister.gov/developers/documentation/api/v1` | none | Publication date = event_time. Same-day primary, free | 4 | 1 | OFAC/EAR/tariff/executive-order primary text vs Google News | **yes-now (docs)** |
| 9 | **USGS earthquakes + NHC RSS** | narrative (kinetic / weather families) | USGS GeoJSON `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson` and FDSN `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson`. NHC Atlantic `https://www.nhc.noaa.gov/index-at.xml` (list: `https://www.nhc.noaa.gov/mobile/rss.html`) | none | USGS origin time vs ingest. NHC advisories are delayed-honest RSS | 4 | 1 | Event families already in engine (weather / kinetic) with no primary feed today | **yes-now (docs)** |
| 10 | **ECB official press RSS** | narrative | `https://www.ecb.europa.eu/rss/press.html` | none | RSS pubDate vs ingest | 3 | 1 | Non-Fed CB primary. Verify additional BoE/BoJ official RSS on their sites before adding | **yes-now (docs)** |
| 11 | **Polymarket Gamma (read-only)** | expectation | `https://gamma-api.polymarket.com/markets` (no auth). Docs: `https://docs.polymarket.com/api-reference/introduction`. Do **not** use CLOB/WS for live trading edge | none for Gamma list | Odds are live; **we must stamp delayed** and/or snapshot on a ≥15m (policy: treat as delayed evidence). Geo restrictions are for **order placement**, not reads | 5 | 3 | Only serious free expectation adapter. P2 after I(T). Risk: ToS/geo, sports noise, live prints temptation | **later** (after I(T); read-only + delayed stamp) |
| 12 | **Atlanta Fed GDPNow** | expectation | Page `https://www.atlantafed.org/cqer/research/gdpnow` (Excel/CSV published; **no REST**). Official nowcast | none | Model vintage = event_time; fetch = available_time | 3 | 2 | Honest nowcast vs title-heuristic “forecast”. Scrape-the-page is worse than downloading the published file; pin the official file URL when greenlit | **later** |
| 13 | **CoinGecko Demo** | crypto market (delayed) | `https://api.coingecko.com/api/v3/` with `x-cg-demo-api-key`. Docs: `https://docs.coingecko.com/` | Optional demo key. Platform: `COINGECKO_DEMO_KEY` | Not an exchange matching engine. Still not 24h delayed — **enforce our delay / `delayed=true`**. Attribution required | 4 | 3 | Complements CoinDesk narrative. P3. Prefer this over Binance public | **later** (P3) |
| 14 | **BEA API** | fundamental | `https://apps.bea.gov/api/data`. Signup: `https://apps.bea.gov/API/signup/` | Free key. Platform: `BEA_API_KEY` | Quarterly/annual NIPA. Vintage-sensitive (prefer FRED ALFRED when overlapping) | 3 | 1 | GDP/PCE primary. Overlaps FRED — use FRED first | **later** |
| 15 | **USDA NASS Quick Stats** | fundamental | `https://quickstats.nass.usda.gov/api` | Free key | Crop/livestock delayed official | 3 | 1 | Ag/DBA graph family. After energy/labor | **later** |
| 16 | **Philadelphia Fed SPF** | expectation | `https://www.philadelphiafed.org/surveys-and-data/real-time-data-research/survey-of-professional-forecasters` (quarterly files) | none | Quarterly; excellent as-of (release dates published) | 3 | 1 | Calibrated forecast panel, not live odds | **later** |

**Suggested first official bundle after I(T) (still CoS-gated):** FRED vintages + Treasury curve + EIA weekly petroleum + EDGAR 8-K/10-Q for `DESK_TICKERS` CIKs + BLS CPI/payrolls. That bundle hits classes 2–3 and filings without touching pred-markets or crypto depth.

### 8.2 Dual-clock notes that change ranking

- **FRED `series/vintagedates` / ALFRED** is ranked #1 because freeze-at-T on macro prints is otherwise a revision leak (event_time-only CPI is a fail).  
- **EDGAR `acceptanceDateTime`** is the filing event_time; our fetch is available_time. Never filter I(T) on `filingDate` alone.  
- **Polymarket / CoinGecko** can look “live.” Product policy: ingest as delayed evidence even if the HTTP payload is current. No websockets.

### 8.3 Existing tape — keep, don’t expand unofficially

| Keep | Do not expand |
|---|---|
| Current RSS list (Fed press is P0) | More Google News queries |
| Yahoo spark for `DESK_TICKERS` | Extra unofficial Yahoo endpoints, chart APIs, crumb hacks |
| CoinDesk RSS as crypto **narrative** | Exchange websockets “just for BTC” |

---

## 9. Rejects / high-risk (do not scrape)

| Source | Why no |
|---|---|
| CME FedWatch (site scrape) | No official API; ToS/hostile scrape; expectation class is better served by Polymarket Gamma + FOMC primary |
| Binance / Bybit / Coinbase WS or REST last | Paid-quality **live edge**; violates delayed/free policy unless we artificially delay ≥24h **and** still risk ToS. Use CoinGecko delayed + CoinDesk narrative |
| Investing.com / ForexFactory / TradingEconomics calendars | ToS / scrape. Use FRED `releases/dates` + BLS/EIA/Fed published calendars |
| MarineTraffic / paid AIS | Paid; ToS. NOAA AIS (US waters) is a later research item, not v0 |
| Glassnode / CryptoQuant / paid on-chain | Paid live edge. P3 only via free surfaces (e.g. mempool.space) if ever |
| NewsAPI / paid wires / Bloomberg API | Paid. Stay on official + current RSS |
| Alpha Vantage / Twelve Data as **primary** quotes | Unofficial aggregators, tiny free quotas. FRED/Treasury first; Yahoo stays the existing tape |

---

## 10. Platform secrets / rate limits (when greenlit — do not commit keys)

| Secret / config | Adapter | Notes |
|---|---|---|
| `FRED_API_KEY` | FRED | Distinct key per app; 120 req/min; cache observations; use bulk/ALFRED vintages sparingly |
| `EIA_API_KEY` | EIA v2 | Query-string only; throttle; prefer bulk zip for history |
| `BLS_API_KEY` | BLS v2 | 500 queries/day registered |
| `BEA_API_KEY` | BEA | Later |
| `USDA_NASS_KEY` | NASS | Later |
| `COINGECKO_DEMO_KEY` | CoinGecko | Header `x-cg-demo-api-key`; attribution |
| `SEC_USER_AGENT` | EDGAR | Not a secret; identifying `AppName contact@domain`. **Must not** reuse the Chrome UA in `build.server.ts` |

Coordinate rate-limiters and secret storage with **Ripple Platform**. Coordinate obs schema / `available_time` with **Ripple Data Eng**. Coordinate feature columns with **DS / FinEng** after I(T).

