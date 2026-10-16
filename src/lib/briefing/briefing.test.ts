/**
 * Morning-briefing math: lexicon hits, bot direction, decayed windows,
 * and a summary that only repeats numbers it was given.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadarEvent } from "@/data/types";
import { EMPTY_EVENT } from "@/lib/engine/placeholder";
import {
  botsFromSentiment,
  levelsToWatch,
  morningSummary,
  parseXaiScores,
  scoreBots,
  scoreHeadline,
  whatMatters,
  windowScore,
  WINDOWS,
  type ScoredHeadline,
} from "./assemble";
import { fredToday, mergeCalendar, parseFaireconomy } from "./calendar";
import { lexiconSentiment } from "./lexicon";

const NOW = Date.parse("2026-10-16T14:00:00Z");

function headline(partial: Partial<ScoredHeadline> & Pick<ScoredHeadline, "id" | "title" | "publishedMs">): ScoredHeadline {
  return {
    source: "BBC Business",
    url: "",
    sentiment: null,
    method: "lexicon",
    bots: {},
    ...partial,
  };
}

test("lexicon scores finance language and flips negation", () => {
  assert.ok((lexiconSentiment("stocks plunge") ?? 0) < 0);
  assert.ok((lexiconSentiment("stocks do not plunge") ?? 0) > 0);
  assert.equal(lexiconSentiment("the committee met on Tuesday"), null);
  const plain = lexiconSentiment("shares plunged and recovery");
  const sharp = lexiconSentiment("sharply plunged shares and recovery");
  assert.ok((sharp ?? 0) < (plain ?? 0));
});

test("a supply shock is negative geopolitics and positive energy", () => {
  const title = "Tanker sunk near the Strait of Hormuz";
  const scored = scoreHeadline(title);
  assert.ok((scored.bots.geopolitics ?? 0) < 0);
  assert.ok((scored.bots.energy ?? 0) > 0);
  assert.equal(scored.bots.crypto, undefined);
});

test("chip pressure routes to equities as risk-off", () => {
  const bots = botsFromSentiment("Chip stocks face renewed pressure", lexiconSentiment("Chip stocks face renewed pressure"));
  assert.ok((bots.equities ?? 0) < 0);
});

test("today's window drops a two-day-old headline and the 3-day window keeps it", () => {
  const old = headline({
    id: "old",
    title: "Oil shortage lifts crude",
    publishedMs: NOW - 48 * 3_600_000,
    bots: { energy: 1 },
  });
  assert.equal(windowScore([old], "energy", NOW, WINDOWS.today).score, null);
  assert.equal(windowScore([old], "energy", NOW, WINDOWS.d3).score, 100);
});

test("decay changes the mix, not a single headline's score", () => {
  const fresh = headline({ id: "a", title: "a", publishedMs: NOW, bots: { macro: 1 } });
  const aged = headline({
    id: "b",
    title: "b",
    publishedMs: NOW - 12 * 3_600_000,
    bots: { macro: -1 },
  });
  const w = Math.exp(-12 / WINDOWS.today.tau);
  const expected = Math.round((100 * (1 - w)) / (1 + w));
  assert.equal(windowScore([fresh, aged], "macro", NOW, WINDOWS.today).score, expected);
});

test("confidence stays low until the sample and the sources are wide enough", () => {
  const one = headline({ id: "1", title: "stocks plunge", publishedMs: NOW, source: "BBC Business", bots: { equities: -0.8 } });
  const { bots } = scoreBots([one], NOW);
  assert.equal(bots.find((b) => b.id === "equities")?.confidence, "low");

  const many: ScoredHeadline[] = [];
  for (let i = 0; i < 8; i += 1) {
    many.push(
      headline({
        id: String(i),
        title: "t",
        publishedMs: NOW - i * 60_000,
        source: ["BBC Business", "NYT Business", "Fed"][i % 3]!,
        bots: { macro: -0.4 },
      }),
    );
  }
  const wide = scoreBots(many, NOW).bots.find((b) => b.id === "macro");
  assert.equal(wide?.confidence, "high");
  assert.equal(wide?.today.score, -40);
});

test("mood renormalizes over bots that actually scored", () => {
  const rows = [
    headline({ id: "e", title: "oil", publishedMs: NOW, bots: { energy: 0.5 } }),
  ];
  const { mood } = scoreBots(rows, NOW);
  assert.equal(mood.today, 50);
  assert.equal(mood.label, "risk-on");
  assert.equal(mood.confidence, "low");
});

test("what matters ranks engine importance and walks the causal chain", () => {
  const small: RadarEvent = {
    ...EMPTY_EVENT,
    id: "small",
    title: "Small book",
    importance: 20,
    evidence: [
      {
        id: "e",
        headline: "h",
        source: "BBC",
        time: "1:00",
        eventTimeMs: NOW,
        availableTimeMs: NOW,
        evidenceClass: "narrative",
        kind: "news",
        delayed: false,
      },
    ],
    nodes: [{ id: "a", label: "A", level: 0, kind: "event", angle: 0, impact: 1, direction: "down", blurb: "" }],
  };
  const large: RadarEvent = {
    ...small,
    id: "large",
    title: "Large book",
    importance: 80,
    nodes: [
      { id: "root", label: "Freight", level: 0, kind: "event", angle: 0, impact: 1, direction: "up", blurb: "" },
      { id: "next", label: "Brent", level: 1, kind: "commodity", angle: 0, impact: 1, direction: "up", blurb: "", ticker: "BZ" },
    ],
    links: [
      {
        source: "root",
        dest: "next",
        direction: 1,
        distance: 1,
        confidence: null,
        support: "inferred",
        evidence: "",
        expectedLag: "",
        invalidation: "",
        historicalSupport: "",
      },
    ],
    trades: [{ ticker: "CL", name: "WTI", score: 1, reason: "", side: "long", category: "commodities", horizon: "days" }],
  };
  const rows = whatMatters([small, large]);
  assert.equal(rows[0]?.id, "large");
  assert.equal(rows[0]?.impactLabel, "High");
  assert.deepEqual(rows[0]?.chain.map((n) => n.label), ["Freight", "Brent"]);
  const levels = levelsToWatch(rows, [large], { BZ: { last: 72.5, prevClose: 70, changePct: 3.2 }, CL: { last: 0, changePct: 1 } });
  assert.deepEqual(levels.map((r) => r.ticker), ["BZ"]);
  assert.equal(levels[0]?.prevClose, 70);
});

test("summary repeats the mood it was given and stays quiet with no tape", () => {
  const { bots, mood } = scoreBots([], NOW);
  assert.match(morningSummary({ mood, bots, matters: [], stored: 0 }), /Collecting headlines/);
  const scored = scoreBots([headline({ id: "e", title: "oil shortage", publishedMs: NOW, bots: { energy: 0.4 } })], NOW);
  const text = morningSummary({
    mood: scored.mood,
    bots: scored.bots,
    matters: [{ title: "Hormuz traffic" }],
    stored: 4,
  });
  assert.match(text, /Largest book on the desk: Hormuz traffic/);
  assert.match(text, /Energy/);
  assert.doesNotMatch(text, /80000|−12/);
});

test("model scores parse only in-range numbers", () => {
  const rows = parseXaiScores('noise {"items":[{"id":"a","sentiment":0.4},{"id":"b","sentiment":2},{"id":"","sentiment":0}]}');
  assert.deepEqual(rows, [{ id: "a", sentiment: 0.4 }]);
  assert.deepEqual(parseXaiScores("not json"), []);
});

test("calendar keeps today's New York rows and does not invent a clock for FRED", () => {
  const rows = parseFaireconomy(
    [
      { title: "CPI", country: "USD", date: "2026-10-16T08:30:00-04:00", impact: "High", forecast: "0.3", previous: "0.2" },
      { title: "Yesterday", country: "USD", date: "2026-10-15T08:30:00-04:00", impact: "High", forecast: "", previous: "" },
    ],
    NOW,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "CPI");
  assert.equal(rows[0]?.impact, "High");
  assert.ok(rows[0]?.when.includes("8:30"));
  const fred = fredToday([{ name: "Employment Situation", date: "2026-10-16", moves: ["Payrolls"] }], NOW);
  assert.equal(fred[0]?.when, "Date only");
  const merged = mergeCalendar(
    { ok: false, rows: [], error: "HTTP 503" },
    { ok: true, rows: fred, detail: "FRED ok." },
  );
  assert.equal(merged.status, "partial");
  assert.equal(merged.items.length, 1);
});
