import type { CausalLink, RippleLevel, RippleNode, TradeIdea } from "@/data/types";
import { resolveNodeTicker, tickersForTag } from "./instruments";
import { TICKER_META, TRANSMIT, hopsFrom, type Tag } from "./ontology";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const TAG_NODE: Record<string, { label: string; kind: RippleNode["kind"] }> = {
  crude: { label: "Crude / barrels", kind: "commodity" },
  energy: { label: "Energy prices", kind: "commodity" },
  refined: { label: "Refined products", kind: "commodity" },
  gas: { label: "Natural gas / LNG", kind: "commodity" },
  shipping: { label: "Seaborne logistics", kind: "bottleneck" },
  freight: { label: "Tonne-miles / freight", kind: "bottleneck" },
  insurance: { label: "War-risk / insurance", kind: "industry" },
  airlines: { label: "Airlines / transport", kind: "industry" },
  ag: { label: "Ag / nutrients", kind: "commodity" },
  inflation: { label: "Inflation", kind: "rates" },
  rates: { label: "Rates / curve", kind: "rates" },
  fx: { label: "FX / dollar funding", kind: "currency" },
  duration: { label: "Duration", kind: "rates" },
  equity: { label: "Equities", kind: "etf" },
  crypto: { label: "Crypto / liquidity", kind: "crypto" },
  liquidity: { label: "Funding / liquidity", kind: "rates" },
  semiconductor: { label: "Semiconductors", kind: "industry" },
  foundry: { label: "Foundry / wafers", kind: "industry" },
  compute: { label: "Compute / AI kit", kind: "industry" },
  tech: { label: "Hardware / devices", kind: "industry" },
  rareearth: { label: "Rare earths", kind: "commodity" },
  magnets: { label: "Magnets / midstream", kind: "bottleneck" },
  defense: { label: "Defense / restock", kind: "industry" },
  banking: { label: "Banks / deposits", kind: "industry" },
  credit: { label: "Credit / funding", kind: "industry" },
  lithium: { label: "Lithium / chemicals", kind: "commodity" },
  industrial: { label: "Industrial demand", kind: "industry" },
  weather: { label: "Physical weather", kind: "other" },
  policy: { label: "Policy / official", kind: "policy" },
  yen: { label: "Yen", kind: "currency" },
  usd: { label: "US dollar", kind: "currency" },
  gold: { label: "Gold", kind: "commodity" },
  haven: { label: "Haven demand", kind: "sentiment" },
  vol: { label: "Volatility", kind: "sentiment" },
  labor: { label: "Labor / throughput", kind: "other" },
  logistics: { label: "Logistics / trucking", kind: "bottleneck" },
  cyber: { label: "Cyber / ops downtime", kind: "other" },
  consumer: { label: "Consumer demand", kind: "industry" },
  conditions: { label: "Financial conditions", kind: "rates" },
  europe: { label: "Europe", kind: "currency" },
  china: { label: "China demand / policy", kind: "policy" },
  ev: { label: "EV / motors", kind: "industry" },
  copper: { label: "Copper / industrial metals", kind: "commodity" },
};

function kindOf(ticker: string): RippleNode["kind"] {
  const k = TICKER_META[ticker]?.kind;
  if (k === "index") return "etf";
  return (k as RippleNode["kind"]) ?? "company";
}

function categoryOf(ticker: string): TradeIdea["category"] {
  const c = TICKER_META[ticker]?.category;
  if (c === "index") return "etf";
  return (c as TradeIdea["category"]) ?? "stock";
}

export interface BuiltGraph {
  nodes: RippleNode[];
  links: CausalLink[];
  trades: TradeIdea[];
  headlineTicker: string;
}

function tradeFrom(
  ticker: string,
  node: RippleNode,
  tags: Tag[],
  index: number,
  headline: boolean,
): TradeIdea {
  const meta = TICKER_META[ticker];
  const side: TradeIdea["side"] = node.direction === "down" ? "short" : "long";
  return {
    ticker,
    name: meta?.name ?? ticker,
    score: clamp(92 - index * 4 - (node.level - 1) * 3, 40, 96),
    reason: node.blurb,
    side,
    category: categoryOf(ticker),
    horizon: meta?.lag ?? "days–weeks",
    distance: node.level,
    headline,
    causalPath: `Event → ${node.label} → ${ticker}`,
    invalidation: "Constraint eases same session; crowded first-order unwinds.",
  };
}

/** EVENT → causal nodes → THEN liquid instruments. Never the reverse. */
export function buildCausalGraph(opts: {
  title: string;
  note?: string;
  tags: Tag[];
  tone: "up" | "down" | "neutral";
  coreLabel?: string;
}): BuiltGraph {
  const tags = opts.tags.slice(0, 8);
  const tone = opts.tone;
  const usedTickers = new Set<string>();
  const nodes: RippleNode[] = [
    {
      id: "core",
      label: opts.coreLabel || (opts.title.length > 40 ? opts.title.slice(0, 38) + "…" : opts.title),
      level: 0,
      kind: "event",
      angle: 0,
      impact: 100,
      direction: tone === "down" ? "down" : "up",
      blurb: opts.note || "Originating development. World-supplied, not a fixture.",
    },
  ];
  const links: CausalLink[] = [];
  const nodeByTag = new Map<Tag, string>();
  nodeByTag.set("__core", "core");

  const primary = tags.length ? tags.slice(0, 3) : (["equity"] as Tag[]);
  const hopList = primary.flatMap((t) => hopsFrom(t, 4));

  function addNode(tag: Tag, level: RippleLevel, i: number, edge?: (typeof hopList)[number]["edge"]) {
    if (nodeByTag.has(tag)) return nodeByTag.get(tag)!;
    const meta = TAG_NODE[tag] ?? { label: tag.replace(/-/g, " "), kind: "other" as const };
    // Prefer a fresh unused ticker for trade diversity; fall back to ontology/TRANSMIT proxy so the map can navigate.
    const fresh = tickersForTag(tag, usedTickers, 1)[0];
    const ticker = fresh ?? resolveNodeTicker(tag);
    if (fresh) usedTickers.add(fresh);
    const id = tag.replace(/[^a-z0-9]+/g, "-") || `n${i}`;
    const dir: RippleNode["direction"] =
      edge?.direction === -1 ? "down" : tone === "down" && level === 1 ? "mixed" : "up";
    nodes.push({
      id,
      label: meta.label,
      ticker,
      level,
      kind: meta.kind,
      angle: (i * 29 + 22) % 360,
      impact: clamp(86 - level * 12 - i, 28, 90),
      direction: dir,
      blurb: edge?.mechanism ?? `${meta.label} is on the causal path from this event.`,
    });
    nodeByTag.set(tag, id);
    const srcId = level === 1 ? "core" : findParent(tag);
    links.push({
      source: srcId,
      dest: id,
      direction: dir === "down" ? -1 : 1,
      distance: level,
      confidence: edge?.confidence ?? clamp(0.8 - level * 0.08, 0.42, 0.9),
      evidence: edge?.mechanism ?? `Inferred transmission: event → ${tag}.`,
      expectedLag: edge?.lag ?? TICKER_META[ticker ?? ""]?.lag ?? "days–weeks",
      invalidation: "The binding constraint eases and the first print mean-reverts.",
      historicalSupport: "Same transmission family — not this ticker's last anecdote.",
    });
    return id;
  }

  function findParent(tag: Tag): string {
    for (const e of TRANSMIT) {
      if (e.to !== tag) continue;
      const pid = nodeByTag.get(e.from);
      if (pid) return pid;
    }
    return "core";
  }

  primary.forEach((tag, i) => addNode(tag, 1, i));

  hopList.forEach((h, i) => {
    const level = (h.depth === 1 ? 2 : h.depth === 2 ? 3 : 4) as RippleLevel;
    if (nodes.length >= 12) return;
    addNode(h.tag, level, primary.length + i, h.edge);
  });

  const macro = nodes.find((n) => n.level >= 3 && (n.kind === "rates" || n.kind === "sentiment" || n.kind === "currency"));
  if (macro) {
    links.push({
      source: macro.id,
      dest: "core",
      direction: 1,
      distance: 4,
      confidence: 0.48,
      evidence: "Price and policy can change the event (offset, exemption, backstop, reroute).",
      expectedLag: "days–weeks",
      invalidation: "Officials do not respond; the chain stays one-way.",
      historicalSupport: "Reflexive policy offsets after prior supply and funding shocks.",
      scenarioDependence: "Materialization scenarios",
    });
  }

  for (const n of nodes) {
    if (n.level === 0 || n.ticker) continue;
    const proxy = resolveNodeTicker(n.id);
    if (proxy) n.ticker = proxy;
  }

  const trades: TradeIdea[] = [];
  const nodeTickers = nodes.map((n) => n.ticker).filter((t): t is string => Boolean(t));
  const headlineTicker = nodeTickers[0] ?? "SPX";

  nodeTickers.forEach((ticker, i) => {
    const node = nodes.find((n) => n.ticker === ticker);
    if (!node) return;
    trades.push(tradeFrom(ticker, node, tags, i, i === 0));
  });

  for (const node of nodes) {
    if (node.level === 0) continue;
    const tag = node.id;
    const extras = tickersForTag(tag, usedTickers, node.level <= 2 ? 2 : 1);
    for (const ticker of extras) {
      usedTickers.add(ticker);
      trades.push(tradeFrom(ticker, node, tags, trades.length, false));
      if (trades.length >= 12) break;
    }
    if (trades.length >= 12) break;
  }

  if (!trades.length) {
    const fallback = tickersForTag("equity", usedTickers, 3);
    const core = nodes[0]!;
    fallback.forEach((ticker, i) => {
      usedTickers.add(ticker);
      trades.push(tradeFrom(ticker, { ...core, level: 3, label: "Risk residual" }, tags, i, i === 0));
    });
  }

  return { nodes, links, trades: trades.slice(0, 12), headlineTicker: trades[0]?.ticker ?? headlineTicker };
}

export { kindOf, categoryOf };
