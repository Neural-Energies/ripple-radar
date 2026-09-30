/**
 * Saved theses: the end of the research loop (event → map → assets →
 * scenarios → thesis → monitoring → review).
 *
 * Three rules hold throughout:
 *
 * 1. A thesis freezes what was believed when it was saved — the book's
 *    probability, the scenario's, the evidence, the prices. Monitoring and
 *    review read the live book beside it and never rewrite it.
 * 2. A thesis follows its own book by id. A book that has left the desk is
 *    reported as gone, never swapped for whichever book is first.
 * 3. Monitoring is mechanical: every signal is a number or a match the
 *    engine already produced, so it can be checked, not narrated.
 */
import type { RadarEvent, Thesis } from "@/data/types";
import { horizonHoursFor, MAX_HORIZON_HOURS, MIN_HORIZON_HOURS, parseHorizonHours } from "@/lib/live/horizon";

export type QuoteLookup = Record<string, { last: number } | undefined> | undefined;

/** What the trader edits before saving. Everything else is taken from the book. */
export interface ThesisDraft {
  statement: string;
  scenarioId: string | null;
  horizon: string;
  instruments: { ticker: string; expected: "up" | "down" }[];
  triggers: string[];
  invalidation: string[];
}

const HOUR = 3_600_000;
const MAX_INSTRUMENTS = 6;
const MAX_EVIDENCE = 5;

function price(quotes: QuoteLookup, ticker: string): number | null {
  const last = quotes?.[ticker]?.last;
  return typeof last === "number" && Number.isFinite(last) && last > 0 ? last : null;
}

function uniq(rows: string[]): string[] {
  return [...new Set(rows.map((r) => r.trim()).filter(Boolean))];
}

function topScenario(event: RadarEvent) {
  return [...(event.scenarios ?? [])].sort((a, b) => b.probability - a.probability)[0] ?? null;
}

/** The book's shortest stated horizon, as its own label. */
export function shortestHorizonLabel(event: RadarEvent): string {
  const labels = [
    ...(event.horizons ?? []).map((h) => h.horizon),
    ...(event.forecastHorizon ? event.forecastHorizon.split(/[\s/·,]+/) : []),
  ];
  let best: { label: string; hours: number } | null = null;
  for (const label of labels) {
    const hours = parseHorizonHours(label);
    if (hours != null && (!best || hours < best.hours)) best = { label: label.trim(), hours };
  }
  return best?.label ?? `${horizonHoursFor(event)}h`;
}

/** A starting draft from the book: its lead scenario, its trades, its own invalidation. */
export function draftFromEvent(event: RadarEvent, scenarioId?: string | null): ThesisDraft {
  const scenario = (scenarioId && event.scenarios.find((s) => s.id === scenarioId)) || topScenario(event);
  const trades = [...event.trades].sort((a, b) => Number(!!b.headline) - Number(!!a.headline) || b.score - a.score);
  const seen = new Set<string>();
  const instruments: ThesisDraft["instruments"] = [];
  for (const t of trades) {
    if (seen.has(t.ticker) || instruments.length >= MAX_INSTRUMENTS) continue;
    seen.add(t.ticker);
    instruments.push({ ticker: t.ticker, expected: t.side === "long" ? "up" : "down" });
  }
  const expected = event.expectedEvidence ?? [];
  const forScenario = expected.filter((e) => !scenario || e.scenarioId === scenario.id);
  return {
    statement: scenario ? `${scenario.name}: ${scenario.keyOutcomes || scenario.detail}`.trim() : event.summary,
    scenarioId: scenario?.id ?? null,
    horizon: shortestHorizonLabel(event),
    instruments,
    triggers: uniq((forScenario.length ? forScenario : expected).map((e) => e.observe)).slice(0, 4),
    invalidation: uniq([...(event.invalidation ?? []), ...trades.map((t) => t.invalidation ?? "")]).slice(0, 4),
  };
}

/** Hours to the review, from the draft's horizon label; the book's own when unreadable. */
export function horizonHours(draft: Pick<ThesisDraft, "horizon">, event: RadarEvent): number {
  const parsed = parseHorizonHours(draft.horizon);
  const hours = parsed ?? horizonHoursFor(event);
  return Math.round(Math.min(MAX_HORIZON_HOURS, Math.max(MIN_HORIZON_HOURS, hours)));
}

export type DraftProblem = "statement" | "instruments" | "invalidation" | "book";

/** Why a draft cannot be saved yet. A thesis without a way to be wrong is not a thesis. */
export function draftProblems(draft: ThesisDraft, event: RadarEvent | null): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!event?.id) out.push("book");
  if (!draft.statement.trim()) out.push("statement");
  if (draft.instruments.length === 0) out.push("instruments");
  if (uniq(draft.invalidation).length === 0) out.push("invalidation");
  return out;
}

/** Freeze the draft against the book as it stands now. */
export function buildThesis(
  event: RadarEvent,
  draft: ThesisDraft,
  quotes: QuoteLookup,
  now: Date,
  id = `t-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
): Thesis {
  const scenario = draft.scenarioId ? event.scenarios.find((s) => s.id === draft.scenarioId) ?? null : null;
  const hours = horizonHours(draft, event);
  const evidence = [...(event.evidence ?? [])]
    .filter((e) => !e.duplicateOf)
    .sort((a, b) => (b.availableTimeMs ?? 0) - (a.availableTimeMs ?? 0))
    .slice(0, MAX_EVIDENCE)
    .map((e) => ({ headline: e.headline, source: e.source, time: e.time }));
  const alternatives = event.scenarios
    .filter((s) => s.id !== scenario?.id)
    .sort((a, b) => b.probability - a.probability)
    .map((s) => ({ name: s.name, probability: s.probability }));
  return {
    id,
    createdAt: now.toISOString(),
    eventId: event.id,
    eventTitle: event.title,
    statement: draft.statement.trim(),
    scenarioId: scenario?.id ?? null,
    scenarioName: scenario?.name ?? null,
    scenarioProbability: scenario?.probability ?? null,
    bookProbability: event.probability,
    horizon: draft.horizon.trim(),
    horizonHours: hours,
    reviewAt: new Date(now.getTime() + hours * HOUR).toISOString(),
    instruments: draft.instruments.map((i) => ({ ...i, priceAtSave: price(quotes, i.ticker) })),
    triggers: uniq(draft.triggers),
    invalidation: uniq(draft.invalidation),
    evidence,
    alternatives,
    status: "open",
  };
}

export interface InstrumentCheck {
  ticker: string;
  expected: "up" | "down";
  priceAtSave: number | null;
  priceNow: number | null;
  /** Percent change since the thesis was saved; null without both prices. */
  changePct: number | null;
  /** True when the move is in the expected direction, null when unknown or flat. */
  agrees: boolean | null;
}

export interface ThesisMonitor {
  /** Negative once the review date has passed. */
  hoursLeft: number;
  due: boolean;
  /** Whether the thesis's own book is still on the desk. */
  onDesk: boolean;
  bookNow: number | null;
  bookDelta: number | null;
  scenarioNow: number | null;
  scenarioDelta: number | null;
  /** The scenario the book now leads with, when it is not the thesis's. */
  leaderNow: { name: string; probability: number } | null;
  instruments: InstrumentCheck[];
  /** Expected evidence for the thesis's scenario that the monitor has matched. */
  triggersSeen: { observe: string; headline: string | null }[];
  /** Market confirmation turned against the transmission. */
  invalidating: boolean;
  /** Plain-language flags, most serious first. Empty means nothing has broken. */
  flags: string[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function checkInstruments(thesis: Thesis, quotes: QuoteLookup): InstrumentCheck[] {
  return thesis.instruments.map((i) => {
    const now = price(quotes, i.ticker);
    const changePct = i.priceAtSave != null && now != null ? round1(((now - i.priceAtSave) / i.priceAtSave) * 100) : null;
    const agrees = changePct == null || changePct === 0 ? null : (changePct > 0) === (i.expected === "up");
    return { ticker: i.ticker, expected: i.expected, priceAtSave: i.priceAtSave, priceNow: now, changePct, agrees };
  });
}

/**
 * How the thesis stands against the live book and tape.
 *
 * `event` must be the thesis's own book (looked up by id) or null — never a
 * substitute.
 */
export function monitorThesis(thesis: Thesis, event: RadarEvent | null, quotes: QuoteLookup, now: Date): ThesisMonitor {
  const own = event && event.id === thesis.eventId ? event : null;
  const hoursLeft = round1((Date.parse(thesis.reviewAt) - now.getTime()) / HOUR);
  const scenario = own && thesis.scenarioId ? own.scenarios.find((s) => s.id === thesis.scenarioId) ?? null : null;
  const leader = own ? topScenario(own) : null;
  const instruments = checkInstruments(thesis, quotes);
  const bookNow = own ? own.probability : null;
  const bookDelta = bookNow != null ? bookNow - thesis.bookProbability : null;
  const scenarioNow = scenario ? scenario.probability : null;
  const scenarioDelta = scenarioNow != null && thesis.scenarioProbability != null ? scenarioNow - thesis.scenarioProbability : null;
  const triggersSeen = (own?.expectedEvidence ?? [])
    .filter((e) => e.appeared && (!thesis.scenarioId || e.scenarioId === thesis.scenarioId))
    .map((e) => ({ observe: e.observe, headline: e.matchedHeadline ?? null }));
  const invalidating = own?.confirmationState === "invalidating";

  const flags: string[] = [];
  if (!own) flags.push("Book is no longer on the desk — review against prices and the saved evidence.");
  if (invalidating) flags.push("Market confirmation is invalidating the transmission.");
  if (own && thesis.scenarioId && !scenario) flags.push("The book no longer carries this scenario.");
  if (scenarioDelta != null && scenarioDelta <= -10) flags.push(`Scenario probability down ${Math.abs(scenarioDelta)} pts since saved.`);
  if (leader && scenario && leader.id !== scenario.id) flags.push(`Book now leads with "${leader.name}" (${leader.probability}%).`);
  const against = instruments.filter((i) => i.agrees === false).length;
  const known = instruments.filter((i) => i.agrees != null).length;
  if (known > 0 && against * 2 > known) flags.push(`${against} of ${known} priced instruments are moving against the thesis.`);
  if (hoursLeft <= 0) flags.push("Due for review.");

  return {
    hoursLeft,
    due: hoursLeft <= 0,
    onDesk: !!own,
    bookNow,
    bookDelta,
    scenarioNow,
    scenarioDelta,
    leaderNow: leader && (!scenario || leader.id !== scenario.id) ? { name: leader.name, probability: leader.probability } : null,
    instruments,
    triggersSeen,
    invalidating,
    flags,
  };
}

/** The review record: the outcome plus what the book and prices said at review time. */
export function reviewRecord(
  thesis: Thesis,
  event: RadarEvent | null,
  quotes: QuoteLookup,
  now: Date,
  outcome: NonNullable<Thesis["review"]>["outcome"],
  note: string,
): NonNullable<Thesis["review"]> {
  const m = monitorThesis(thesis, event, quotes, now);
  return {
    at: now.toISOString(),
    outcome,
    note: note.trim(),
    bookProbability: m.bookNow,
    scenarioProbability: m.scenarioNow,
    prices: m.instruments.map((i) => ({ ticker: i.ticker, price: i.priceNow, changePct: i.changePct })),
  };
}

/** Outcome counts across reviewed theses, for the review log. */
export function reviewTally(theses: Thesis[]) {
  const reviewed = theses.filter((t) => t.status === "reviewed" && t.review);
  const count = (o: NonNullable<Thesis["review"]>["outcome"]) => reviewed.filter((t) => t.review!.outcome === o).length;
  return { reviewed: reviewed.length, right: count("right"), wrong: count("wrong"), mixed: count("mixed"), unclear: count("unclear") };
}

export interface ThesisOutcomes {
  reviewed: number;
  right: number;
  wrong: number;
  mixed: number;
  unclear: number;
  /** right / (right + wrong); null until one thesis is decided either way. */
  hitRate: number | null;
  /**
   * Brier score of the probability each decided thesis was saved at (its
   * scenario's, else the book's), against right = 1, wrong = 0. Mixed and
   * unclear reviews are not scored.
   */
  brier: number | null;
  decided: number;
  /** Mean saved probability, in percent, of theses later judged right and wrong. */
  meanSavedRight: number | null;
  meanSavedWrong: number | null;
  /** Instruments in reviewed theses whose price at review moved as expected, of those with a move. */
  instruments: { withMove: number; asExpected: number };
  /** Open theses past their review date. */
  awaitingReview: number;
  /** Most recent reviews first. */
  recent: Thesis[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** How the account's own reviewed theses turned out, for the learning page. */
export function thesisOutcomes(theses: Thesis[], now: Date, recent = 5): ThesisOutcomes {
  const tally = reviewTally(theses);
  const reviewed = theses.filter((t) => t.status === "reviewed" && t.review);
  const decided = reviewed.filter((t) => t.review!.outcome === "right" || t.review!.outcome === "wrong");
  const saved = (t: Thesis) => t.scenarioProbability ?? t.bookProbability;
  const brier = mean(decided.map((t) => (saved(t) / 100 - (t.review!.outcome === "right" ? 1 : 0)) ** 2));
  let withMove = 0;
  let asExpected = 0;
  for (const t of reviewed) {
    for (const p of t.review!.prices) {
      const expected = t.instruments.find((i) => i.ticker === p.ticker)?.expected;
      if (!expected || p.changePct == null || p.changePct === 0) continue;
      withMove += 1;
      if ((p.changePct > 0) === (expected === "up")) asExpected += 1;
    }
  }
  return {
    ...tally,
    hitRate: tally.right + tally.wrong > 0 ? tally.right / (tally.right + tally.wrong) : null,
    brier: brier == null ? null : Math.round(brier * 10_000) / 10_000,
    decided: decided.length,
    meanSavedRight: mean(decided.filter((t) => t.review!.outcome === "right").map(saved)),
    meanSavedWrong: mean(decided.filter((t) => t.review!.outcome === "wrong").map(saved)),
    instruments: { withMove, asExpected },
    awaitingReview: theses.filter((t) => t.status === "open" && Date.parse(t.reviewAt) <= now.getTime()).length,
    recent: [...reviewed].sort((a, b) => Date.parse(b.review!.at) - Date.parse(a.review!.at)).slice(0, recent),
  };
}
