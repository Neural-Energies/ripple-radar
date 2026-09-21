import { composeFromCluster } from "@/lib/engine/compose";
import { clusterHeadlines, stampHeadlineClusters } from "@/lib/engine/cluster";
import { relateEvents } from "@/lib/engine/relate";
import { toneOf } from "@/lib/engine/ontology";
import { hid } from "@/lib/engine/tokenize";
import type { EvidenceItem, RadarEvent, Scenario } from "@/data/types";
import { headlineToEvidence } from "./evidence";
import { etParts, quoteState, sessionFlags } from "./clock";
import { attachFredEvidence, fetchFredSeriesBundle, latestFredEvidence } from "./fred.server";
import { DESK_TICKERS, fromYahoo, toYahoo } from "./symbols";
import type { LiveBook, LiveDesk, LiveHeadline, LiveQuote } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const QUOTE_TTL = 12_000;
const NEWS_TTL = 40_000;

type QuoteCache = { at: number; quotes: Record<string, LiveQuote> };
type NewsCache = { at: number; headlines: LiveHeadline[] };

let quoteCache: QuoteCache | null = null;
let newsCache: NewsCache | null = null;

const FEEDS: { source: string; url: string }[] = [
  { source: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { source: "NYT Business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "OilPrice", url: "https://oilprice.com/rss/main" },
  { source: "CNBC World", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html" },
  { source: "CNBC Markets", url: "https://www.cnbc.com/id/15839069/device/rss/rss.html" },
  { source: "Defense One", url: "https://www.defenseone.com/rss/all/" },
  { source: "Guardian", url: "https://www.theguardian.com/world/rss" },
  { source: "Guardian Business", url: "https://www.theguardian.com/uk/business/rss" },
  { source: "Reuters World", url: "https://feeds.reuters.com/Reuters/worldNews" },
  { source: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews" },
  { source: "Fed", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  {
    source: "Google News",
    url: "https://news.google.com/rss/search?q=when:1d+(markets+OR+geopolitics+OR+%22central+bank%22+OR+%22supply+chain%22+OR+sanctions+OR+hurricane+OR+semiconductor)&hl=en-US&gl=US&ceid=US:en",
  },
];

function decode(raw: string) {
  const amp = "\u0026";
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(new RegExp(amp + "amp;", "g"), amp)
    .replace(new RegExp(amp + "lt;", "g"), "<")
    .replace(new RegExp(amp + "gt;", "g"), ">")
    .replace(new RegExp(amp + "quot;", "g"), '"')
    .replace(new RegExp(amp + "#39;", "g"), "'")
    .replace(new RegExp(amp + "apos;", "g"), "'")
    .replace(new RegExp(amp + "#(\\d+);", "g"), (_, n) => String.fromCharCode(Number(n)))
    .replace(new RegExp(amp + "nbsp;", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? decode(m[1]) : "";
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

async function fetchText(url: string, ms = 7000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseRss(xml: string, fallbackSource: string): LiveHeadline[] {
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  const out: LiveHeadline[] = [];
  for (const block of chunks.slice(0, 20)) {
    let title = tag(block, "title");
    const link = tag(block, "link") || tag(block, "guid");
    const pub = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    if (!title) continue;
    let source = fallbackSource;
    const dash = title.lastIndexOf(" - ");
    if (fallbackSource === "Google News" && dash > 12) {
      source = title.slice(dash + 3).trim() || source;
      title = title.slice(0, dash).trim();
    }
    const published = pub ? Date.parse(pub) : Date.now();
    out.push({
      id: hid(title + source + String(published) + link),
      title,
      source,
      url: link,
      published: Number.isFinite(published) ? published : Date.now(),
      eventIds: [],
      tone: toneOf(title),
    });
  }
  return out;
}

async function loadNews(): Promise<LiveHeadline[]> {
  if (newsCache && Date.now() - newsCache.at < NEWS_TTL) return newsCache.headlines;
  const results = await Promise.allSettled(FEEDS.map((f) => fetchText(f.url).then((xml) => parseRss(xml, f.source))));
  const seen = new Set<string>();
  const headlines: LiveHeadline[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const h of r.value) {
      const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key) || key.length < 18) continue;
      seen.add(key);
      headlines.push(h);
    }
  }
  headlines.sort((a, b) => b.published - a.published);
  const trimmed = headlines.slice(0, 80);
  newsCache = { at: Date.now(), headlines: trimmed };
  return trimmed;
}

type SparkMeta = {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  exchangeName?: string;
};

type SparkResult = {
  symbol: string;
  response?: {
    meta?: SparkMeta;
    indicators?: { quote?: { close?: Array<number | null> }[] };
  }[];
};

async function sparkBatch(tickers: string[]): Promise<Record<string, LiveQuote>> {
  const symbols = tickers.map(toYahoo).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols)}&range=1d&interval=5m`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`spark ${res.status}`);
  const json = (await res.json()) as { spark?: { result?: SparkResult[] } };
  const now = Date.now();
  const quotes: Record<string, LiveQuote> = {};
  for (const row of json.spark?.result ?? []) {
    const resp = row.response?.[0];
    const meta = resp?.meta ?? {};
    const closes = (resp?.indicators?.quote?.[0]?.close ?? []).filter((n): n is number => typeof n === "number");
    const last = meta.regularMarketPrice ?? closes.at(-1);
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? closes[0];
    if (typeof last !== "number" || typeof prev !== "number" || !Number.isFinite(last)) continue;
    const asOf = (meta.regularMarketTime ?? 0) * 1000 || now;
    const change = last - prev;
    const changePct = prev !== 0 ? (change / prev) * 100 : 0;
    const step = Math.max(1, Math.floor(closes.length / 24));
    const spark = closes.filter((_, i) => i % step === 0).slice(-24);
    const ticker = fromYahoo(row.symbol);
    quotes[ticker] = {
      ticker,
      last,
      prevClose: prev,
      change,
      changePct,
      spark,
      state: quoteState(asOf, now),
      asOf,
      exchange: meta.exchangeName ?? "",
    };
  }
  return quotes;
}

async function loadQuotes(): Promise<Record<string, LiveQuote>> {
  if (quoteCache && Date.now() - quoteCache.at < QUOTE_TTL) return quoteCache.quotes;
  const chunks: string[][] = [];
  for (let i = 0; i < DESK_TICKERS.length; i += 12) {
    chunks.push([...DESK_TICKERS.slice(i, i + 12)]);
  }
  const parts = await Promise.allSettled(chunks.map((c) => sparkBatch(c)));
  const quotes: Record<string, LiveQuote> = {};
  for (const p of parts) {
    if (p.status === "fulfilled") Object.assign(quotes, p.value);
  }
  quoteCache = { at: Date.now(), quotes };
  return quotes;
}

function clockOf(ms: number) {
  return etParts(ms).clock.replace(" ET", "");
}

function shiftScenarios(base: Scenario[], delta: number, evidence: string): Scenario[] {
  if (!base.length) return base;
  const risky = (s: Scenario) =>
    /sustain|material|escalat|full|blockade|closure|default|rupture/i.test(s.name + s.detail);
  const calm = (s: Scenario) => /fade|revers|headline premium|noise|talks|none/i.test(s.name + s.detail);
  const next = base.map((s) => ({ ...s, prevProbability: s.probability }));
  const tilt = clamp(delta * 0.35, -8, 10);
  for (const s of next) {
    if (risky(s)) s.probability = clamp(s.probability + tilt, 4, 72);
    else if (calm(s)) s.probability = clamp(s.probability - tilt, 4, 80);
  }
  const sum = next.reduce((a, s) => a + s.probability, 0) || 1;
  for (const s of next) {
    s.probability = Math.round((s.probability / sum) * 100);
    s.audit = {
      ...s.audit,
      previous: s.prevProbability,
      updated: s.probability,
      evidence,
      direction: s.probability >= s.prevProbability ? "up" : "down",
    };
  }
  const drift = 100 - next.reduce((a, s) => a + s.probability, 0);
  if (next[0]) next[0].probability += drift;
  return next;
}

async function loadFredMacroEvidence(): Promise<EvidenceItem[]> {
  try {
    const bundle = await fetchFredSeriesBundle();
    return latestFredEvidence(bundle, clockOf);
  } catch {
    return [];
  }
}

function bookFromEvent(
  event: RadarEvent,
  headlines: LiveHeadline[],
  quotes: Record<string, LiveQuote>,
  fredEvidence: EvidenceItem[] = [],
): LiveBook {
  const matched = headlines.filter((h) => h.eventIds.includes(event.id));
  const use = matched.length ? matched : event.evidence.length ? matched : headlines.filter((h) => event.entities?.some((e) => h.title.toLowerCase().includes(e.toLowerCase())));
  const relatedTickers = event.marketReaction.map((m) => m.ticker);
  const related = relatedTickers.map((t) => quotes[t]).filter(Boolean);
  const mkt = related.length > 0 ? related.reduce((a, q) => a + q.changePct, 0) / related.length : 0;
  const esc = use.filter((h) => h.tone === "up").length;
  const de = use.filter((h) => h.tone === "down").length;
  const evidenceNote = use[0] ? `${use.length} live items. Latest: ${use[0].title}` : "Holding constructed prior.";
  const baseEvidence: EvidenceItem[] = event.evidence.length
    ? event.evidence
    : use.slice(0, 8).map((h) => headlineToEvidence(h, clockOf));
  const evidence = attachFredEvidence(baseEvidence, fredEvidence);
  return {
    eventId: event.id,
    probability: event.probability,
    probabilityDelta: event.probabilityDelta,
    hits: use.length || event.evidence.length,
    evidence,
    sources: event.sources,
    marketReaction: event.marketReaction.map((m) => ({
      ...m,
      change: quotes[m.ticker]?.changePct ?? m.change,
    })),
    scenarios: shiftScenarios(
      event.scenarios,
      clamp((use.length || hitsSafe(event)) * 0.5 + (esc - de) * 1.5 + mkt * 0.4, -12, 16),
      evidenceNote,
    ),
    heatPoint: event.narrativeHeat[event.narrativeHeat.length - 1] ?? { date: "Now", news: 40, social: 20, search: 18 },
    sentiment: event.sentiment,
  };
}

function hitsSafe(event: RadarEvent) {
  return event.evidence.length || 1;
}

function discover(headlines: LiveHeadline[], quotes: Record<string, LiveQuote>): { events: RadarEvent[]; headlines: LiveHeadline[] } {
  const clusters = clusterHeadlines(headlines);
  const stamped = stampHeadlineClusters(headlines, clusters);
  const events = relateEvents(
    clusters.map((c) => composeFromCluster(c, quotes)).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)),
  );
  return { events, headlines: stamped };
}

export async function buildDesk(): Promise<LiveDesk> {
  const now = Date.now();
  const [quotes, rawNews, fredEvidence] = await Promise.all([
    loadQuotes().catch(() => quoteCache?.quotes ?? {}),
    loadNews().catch(() => newsCache?.headlines ?? []),
    loadFredMacroEvidence(),
  ]);
  const { events, headlines } = discover(rawNews, quotes);
  const books: Record<string, LiveBook> = {};
  for (const ev of events) {
    const book = bookFromEvent(ev, headlines, quotes, fredEvidence);
    books[ev.id] = book;
    ev.evidence = book.evidence;
  }

  const quoteCount = Object.keys(quotes).length;
  const quoteLive = Object.values(quotes).filter((q) => q.state === "live").length;
  const sessions = sessionFlags(now);
  let status: LiveDesk["status"] = "degraded";
  let statusDetail = "Waiting on public tape.";
  if (quoteCount > 0 && headlines.length > 0) {
    status = quoteLive > 0 || headlines.length > 0 ? "live" : "degraded";
    if (quoteLive > 0 && sessions.ny) statusDetail = "Cash + futures tape live.";
    else if (quoteLive > 0 && sessions.futures) statusDetail = "Futures live · cash last print.";
    else statusDetail = "Last session prints · news live.";
  } else if (headlines.length > 0) {
    statusDetail = "News live · quotes unavailable.";
  } else if (quoteCount > 0) {
    status = "degraded";
    statusDetail = "Quotes live · news feed thin.";
  } else if (fredEvidence.length > 0) {
    statusDetail = "FRED delayed macro live · tape thin.";
  }
  return {
    asOf: now,
    asOfLabel: etParts(now).label,
    status,
    statusDetail,
    sessions,
    quotes,
    headlines: headlines.slice(0, 40),
    books,
    liveEvents: events,
    quoteLive,
    quoteCount,
    macroEvidence: fredEvidence,
  };
}
