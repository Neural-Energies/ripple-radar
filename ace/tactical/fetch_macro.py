"""Rebuild the committed macro panel from the public sources.

    python -m ace.tactical.fetch_macro

CPI and nonfarm payrolls are the Philadelphia Fed's monthly real-time
vintages (the first column in which an observation appears is the first
release). The FOMC surprise is the front 30-day fed-funds future from
Yahoo, on the Federal Reserve's statement dates. The news series is the
Baker, Bloom and Davis daily news index from policyuncertainty.com.

FRED's graph download did not answer from the research environment, so
none of these files is a FRED pull. openpyxl is required for the two
workbooks and is not a runtime dependency of the backtest.
"""
from __future__ import annotations

import calendar
import json
import re
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ace.config import CACHE
from ace.tactical.data import DATA_DIR, fetch_yahoo

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
_PCPI = "https://www.philadelphiafed.org/-/media/FRBP/Assets/Surveys-And-Data/real-time-data/data-files/xlsx/pcpiMvMd.xlsx"
_EMPLOY = "https://www.philadelphiafed.org/-/media/FRBP/Assets/Surveys-And-Data/real-time-data/data-files/xlsx/employMvMd.xlsx"
_EPU = "https://www.policyuncertainty.com/media/All_Daily_Policy_Data.csv"
_FED = "https://www.federalreserve.gov"

RELEASES_PATH = DATA_DIR / "macro_releases.csv"
EPU_PATH = DATA_DIR / "epu_monthly.csv"
CATALOG_PATH = DATA_DIR / "naive_catalog.json"
SOURCES_PATH = DATA_DIR / "macro_sources.json"


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    last: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001 — retry the public file
            last = exc
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"failed to download {url}") from last


def _cache_bytes(name: str, url: str) -> Path:
    path = CACHE / "tactical" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.stat().st_size < 1000:
        path.write_bytes(_get(url))
    return path


def _vintage_month(token: str) -> pd.Timestamp:
    match = re.search(r"(\d{2})M(\d{1,2})$", str(token))
    if match is None:
        raise ValueError(token)
    yy, month = int(match.group(1)), int(match.group(2))
    year = 1900 + yy if yy >= 30 else 2000 + yy
    last = calendar.monthrange(year, month)[1]
    return pd.Timestamp(year=year, month=month, day=last)


def _first_prints(path: Path) -> pd.DataFrame:
    frame = pd.read_excel(path, sheet_name=0, header=0)
    obs = []
    for raw in frame.iloc[:, 0]:
        text = str(raw)
        if ":" not in text:
            obs.append(pd.NaT)
            continue
        year, month = text.split(":")
        obs.append(pd.Timestamp(year=int(year), month=int(month), day=1))
    frame.index = pd.DatetimeIndex(obs)
    frame = frame[frame.index.notna()]
    rows = []
    seen: set[pd.Timestamp] = set()
    columns = []
    for col in frame.columns[1:]:
        columns.append((_vintage_month(str(col)), col))
    for available, col in sorted(columns):
        series = pd.to_numeric(frame[col], errors="coerce")
        for stamp, value in series.items():
            stamp = pd.Timestamp(stamp)
            if pd.isna(value) or stamp in seen:
                continue
            prev = stamp - pd.offsets.MonthBegin(1)
            year_ago = stamp - pd.offsets.MonthBegin(12)
            rows.append(
                {
                    "obs": stamp,
                    "available_on": available,
                    "level": float(value),
                    "level_prev": series.get(prev, np.nan),
                    "level_yoy": series.get(year_ago, np.nan),
                }
            )
            seen.add(stamp)
    return pd.DataFrame(rows).sort_values("obs")


def _cpi_rows(prints: pd.DataFrame) -> list[dict]:
    rows = []
    for record in prints.itertuples(index=False):
        if not np.isfinite(record.level_prev) or record.level_prev <= 0:
            continue
        if record.available_on <= record.obs + pd.offsets.MonthEnd(0):
            raise RuntimeError(f"CPI vintage {record.available_on.date()} is not after {record.obs.date()}")
        mom = 100.0 * (record.level / record.level_prev - 1.0)
        yoy = np.nan
        if np.isfinite(record.level_yoy) and record.level_yoy > 0:
            yoy = 100.0 * (record.level / record.level_yoy - 1.0)
        rows.append(
            {
                "series": "cpi",
                "obs_period": record.obs.strftime("%Y-%m"),
                "available_on": record.available_on.strftime("%Y-%m-%d"),
                "actual": round(float(mom), 6),
                "state": None if not np.isfinite(yoy) else round(float(yoy), 6),
            }
        )
    return rows


def _nfp_rows(prints: pd.DataFrame) -> list[dict]:
    rows = []
    for record in prints.itertuples(index=False):
        if not np.isfinite(record.level_prev):
            continue
        if record.available_on <= record.obs + pd.offsets.MonthEnd(0):
            raise RuntimeError(f"payroll vintage {record.available_on.date()} is not after {record.obs.date()}")
        change = float(record.level - record.level_prev)
        growth = np.nan
        if np.isfinite(record.level_yoy):
            growth = float(record.level - record.level_yoy)
        rows.append(
            {
                "series": "nfp",
                "obs_period": record.obs.strftime("%Y-%m"),
                "available_on": record.available_on.strftime("%Y-%m-%d"),
                "actual": round(change, 3),
                "state": None if not np.isfinite(growth) else round(growth, 3),
            }
        )
    return rows


def _statement_urls() -> dict[str, str]:
    """Press-release URLs whose title is an FOMC statement, not a facility note."""
    pages = [_get(f"{_FED}/monetarypolicy/fomccalendars.htm")]
    for year in range(2004, 2021):
        pages.append(_get(f"{_FED}/monetarypolicy/fomchistorical{year}.htm"))
        time.sleep(0.08)
    found: dict[str, str] = {}
    for html in pages:
        text = html.decode("utf-8", "replace")
        for href in re.findall(r'href="([^"]+)"', text):
            low = href.lower()
            if "monetary" not in low or "press" not in low:
                continue
            if any(token in low for token in ("minute", "beige", "material", "pdf", "zip")):
                continue
            if not (low.endswith("a.htm") or low.endswith("b.htm") or low.endswith("/default.htm")):
                continue
            match = re.search(r"(20\d{6})", href)
            if match is None:
                continue
            full = href if href.startswith("http") else _FED + href
            found.setdefault(match.group(1), full)
    kept: dict[str, str] = {}
    for stamp, url in sorted(found.items()):
        page = _get(url).decode("utf-8", "replace")
        title_match = re.search(r"<title>(.*?)</title>", page, re.S | re.I)
        title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
        if "fomc statement" in title.lower():
            kept[stamp] = url
        time.sleep(0.04)
    return kept


def _zq_ohlc() -> pd.DataFrame:
    fetch_yahoo("ZQ=F", start="2004-01-01")
    payload = json.loads((CACHE / "tactical" / "ZQ_F.json").read_text())
    result = payload["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    index = (
        pd.to_datetime(result["timestamp"], unit="s", utc=True)
        .tz_convert("America/New_York")
        .normalize()
        .tz_localize(None)
    )
    frame = pd.DataFrame({"open": quote["open"], "close": quote["close"]}, index=index)
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    return frame.astype(float)


def _fomc_rows(urls: dict[str, str], zq: pd.DataFrame) -> list[dict]:
    """Implied-rate change on the statement session.

    The continuous contract splices on the first three calendar days of the
    month (that is where the large one-day jumps sit). On those sessions the
    surprise is the open-to-close move, so the overnight splice is not a
    policy surprise. On every other session it is the close-to-close move,
    which keeps a pre-open or weekend announcement.
    """
    implied_open = 100.0 - zq["open"]
    implied_close = 100.0 - zq["close"]
    rows = []
    for stamp in sorted(urls):
        day = pd.Timestamp(f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}")
        after = zq.index[zq.index >= day]
        if len(after) == 0 or (after[0] - day).days > 4:
            continue
        session = after[0]
        prior = zq.index[zq.index < session]
        if len(prior) == 0 or not np.isfinite(implied_close.loc[session]):
            continue
        if int(session.day) <= 3:
            if not np.isfinite(implied_open.loc[session]):
                continue
            surprise = float(implied_close.loc[session] - implied_open.loc[session])
            clock = "open_to_close_splice_day"
        else:
            surprise = float(implied_close.loc[session] - implied_close.loc[prior[-1]])
            clock = "close_to_close"
        rows.append(
            {
                "series": "fomc",
                "obs_period": day.strftime("%Y-%m-%d"),
                "available_on": session.strftime("%Y-%m-%d"),
                "actual": round(surprise, 6),
                "state": None,
                "clock": clock,
            }
        )
    return rows


def _epu_monthly() -> pd.DataFrame:
    path = _cache_bytes("epu_daily.csv", _EPU)
    frame = pd.read_csv(path)
    stamp = pd.to_datetime(
        dict(year=frame["year"].astype(int), month=frame["month"].astype(int), day=frame["day"].astype(int)),
        errors="coerce",
    )
    values = pd.to_numeric(frame["daily_policy_index"], errors="coerce")
    monthly = values.groupby(stamp.dt.to_period("M")).mean()
    out = pd.DataFrame(
        {
            "month": monthly.index.astype(str),
            "value": [round(float(v), 6) for v in monthly.to_numpy()],
        }
    )
    return out


def _catalog() -> list[dict]:
    raw = subprocess.check_output(
        ["git", "show", "origin/cursor/replay-accuracy-5997:scripts/replay-eval/events.json"],
        cwd=Path(__file__).resolve().parents[2],
        text=True,
    )
    payload = json.loads(raw)
    events = payload["events"] if isinstance(payload, dict) else payload
    rows = []
    for event in events:
        rows.append(
            {
                "id": event["id"],
                "release_utc": event["releaseUtc"],
                "naive": event["naive"],
            }
        )
    return rows


def build() -> None:
    cpi = _cpi_rows(_first_prints(_cache_bytes("pcpiMvMd.xlsx", _PCPI)))
    nfp = _nfp_rows(_first_prints(_cache_bytes("employMvMd.xlsx", _EMPLOY)))
    urls = _statement_urls()
    fomc = _fomc_rows(urls, _zq_ohlc())
    releases = pd.DataFrame(cpi + nfp + fomc)
    # Keep the history the z-score and the five-year median actually read.
    releases = releases[releases["available_on"] >= "1998-01-01"].copy()
    releases = releases.sort_values(["series", "available_on", "obs_period"])
    releases.to_csv(RELEASES_PATH, index=False)
    epu = _epu_monthly()
    epu.to_csv(EPU_PATH, index=False)
    catalog = _catalog()
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n")
    SOURCES_PATH.write_text(
        json.dumps(
            {
                "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "cpi_nfp": "Philadelphia Fed Real-Time Data Set, monthly vintages PCPI and EMPLOY. First vintage that contains the observation month. Month-over-month CPI uses that vintage's own prior level. Payrolls are the change in thousands in that vintage.",
                "cpi_url": _PCPI,
                "nfp_url": _EMPLOY,
                "fomc": "Federal Reserve statement pages whose title contains 'FOMC statement'. Surprise is the change in the Yahoo ZQ=F implied rate (100 minus the price). On a session dated the 1st, 2nd or 3rd the change is open to close, because the continuous contract splices then. Otherwise it is close to close.",
                "fomc_statements": len(urls),
                "news": "Baker, Bloom and Davis daily news-based US EPU, averaged within the calendar month. policyuncertainty.com All_Daily_Policy_Data.csv. This is the series FRED publishes as USEPUINDXD. The FRED file did not download.",
                "news_url": _EPU,
                "consensus": "No free CPI, payroll or funds-rate survey history was available. CPI and payroll consensus is the median of the previous 36 first releases. FOMC consensus is the rate already in the fed-funds future.",
                "counts": {"cpi": len(cpi), "nfp": len(nfp), "fomc": len(fomc), "catalog": len(catalog)},
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {RELEASES_PATH} cpi {len(cpi)} nfp {len(nfp)} fomc {len(fomc)}")
    print(f"wrote {EPU_PATH} months {len(epu)} last {epu.iloc[-1].to_dict()}")
    print(f"wrote {CATALOG_PATH} events {len(catalog)}")


if __name__ == "__main__":
    build()
