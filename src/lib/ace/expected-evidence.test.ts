/**
 * The bug these exist to prevent: `appeared` was authored as a literal false
 * and nothing could ever flip it, so the panel promised a test it never ran.
 * The opposite failure is worse — a row flipping to "observed" on a keyword
 * coincidence — so most of these check that it stays honest under pressure.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvidenceItem, EvidenceWatch, ExpectedEvidence } from "../../data/types.ts";
import { monitorExpectedEvidence, observedShare, satisfies } from "./expected-evidence.ts";

const T = 1_700_000_000_000;

function ev(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: over.id ?? "e1",
    time: "10:00",
    eventTimeMs: T,
    availableTimeMs: T,
    source: "Reuters",
    evidenceClass: "fundamental",
    kind: "news",
    headline: "Refinery outage confirmed at Gulf Coast plant",
    delayed: false,
    reliability: "A",
    direction: "up",
    ...over,
  };
}

const WATCH: EvidenceWatch = {
  tickers: ["XLE"],
  terms: ["outage", "refinery"],
  classes: ["fundamental", "market"],
  direction: "up",
  minHits: 2,
};

function row(over: Partial<ExpectedEvidence> = {}): ExpectedEvidence {
  return {
    id: "ee-1",
    scenarioId: "s1",
    ifTrue: "Plants actually stop",
    observe: "A second-order node confirms",
    lag: "hours–days",
    appeared: false,
    watch: WATCH,
    ...over,
  };
}

test("a real corroborated observation flips the row and names the item", () => {
  const [out] = monitorExpectedEvidence([row()], [ev()]);
  assert.equal(out!.appeared, true);
  assert.equal(out!.matchedBy, "e1");
  assert.equal(out!.observedAt, T);
  assert.match(out!.matchedHeadline!, /Refinery outage/);
});

test("one lonely term is not a confirmation when the watch demands two", () => {
  const [out] = monitorExpectedEvidence(
    [row()],
    [ev({ headline: "Analysts discuss refinery economics" })],
  );
  assert.equal(out!.appeared, false, "minHits must not be satisfiable by a single hit");
});

test("repeating one term does not manufacture extra hits", () => {
  const [out] = monitorExpectedEvidence(
    [row()],
    [ev({ headline: "Outage, outage, outage — an outage" })],
  );
  assert.equal(out!.appeared, false, "distinct observables, not repetitions");
});

test("the wrong class cannot settle the watch", () => {
  const [out] = monitorExpectedEvidence([row()], [ev({ evidenceClass: "narrative" })]);
  assert.equal(out!.appeared, false, "a narrative echo cannot settle a fundamental watch");
});

test("evidence pointing the other way is not confirmation", () => {
  const [out] = monitorExpectedEvidence([row()], [ev({ direction: "down" })]);
  assert.equal(out!.appeared, false);
});

test("a substring inside another word is not a mention", () => {
  const w: EvidenceWatch = { ...WATCH, terms: ["oil"], tickers: [], minHits: 1 };
  assert.equal(satisfies(ev({ headline: "Toilet paper maker guides lower" }), w), false);
  assert.equal(satisfies(ev({ headline: "Oil output falls" }), w), true);
});

test("the earliest satisfying observation wins, not feed order", () => {
  const late = ev({ id: "late", availableTimeMs: T + 5_000 });
  const early = ev({ id: "early", availableTimeMs: T - 5_000 });
  const [out] = monitorExpectedEvidence([row()], [late, early]);
  assert.equal(out!.matchedBy, "early", "observedAt must be when we could first have known");
});

test("a row with no declared test stays awaiting instead of inventing one", () => {
  const [out] = monitorExpectedEvidence([row({ watch: undefined })], [ev()]);
  assert.equal(out!.appeared, false);
  assert.equal(out!.matchedBy, undefined);
});

test("a stale match is retracted rather than left asserting an item we cannot show", () => {
  const stamped = row({ appeared: true, matchedBy: "gone", matchedHeadline: "old", observedAt: T });
  const [out] = monitorExpectedEvidence([stamped], []);
  assert.equal(out!.appeared, false);
  assert.equal(out!.matchedBy, undefined, "no dangling pointer to evidence that is not in the book");
  assert.equal(out!.matchedHeadline, undefined);
});

test("the monitor does not mutate its input", () => {
  const rows = [row()];
  monitorExpectedEvidence(rows, [ev()]);
  assert.equal(rows[0]!.appeared, false, "authored state is never written through");
});

test("observedShare counts only rows that carry a real test", () => {
  const out = monitorExpectedEvidence(
    [row({ id: "a" }), row({ id: "b", watch: undefined })],
    [ev()],
  );
  assert.deepEqual(observedShare(out), { observed: 1, total: 1 });
});
