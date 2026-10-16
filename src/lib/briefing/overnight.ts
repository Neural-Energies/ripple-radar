/**
 * Overnight: from the prior US cash close (16:00 ET) to now. Pure functions
 * only; the server module fetches Yahoo bars and the stored, scored tape.
 * Nothing here invents a value. A missing input stays null and is shown as such.
 */
import { BOTS, sourceWeight } from "./bots";
import type { ScoredHeadline } from "./assemble";

export const SESSION_SYMBOLS = {
  asia: [
    { id: "N225", name: "Nikkei 225", yahoo: "^N225" },
    { id: "HSI", name: "Hang Seng", yahoo: "^HSI" },
    { id: "SSEC", name: "Shanghai Composite", yahoo: "000001.SS" },
    { id: "AXJO", name: "ASX 200", yahoo: "^AXJO" },
  ],
  europe: [
    { id: "GDAXI", name: "DAX", yahoo: "^GDAXI" },
    { id: "FTSE", name: "FTSE 100", yahoo: "^FTSE" },
    { id: "STOXX50E", name: "Euro Stoxx 50", yahoo: "^STOXX50E" },
  ],
} as const;

export const OVERNIGHT_MARKETS = [
  { id: "NQ", name: "Nasdaq-100 fut", yahoo: "NQ=F" },
  { id: "ES", name: "S&P 500 fut", yahoo: "ES=F" },
  { id: "GC", name: "Gold fut", yahoo: "GC=F" },
  { id: "CL", name: "WTI crude fut", yahoo: "CL=F" },
  { id: "ZN", name: "10-yr T-note fut", yahoo: "ZN=F" },
  { id: "DXY", name: "Dollar index", yahoo: "DX-Y.NYB" },
  { id: "BTC", name: "Bitcoin", yahoo: "BTC-USD" },
] as const;

/**
 * Rule-based link between a bot topic and the markets it moves. A headline
 * can only be named as a market's likely driver through one of these links.
 */
export const TOPIC_MARKETS: Record<string, string[]> = {
  macro: ["ES", "NQ", "ZN", "DXY"],
  rates: ["ZN", "DXY", "NQ", "GC"],
  energy: ["CL"],
  equities: ["NQ", "ES"],
  geopolitics: ["CL", "GC"],
  crypto: ["BTC"],
};

export interface Bar {
  t: number; // bar start, epoch ms
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
}

const ET = "America/New_York";

function etParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** Epoch ms of a New York wall-clock time. DST-safe. */
export function etWallToMs(y: number, m: number, d: number, hour: number, minute = 0): number {
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 3; i++) {
    const p = etParts(guess);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute);
    guess += Date.UTC(y, m - 1, d, hour, minute) - asUtc;
  }
  return guess;
}

/** ET calendar date (YYYY-MM-DD) of an instant. */
export function etDate(ms: number): string {
  const p = etParts(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The most recent weekday 16:00 ET at or before now. Exchange holidays are not modelled. */
export function priorCashClose(nowMs: number): number {
  for (let back = 0; back < 8; back++) {
    const p = etParts(nowMs - back * 86_400_000);
    if (p.weekday === "Sat" || p.weekday === "Sun") continue;
    const close = etWallToMs(p.y, p.m, p.d, 16);
    if (close <= nowMs) return close;
  }
  return nowMs - 86_400_000;
}

export interface SessionMove {
  id: string;
  name: string;
  last: number | null;
  prevClose: number | null;
  changePct: number | null;
  asOf: number | null;
  /** True when the market has printed since the 16:00 ET close. */
  inWindow: boolean;
}

/** Daily bars: last price against the prior session's close. */
export function sessionMove(
  def: { id: string; name: string },
  daily: Bar[],
  meta: { price?: number; time?: number },
  windowStart: number,
): SessionMove {
  const closes = daily.filter((b) => b.c != null);
  const last = meta.price ?? closes.at(-1)?.c ?? null;
  const asOf = meta.time ? meta.time * 1000 : (closes.at(-1)?.t ?? null);
  const prevClose = closes.at(-2)?.c ?? null;
  const changePct = last != null && prevClose ? ((last - prevClose) / prevClose) * 100 : null;
  return { ...def, last, prevClose, changePct, asOf, inWindow: asOf != null && asOf >= windowStart };
}

export interface OvernightMove {
  id: string;
  name: string;
  /** Close of the bar that ended at or before 16:00 ET. */
  refClose: number | null;
  last: number | null;
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  prior: { high: number; low: number; close: number; date: string } | null;
  asOf: number | null;
}

/**
 * Intraday bars (ascending, `stepMs` long) give the move since the close and
 * the overnight range. Daily bars give the prior session's high, low and close.
 */
export function overnightMove(
  def: { id: string; name: string },
  intraday: Bar[],
  daily: Bar[],
  windowStart: number,
  nowMs: number,
  stepMs: number,
): OvernightMove {
  const before = intraday.filter((b) => b.c != null && b.t + stepMs <= windowStart);
  const after = intraday.filter((b) => b.t >= windowStart && b.t <= nowMs);
  const refClose = before.at(-1)?.c ?? null;
  const lastBar = [...after].reverse().find((b) => b.c != null);
  const last = lastBar?.c ?? null;
  const highs = after.map((b) => b.h).filter((n): n is number => n != null);
  const lows = after.map((b) => b.l).filter((n): n is number => n != null);
  const change = last != null && refClose != null ? last - refClose : null;
  const changePct = change != null && refClose ? (change / refClose) * 100 : null;
  const today = etDate(nowMs);
  const prevDaily = daily.filter((b) => b.h != null && b.l != null && b.c != null && etDate(b.t) < today).at(-1);
  return {
    ...def,
    refClose,
    last,
    change,
    changePct,
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    prior: prevDaily ? { high: prevDaily.h!, low: prevDaily.l!, close: prevDaily.c!, date: etDate(prevDaily.t) } : null,
    asOf: lastBar?.t ?? null,
  };
}

export interface OvernightDriver {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedMs: number;
  sentiment: number;
  topics: string[];
  /** |sentiment| × strongest bot weight × source weight. */
  impact: number;
  markets: string[];
}

const BOT_WEIGHT = Object.fromEntries(BOTS.map((b) => [b.id, b.weight]));

/** Scored headlines published inside the window, ranked by the existing scores. */
export function rankDrivers(headlines: ScoredHeadline[], windowStart: number, nowMs: number, limit = 6): OvernightDriver[] {
  const out: OvernightDriver[] = [];
  for (const h of headlines) {
    if (h.publishedMs < windowStart || h.publishedMs > nowMs || h.sentiment == null) continue;
    const topics = Object.keys(h.bots).filter((id) => id in TOPIC_MARKETS);
    if (!topics.length) continue;
    const weight = Math.max(...topics.map((id) => BOT_WEIGHT[id] ?? 0));
    const impact = Math.abs(h.sentiment) * weight * sourceWeight(h.source);
    if (impact <= 0) continue;
    const markets = [...new Set(topics.flatMap((id) => TOPIC_MARKETS[id] ?? []))];
    out.push({ id: h.id, title: h.title, source: h.source, url: h.url, publishedMs: h.publishedMs, sentiment: h.sentiment, topics, impact, markets });
  }
  out.sort((a, b) => b.impact - a.impact || b.publishedMs - a.publishedMs);
  // The same story can be stored more than once (several feeds, re-publishes). Keep the strongest.
  const seen = new Set<string>();
  const unique = out.filter((d) => {
    const key = d.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, limit);
}

export interface ImpactedMarket {
  id: string;
  name: string;
  changePct: number;
  driver: { title: string; source: string; topic: string } | null;
}

/** Markets ranked by the size of the overnight move, each with the strongest linked headline, if any. */
export function impactedMarkets(moves: OvernightMove[], drivers: OvernightDriver[], limit = 4): ImpactedMarket[] {
  return moves
    .filter((m): m is OvernightMove & { changePct: number } => m.changePct != null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, limit)
    .map((m) => {
      const d = drivers.find((x) => x.markets.includes(m.id));
      const topic = d?.topics.find((t) => TOPIC_MARKETS[t]?.includes(m.id));
      return { id: m.id, name: m.name, changePct: m.changePct, driver: d && topic ? { title: d.title, source: d.source, topic } : null };
    });
}

export interface RiskFlag {
  tone: "warn" | "down" | "neutral";
  text: string;
}

/** Rule-based flags from the moves and today's calendar. Thresholds are stated in the text. */
export function riskFlags(
  moves: OvernightMove[],
  events: { title: string; when: string; impact: string; country?: string | null }[],
  bigMovePct = 1,
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const m of moves) {
    if (m.last == null) continue;
    if (m.prior && m.last > m.prior.high) flags.push({ tone: "warn", text: `${m.id} above the prior-day high (${fmt(m.prior.high)})` });
    if (m.prior && m.last < m.prior.low) flags.push({ tone: "down", text: `${m.id} below the prior-day low (${fmt(m.prior.low)})` });
    if (m.changePct != null && Math.abs(m.changePct) >= bigMovePct)
      flags.push({ tone: "warn", text: `${m.id} ${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(2)}% since the 4pm close (≥${bigMovePct}%)` });
  }
  for (const e of events) {
    if (e.impact.toLowerCase() === "high") flags.push({ tone: "neutral", text: `High-impact release ${e.when}: ${e.country ? `${e.country} ` : ""}${e.title}` });
  }
  return flags;
}

function fmt(n: number): string {
  return Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toFixed(Math.abs(n) < 10 ? 3 : 2);
}
