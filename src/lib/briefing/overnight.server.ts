import type { Sql } from "@/lib/db";
import { fetchTextResilient } from "@/lib/live/feed-resilience";
import { loadScored } from "./read.server";
import {
  OVERNIGHT_MARKETS,
  SESSION_SYMBOLS,
  impactedMarkets,
  overnightMove,
  priorCashClose,
  rankDrivers,
  riskFlags,
  sessionMove,
  type Bar,
  type ImpactedMarket,
  type OvernightDriver,
  type OvernightMove,
  type RiskFlag,
  type SessionMove,
} from "./overnight";
import type { CalendarRow } from "./calendar";

export interface OvernightView {
  asOf: number;
  windowStart: number;
  asia: SessionMove[];
  europe: SessionMove[];
  moves: OvernightMove[];
  drivers: OvernightDriver[];
  impacted: ImpactedMarket[];
  watch: CalendarRow[];
  flags: RiskFlag[];
  calendarDetail: string;
  source: string;
  failed: string[];
}

const UA = "Mozilla/5.0";
const STEP_MS = 15 * 60_000;
const TTL_MS = 2 * 60_000;
const globalRef = globalThis as typeof globalThis & { __overnight__?: { at: number; value: OvernightView } };

interface ChartJson {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] };
    }[];
  };
}

export function parseChart(text: string): { bars: Bar[]; meta: { price?: number; time?: number } } {
  const r = (JSON.parse(text) as ChartJson).chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bars = ts.map((t, i) => ({ t: t * 1000, o: num(q.open?.[i]), h: num(q.high?.[i]), l: num(q.low?.[i]), c: num(q.close?.[i]) }));
  return { bars, meta: { price: r?.meta?.regularMarketPrice, time: r?.meta?.regularMarketTime } };
}

/** Yahoo throttles bursts, so at most four chart requests run at once. */
let active = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

async function chart(symbol: string, range: string, interval: string) {
  return limited(() => chartOnce(symbol, range, interval));
}

async function chartOnce(symbol: string, range: string, interval: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=true`;
  const got = await fetchTextResilient(url, { timeoutMs: 8000, headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!got.ok) {
    console.warn(`[overnight] ${symbol} ${got.error.split(" ")[0]}`);
    throw new Error(got.error);
  }
  return parseChart(got.text);
}

export async function loadOvernight(deps?: { sql?: Sql; now?: number }): Promise<OvernightView> {
  const now = deps?.now ?? Date.now();
  const hit = globalRef.__overnight__;
  if (!deps && hit && now - hit.at < TTL_MS) return hit.value;
  const windowStart = priorCashClose(now);
  const failed: string[] = [];

  const sessions = async (defs: readonly { id: string; name: string; yahoo: string }[]) =>
    Promise.all(
      defs.map(async (d) => {
        try {
          const daily = await chart(d.yahoo, "10d", "1d");
          return sessionMove(d, daily.bars, daily.meta, windowStart);
        } catch {
          failed.push(d.name);
          return { id: d.id, name: d.name, last: null, prevClose: null, changePct: null, asOf: null, inWindow: false };
        }
      }),
    );

  const sql = deps?.sql ?? (await (await import("@/lib/db")).getSql());
  const [asia, europe, moves, scored, calendar] = await Promise.all([
    sessions(SESSION_SYMBOLS.asia),
    sessions(SESSION_SYMBOLS.europe),
    Promise.all(
      OVERNIGHT_MARKETS.map(async (d) => {
        try {
          const [intra, daily] = await Promise.all([chart(d.yahoo, "5d", "15m"), chart(d.yahoo, "10d", "1d")]);
          return overnightMove(d, intra.bars, daily.bars, windowStart, now, STEP_MS);
        } catch {
          failed.push(d.id);
          return overnightMove(d, [], [], windowStart, now, STEP_MS);
        }
      }),
    ),
    loadScored(sql, now),
    import("./calendar.server").then((m) => m.loadBriefingCalendar({ nowMs: now })),
  ]);

  const drivers = rankDrivers(scored, windowStart, now);
  const watch = calendar.items.filter((i) => i.impact.toLowerCase() === "high" || i.impact.toLowerCase() === "medium");
  const value: OvernightView = {
    asOf: now,
    windowStart,
    asia,
    europe,
    moves,
    drivers,
    impacted: impactedMarkets(moves, drivers),
    watch,
    flags: riskFlags(moves, watch),
    calendarDetail: calendar.detail,
    source: "Yahoo Finance chart data (exchange-delayed); stored RSS tape; Faireconomy calendar",
    failed,
  };
  if (!deps) globalRef.__overnight__ = { at: now, value };
  return value;
}
