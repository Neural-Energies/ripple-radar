/**
 * The research loop's last three steps: save a thesis, monitor it, review it.
 * A saved thesis must keep what was believed when it was saved, follow its
 * own book, and be judged on mechanical signals.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadarEvent, Scenario } from "@/data/types";
import { EMPTY_EVENT } from "@/lib/engine/placeholder";
import {
  buildThesis,
  draftFromEvent,
  draftProblems,
  monitorThesis,
  reviewRecord,
  reviewTally,
  shortestHorizonLabel,
  thesisOutcomes,
} from "./thesis";

const scenario = (id: string, name: string, probability: number): Scenario => ({
  id,
  name,
  detail: `${name} detail`,
  probability,
  prevProbability: probability,
  range: "",
  keyOutcomes: `${name} outcomes`,
  audit: { previous: probability, updated: probability, evidence: "", direction: "up", weight: 0, affectedNodes: [], rescoredAssets: [] },
});

function book(over: Partial<RadarEvent> = {}): RadarEvent {
  return {
    ...EMPTY_EVENT,
    id: "hormuz",
    title: "Hormuz transit disruption",
    summary: "Tanker traffic through Hormuz is disrupted.",
    probability: 62,
    scenarios: [scenario("s-base", "Contained", 30), scenario("s-esc", "Escalation", 55), scenario("s-de", "De-escalation", 15)],
    trades: [
      { ticker: "XLE", name: "Energy", score: 70, reason: "", side: "long", category: "etf", horizon: "7d", invalidation: "Brent back under 80" },
      { ticker: "JETS", name: "Airlines", score: 60, reason: "", side: "short", category: "etf", horizon: "7d" },
      { ticker: "USO", name: "Oil", score: 90, reason: "", side: "long", category: "etf", horizon: "7d", headline: true },
    ],
    horizons: [
      { horizon: "30d", probability: 50, note: "" },
      { horizon: "7d", probability: 40, note: "" },
    ],
    invalidation: ["Transit resumes at normal volumes"],
    expectedEvidence: [
      { id: "e1", scenarioId: "s-esc", ifTrue: "", observe: "War-risk premia widen", lag: "1d", appeared: false },
      { id: "e2", scenarioId: "s-base", ifTrue: "", observe: "Escorts announced", lag: "2d", appeared: false },
    ],
    evidence: [
      { id: "a", time: "09:00", eventTimeMs: 1, availableTimeMs: 1, source: "Reuters", evidenceClass: "narrative", kind: "news", headline: "Old", delayed: false },
      { id: "b", time: "10:00", eventTimeMs: 2, availableTimeMs: 2, source: "AP", evidenceClass: "narrative", kind: "news", headline: "New", delayed: false },
      { id: "c", time: "10:01", eventTimeMs: 3, availableTimeMs: 3, source: "AP", evidenceClass: "narrative", kind: "news", headline: "Dup", delayed: false, duplicateOf: "b" },
    ],
    ...over,
  };
}

const NOW = new Date("2026-09-29T12:00:00Z");
const quotes = { XLE: { last: 100 }, JETS: { last: 20 }, USO: { last: 80 } };

test("the draft comes from the book: lead scenario, headline trade first, its triggers and invalidation", () => {
  const d = draftFromEvent(book());
  assert.equal(d.scenarioId, "s-esc");
  assert.equal(d.horizon, "7d", "the shortest stated horizon, as the book labels it");
  assert.deepEqual(d.instruments.map((i) => [i.ticker, i.expected]), [["USO", "up"], ["XLE", "up"], ["JETS", "down"]]);
  assert.deepEqual(d.triggers, ["War-risk premia widen"], "only the chosen scenario's expected evidence");
  assert.deepEqual(d.invalidation, ["Transit resumes at normal volumes", "Brent back under 80"]);
  assert.equal(draftFromEvent(book(), "s-base").scenarioId, "s-base");
});

test("a thesis cannot be saved without a claim, an instrument and a way to be wrong", () => {
  const d = draftFromEvent(book());
  assert.deepEqual(draftProblems(d, book()), []);
  assert.deepEqual(draftProblems({ ...d, statement: " ", instruments: [], invalidation: [""] }, book()), ["statement", "instruments", "invalidation"]);
  assert.deepEqual(draftProblems(d, EMPTY_EVENT), ["book"]);
});

test("saving freezes the book's probabilities, prices, evidence and alternatives, and schedules the review", () => {
  const t = buildThesis(book(), draftFromEvent(book()), quotes, NOW, "t1");
  assert.equal(t.bookProbability, 62);
  assert.equal(t.scenarioProbability, 55);
  assert.equal(t.horizonHours, 168);
  assert.equal(t.reviewAt, "2026-10-06T12:00:00.000Z");
  assert.deepEqual(t.instruments.map((i) => i.priceAtSave), [80, 100, 20]);
  assert.deepEqual(t.evidence.map((e) => e.headline), ["New", "Old"], "newest first, duplicates dropped");
  assert.deepEqual(t.alternatives, [{ name: "Contained", probability: 30 }, { name: "De-escalation", probability: 15 }]);
  assert.equal(buildThesis(book(), { ...draftFromEvent(book()), horizon: "nonsense" }, quotes, NOW).horizonHours, 168, "an unreadable horizon falls back to the book's");
  assert.equal(buildThesis(book(), draftFromEvent(book()), {}, NOW).instruments[0]!.priceAtSave, null, "no quote is recorded as unknown, not zero");
});

test("monitoring reads the live book beside the frozen thesis without changing it", () => {
  const t = buildThesis(book(), draftFromEvent(book()), quotes, NOW, "t1");
  const frozen = structuredClone(t);
  const later = book({
    probability: 48,
    scenarios: [scenario("s-base", "Contained", 60), scenario("s-esc", "Escalation", 30), scenario("s-de", "De-escalation", 10)],
    expectedEvidence: [
      { id: "e1", scenarioId: "s-esc", ifTrue: "", observe: "War-risk premia widen", lag: "1d", appeared: true, matchedHeadline: "Lloyd's lifts premia" },
      { id: "e2", scenarioId: "s-base", ifTrue: "", observe: "Escorts announced", lag: "2d", appeared: true },
    ],
  });
  const m = monitorThesis(t, later, { XLE: { last: 95 }, JETS: { last: 21 }, USO: { last: 84 } }, new Date("2026-10-01T12:00:00Z"));
  assert.deepEqual(t, frozen, "the saved thesis is untouched");
  assert.equal(m.onDesk, true);
  assert.equal(m.hoursLeft, 120);
  assert.equal(m.due, false);
  assert.equal(m.bookDelta, -14);
  assert.equal(m.scenarioNow, 30);
  assert.equal(m.scenarioDelta, -25);
  assert.deepEqual(m.leaderNow, { name: "Contained", probability: 60 });
  assert.deepEqual(m.instruments.map((i) => [i.ticker, i.changePct, i.agrees]), [["USO", 5, true], ["XLE", -5, false], ["JETS", 5, false]]);
  assert.deepEqual(m.triggersSeen, [{ observe: "War-risk premia widen", headline: "Lloyd's lifts premia" }], "only its own scenario's matched evidence");
  assert.ok(m.flags.some((f) => f.includes("down 25 pts")));
  assert.ok(m.flags.some((f) => f.includes("Contained")));
  assert.ok(m.flags.some((f) => f.includes("2 of 3")));
});

test("a thesis follows its own book: a different or missing book is reported as gone, never substituted", () => {
  const t = buildThesis(book(), draftFromEvent(book()), quotes, NOW);
  const other = book({ id: "taiwan", probability: 90 });
  for (const e of [other, null]) {
    const m = monitorThesis(t, e, quotes, NOW);
    assert.equal(m.onDesk, false);
    assert.equal(m.bookNow, null);
    assert.equal(m.scenarioNow, null);
    assert.match(m.flags[0]!, /no longer on the desk/);
  }
  assert.equal(monitorThesis(t, null, quotes, new Date("2026-10-07T00:00:00Z")).due, true);
});

test("a review appends the outcome and the state at review time; the original claim stays as saved", () => {
  const t = buildThesis(book(), draftFromEvent(book()), quotes, NOW, "t1");
  const review = reviewRecord(t, book({ probability: 70 }), { USO: { last: 88 } }, new Date("2026-10-06T12:00:00Z"), "right", " premia widened ");
  assert.equal(review.outcome, "right");
  assert.equal(review.note, "premia widened");
  assert.equal(review.bookProbability, 70);
  assert.deepEqual(review.prices[0], { ticker: "USO", price: 88, changePct: 10 });
  assert.deepEqual(review.prices[1], { ticker: "XLE", price: null, changePct: null });
  const reviewed = { ...t, status: "reviewed" as const, review };
  assert.equal(reviewed.bookProbability, 62, "the frozen probability is not overwritten by the review");
  assert.deepEqual(reviewTally([t, reviewed]), { reviewed: 1, right: 1, wrong: 0, mixed: 0, unclear: 0 });
});

test("the horizon label is the book's own shortest", () => {
  assert.equal(shortestHorizonLabel(book({ horizons: [], forecastHorizon: "2q / 12m" })), "2q");
  assert.equal(shortestHorizonLabel(book({ horizons: [], forecastHorizon: undefined })), "72h");
});

test("outcomes score decided theses at the probability they were saved at, and count moves against the call", () => {
  const draft = draftFromEvent(book());
  const at = (i: number) => new Date(Date.parse("2026-10-06T12:00:00Z") + i * 3_600_000);
  const saved = (id: string) => buildThesis(book(), draft, quotes, NOW, id);
  const review = (id: string, outcome: "right" | "wrong" | "mixed", uso: number, i: number) => {
    const t = saved(id);
    return { ...t, status: "reviewed" as const, review: reviewRecord(t, book(), { USO: { last: uso } }, at(i), outcome, "") };
  };
  // Saved on Escalation at 55%: right once, wrong once, mixed once; one still open and overdue.
  const theses = [review("r1", "right", 88, 0), review("r2", "wrong", 76, 1), review("r3", "mixed", 80, 2), saved("open")];
  const o = thesisOutcomes(theses, new Date("2026-12-01T00:00:00Z"));
  assert.equal(o.reviewed, 3);
  assert.equal(o.decided, 2);
  assert.equal(o.hitRate, 0.5);
  // (0.55 - 1)^2 and (0.55 - 0)^2, averaged; mixed is not scored.
  assert.equal(o.brier, Math.round(((0.45 ** 2 + 0.55 ** 2) / 2) * 10_000) / 10_000);
  assert.equal(o.meanSavedRight, 55);
  assert.equal(o.meanSavedWrong, 55);
  // USO was called up: +10% as expected, -5% against, flat not counted; XLE had no price.
  assert.deepEqual(o.instruments, { withMove: 2, asExpected: 1 });
  assert.equal(o.awaitingReview, 1);
  assert.deepEqual(o.recent.map((t) => t.id), ["r3", "r2", "r1"]);
  assert.equal(thesisOutcomes([], NOW).hitRate, null);
  assert.equal(thesisOutcomes([], NOW).brier, null);
});
