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

## Probed, reachable, not yet wired

| Feed | Key | Returned | Candidate use |
|---|---|---|---|
| NWS / weather.gov alerts | no | 200, 55 KB | Live US weather warnings as typed events |
| SEC EDGAR full-index | no | 200 | Corporate filing events (8-K as a material-event stream) |
| Treasury FiscalData | no | 200 | Issuance, rates, debt operations |
| World Bank indicators | no | 200 | Country macro context for hierarchical pooling |
| CoinGecko | no | 200 | Crypto price history |

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
