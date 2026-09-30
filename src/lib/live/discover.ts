import type { AssetRecord, Confirmation, Crowding, Liquidity, RadarEvent, ScoreParts, TradeIdea } from "@/data/types";
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

const CONF_BOOST: Record<Confirmation, number> = { strong: 10, confirming: 6, early: 3, none: 0, diverging: -6, invalidating: -12 };
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Re-rank a book's name against the tape. Idempotent: the adjustments are
 * applied to the book's own rank (`scoreParts.base` once scored), so a trade
 * scored on the server and again on the client is not boosted twice.
 */
export function scoreTrade(trade: TradeIdea, ctx: DiscoverCtx): TradeIdea {
  const base = trade.scoreParts?.base ?? trade.score;
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
  const confBoost = CONF_BOOST[confirmation];
  const underowned = crowding === "low" || crowding === "emerging" ? 8 : 0;
  const crowdPenalty = round1(CROWD_PENALTY[crowding] * 0.35);
  const score = clamp(base + confBoost + underowned - crowdPenalty, 8, 99);
  const scoreParts: ScoreParts = {
    base,
    confirmation: confBoost,
    underCovered: underowned,
    crowding: -crowdPenalty,
    mentions: hits,
    movePct: q?.changePct != null ? round1(q.changePct) : null,
    headlineMovePct: headQ != null && ctx.event.headlineTicker !== trade.ticker ? round1(headQ) : null,
    expected,
  };
  return {
    ...trade,
    score: Math.round(score),
    scoreParts,
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
    scoreParts: scored?.scoreParts,
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

/**
 * The score as lines a trader can check: each component with the observation
 * behind it. The final score is clamped to 8–99, so the lines can sum past it.
 */
export function explainScore(p: ScoreParts, crowding: Crowding | undefined, confirmation: Confirmation | undefined): { label: string; points: number; basis: string }[] {
  const move = p.movePct == null ? "no quote" : `${p.movePct > 0 ? "+" : ""}${p.movePct}% on the session`;
  const vs = p.headlineMovePct == null ? "" : `, headline ticker ${p.headlineMovePct > 0 ? "+" : ""}${p.headlineMovePct}%`;
  const mentions = `${p.mentions} headline mention${p.mentions === 1 ? "" : "s"}`;
  return [
    { label: "Book rank", points: p.base, basis: "The book's own rank for this name, from its causal path." },
    { label: `Tape ${confirmation ?? "none"}`, points: p.confirmation, basis: `${move}${vs}; the book implies ${p.expected === "mixed" ? "a mixed move" : p.expected}.` },
    { label: "Under-covered", points: p.underCovered, basis: p.underCovered ? `${mentions}, ${move}: the move is not yet in the headlines.` : "Already covered, so no bonus." },
    { label: `Crowding ${crowding ?? "low"}`, points: p.crowding, basis: `${mentions}, ${move}. A proxy from headlines and price, not positioning data.` },
  ];
}
