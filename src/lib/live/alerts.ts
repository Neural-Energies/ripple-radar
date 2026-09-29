/**
 * Alert rules: one metric, one unit, one explicit target (PR #5 B02).
 *
 * The previous evaluator guessed. A rule whose book had left the desk fell
 * through to whichever book was first and fired on it; a "Price" threshold
 * was compared against the absolute session percent; scenario and crowding
 * rules read their intent out of free-text titles. Now:
 *
 * - A rule is bound at creation to an exact book (and scenario) or ticker.
 *   A missing target suspends the rule. It is never re-bound.
 * - Each metric has one unit. Last price, signed session percent and
 *   absolute session percent are separate metrics.
 * - A quote that is missing or stale is "unavailable", not evidence.
 * - Thresholds are validated against an explicit contract per metric.
 * - A rule fires once when its condition becomes true (an episode) and again
 *   only after it has been false, so a held condition does not re-notify.
 *
 * The same code runs in the browser (live status) and on the server (durable
 * delivery), against the same event list.
 */
import type { AlertMetric, AlertOperator, AlertRule, DeskBook } from "@/data/types";
import { liveEventsList } from "./overlay";
import type { AlertHit, LiveDesk, QuoteState } from "./types";

type TargetKind = "book" | "scenario" | "ticker";

export interface MetricSpec {
  label: string;
  target: TargetKind;
  unit: "%" | "pts" | "items" | "price";
  operators: AlertOperator[];
  /** Human statement of the threshold contract, shown on the form. */
  contract: string;
  valid: (t: number) => boolean;
  defaultThreshold: number;
}

export const METRICS: Record<AlertMetric, MetricSpec> = {
  book_probability: {
    label: "Book probability",
    target: "book",
    unit: "%",
    operators: ["above", "below"],
    contract: "Percent, strictly between 0 and 100.",
    valid: (t) => t > 0 && t < 100,
    defaultThreshold: 60,
  },
  scenario_probability: {
    label: "Scenario probability",
    target: "scenario",
    unit: "%",
    operators: ["above", "below"],
    contract: "Percent, strictly between 0 and 100.",
    valid: (t) => t > 0 && t < 100,
    defaultThreshold: 40,
  },
  scenario_move: {
    label: "Scenario move",
    target: "scenario",
    unit: "pts",
    operators: ["above"],
    contract: "Points moved in one update, greater than 0 and at most 100.",
    valid: (t) => t > 0 && t <= 100,
    defaultThreshold: 5,
  },
  book_evidence: {
    label: "Live evidence on book",
    target: "book",
    unit: "items",
    operators: ["above"],
    contract: "A whole number of live items, 1 or more.",
    valid: (t) => Number.isInteger(t) && t >= 1,
    defaultThreshold: 4,
  },
  price_last: {
    label: "Last price",
    target: "ticker",
    unit: "price",
    operators: ["above", "below"],
    contract: "A price greater than 0, in the instrument's quote currency.",
    valid: (t) => t > 0,
    defaultThreshold: 100,
  },
  price_change_pct: {
    label: "Session change (signed %)",
    target: "ticker",
    unit: "%",
    operators: ["above", "below"],
    contract: "Signed percent, non-zero, between −100 and +100. Above +2 needs a rise of 2%; a fall never satisfies it.",
    valid: (t) => t !== 0 && t >= -100 && t <= 100,
    defaultThreshold: 2,
  },
  price_abs_change_pct: {
    label: "Session move, either way (%)",
    target: "ticker",
    unit: "%",
    operators: ["above", "below"],
    contract: "Size of the session move in percent, greater than 0 and at most 100.",
    valid: (t) => t > 0 && t <= 100,
    defaultThreshold: 3,
  },
};

export const METRIC_ORDER = Object.keys(METRICS) as AlertMetric[];

const TICKER = /^[A-Z0-9][A-Z0-9.=^-]{0,14}$/;

export type RuleDraft = Pick<AlertRule, "metric" | "operator" | "threshold" | "eventId" | "scenarioId" | "ticker">;

/** Why a draft is not a valid rule. Empty when it is. */
export function validateRule(r: RuleDraft): string[] {
  const errors: string[] = [];
  const spec = r.metric ? METRICS[r.metric] : undefined;
  if (!spec) return ["Choose what to measure."];
  if (!r.operator || !spec.operators.includes(r.operator)) errors.push(`${spec.label} supports: ${spec.operators.join(", ")}.`);
  if (typeof r.threshold !== "number" || !Number.isFinite(r.threshold) || !spec.valid(r.threshold)) errors.push(spec.contract);
  if ((spec.target === "book" || spec.target === "scenario") && !r.eventId) errors.push("Choose the book this rule watches.");
  if (spec.target === "scenario" && !r.scenarioId) errors.push("Choose the scenario this rule watches.");
  if (spec.target === "ticker" && !(r.ticker && TICKER.test(r.ticker))) errors.push("Enter the ticker this rule watches.");
  return errors;
}

function fmt(value: number, unit: MetricSpec["unit"], signed = false) {
  if (unit === "price") return value.toFixed(value >= 1 ? 2 : 4);
  if (unit === "items") return String(Math.round(value));
  const sign = signed && value > 0 ? "+" : "";
  const n = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return unit === "%" ? `${sign}${n}%` : `${sign}${n} pts`;
}

/** A plain statement of the rule from its structure, not its title. */
export function describeRule(r: AlertRule): string {
  if (!r.metric) return "Needs a structured target";
  const spec = METRICS[r.metric];
  const op = r.operator === "below" ? "≤" : "≥";
  const target = spec.target === "ticker" ? r.ticker : r.targetLabel || r.eventId;
  const t = typeof r.threshold === "number" ? fmt(r.threshold, spec.unit, r.metric === "price_change_pct") : "?";
  return `${target} · ${spec.label} ${op} ${t}`;
}

// ------------------------------------------------------------- the world --

export interface WorldBook {
  title: string;
  probability: number;
  hits: number;
  scenarios: { id: string; name: string; probability: number; prevProbability: number }[];
}

export interface WorldQuote {
  last: number;
  changePct: number;
  state: QuoteState;
}

export interface AlertWorld {
  books: Record<string, WorldBook>;
  quotes: Record<string, WorldQuote | undefined>;
}

/**
 * The books and quotes rules are evaluated against: the tape's books plus the
 * account's own desk books, exactly as the desk lists them (without unsaved
 * in-browser rescores, which the server never sees).
 */
export function worldFromDesk(desk: LiveDesk, deskBooks: DeskBook[] = []): AlertWorld {
  const books: Record<string, WorldBook> = {};
  for (const e of liveEventsList(desk, {}, deskBooks)) {
    if (!e.id) continue;
    books[e.id] = {
      title: e.title,
      probability: e.probability,
      hits: desk.books[e.id]?.hits ?? e.evidence.length,
      scenarios: e.scenarios.map((s) => ({ id: s.id, name: s.name, probability: s.probability, prevProbability: s.prevProbability })),
    };
  }
  return { books, quotes: desk.quotes };
}

// ------------------------------------------------------------ evaluation --

export type Evaluation =
  | { status: "ok"; value: number; satisfied: boolean; reason: string }
  /** The target is gone: the rule is suspended, never moved to another target. */
  | { status: "suspended"; reason: string }
  /** The target exists but its reading cannot be trusted right now. */
  | { status: "unavailable"; reason: string }
  /** Paused, invalid, or a rule that predates structured targets. */
  | { status: "inactive"; reason: string };

function compare(value: number, operator: AlertOperator, threshold: number) {
  return operator === "below" ? value <= threshold : value >= threshold;
}

export function evaluateRule(rule: AlertRule, world: AlertWorld): Evaluation {
  if (!rule.metric) return { status: "inactive", reason: "Created before structured alerts: recreate it with an explicit target." };
  const errors = validateRule(rule);
  if (errors.length) return { status: "inactive", reason: errors[0]! };
  if (!rule.active) return { status: "inactive", reason: "Paused." };
  const spec = METRICS[rule.metric];
  const operator = rule.operator!;
  const threshold = rule.threshold!;
  const signed = rule.metric === "price_change_pct";

  let value: number;
  let subject: string;
  if (spec.target === "ticker") {
    const q = world.quotes[rule.ticker!];
    if (!q || !Number.isFinite(q.last) || q.last <= 0) return { status: "unavailable", reason: `No quote for ${rule.ticker}.` };
    if (q.state === "stale") return { status: "unavailable", reason: `${rule.ticker} quote is stale.` };
    if (rule.metric === "price_last") value = q.last;
    else {
      if (!Number.isFinite(q.changePct)) return { status: "unavailable", reason: `No session change for ${rule.ticker}.` };
      value = rule.metric === "price_abs_change_pct" ? Math.abs(q.changePct) : q.changePct;
    }
    subject = rule.ticker!;
  } else {
    const book = world.books[rule.eventId!];
    if (!book) {
      return {
        status: "suspended",
        reason: `${rule.targetLabel || rule.eventId} is no longer on the desk. Suspended — it will not watch another book.`,
      };
    }
    subject = book.title;
    if (spec.target === "scenario") {
      const s = book.scenarios.find((x) => x.id === rule.scenarioId);
      if (!s) return { status: "suspended", reason: `The book no longer carries scenario ${rule.scenarioId}. Suspended.` };
      subject = `${book.title} · ${s.name}`;
      value = rule.metric === "scenario_move" ? Math.abs(s.probability - s.prevProbability) : s.probability;
    } else {
      value = rule.metric === "book_evidence" ? book.hits : book.probability;
    }
  }
  const satisfied = compare(value, operator, threshold);
  const op = operator === "below" ? "≤" : "≥";
  return {
    status: "ok",
    value,
    satisfied,
    reason: `${subject}: ${spec.label.toLowerCase()} ${fmt(value, spec.unit, signed)} ${satisfied ? op : "vs"} ${fmt(threshold, spec.unit, signed)}`,
  };
}

// -------------------------------------------------------------- episodes --

export interface RuleState {
  satisfied: boolean;
  /** When the current satisfied episode began; null while not satisfied. */
  since: number | null;
}

/**
 * Advance one rule's state. Fires only on the transition into "satisfied".
 * A suspended or unavailable reading holds the previous state, so an outage
 * neither fires nor starts a fresh episode when it ends.
 */
export function stepRule(prev: RuleState | null, evaluation: Evaluation, now: number): { next: RuleState; fired: boolean } {
  const held = prev ?? { satisfied: false, since: null };
  if (evaluation.status === "inactive") return { next: { satisfied: false, since: null }, fired: false };
  if (evaluation.status !== "ok") return { next: held, fired: false };
  if (!evaluation.satisfied) return { next: { satisfied: false, since: null }, fired: false };
  if (held.satisfied) return { next: held, fired: false };
  return { next: { satisfied: true, since: now }, fired: true };
}

export function episodeKey(ruleId: string, since: number) {
  return `${ruleId}@${since}`;
}

/** Live status for every rule, and the ones currently satisfied. */
export function evaluateAlerts(alerts: AlertRule[], desk: LiveDesk, deskBooks: DeskBook[] = []) {
  const world = worldFromDesk(desk, deskBooks);
  const status: Record<string, Evaluation> = {};
  const hits: AlertHit[] = [];
  for (const a of alerts) {
    const e = evaluateRule(a, world);
    status[a.id] = e;
    if (e.status === "ok" && e.satisfied) hits.push({ id: a.id, reason: e.reason });
  }
  return { status, hits };
}
