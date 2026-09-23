"""Remaining free public feeds, wired.

Each was probed from this container and is included only because it actually
returned data. Every fetch caches by request hash and raises FeedUnavailable
rather than returning a partial frame — a caller surfaces the gap instead of
filling it.

  NWS / weather.gov   live US weather alerts as typed, timestamped events
  SEC EDGAR           filing index; 8-K is a corporate material-event stream
  Treasury FiscalData rates, issuance and debt operations
  World Bank          country indicators, for hierarchical pooling across
                      comparable economies
  CoinGecko           crypto price history
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
import urllib.request

import pandas as pd

from ace.config import CACHE

_UA = "AlphaRecon-Research/1.0 (research@neuralenergies.com)"


class FeedUnavailable(RuntimeError):
    pass


def _get_json(url: str, *, cache_key: str | None = None, timeout: int = 45, pace: float = 0.0) -> dict:
    key = cache_key or url
    path = CACHE / f"pub_{hashlib.sha256(key.encode()).hexdigest()[:16]}.json"
    if path.exists():
        return json.loads(path.read_text())
    if pace:
        time.sleep(pace)
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/json"})
    last: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                payload = json.loads(r.read().decode())
            path.write_text(json.dumps(payload))
            return payload
        except Exception as e:
            last = e
            time.sleep(2 ** attempt)
    raise FeedUnavailable(f"{url.split('?')[0]}: {last}")


# ----------------------------------------------------------------- weather --
def nws_alerts(area: str | None = None, *, active: bool = True) -> pd.DataFrame:
    """US weather alerts. Live only — the NWS API does not serve deep history.

    Useful as a real-time typed event stream; not a training set. Historical
    severe-weather events would need NOAA's archive, which is a separate bulk
    download rather than an API.
    """
    base = "https://api.weather.gov/alerts/active" if active else "https://api.weather.gov/alerts"
    url = f"{base}?area={area}" if area else base
    payload = _get_json(url, cache_key=f"nws:{url}:{int(time.time() // 900)}")
    feats = payload.get("features") or []
    rows = []
    for f in feats:
        p = f.get("properties") or {}
        rows.append({
            "id": p.get("id"),
            "event": p.get("event"),
            "severity": p.get("severity"),
            "certainty": p.get("certainty"),
            "urgency": p.get("urgency"),
            "onset": pd.to_datetime(p.get("onset"), utc=True, errors="coerce"),
            "expires": pd.to_datetime(p.get("expires"), utc=True, errors="coerce"),
            "sent": pd.to_datetime(p.get("sent"), utc=True, errors="coerce"),
            "area": p.get("areaDesc"),
            "headline": (p.get("headline") or "")[:200],
        })
    if not rows:
        return pd.DataFrame(columns=["id", "event", "severity", "onset", "expires", "sent", "area", "headline"])
    return pd.DataFrame(rows).sort_values("sent", ascending=False).reset_index(drop=True)


# -------------------------------------------------------------- treasury ----
def treasury_rates(*, page_size: int = 1000) -> pd.DataFrame:
    """Average interest rates on Treasury securities, monthly back to 2001."""
    url = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
           f"/v2/accounting/od/avg_interest_rates?page[size]={page_size}&sort=-record_date")
    payload = _get_json(urllib.parse.quote(url, safe=":/?&=[]-,"))
    data = payload.get("data") or []
    if not data:
        raise FeedUnavailable("Treasury: empty response")
    df = pd.DataFrame(data)
    df["record_date"] = pd.to_datetime(df["record_date"], utc=True, errors="coerce")
    df["avg_interest_rate_amt"] = pd.to_numeric(df.get("avg_interest_rate_amt"), errors="coerce")
    return df.dropna(subset=["record_date"]).sort_values("record_date").reset_index(drop=True)


# ------------------------------------------------------------- world bank ---
def world_bank(indicator: str, country: str = "all", *, start: int = 2000, end: int = 2026) -> pd.DataFrame:
    """World Bank indicator series. Annual; used as slow-moving context."""
    url = (f"https://api.worldbank.org/v2/country/{country}/indicator/{indicator}"
           f"?format=json&per_page=20000&date={start}:{end}")
    payload = _get_json(url)
    if not isinstance(payload, list) or len(payload) < 2 or not payload[1]:
        raise FeedUnavailable(f"World Bank {indicator}: no data")
    rows = [{
        "country": (r.get("country") or {}).get("value"),
        "iso3": r.get("countryiso3code"),
        "year": int(r["date"]) if str(r.get("date", "")).isdigit() else None,
        "value": r.get("value"),
        "indicator": indicator,
    } for r in payload[1]]
    df = pd.DataFrame(rows).dropna(subset=["year"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.sort_values(["iso3", "year"]).reset_index(drop=True)


# ------------------------------------------------------------------ crypto --
def coingecko_history(coin: str = "bitcoin", *, days: int = 365, vs: str = "usd") -> pd.DataFrame:
    """Daily crypto price history. Free tier caps the window; it is not deep."""
    url = (f"https://api.coingecko.com/api/v3/coins/{coin}/market_chart"
           f"?vs_currency={vs}&days={days}&interval=daily")
    payload = _get_json(url, pace=1.5)
    prices = payload.get("prices") or []
    if not prices:
        raise FeedUnavailable(f"CoinGecko {coin}: no prices")
    df = pd.DataFrame(prices, columns=["ms", "price"])
    df["date"] = pd.to_datetime(df["ms"], unit="ms", utc=True)
    return df[["date", "price"]].sort_values("date").reset_index(drop=True)


# -------------------------------------------------------------- sec edgar ---
def edgar_filings(year: int, quarter: int, *, form_type: str = "8-K") -> pd.DataFrame:
    """Corporate filings from the EDGAR full index.

    8-K is the material-event form: a company files one when something happens
    it must disclose. That makes it a genuine corporate event stream with
    exact timestamps, which is what a point-process model needs.
    """
    url = f"https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{quarter}/form.idx"
    path = CACHE / f"edgar_{year}Q{quarter}.idx"
    if not path.exists():
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                path.write_bytes(r.read())
        except Exception as e:
            raise FeedUnavailable(f"EDGAR {year}Q{quarter}: {e}") from e

    rows = []
    for line in path.read_text(errors="ignore").splitlines():
        if not line.strip() or line.startswith(("Form Type", "-")):
            continue
        # Fixed-width index: form type, company, CIK, date filed, file name
        ft = line[:12].strip()
        if form_type and ft != form_type:
            continue
        rows.append({
            "form_type": ft,
            "company": line[12:74].strip(),
            "cik": line[74:86].strip(),
            "date_filed": line[86:98].strip(),
            "filename": line[98:].strip(),
        })
    if not rows:
        raise FeedUnavailable(f"EDGAR {year}Q{quarter}: no {form_type} rows parsed")
    df = pd.DataFrame(rows)
    df["date_filed"] = pd.to_datetime(df["date_filed"], utc=True, errors="coerce")
    return df.dropna(subset=["date_filed"]).sort_values("date_filed").reset_index(drop=True)
