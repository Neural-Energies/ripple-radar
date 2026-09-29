/**
 * The daily brief: what changed since you last looked, and why it matters to
 * the names you hold an interest in.
 *
 * "Your names" are the tickers on your watchlists and the instruments on your
 * open theses. A book matters to you when its trades or its causal map touch
 * one of them. Every line is built from engine output (probabilities,
 * scenarios, evidence, horizons, invalidation) or a quote. Nothing is scored
 * by hand, and a book that touches none of your names is not dressed up as
 * relevant.
 */
import type { RadarEvent, Thesis } from "@/data/types";
import type { Watchlist } from "@/lib/desk-model";
import { monitorThesis, shortestHorizonLabel, type QuoteLookup, type ThesisMonitor } from "@/lib/thesis";

/** What the book and tape looked like when you last marked the brief read. */
export interface BriefBaseline {
  at: number;
  books: Record<string, { probability: number; scenarios: Record<string, number> }>;
  prices: Record<string, number>;
}

export type Quotes = Record<string, { last: number; changePct?: number } | undefined> | undefined;

export interface Exposure {
  ticker: string;
  /** Where your interest comes from. */
  via: ("watchlist" | "thesis")[];
  /** The direction the book implies for this name. */
  bookDirection: "up" | "down" | "mixed";
  /** Your thesis's expected direction, when a thesis holds it. */
  yourDirection: "up" | "down" | null;
  /** True when your thesis expects the opposite of what this book implies. */
  conflict: boolean;
  /** Move since the baseline when one exists, otherwise the session move. */
  changePct: number | null;
  changeBasis: "since_seen" | "session" | null;
  /** How the book reaches it. */
  reason: string;
}

export interface BookBrief {
  eventId: string;
  title: string;
  probability: number;
  /** Change since the baseline, or the engine's last poll-to-poll change with no baseline. */
  delta: number;
  deltaBasis: "since_seen" | "last_update";
  lead: { id: string; name: string; probability: number; delta: number | null } | null;
  alternatives: { name: string; probability: number }[];
  horizon: string;
  invalidation: string[];
  evidence: { headline: string; source: string; time: string; isNew: boolean }[];
  newEvidence: number;
  exposures: Exposure[];
  /** Ranking weight: material movement, new evidence, and how much of your book it touches. */
  weight: number;
  isNewBook: boolean;
}

export interface Brief {
  since: number | null;
  /** Books touching your names, most material first. */
  books: BookBrief[];
  /** Material movers that touch none of your names. */
  elsewhere: BookBrief[];
  /** Your names moving with no book on the desk that reaches them. */
  unexplained: { ticker: string; changePct: number; changeBasis: "since_seen" | "session" }[];
  /** Open theses that are due, or where something has broken. */
  theses: { thesis: Thesis; monitor: ThesisMonitor }[];
  exposureCount: number;
}

/** Book moves below this, in probability points, are not called material. */
export const MATERIAL_PTS = 5;
/** Name moves below this, in percent, are not called material. */
export const MATERIAL_MOVE_PCT = 2;

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function yourNames(watchlists: Watchlist[], theses: Thesis[]) {
  const names = new Map<string, { via: Set<"watchlist" | "thesis">; direction: "up" | "down" | null }>();
  for (const w of watchlists) {
    for (const t of w.tickers) {
      const row = names.get(t) ?? { via: new Set(), direction: null };
      row.via.add("watchlist");
      names.set(t, row);
    }
  }
  for (const th of theses) {
    if (th.status !== "open") continue;
    for (const i of th.instruments) {
      const row = names.get(i.ticker) ?? { via: new Set(), direction: null };
      row.via.add("thesis");
      row.direction = i.expected;
      names.set(i.ticker, row);
    }
  }
  return names;
}

function nameMove(ticker: string, quotes: Quotes, baseline: BriefBaseline | null) {
  const q = quotes?.[ticker];
  if (!q || !Number.isFinite(q.last) || q.last <= 0) return { changePct: null, changeBasis: null } as const;
  const then = baseline?.prices[ticker];
  if (then && then > 0) return { changePct: round1(((q.last - then) / then) * 100), changeBasis: "since_seen" } as const;
  if (typeof q.changePct === "number" && Number.isFinite(q.changePct)) {
    return { changePct: round1(q.changePct), changeBasis: "session" } as const;
  }
  return { changePct: null, changeBasis: null } as const;
}

function touches(event: RadarEvent) {
  const out = new Map<string, { direction: "up" | "down" | "mixed"; reason: string }>();
  for (const t of event.trades) {
    if (out.has(t.ticker)) continue;
    out.set(t.ticker, {
      direction: t.side === "long" ? "up" : "down",
      reason: t.causalPath || t.reason || (t.distance != null ? `ripple ${t.distance}` : "on the book"),
    });
  }
  for (const n of event.nodes) {
    if (!n.ticker || out.has(n.ticker)) continue;
    out.set(n.ticker, { direction: n.direction, reason: `${n.label} (ripple ${n.level})` });
  }
  return out;
}

function summarize(
  event: RadarEvent,
  names: ReturnType<typeof yourNames>,
  quotes: Quotes,
  baseline: BriefBaseline | null,
): BookBrief {
  const seen = baseline?.books[event.id];
  const isNewBook = !!baseline && !seen;
  const delta = seen ? event.probability - seen.probability : isNewBook ? 0 : event.probabilityDelta ?? 0;
  const ranked = [...event.scenarios].sort((a, b) => b.probability - a.probability);
  const lead = ranked[0];
  const leadThen = lead && seen ? seen.scenarios[lead.id] : undefined;
  const since = baseline?.at ?? null;
  const evidence = [...event.evidence]
    .filter((e) => !e.duplicateOf)
    .sort((a, b) => (b.availableTimeMs ?? 0) - (a.availableTimeMs ?? 0));
  const fresh = since != null ? evidence.filter((e) => (e.availableTimeMs ?? 0) > since) : [];
  const exposures: Exposure[] = [];
  for (const [ticker, how] of touches(event)) {
    const mine = names.get(ticker);
    if (!mine) continue;
    const move = nameMove(ticker, quotes, baseline);
    exposures.push({
      ticker,
      via: [...mine.via],
      bookDirection: how.direction,
      yourDirection: mine.direction,
      conflict: mine.direction != null && how.direction !== "mixed" && mine.direction !== how.direction,
      changePct: move.changePct,
      changeBasis: move.changeBasis,
      reason: how.reason,
    });
  }
  const conflicts = exposures.filter((e) => e.conflict).length;
  return {
    eventId: event.id,
    title: event.title,
    probability: event.probability,
    delta,
    deltaBasis: seen ? "since_seen" : "last_update",
    lead: lead
      ? { id: lead.id, name: lead.name, probability: lead.probability, delta: leadThen != null ? lead.probability - leadThen : null }
      : null,
    alternatives: ranked.slice(1, 3).map((s) => ({ name: s.name, probability: s.probability })),
    horizon: shortestHorizonLabel(event),
    invalidation: (event.invalidation ?? []).slice(0, 2),
    evidence: evidence.slice(0, 3).map((e) => ({
      headline: e.headline,
      source: e.source,
      time: e.time,
      isNew: since != null && (e.availableTimeMs ?? 0) > since,
    })),
    newEvidence: fresh.length,
    exposures,
    weight: Math.abs(delta) + 2 * Math.min(fresh.length, 5) + 3 * exposures.length + 5 * conflicts + (isNewBook ? 5 : 0),
    isNewBook,
  };
}

export function buildBrief(input: {
  events: RadarEvent[];
  quotes: Quotes;
  watchlists: Watchlist[];
  theses: Thesis[];
  baseline: BriefBaseline | null;
  now: Date;
}): Brief {
  const { events, quotes, watchlists, theses, baseline, now } = input;
  const names = yourNames(watchlists, theses);
  const books: BookBrief[] = [];
  const elsewhere: BookBrief[] = [];
  const reached = new Set<string>();
  for (const event of events) {
    if (!event.id) continue;
    const b = summarize(event, names, quotes, baseline);
    if (b.exposures.length) {
      books.push(b);
      b.exposures.forEach((e) => reached.add(e.ticker));
    } else if (Math.abs(b.delta) >= MATERIAL_PTS || b.isNewBook) {
      elsewhere.push(b);
    }
  }
  books.sort((a, b) => b.weight - a.weight);
  elsewhere.sort((a, b) => b.weight - a.weight);

  const unexplained: Brief["unexplained"] = [];
  for (const ticker of names.keys()) {
    if (reached.has(ticker)) continue;
    const move = nameMove(ticker, quotes, baseline);
    if (move.changePct != null && Math.abs(move.changePct) >= MATERIAL_MOVE_PCT) {
      unexplained.push({ ticker, changePct: move.changePct, changeBasis: move.changeBasis! });
    }
  }
  unexplained.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  const byId = new Map(events.map((e) => [e.id, e]));
  const attention = theses
    .filter((t) => t.status === "open")
    .map((thesis) => ({ thesis, monitor: monitorThesis(thesis, byId.get(thesis.eventId) ?? null, quotes, now) }))
    .filter((r) => r.monitor.due || r.monitor.flags.length > 0)
    .sort((a, b) => a.monitor.hoursLeft - b.monitor.hoursLeft);

  return {
    since: baseline?.at ?? null,
    books,
    elsewhere: elsewhere.slice(0, 5),
    unexplained,
    theses: attention,
    exposureCount: names.size,
  };
}

/** What to compare against next time: the books and your names as they stand now. */
export function baselineFrom(events: RadarEvent[], quotes: Quotes, tickers: string[], now: Date): BriefBaseline {
  const books: BriefBaseline["books"] = {};
  for (const e of events) {
    if (!e.id) continue;
    books[e.id] = { probability: e.probability, scenarios: Object.fromEntries(e.scenarios.map((s) => [s.id, s.probability])) };
  }
  const prices: Record<string, number> = {};
  for (const t of tickers) {
    const last = quotes?.[t]?.last;
    if (typeof last === "number" && Number.isFinite(last) && last > 0) prices[t] = last;
  }
  return { at: now.getTime(), books, prices };
}

export function briefTickers(watchlists: Watchlist[], theses: Thesis[]): string[] {
  return [...yourNames(watchlists, theses).keys()];
}

// ------------------------------------------------------------ persistence --
// The read-marker is a per-viewer convenience, kept on this device under the
// signed-in identity's partition; it is not research and is not synced.

export function baselineKey(deskKey: string) {
  return `${deskKey}:brief-seen`;
}

export function readBaseline(key: string): BriefBaseline | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BriefBaseline;
    return typeof parsed?.at === "number" && parsed.books && parsed.prices ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBaseline(key: string, baseline: BriefBaseline) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(baseline));
  } catch {
    // Storage unavailable (private window): the brief falls back to session moves.
  }
}
