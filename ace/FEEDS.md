# ACE data feeds

Every source here was probed from this container and is recorded with what it
actually returned — not what its documentation claims. All are free; two need
a key you already hold.

## Wired and validated

| Feed | Key | Coverage | Adapter | Use |
|---|---|---|---|---|
| **FRED / ALFRED** | yes | 1985→ daily | `ace/data/alfred.py`, `fred_market.py` | Market panel (16 channels), macro vintages, news-text uncertainty indices |
| **USGS earthquakes** | no | 1990→, 17,714 M5.5+ | `ace/feeds/usgs.py` | Natural-disaster events; **validation set for the cascade engine** |
| **GDELT 2.0 Events** | no | 2015-02-18→, 399,205 files | `ace/feeds/gdelt.py` | Machine-coded global news events: CAMEO code, actors, geography, tone, Goldstein scale |

### Why GDELT matters most
It is the event database the probability engines need and the app's own RSS
archive cannot be — that archive is a rolling window that started weeks ago.
GDELT supplies typed, timestamped, actor-attributed events back to 2015, which
is what Hawkes, competing-risks, Dynamic Bayesian Networks and hierarchical
Bayes all require to be *fitted* rather than merely implemented.

One 15-minute export yields ~950 events. A full year is ~35,000 files, so
backfill is a paced background job — GDELT asks for one request per five
seconds and the adapter enforces it.

### Why USGS matters
Aftershock sequences are the canonical self-exciting point process; the ETAS
model was invented for them. Fitting Hawkes to earthquakes tests the engine
against the domain it was designed for. Result on 2,290 M6.0+ events
(2010–2025): branching ratio 0.107, LR statistic 454.5 (p ≈ 0), Ogata
residuals Exp(1) with KS p = 0.187, excitation half-life 43 minutes. The
engine is correct.

## Also wired (`ace/feeds/public.py`)

| Feed | Key | Verified | Use |
|---|---|---|---|
| **SEC EDGAR** | no | 16,997 8-K filings, 2024Q1 | Corporate material-event stream with exact filing timestamps |
| **NWS / weather.gov** | no | 444 active alerts | Live US weather warnings as typed events. **Live only** — no deep history from this API |
| **Treasury FiscalData** | no | 1,000 rows | Rates, issuance, debt operations |
| **World Bank** | no | annual series | Country context for hierarchical pooling |
| **CoinGecko** | no | 366 daily prices | Crypto history. Free tier caps the window |

### GDELT ingestion: use the DAILY export, not the 15-minute one

The 2.0 feed publishes every 15 minutes — ~35,000 files a year, which at
GDELT's requested 5s pacing is two days of fetching per year. The 1.0 **daily**
export carries a full day in one file of ~100,000 events, so a decade is ~4,000
files rather than ~350,000. Same CAMEO coding, same actors, same tone.

The two schemas are **not interchangeable**. The 1.0 daily file has 58 columns
and puts `DATEADDED` and `SOURCEURL` at 56/57, where 2.0 puts geography.
Reading 2.0's positions against a 1.0 file silently places a source URL in the
latitude field — a pipeline that runs fine and produces wrong data. Verified
against real files and pinned by a test.

`ace/feeds/backfill_gdelt.py` is resumable (each day caches under its own
filter tag) and filters at ingest, since an unfiltered day is ~8 MB of mostly
low-mention routine coverage.

## Probed and rejected

| Feed | Why |
|---|---|
| Yahoo Finance chart | Rate-limits a bulk historical pull hard enough to be undependable. FRED replaced it as the market source. |
| Stooq | Not reachable from this container. |
| Open-Meteo archive | HTTP 429 — hourly limit exceeded on a shared address. |
| Wikipedia pageviews | HTTP 429 on a shared address. Viable from a dedicated IP. |

## Discipline

Adapters cache to `artifacts/cache/` keyed by request, so a rebuilt dataset is
reproducible from the same bytes. Every adapter raises `FeedUnavailable`
rather than returning a partial or imputed frame — a caller surfaces the gap
instead of filling it.
