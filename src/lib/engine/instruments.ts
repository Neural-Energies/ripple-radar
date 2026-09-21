import type { AssetRecord, NodeKind, RadarEvent, TradeCategory, TradeIdea } from "@/data/types";
import type { LiveQuote } from "@/lib/live/types";
import { TICKER_META, TRANSMIT, type Tag } from "./ontology";

function kindOf(ticker: string): NodeKind | "index" {
  return TICKER_META[ticker]?.kind ?? "company";
}

function categoryOf(ticker: string): TradeCategory | "index" {
  return TICKER_META[ticker]?.category ?? "stock";
}

/** Liquid-instrument master. Identity and liquidity — not event conclusions. */
export function instrumentOf(ticker: string, quotes?: Record<string, LiveQuote>): AssetRecord | undefined {
  const key = Object.keys(TICKER_META).find((t) => t.toLowerCase() === ticker.toLowerCase());
  if (!key) return undefined;
  const meta = TICKER_META[key]!;
  const q = quotes?.[key];
  const cat = categoryOf(key);
  return {
    ticker: key,
    name: meta.name,
    kind: kindOf(key),
    category: cat,
    last: q?.last ?? 0,
    change: q?.changePct ?? 0,
    score: 50,
    eventIds: [],
    thesis: `${meta.name} is a liquid expression of ${meta.tags.join(" / ")}.`,
    bottleneck: meta.tags[0] ?? "transmission",
    lag: meta.lag,
  };
}

export function allInstruments(quotes?: Record<string, LiveQuote>): AssetRecord[] {
  return Object.keys(TICKER_META)
    .map((t) => instrumentOf(t, quotes))
    .filter((a): a is AssetRecord => Boolean(a));
}

export function tradeToAsset(trade: TradeIdea, event: RadarEvent, quotes?: Record<string, LiveQuote>): AssetRecord {
  const base = instrumentOf(trade.ticker, quotes);
  const q = quotes?.[trade.ticker];
  return {
    ticker: trade.ticker,
    name: trade.name,
    kind: base?.kind ?? "company",
    category: trade.category,
    last: q?.last ?? base?.last ?? 0,
    change: q?.changePct ?? base?.change ?? 0,
    score: trade.score,
    eventIds: event.id ? [event.id] : [],
    thesis: trade.reason,
    bottleneck: trade.causalPath ?? event.theme,
    lag: trade.horizon,
    crowding: trade.crowding,
    confirmation: trade.confirmation,
    awareness: trade.awareness,
    liquidity: trade.liquidity,
    causalPath: trade.causalPath,
    invalidation: trade.invalidation,
    distance: trade.distance,
  };
}

export function tickersForTag(tag: Tag, used: Set<string>, n = 3): string[] {
  const hits: { ticker: string; rank: number }[] = [];
  for (const [ticker, meta] of Object.entries(TICKER_META)) {
    if (used.has(ticker)) continue;
    const i = meta.tags.indexOf(tag);
    if (i < 0) continue;
    hits.push({ ticker, rank: i === 0 ? 5 : Math.max(1, 4 - i) });
  }
  hits.sort((a, b) => b.rank - a.rank);
  return hits.slice(0, n).map((h) => h.ticker);
}

/** Best liquid proxy for a causal tag. Reuse allowed — for map navigation, not trade uniqueness. */
export function proxyForTag(tag: Tag): string | undefined {
  return tickersForTag(tag, new Set(), 1)[0];
}

/**
 * Resolve a navigable liquid ticker for a graph node id/tag.
 * Prefer direct ontology hit; else a TRANSMIT neighbor that already has instruments.
 * Never invents tickers.
 */
export function resolveNodeTicker(tagOrId: string): string | undefined {
  const tag = tagOrId as Tag;
  const direct = proxyForTag(tag);
  if (direct) return direct;
  for (const e of TRANSMIT) {
    if (e.from !== tag && e.to !== tag) continue;
    const other = e.from === tag ? e.to : e.from;
    const hit = proxyForTag(other);
    if (hit) return hit;
  }
  return undefined;
}


export type NodeNavTarget =
  | { kind: "ticker"; ticker: string }
  | { kind: "filter"; q: string };

/**
 * Map / inspector navigation target for a causal node.
 * Prefers attached ticker → core headline trade → ontology/TRANSMIT proxy → sector filter.
 * Never invents tickers.
 */
export function nodeNavTarget(
  node: { id: string; label: string; ticker?: string; level: number },
  event: {
    headlineTicker?: string;
    trades: Array<{ ticker: string; headline?: boolean }>;
    marketReaction: Array<{ ticker: string }>;
  },
): NodeNavTarget | null {
  if (node.ticker) return { kind: "ticker", ticker: node.ticker };

  if (node.level === 0) {
    const head =
      event.headlineTicker ??
      event.trades.find((t) => t.headline)?.ticker ??
      event.trades[0]?.ticker ??
      event.marketReaction[0]?.ticker;
    if (head) return { kind: "ticker", ticker: head };
  }

  const proxy = resolveNodeTicker(node.id);
  if (proxy) return { kind: "ticker", ticker: proxy };

  const q = node.id && node.id !== "core" ? node.id.replace(/-/g, " ") : node.label;
  if (q.trim()) return { kind: "filter", q: q.trim() };
  return null;
}
