import type { AssetRecord, Confirmation, Crowding, Liquidity, RadarEvent, TradeIdea } from "@/data/types";
import type { LiveHeadline, LiveQuote } from "./types";

export interface DiscoverCtx {
  event: RadarEvent;
  quotes: Record<string, LiveQuote>;
  headlines: LiveHeadline[];
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function mentions(headlines: LiveHeadline[], ticker: string, name: string) {
  const keys = [ticker.toLowerCase(), ...name.toLowerCase().split(/\s+/).filter((w) => w.length > 3)];
  return headlines.filter((h) => keys.some((k) => h.title.toLowerCase().includes(k))).length;
}

export function crowdingOf(mentionsN: number, absMove: number, headline: boolean): Crowding {
  if (headline && (mentionsN >= 3 || absMove > 2.5)) return "saturated";
  if (mentionsN >= 4 || (headline && absMove > 1.2)) return "high";
  if (mentionsN >= 2 || absMove > 2) return "medium";
  if (mentionsN >= 1 || absMove > 0.8) return "emerging";
  return "low";
}

export function confirmationOf(
  change: number | undefined,
  expected: "up" | "down" | "mixed",
  headlineMove: number | undefined,
): Confirmation {
  if (change == null) return "none";
  const signed = expected === "down" ? -change : change;
  const rel = headlineMove != null ? signed - Math.abs(headlineMove) * 0.25 : signed;
  if (expected !== "mixed" && signed < -1.2) return "invalidating";
  if (expected !== "mixed" && signed < -0.4) return "diverging";
  if (signed > 3 || rel > 1.5) return "strong";
  if (signed > 1.1) return "confirming";
  if (signed > 0.25) return "early";
  return "none";
}

function liquidityOf(category: TradeIdea["category"] | AssetRecord["category"]): Liquidity {
  if (category === "futures" || category === "forex" || category === "crypto" || category === "index") return "high";
  if (category === "etf") return "high";
  return "medium";
}

const CROWD_PENALTY: Record<Crowding, number> = {
  low: 0,
  emerging: 6,
  medium: 14,
  high: 24,
  saturated: 36,
};

export function scoreTrade(trade: TradeIdea, ctx: DiscoverCtx): TradeIdea {
  const q = ctx.quotes[trade.ticker];
  const node = ctx.event.nodes.find((n) => n.ticker === trade.ticker);
  const hits = mentions(ctx.headlines, trade.ticker, trade.name);
  const abs = Math.abs(q?.changePct ?? 0);
  const crowding = crowdingOf(hits, abs, Boolean(trade.headline));
  const expected = node?.direction ?? (trade.side === "short" ? "down" : "up");
  const headQ = ctx.quotes[ctx.event.headlineTicker ?? ""]?.changePct;
  const confirmation = confirmationOf(q?.changePct, expected, headQ);
  const awareness = clamp(hits * 18 + (trade.headline ? 40 : 0) + abs * 6, 4, 96);
  const liquidity = trade.liquidity ?? liquidityOf(trade.category);
  const confBoost =
    confirmation === "strong" ? 10 : confirmation === "confirming" ? 6 : confirmation === "early" ? 3 : confirmation === "invalidating" ? -12 : confirmation === "diverging" ? -6 : 0;
  const underowned = crowding === "low" || crowding === "emerging" ? 8 : 0;
  const score = clamp(trade.score + confBoost + underowned - CROWD_PENALTY[crowding] * 0.35, 8, 99);
  return {
    ...trade,
    score: Math.round(score),
    crowding,
    confirmation,
    awareness: Math.round(awareness),
    liquidity,
    distance: trade.distance ?? node?.level,
  };
}

export function scoreAsset(asset: AssetRecord, ctx: DiscoverCtx): AssetRecord {
  const trade = ctx.event.trades.find((t) => t.ticker === asset.ticker);
  const scored = trade ? scoreTrade(trade, ctx) : null;
  const q = ctx.quotes[asset.ticker];
  const node = ctx.event.nodes.find((n) => n.ticker === asset.ticker);
  const hits = mentions(ctx.headlines, asset.ticker, asset.name);
  const crowding = scored?.crowding ?? crowdingOf(hits, Math.abs(q?.changePct ?? 0), false);
  const confirmation =
    scored?.confirmation ??
    confirmationOf(q?.changePct, node?.direction ?? (asset.change >= 0 ? "up" : "down"), ctx.quotes[ctx.event.headlineTicker ?? ""]?.changePct);
  const path =
    scored?.causalPath ??
    (node
      ? `${ctx.event.theme} → ${node.label}${asset.ticker ? ` → ${asset.ticker}` : ""}`
      : asset.thesis);
  const related = asset.eventIds.includes(ctx.event.id) || Boolean(node) || Boolean(trade);
  const base = related ? asset.score : Math.max(12, asset.score - 18);
  return {
    ...asset,
    score: scored?.score ?? base,
    crowding,
    confirmation,
    awareness: scored?.awareness ?? clamp(hits * 15, 4, 80),
    liquidity: scored?.liquidity ?? liquidityOf(asset.category),
    causalPath: path,
    invalidation: scored?.invalidation ?? asset.bottleneck,
    distance: scored?.distance ?? node?.level,
    last: q?.last ?? asset.last,
    change: q?.changePct ?? asset.change,
  };
}

export function rankTrades(event: RadarEvent, ctx: Omit<DiscoverCtx, "event">): TradeIdea[] {
  return event.trades
    .map((t) => scoreTrade(t, { ...ctx, event }))
    .sort((a, b) => b.score - a.score);
}
