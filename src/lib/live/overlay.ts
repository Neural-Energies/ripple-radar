import { EMPTY_EVENT } from "@/lib/engine/placeholder";
import { composeFromText } from "@/lib/engine/compose";
import { allInstruments, instrumentOf, tradeToAsset } from "@/lib/engine/instruments";
import type {
  AssetRecord,
  DeskBook,
  ForecastBand,
  ForecastProvenance,
  RadarEvent,
  Scenario,
  TradeIdea,
} from "@/data/types";
import { rankTrades, scoreAsset } from "./discover";
import { markDuplicates } from "./evidence";
import { EMPTY_BOOKS, EMPTY_HEADLINES, EMPTY_QUOTES } from "./empty";
import type { LiveBook, LiveDesk, LiveQuote, RescoreResult } from "./types";

export function overlayScenarios(base: Scenario[], live: Scenario[] | undefined, rescore?: RescoreResult) {
  const next = (live ?? base).map((s) => ({ ...s }));
  if (!rescore?.scenarioShifts?.length) return next;
  for (const shift of rescore.scenarioShifts) {
    const row = next.find((s) => s.id === shift.id);
    if (!row) continue;
    row.prevProbability = row.probability;
    row.probability = shift.probability;
    row.audit = {
      ...row.audit,
      previous: row.prevProbability,
      updated: shift.probability,
      evidence: rescore.takeaway,
      direction: shift.probability >= row.prevProbability ? "up" : "down",
    };
  }
  return next;
}

/**
 * Decide what the displayed forecast may honestly claim to be.
 *
 * Bands describe the Dirichlet posterior the probability engine produced. A
 * rescore that actually moved mass replaced those numbers with an LLM
 * proposal, so the stored band no longer brackets what is on screen — drop it
 * rather than draw an interval around a different number, and let the
 * rescore's own (weaker) provenance stand. Nothing here ever promotes a claim.
 */
export function overlayForecastClaim(
  base: Pick<RadarEvent, "bands" | "provenance">,
  book: Pick<LiveBook, "bands" | "provenance"> | undefined,
  rescore?: RescoreResult,
): { bands: ForecastBand[] | undefined; provenance: ForecastProvenance | undefined } {
  const shifted = Boolean(rescore?.scenarioShifts?.length);
  return {
    bands: shifted ? undefined : (book?.bands ?? base.bands),
    provenance: shifted
      ? (rescore?.provenance ?? base.provenance)
      : (book?.provenance ?? base.provenance),
  };
}

export function overlayEvent(base: RadarEvent, desk: LiveDesk | null, rescore?: RescoreResult): RadarEvent {
  if (!desk) {
    const ranked = rankTrades(base, { quotes: EMPTY_QUOTES, headlines: EMPTY_HEADLINES });
    return { ...base, trades: ranked, mode: base.mode ?? "live", headlineTicker: base.headlineTicker ?? ranked.find((t) => t.headline)?.ticker };
  }
  const book = desk.books[base.id];
  const quotes = desk.quotes;
  const marketReaction = (book?.marketReaction ??
    base.marketReaction.map((m) => ({
      ...m,
      change: quotes[m.ticker]?.changePct ?? m.change,
    })));
  const probability = rescore?.probability ?? book?.probability ?? base.probability;
  const heat = book?.heatPoint;
  const narrativeHeat = heat
    ? [...base.narrativeHeat.filter((h) => h.date !== "Now"), heat]
    : base.narrativeHeat;
  const history = [
    ...base.probabilityHistory.filter((p) => p.date !== "Now"),
    { date: "Now", value: probability },
  ];
  const takeaways = rescore?.takeaway
    ? [rescore.takeaway, ...base.takeaways.filter((t) => t !== rescore.takeaway)]
    : base.takeaways;

  const { bands, provenance } = overlayForecastClaim(base, book, rescore);

  const next: RadarEvent = {
    ...base,
    timestamp: base.timestamp,
    probability,
    probabilityDelta: book ? book.probabilityDelta + (rescore ? probability - book.probability : 0) : base.probabilityDelta,
    evidence: markDuplicates(
      book?.evidence?.length ? book.evidence : base.evidence,
    ).slice(0, 18),
    sources: book?.sources?.length ? book.sources : base.sources,
    marketReaction,
    scenarios: overlayScenarios(base.scenarios, book?.scenarios, rescore),
    bands,
    provenance,
    narrativeHeat,
    probabilityHistory: history,
    sentiment: book?.sentiment ?? base.sentiment,
    takeaways,
    summary: rescore?.narrative ?? base.summary,
    mode: base.mode ?? (base.id.startsWith("desk-") ? "desk" : "live"),
    headlineTicker: base.headlineTicker ?? base.trades.find((t) => t.headline)?.ticker ?? base.marketReaction[0]?.ticker,
  };
  next.trades = rankTrades(next, { quotes, headlines: desk.headlines });
  return next;
}

export function overlayAsset(asset: AssetRecord, quotes: Record<string, LiveQuote> | undefined): AssetRecord {
  const q = quotes?.[asset.ticker];
  if (!q) return asset;
  return {
    ...asset,
    last: q.last,
    change: q.changePct,
  };
}

function openBook(book: DeskBook, desk: LiveDesk | null): RadarEvent {
  if (book.payload) {
    return {
      ...book.payload,
      id: book.id,
      mode: "desk",
      title: book.payload.title || book.title,
    };
  }
  return {
    ...composeFromText(book.title + (book.note ? " — " + book.note : ""), desk?.headlines ?? EMPTY_HEADLINES, desk?.quotes ?? EMPTY_QUOTES, book.id),
    bookSource: "engine",
  };
}

export function liveEventsList(
  desk: LiveDesk | null,
  rescores: Record<string, RescoreResult> = {},
  deskBooks: DeskBook[] = EMPTY_BOOKS,
): RadarEvent[] {
  const extra = (desk?.liveEvents ?? []).map((e) => overlayEvent(e, desk, rescores[e.id]));
  const opened = deskBooks
    .map((b) => overlayEvent(openBook(b, desk), desk, rescores[b.id]));
  const seen = new Set<string>();
  const out: RadarEvent[] = [];
  for (const e of [...opened, ...extra]) {
    if (!e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  out.sort((a, b) => (b.importance ?? b.probability) - (a.importance ?? a.probability));
  return out;
}

export function liveGetEvent(
  id: string,
  desk: LiveDesk | null,
  rescores: Record<string, RescoreResult> = {},
  deskBooks: DeskBook[] = EMPTY_BOOKS,
): RadarEvent {
  const all = liveEventsList(desk, rescores, deskBooks);
  if (!id) return all[0] ?? EMPTY_EVENT;
  return all.find((e) => e.id === id) ?? all[0] ?? EMPTY_EVENT;
}

/** Assets are discovered from the event's causal graph, then the liquid master. */
export function liveAssets(
  desk: LiveDesk | null,
  event?: RadarEvent | null,
): AssetRecord[] {
  const quotes = desk?.quotes ?? EMPTY_QUOTES;
  if (!event || !event.id) {
    return allInstruments(quotes)
      .map((a) => overlayAsset(a, quotes))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }
  const ctx = { event, quotes, headlines: desk?.headlines ?? EMPTY_HEADLINES };
  const seen = new Set<string>();
  const out: AssetRecord[] = [];
  for (const t of event.trades) {
    if (seen.has(t.ticker)) continue;
    seen.add(t.ticker);
    out.push(scoreAsset(tradeToAsset(t, event, quotes), ctx));
  }
  for (const n of event.nodes) {
    if (!n.ticker || seen.has(n.ticker)) continue;
    seen.add(n.ticker);
    const inst = instrumentOf(n.ticker, quotes);
    if (!inst) continue;
    out.push(
      scoreAsset(
        {
          ...inst,
          eventIds: [event.id],
          thesis: n.blurb,
          bottleneck: n.label,
          causalPath: `Event → ${n.label} → ${n.ticker}`,
          distance: n.level,
        },
        ctx,
      ),
    );
  }
  return out.sort((a, b) => b.score - a.score);
}

export function liveGetAsset(ticker: string, desk: LiveDesk | null, event?: RadarEvent | null) {
  const quotes = desk?.quotes ?? EMPTY_QUOTES;
  const fromEvent = event ? liveAssets(desk, event).find((a) => a.ticker.toLowerCase() === ticker.toLowerCase()) : undefined;
  if (fromEvent) return fromEvent;
  const inst = instrumentOf(ticker, quotes);
  if (!inst) return undefined;
  const marked = overlayAsset(inst, quotes);
  if (!event || !event.id) return marked;
  return scoreAsset(marked, { event, quotes, headlines: desk?.headlines ?? EMPTY_HEADLINES });
}

export type { TradeIdea };
