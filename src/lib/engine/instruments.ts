import type { AssetRecord, NodeKind, RadarEvent, TradeCategory, TradeIdea } from "@/data/types";
import type { LiveQuote } from "@/lib/live/types";
import { TICKER_META, type Tag } from "./ontology";

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
