import assert from "node:assert/strict";
import test from "node:test";
import {
  cashSession,
  directionHit,
  engineBasketCall,
  hourWindow,
  priceReturn,
  scoreReplay,
  spearman,
  wilson,
} from "./score.mjs";

const SPY = ["2024-04-09", "2024-04-10", "2024-04-11", "2024-04-12", "2024-04-15"];

test("cash session uses the same day before 16:00 ET and the next session after", () => {
  assert.equal(cashSession(SPY, "2024-04-10T12:30:00Z"), "2024-04-10");
  assert.equal(cashSession(SPY, "2024-04-10T20:00:00Z"), "2024-04-11");
  assert.equal(cashSession(SPY, "2024-04-13T18:00:00Z"), "2024-04-15");
});

test("flat prints inside the deadband are not hits", () => {
  assert.equal(directionHit(1, 0.0001).hit, null);
  assert.equal(directionHit(1, 0.0001).flat, true);
  assert.equal(directionHit(-1, -0.01).hit, true);
  assert.equal(directionHit(1, -0.01).hit, false);
});

test("a short bond price is a call for higher yields, and a conflict abstains", () => {
  assert.equal(engineBasketCall([{ ticker: "TLT", side: "short" }], "TNX"), 1);
  assert.equal(engineBasketCall([{ ticker: "TNX", side: "long" }], "TNX"), 1);
  assert.equal(
    engineBasketCall(
      [
        { ticker: "SPX", side: "long" },
        { ticker: "ES", side: "short" },
      ],
      "SPY",
    ),
    0,
  );
});

test("return, wilson, and spearman stay on the numbers they are given", () => {
  assert.ok(Math.abs(priceReturn({ a: 100, b: 110 }, "a", "b") - 0.1) < 1e-12);
  const band = wilson(50, 100);
  assert.ok(band.low > 0.4 && band.low < 0.5);
  assert.ok(band.high > 0.5 && band.high < 0.6);
  assert.equal(spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.ok(spearman([1, 2, 3, 4], [4, 3, 2, 1]) < -0.99);
});

test("an in-session hour window does not use a stale prior close", () => {
  const release = Date.parse("2024-12-18T19:00:00Z");
  const hour = 3_600_000;
  const bars = [
    { t: release - 2 * hour, c: 100 },
    { t: release - hour, c: 101 },
    { t: release, c: 102 },
  ];
  const window = hourWindow(bars, release);
  assert.equal(window.kind, "in_session");
  assert.equal(window.ret, 102 / 101 - 1);

  const stale = hourWindow([{ t: release - 30 * hour, c: 100 }, { t: release, c: 110 }], release);
  assert.equal(stale.kind, "stale_pre");
});

test("scoreReplay does not invent a hit when the close is missing", () => {
  const predictions = {
    events: [
      {
        id: "toy",
        group: "cpi",
        title: "toy",
        releaseUtc: "2024-04-10T12:30:00Z",
        source: "https://example.test",
        naive: "hot_inflation",
        tone: "down",
        toneHits: { escalate: [], deescalate: [] },
        tags: ["inflation"],
        family: "policy",
        relevance: { score: 6, keep: true },
        probability: 40,
        importance: 50,
        headlineTicker: "TNX",
        conflicts: [],
        trades: [
          { ticker: "TNX", yahoo: "^TNX", side: "long", nodeDirection: "up", score: 90, distance: 1 },
          { ticker: "SPX", yahoo: "^GSPC", side: "short", nodeDirection: "down", score: 70, distance: 3 },
        ],
      },
    ],
  };
  const prices = {
    daily: {
      SPY: { "2024-04-09": 100, "2024-04-10": 99, "2024-04-11": 98, "2024-04-12": 97, "2024-04-15": 96 },
      "^TNX": { "2024-04-09": 4, "2024-04-10": 4.2, "2024-04-11": 4.1, "2024-04-12": 4.0, "2024-04-15": 4.0 },
      "^GSPC": { "2024-04-09": 100, "2024-04-10": 101 },
    },
    hourly: {},
  };
  const scored = scoreReplay(predictions, prices);
  const event = scored.perEvent[0];
  assert.equal(event.dates.session, "2024-04-10");
  assert.equal(event.trades[0].hits.eod, true);
  assert.equal(event.trades[1].hits.d1, null);
  assert.equal(event.basket.SPY.engine, -1);
  assert.equal(event.basket.SPY.judged.eod.engine, true);
  assert.equal(event.basket.TNX.naive, 1);
  assert.equal(scored.summary.bookAllNonControl.eod.hits, 1);
  assert.equal(scored.summary.bookAllNonControl.eod.decided, 2);
});
