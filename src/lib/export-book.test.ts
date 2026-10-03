import assert from "node:assert/strict";
import { test } from "node:test";
import type { RippleNode, Scenario, TradeIdea } from "../data/types.ts";
import { EMPTY_EVENT } from "./engine/placeholder.ts";
import { bookExportHtml, bookExportText } from "./export-book.ts";

const scenario = (id: string, name: string, probability: number, detail: string): Scenario => ({
  id,
  name,
  detail,
  probability,
  prevProbability: probability,
  range: "",
  keyOutcomes: "",
  audit: { previous: probability, updated: probability, evidence: "", direction: "up", weight: 0, affectedNodes: [], rescoredAssets: [] },
});

const node = (id: string, label: string, level: RippleNode["level"], ticker?: string): RippleNode => ({
  id,
  label,
  ticker,
  level,
  kind: "other",
  angle: 0,
  impact: 0,
  direction: "mixed",
  blurb: "",
});

const trade = (): TradeIdea => ({
  ticker: "BDRY",
  name: "Breakwave",
  score: 1,
  reason: "Freight follows the outage",
  side: "long",
  category: "etf",
  horizon: "days",
  distance: 2,
});

test("an empty desk exports a short refusal", () => {
  assert.match(bookExportText(EMPTY_EVENT), /No active book/);
});

test("a book export names the path, the map, and the names", () => {
  const text = bookExportText(
    {
      ...EMPTY_EVENT,
      id: "book-1",
      title: "Pipeline outage",
      region: "Gulf",
      theme: "energy",
      importance: 80,
      probability: 42,
      summary: "A line is down.",
      scenarios: [scenario("a", "Short outage", 70, "Days"), scenario("b", "Long outage", 30, "Weeks")],
      nodes: [node("n0", "Outage", 0), node("n1", "Freight", 2, "BDRY")],
      trades: [trade()],
      invalidation: ["The line reopens this week"],
    },
    new Date("2026-10-03T17:00:00.000Z"),
  );
  assert.match(text, /Pipeline outage/);
  assert.match(text, /Importance 80/);
  assert.match(text, /Short outage — 70%/);
  assert.match(text, /L2 Freight \(BDRY\)/);
  assert.match(text, /BDRY — Freight follows the outage/);
  assert.match(text, /line reopens/);
  const html = bookExportHtml(text);
  assert.match(html, /#f5f7fa/);
  assert.doesNotMatch(html, /<script/i);
});
