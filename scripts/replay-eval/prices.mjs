/**
 * Download daily and 60-minute closes from Yahoo Finance chart v8.
 * Writes scripts/replay-eval/cache/prices.json. No synthetic fills.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (compatible; ripple-replay-eval/1.0; research)";
const HOURLY = ["ES=F", "NQ=F", "GC=F", "CL=F", "ZN=F", "DX-Y.NYB", "^TNX", "SPY", "QQQ", "GLD", "UUP", "TLT", "NVDA", "TSLA"];

function nyDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text.slice(0, 180)}`);
  }
  return res.json();
}

async function yahooBars(symbol, period1, period2, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${interval}&events=history`;
  const body = await getJson(url);
  const result = body.chart?.result?.[0];
  if (!result) throw new Error(JSON.stringify(body.chart?.error ?? "empty"));
  const ts = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const bars = [];
  for (let i = 0; i < ts.length; i += 1) {
    if (closes[i] == null) continue;
    bars.push({ t: ts[i] * 1000, c: closes[i] });
  }
  return bars;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function fredDgs10() {
  const res = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`FRED ${res.status}`);
  const text = await res.text();
  const series = {};
  for (const line of text.trim().split(/\n/).slice(1)) {
    const [date, value] = line.split(",");
    if (!date || !value || value === ".") continue;
    series[date] = Number(value);
  }
  return series;
}

async function main() {
  const predictions = JSON.parse(readFileSync(new URL("./out/predictions.json", import.meta.url), "utf8"));
  const symbols = [...new Set(predictions.yahooSymbols)].sort();
  const period1 = Math.floor(Date.parse("2022-12-01T00:00:00Z") / 1000);
  const period2 = Math.floor(Date.parse("2026-10-18T00:00:00Z") / 1000);
  const hour1 = Math.floor(Date.parse("2024-10-20T00:00:00Z") / 1000);
  const errors = [];

  const dailyBars = await mapPool(symbols, 4, async (symbol) => {
    try {
      const bars = await yahooBars(symbol, period1, period2, "1d");
      const series = {};
      for (const bar of bars) series[nyDate(bar.t)] = bar.c;
      return [symbol, series];
    } catch (error) {
      errors.push({ symbol, interval: "1d", error: String(error.message ?? error) });
      return [symbol, null];
    }
  });

  const hourlyBars = await mapPool(HOURLY, 3, async (symbol) => {
    try {
      const bars = await yahooBars(symbol, hour1, period2, "60m");
      return [symbol, bars];
    } catch (error) {
      errors.push({ symbol, interval: "60m", error: String(error.message ?? error) });
      return [symbol, null];
    }
  });

  let fred = null;
  try {
    fred = { DGS10: await fredDgs10() };
  } catch (error) {
    errors.push({ symbol: "DGS10", interval: "fred", error: String(error.message ?? error) });
  }

  const daily = {};
  for (const [symbol, series] of dailyBars) if (series) daily[symbol] = series;
  const hourly = {};
  for (const [symbol, bars] of hourlyBars) if (bars) hourly[symbol] = bars;

  const payload = {
    vendor: "Yahoo Finance chart v8 (query1.finance.yahoo.com) daily closes and 60-minute bars; FRED DGS10 for a yield sign check",
    fetchedAt: new Date().toISOString(),
    dailyFrom: "2022-12-01",
    dailyTo: "2026-10-18",
    hourlyFrom: "2024-10-20",
    hourlyNote: "Yahoo returned HTTP 422 for 60-minute history in 2023 on a probe. Hourly bars are requested only from 2024-10-20.",
    errors,
    daily,
    hourly,
    fred,
  };
  mkdirSync(new URL("./cache/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./cache/prices.json", import.meta.url), JSON.stringify(payload));
  const dailyN = Object.values(daily).reduce((s, series) => s + Object.keys(series).length, 0);
  const hourN = Object.values(hourly).reduce((s, bars) => s + bars.length, 0);
  console.log(`prices dailySeries=${Object.keys(daily).length} dailyBars=${dailyN} hourlySeries=${Object.keys(hourly).length} hourlyBars=${hourN} errors=${errors.length}`);
  if (errors.length) console.log(errors.map((e) => `${e.symbol} ${e.interval}: ${e.error}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
