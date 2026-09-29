/**
 * The brief is personal and mechanical: it ranks books by how they touch your
 * names and how much they moved since you last looked, and every line comes
 * from engine output or a quote.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadarEvent, Scenario } from "@/data/types";
import { EMPTY_EVENT } from "@/lib/engine/placeholder";
import { baselineFrom, buildBrief, readBaseline, writeBaseline } from "./brief";
import { buildThesis, draftFromEvent } from "./thesis";

const sc = (id: string, name: string, probability: number): Scenario => ({
  id,
  name,
  detail: "",
  probability,
  prevProbability: probability,
  range: "",
  keyOutcomes: name,
  audit: { previous: probability, updated: probability, evidence: "", direction: "up", weight: 0, affectedNodes: [], rescoredAssets: [] },
});

function book(id: string, over: Partial<RadarEvent> = {}): RadarEvent {
  return {
    ...EMPTY_EVENT,
    id,
    title: id,
    probability: 50,
    probabilityDelta: 0,
    scenarios: [sc(`${id}-a`, "A", 60), sc(`${id}-b`, "B", 30), sc(`${id}-c`, "C", 10)],
    horizons: [{ horizon: "7d", probability: 50, note: "" }],
    invalidation: ["It stops"],
    ...over,
  };
}

const oil = book("oil", {
  trades: [
    { ticker: "XLE", name: "", score: 80, reason: "", side: "long", category: "etf", horizon: "7d", causalPath: "Event → crude → XLE" },
    { ticker: "JETS", name: "", score: 60, reason: "", side: "short", category: "etf", horizon: "7d" },
  ],
  evidence: [
    { id: "1", time: "08:00", eventTimeMs: 1000, availableTimeMs: 1000, source: "AP", evidenceClass: "narrative", kind: "news", headline: "old", delayed: false },
    { id: "2", time: "12:00", eventTimeMs: 5000, availableTimeMs: 5000, source: "Reuters", evidenceClass: "narrative", kind: "news", headline: "fresh", delayed: false },
  ],
});
const chips = book("chips", {
  nodes: [{ id: "n", label: "Foundry", ticker: "TSM", level: 1, kind: "company", angle: 0, impact: 1, direction: "down", blurb: "" }],
});
const quiet = book("quiet");
const NOW = new Date("2026-09-29T12:00:00Z");
const lists = [{ id: "w", name: "Core", tickers: ["XLE", "TSM", "GLD"] }];

test("books are in the brief only when they touch your names, with the direction the book implies", () => {
  const brief = buildBrief({ events: [oil, chips, quiet], quotes: {}, watchlists: lists, theses: [], baseline: null, now: NOW });
  assert.deepEqual(brief.books.map((b) => b.eventId).sort(), ["chips", "oil"]);
  const o = brief.books.find((b) => b.eventId === "oil")!;
  assert.deepEqual(o.exposures.map((e) => [e.ticker, e.bookDirection, e.reason]), [["XLE", "up", "Event → crude → XLE"]]);
  assert.equal(brief.books.find((b) => b.eventId === "chips")!.exposures[0]!.bookDirection, "down", "reached through the causal map");
  assert.equal(o.horizon, "7d");
  assert.deepEqual(o.alternatives, [{ name: "B", probability: 30 }, { name: "C", probability: 10 }]);
  assert.deepEqual(o.invalidation, ["It stops"]);
  assert.equal(brief.elsewhere.length, 0, "an unchanged book that touches nothing of yours is left out");
});

test("since the last read: probability, lead scenario, evidence and prices are compared with the baseline", () => {
  const baseline = { ...baselineFrom([oil, chips], { XLE: { last: 100 } }, ["XLE"], new Date(0)), at: 2000 };
  const later = { ...oil, probability: 62, scenarios: [sc("oil-a", "A", 70), sc("oil-b", "B", 20), sc("oil-c", "C", 10)] };
  const brief = buildBrief({ events: [later, chips, book("new-one")], quotes: { XLE: { last: 104, changePct: 1 } }, watchlists: lists, theses: [], baseline, now: NOW });
  const o = brief.books.find((b) => b.eventId === "oil")!;
  assert.equal(o.delta, 12);
  assert.equal(o.deltaBasis, "since_seen");
  assert.deepEqual(o.lead, { id: "oil-a", name: "A", probability: 70, delta: 10 });
  assert.equal(o.newEvidence, 1);
  assert.deepEqual(o.evidence.map((e) => [e.headline, e.isNew]), [["fresh", true], ["old", false]]);
  assert.equal(o.exposures[0]!.changePct, 4, "priced against the baseline, not the session");
  assert.equal(o.exposures[0]!.changeBasis, "since_seen");
  assert.deepEqual(brief.elsewhere.map((b) => [b.eventId, b.isNewBook]), [["new-one", true]], "a book that appeared since is surfaced");
});

test("without a baseline, moves fall back to the engine's last update and the session, and say so", () => {
  const brief = buildBrief({ events: [{ ...oil, probabilityDelta: -7 }], quotes: { XLE: { last: 99, changePct: -2.345 } }, watchlists: lists, theses: [], baseline: null, now: NOW });
  const o = brief.books[0]!;
  assert.equal(o.delta, -7);
  assert.equal(o.deltaBasis, "last_update");
  assert.equal(o.exposures[0]!.changePct, -2.3);
  assert.equal(o.exposures[0]!.changeBasis, "session");
  assert.equal(o.newEvidence, 0);
});

test("a thesis on the opposite side of a book is flagged as a conflict, and ranks the book up", () => {
  const thesis = buildThesis(oil, { ...draftFromEvent(oil), instruments: [{ ticker: "JETS", expected: "up" }] }, {}, NOW);
  const brief = buildBrief({ events: [oil, chips], quotes: {}, watchlists: lists, theses: [thesis], baseline: null, now: NOW });
  const jets = brief.books.find((b) => b.eventId === "oil")!.exposures.find((e) => e.ticker === "JETS")!;
  assert.deepEqual(jets.via, ["thesis"]);
  assert.equal(jets.bookDirection, "down");
  assert.equal(jets.yourDirection, "up");
  assert.equal(jets.conflict, true);
  assert.equal(brief.books[0]!.eventId, "oil");
});

test("your names moving with no book reaching them are listed; due or broken theses are surfaced", () => {
  const thesis = buildThesis(oil, draftFromEvent(oil), {}, new Date("2026-09-01T00:00:00Z"));
  const brief = buildBrief({ events: [oil], quotes: { GLD: { last: 300, changePct: 3.1 }, TSM: { last: 100, changePct: 0.5 } }, watchlists: lists, theses: [thesis], baseline: null, now: NOW });
  assert.deepEqual(brief.unexplained, [{ ticker: "GLD", changePct: 3.1, changeBasis: "session" }], "TSM moved less than the materiality floor");
  assert.equal(brief.theses.length, 1);
  assert.equal(brief.theses[0]!.monitor.due, true);
  assert.equal(brief.exposureCount, 4, "watchlist names plus the thesis's instruments");
});

test("the read-marker round-trips and a missing store is not an error", () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const b = baselineFrom([oil], { XLE: { last: 100 } }, ["XLE", "NOPE"], NOW);
  writeBaseline("k", b);
  assert.deepEqual(readBaseline("k"), b);
  assert.deepEqual(b.prices, { XLE: 100 });
  store.set("bad", "{not json");
  assert.equal(readBaseline("bad"), null);
  assert.equal(readBaseline("absent"), null);
});
