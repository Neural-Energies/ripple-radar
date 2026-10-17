/**
 * Freeze a book from the deterministic engine for each replay headline.
 *
 * Quotes are empty on purpose. Passing the later tape into rankTrades would
 * score confirmation, which is not a forecast. The optional Grok path is not
 * called.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { composeFromText } from "../../src/lib/engine/compose.ts";
import { marketRelevanceOf } from "../../src/lib/engine/relevance.ts";
import { DEESCALATE, ESCALATE, tagsFromText, toneOf } from "../../src/lib/engine/ontology.ts";
import { toYahoo } from "../../src/lib/live/symbols.ts";

const BASKET = ["SPY", "QQQ", "GLD", "UUP", "TLT", "TSLA", "NVDA", "DX-Y.NYB", "^TNX", "CL=F", "GC=F", "ES=F", "NQ=F", "ZN=F", "^GSPC", "^VIX"];

interface EventRow {
  id: string;
  group: string;
  title: string;
  releaseUtc: string;
  text: string;
  source: string;
  sourceNote: string;
  naive: string;
  naiveSource?: string;
}

function toneHits(text: string) {
  const hay = text.toLowerCase();
  return {
    escalate: ESCALATE.filter((k) => hay.includes(k)),
    deescalate: DEESCALATE.filter((k) => hay.includes(k)),
  };
}

const catalog = JSON.parse(readFileSync(new URL("./events.json", import.meta.url), "utf8")) as { events: EventRow[] };
const yahoo = new Set<string>(BASKET);

const events = catalog.events.map((row) => {
  const book = composeFromText(row.text, [], {}, `replay-${row.id}`);
  const relevance = marketRelevanceOf(row.text);
  const nodes = book.nodes
    .filter((n) => n.level > 0)
    .map((n) => ({
      id: n.id,
      label: n.label,
      ticker: n.ticker ?? null,
      level: n.level,
      direction: n.direction,
      impact: n.impact,
    }));
  const byTicker = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (!n.ticker) continue;
    const set = byTicker.get(n.ticker) ?? new Set();
    set.add(n.direction);
    byTicker.set(n.ticker, set);
  }
  const conflicts = [...byTicker.entries()]
    .filter(([, dirs]) => dirs.size > 1)
    .map(([ticker, dirs]) => ({ ticker, directions: [...dirs] }));

  const trades = book.trades.map((t) => {
    const yahooSymbol = toYahoo(t.ticker);
    yahoo.add(yahooSymbol);
    const node = book.nodes.find((n) => n.ticker === t.ticker);
    return {
      ticker: t.ticker,
      yahoo: yahooSymbol,
      name: t.name,
      side: t.side,
      nodeDirection: node?.direction ?? null,
      score: t.score,
      distance: t.distance ?? null,
      horizonLabel: t.horizon,
    };
  });

  return {
    id: row.id,
    group: row.group,
    title: row.title,
    releaseUtc: row.releaseUtc,
    text: row.text,
    source: row.source,
    sourceNote: row.sourceNote,
    naive: row.naive,
    naiveSource: row.naiveSource ?? null,
    tone: toneOf(row.text),
    toneHits: toneHits(row.text),
    tags: tagsFromText(row.text),
    family: book.eventType,
    relevance: { score: relevance.score, keep: relevance.keep },
    probability: book.probability,
    importance: book.importance,
    headlineTicker: book.headlineTicker ?? null,
    nodes,
    conflicts,
    trades,
  };
});

const out = {
  generatedBy: "scripts/replay-eval/predict.ts",
  engine: "composeFromText",
  quotesPassed: false,
  llm: "not called — replay uses the deterministic fallback only",
  yahooSymbols: [...yahoo].sort(),
  events,
};

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/predictions.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`predicted ${events.length} events, ${yahoo.size} yahoo symbols`);
