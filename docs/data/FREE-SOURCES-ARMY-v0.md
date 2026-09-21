# Free sources army — v0

**Owner:** Ripple Free Data (catalog)  
**Partner:** Ripple Data Eng (ingest / as-of stamps — only after CoS greenlights a **specific** adapter)  
**Status:** catalog + **FRED+ALFRED adapter landed** on `main` @ `4782bce` (Data Eng PR #1). Other P0 adapters still hold. Live fetches wait on `FRED_API_KEY`.  
**Date:** 2026-09-21  
**Policy:** Model Design 24h delayed/free. Prefer official APIs. No paywall bypass, no credential stuffing, no invented prints. Mark `delayed` honestly.  
**Live tape (already on):** `docs/data/FEED-INVENTORY.md` §1 · `src/lib/live/build.server.ts`  
**Stamp contract (every new feed):** `eventTimeMs` (fact/print) · `availableTimeMs` (first ingest sighting) · `delayed` via `computeDelayedFlag` (`src/lib/live/evidence.ts`). No step-2 obs log.

---

## Ranking formula

**Score = trader usefulness × reliability × legal cleanliness ÷ rate-limit pain** (each 1–5).  
P0 = wire **after** I(T) ledger + CoS greenlight of that adapter. P1 = next. P2 = later / delayed-stamp required.  
§5c Brier diet still wins for **code order**: persist today’s RSS+Yahoo before any new adapter.

| Band | Meaning |
|---|---|
| **P0** | Official, delayed-honest, fills a class gap, low ToS/rate pain — top 5 to greenlight first |
| **P1** | Official or licensed-public; slightly more pain or narrower desk value |
| **P2** | Free but live-looking, ToS/geo, or overlaps FRED — stamp delayed; not tonight |
| **Reject** | Scrape, paid live edge, paywall, unofficial quote farms as primary |

---

## P0 — top 5

| # | Source | Class | Official surface | Auth / limits | Delayed / as-of | U×R×L / pain | Why P0 |
|---|---|---|---|---|---|---|---|
| 1 | **FRED + ALFRED vintages** ✅ **landed** | fundamental + market + calendar | Code: `src/lib/live/fred.server.ts` → `fetchFredSeriesBundle` · series `CPIAUCSL` `UNRATE` `VIXCLS` `DCOILWTICO` `T10Y2Y` `DGS10` · API `https://api.stlouisfed.org/fred/` | Free `FRED_API_KEY` (empty → soft degrade) | `eventTimeMs`=obs date; `availableTimeMs`=ALFRED `realtime_start`; `delayed=true` always | 5×5×5 / 2 | On `main` @ `4782bce`. Live prints wait on Joshua key |
| 2 | **Treasury par yield curve XML** | market | `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=2026` · daily `https://home.treasury.gov/sites/default/files/interest-rates/yield.xml`. Docs: `https://home.treasury.gov/treasury-daily-interest-rate-xml-feed` | none | Daily official close. `record date` vs ingest | 5×5×5 / 1 | Honest curve vs Yahoo `^TNX` |
| 3 | **EIA Open Data v2** | fundamental | `https://api.eia.gov/v2/{route}/data?api_key=`. Docs: `https://www.eia.gov/opendata/documentation.php`. Bulk (no key): `https://api.eia.gov/bulk/` | Free `EIA_API_KEY` in **query string**. Auto-suspend if hammered | Weekly petroleum/gas, production, power — days of lag | 5×5×5 / 2 | Inventories/production/power gap |
| 4 | **SEC EDGAR `data.sec.gov`** | narrative (filings) | `https://data.sec.gov/submissions/CIK##########.json` · tickers `https://www.sec.gov/files/company_tickers.json`. Official: `https://www.sec.gov/search-filings/edgar-application-programming-interfaces` | none. Identifying `User-Agent: Neural-Energies RippleRadar contact@…`. ≤10 req/s | `acceptanceDateTime` = event_time; ingest = available_time | 5×5×5 / 3 | Filings gap. Do **not** reuse Chrome UA in `build.server.ts` |
| 5 | **BLS Public API v2** | fundamental | `POST https://api.bls.gov/publicAPI/v2/timeseries/data/`. Docs: `https://www.bls.gov/developers/api_signature_v2.htm`. Register: `https://data.bls.gov/registrationEngine/` | Free `BLS_API_KEY`. 500 queries/day registered, 50 series/query | CPI / payrolls / PPI — scheduled lag. Calendar via FRED `releases/dates` | 4×5×5 / 2 | Official labor/inflation |

**Landed:** #1 FRED+ALFRED only (`4782bce`). **Still CoS-gated:** #2–5. No pred-markets, no crypto depth, no step-2 obs log.

---

## Already on the desk (do not rebuild tonight)

### News / RSS — 16 feeds coded

BBC World/Business, NYT World/Business, Al Jazeera, OilPrice, CNBC World/Markets, Defense One, Guardian World/Business, Reuters World/Business, **Fed `press_all.xml` (P0 policy primary)**, CoinDesk (crypto **narrative** only), Google News search (demote weight).

**RSS expansions (P1, official only — not more Google News):** ECB press `https://www.ecb.europa.eu/rss/press.html`; USGS M4.5+ GeoJSON `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson`; NHC Atlantic `https://www.nhc.noaa.gov/index-at.xml`; Federal Register `https://www.federalregister.gov/api/v1/documents.json`. Verify BoE/BoJ official RSS on-site before adding.

### Markets — Yahoo spark (keep, don’t expand unofficially)

`query1.finance.yahoo.com/v7/finance/spark` · `DESK_TICKERS` · unofficial JSON ToS risk. **Keep as existing tape.** Prefer FRED/Treasury for rates/commodities confirmation. No extra Yahoo crumbs, no Alpha Vantage/Twelve Data as primary.

### Crypto — CoinDesk RSS only

Narrative class. Market confirmation waits for CoinGecko demo (P2) with **forced `delayed=true`**. No exchange websockets.

---

## P1 — next official army

| Source | Class | Surface | Auth | Pain | Note |
|---|---|---|---|---|---|
| Treasury Fiscal Data | fundamental | `https://api.fiscaldata.treasury.gov/services/api/fiscal_service` — `debt_to_penny`, DTS cash | none (commercial OK) | 1 | TGA / debt |
| CFTC COT PRE | market (crowding) | `https://publicreporting.cftc.gov/resource/kh3c-gbw2.json` (disagg), `jun7-fc8e.json` (legacy) | none | 2 | Weekly positioning. Only free official OI |
| Federal Register API v1 | narrative (policy) | `https://www.federalregister.gov/api/v1/documents.json` | none | 1 | Rules / sanctions / EO primary |
| USGS + NHC | narrative (kinetic / weather) | USGS GeoJSON + NHC RSS (URLs above) | none | 1 | Families the engine already has |
| ECB press RSS | narrative | `https://www.ecb.europa.eu/rss/press.html` | none | 1 | Non-Fed CB primary |

---

## P2 — later (free + ToS-OK, delayed stamp required)

| Source | Class | Surface | Caveat |
|---|---|---|---|
| Polymarket Gamma **read-only** | expectation | `https://gamma-api.polymarket.com/markets` · docs `https://docs.polymarket.com/api-reference/introduction` | Odds are live-looking. **Stamp delayed.** No CLOB/WS. Geo limits are for **orders**, not reads |
| CoinGecko Demo | crypto market | `https://api.coingecko.com/api/v3/` + `x-cg-demo-api-key` | Attribution. Enforce delay / `delayed=true`. Prefer over Binance public |
| Atlanta Fed GDPNow | expectation | `https://www.atlantafed.org/cqer/research/gdpnow` (published file, no REST) | Pin official file URL when greenlit; don’t scrape the page |
| BEA API | fundamental | `https://apps.bea.gov/api/data` | Overlaps FRED — use FRED first |
| USDA NASS | fundamental | `https://quickstats.nass.usda.gov/api` | Ag/DBA family |
| Philadelphia Fed SPF | expectation | SPF page (quarterly files) | Excellent as-of; quarterly only |

---

## Rejects (hard)

| No | Why |
|---|---|
| CME FedWatch scrape | No official API; ToS. Use FOMC primary + Polymarket Gamma later |
| Binance / Bybit / Coinbase WS or REST last | Live edge. Policy fail |
| Investing.com / ForexFactory / TradingEconomics calendars | Scrape/ToS. Use FRED `releases/dates` |
| MarineTraffic / paid AIS | Paid |
| Glassnode / CryptoQuant | Paid on-chain |
| NewsAPI / Bloomberg / paid wires | Paid |
| Alpha Vantage / Twelve Data as **primary** quotes | Unofficial, tiny quotas |
| Paywalled RSS full text | No bypass |
| Credential stuffing / shared keys | One app key per official API, Platform-held |

---

## Stamp rules for Data Eng (when a P0 is greenlit)

1. `eventTimeMs` = provider timestamp (FRED observation / vintage, Treasury record date, EIA period, EDGAR `acceptanceDateTime`, BLS period).  
2. `availableTimeMs` = our first successful fetch — **never earlier**.  
3. `delayed` = true for RSS, filings, `kind` in {filing, data}, or lag ≥15m (`computeDelayedFlag`). Yahoo spark may be false only inside existing `quoteState` “live” band — still no paid live edge.  
4. Missing provider time → `eventTimeMs = availableTimeMs` + `eventTimeInferred = true`.  
5. FRED revisions: **ALFRED / `vintagedates`**, not event-time-only CPI (QA fail).  
6. EDGAR: never I(T)-filter on `filingDate` alone.  
7. No step-2 obs log in this track.

---

## Platform secrets (when greenlit — never in repo)

| Name | Adapter |
|---|---|
| `FRED_API_KEY` | FRED |
| `EIA_API_KEY` | EIA v2 (query string) |
| `BLS_API_KEY` | BLS v2 |
| `SEC_USER_AGENT` | EDGAR identifying UA (not a secret; must not be Chrome UA) |
| `COINGECKO_DEMO_KEY` | P2 |
| `BEA_API_KEY` / `USDA_NASS_KEY` | P2 |

---

## Tonight vs later

| Do now | Do not |
|---|---|
| Catalog status (this file) | Touch FEED-INVENTORY (Data Eng / CoS) |
| Mark FRED landed after merge | Other P0 adapters / obs log |
| Wait on Platform for `FRED_API_KEY` live | Fan-out five builds |

**Changelog**

- 2026-09-14 — v0 army: P0 five (FRED, Treasury curve, EIA, EDGAR, BLS); P1 official expansions; P2 delayed-stamp; rejects locked.
- 2026-09-21 — FRED+ALFRED adapter-landed on `main` @ `4782bce` (Data Eng PR #1). Catalog mark only; FEED-INVENTORY untouched. Live waits on `FRED_API_KEY`. Other P0s hold.
