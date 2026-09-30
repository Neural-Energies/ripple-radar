/**
 * Why a name ranks where it does (PR #5 B06 "why this exposure?"): the score
 * is the book's rank plus tape adjustments, each one reported, and re-ranking
 * an already-ranked trade does not apply them twice.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadarEvent, TradeIdea } from "@/data/types";
import { EMPTY_EVENT } from "@/lib/engine/placeholder";
import { explainScore, rankTrades, scoreTrade } from "./discover.ts";
import type { LiveHeadline, LiveQuote } from "./types.ts";

const quote = (ticker: string, changePct: number): LiveQuote => ({
  ticker, last: 100, prevClose: 100, change: changePct, changePct, spark: [], state: "live",
  asOf: 0, eventTimeMs: 0, availableTimeMs: 0, exchange: "",
} as LiveQuote);

const headline = (title: string): LiveHeadline => ({
  id: title, title, source: "Wire", url: "", published: 0, eventTimeMs: 0, availableTimeMs: 0, eventIds: [], tone: "neutral",
} as LiveHeadline);

const trade: TradeIdea = { ticker: "XLE", name: "Energy Select", score: 70, reason: "", side: "long", category: "etf", horizon: "7d" };
const event: RadarEvent = { ...EMPTY_EVENT, id: "oil", headlineTicker: "USO", trades: [trade] };

test("each component is reported with the observation behind it", () => {
  const scored = scoreTrade(trade, { event, quotes: { XLE: quote("XLE", 1.5), USO: quote("USO", 2) }, headlines: [] });
  const p = scored.scoreParts!;
  assert.equal(p.base, 70);
  assert.equal(scored.confirmation, "confirming");
  assert.equal(p.confirmation, 6);
  assert.equal(scored.crowding, "emerging", "no mentions, a 1.5% move");
  assert.equal(p.underCovered, 8);
  assert.equal(p.crowding, -2.1);
  assert.deepEqual([p.mentions, p.movePct, p.headlineMovePct], [0, 1.5, 2]);
  assert.equal(scored.score, Math.round(70 + 6 + 8 - 2.1));
  const lines = explainScore(p, scored.crowding, scored.confirmation);
  assert.deepEqual(lines.map((l) => l.points), [70, 6, 8, -2.1]);
  assert.match(lines[3]!.basis, /not positioning data/);
  assert.match(lines[1]!.basis, /\+1\.5% on the session, headline ticker \+2%; the book implies up/);
});

test("ranking an already-ranked book again does not stack the adjustments", () => {
  const ctx = { quotes: { XLE: quote("XLE", 1.5) }, headlines: [headline("Energy Select fund draws inflows")] };
  const once = rankTrades(event, ctx);
  const twice = rankTrades({ ...event, trades: once }, ctx);
  assert.equal(twice[0]!.score, once[0]!.score);
  assert.equal(twice[0]!.scoreParts!.base, 70);
  assert.equal(once[0]!.scoreParts!.mentions, 1);
});
