import assert from "node:assert/strict";
import { test } from "node:test";
import {
  etWallToMs,
  impactedMarkets,
  overnightMove,
  priorCashClose,
  rankDrivers,
  riskFlags,
  sessionMove,
  type Bar,
} from "./overnight.ts";
import { parseChart } from "./overnight.server.ts";
import type { ScoredHeadline } from "./assemble.ts";

const close15 = etWallToMs(2026, 10, 15, 16); // Thu 15 Oct 2026, 16:00 EDT

test("New York wall time converts with DST", () => {
  assert.equal(new Date(close15).toISOString(), "2026-10-15T20:00:00.000Z");
  assert.equal(new Date(etWallToMs(2026, 1, 15, 16)).toISOString(), "2026-01-15T21:00:00.000Z");
});

test("the window opens at the most recent weekday 4pm ET", () => {
  const fri0900 = etWallToMs(2026, 10, 16, 9);
  assert.equal(priorCashClose(fri0900), close15);
  const fri1700 = etWallToMs(2026, 10, 16, 17);
  assert.equal(priorCashClose(fri1700), etWallToMs(2026, 10, 16, 16));
  const mon0800 = etWallToMs(2026, 10, 19, 8);
  assert.equal(priorCashClose(mon0800), etWallToMs(2026, 10, 16, 16));
});

const step = 15 * 60_000;
const fri0900 = etWallToMs(2026, 10, 16, 9);
const bar = (t: number, c: number, h = c, l = c): Bar => ({ t, o: c, h, l, c });

test("overnight move is measured from the bar that ended at the close", () => {
  const now = fri0900;
  const intraday = [bar(close15 - 2 * step, 99), bar(close15 - step, 100), bar(close15, 101, 103, 100.5), bar(close15 + step, 98, 101, 97), bar(close15 + 2 * step, 102)];
  const daily = [
    { t: etWallToMs(2026, 10, 14, 0), o: 90, h: 95, l: 89, c: 94 },
    { t: etWallToMs(2026, 10, 15, 0), o: 94, h: 101, l: 93, c: 100 },
    { t: etWallToMs(2026, 10, 16, 0), o: 100, h: 103, l: 97, c: 102 }, // today, excluded
  ];
  const m = overnightMove({ id: "NQ", name: "NQ" }, intraday, daily, close15, now, step);
  assert.equal(m.refClose, 100);
  assert.equal(m.last, 102);
  assert.ok(Math.abs(m.changePct! - 2) < 1e-9);
  assert.equal(m.high, 103);
  assert.equal(m.low, 97);
  assert.deepEqual(m.prior, { high: 101, low: 93, close: 100, date: "2026-10-15" });
});

test("missing bars stay null instead of being filled", () => {
  const m = overnightMove({ id: "CL", name: "CL" }, [], [], close15, close15 + step, step);
  assert.equal(m.last, null);
  assert.equal(m.changePct, null);
  assert.equal(m.high, null);
  assert.equal(m.prior, null);
});

test("session move compares the last price with the prior session close", () => {
  const s = sessionMove({ id: "N225", name: "Nikkei" }, [bar(1, 100), bar(2, 110)], { price: 99, time: (close15 + step) / 1000 }, close15);
  assert.ok(Math.abs(s.changePct! - -1) < 1e-9);
  assert.equal(s.inWindow, true);
});

const h = (id: string, ms: number, sentiment: number, bots: Record<string, number>, source = "Reuters"): ScoredHeadline => ({
  id, title: `headline ${id}`, source, url: "https://example.com/" + id, publishedMs: ms, sentiment, method: "lexicon", bots,
});

test("drivers are only headlines inside the window, ranked by score", () => {
  const now = close15 + 40 * step;
  const rows = rankDrivers([
    h("before", close15 - 1, -90, { energy: -90 }),
    h("small", close15 + step, -10, { equities: -10 }),
    h("big", close15 + 2 * step, -80, { energy: -80 }),
    h("unscored", close15 + 3 * step, 0, {}),
  ], close15, now);
  assert.deepEqual(rows.map((r) => r.id), ["big", "small"]);
  assert.deepEqual(rows[0]!.markets, ["CL"]);
});

test("impacted markets name a driver only through a topic link", () => {
  const moves = [
    overnightMove({ id: "CL", name: "CL" }, [bar(close15 - step, 100), bar(close15 + step, 103)], [], close15, close15 + 4 * step, step),
    overnightMove({ id: "BTC", name: "BTC" }, [bar(close15 - step, 100), bar(close15 + step, 99)], [], close15, close15 + 4 * step, step),
  ];
  const drivers = rankDrivers([h("oil", close15 + step, -70, { energy: -70 })], close15, close15 + 4 * step);
  const out = impactedMarkets(moves, drivers);
  assert.equal(out[0]!.id, "CL");
  assert.equal(out[0]!.driver?.topic, "energy");
  assert.equal(out[1]!.id, "BTC");
  assert.equal(out[1]!.driver, null);
});

test("risk flags come from stated rules", () => {
  const m = overnightMove(
    { id: "ES", name: "ES" },
    [bar(close15 - step, 100), bar(close15 + step, 98.5)],
    [{ t: etWallToMs(2026, 10, 15, 0), o: 100, h: 101, l: 99, c: 100 }],
    close15,
    fri0900,
    step,
  );
  const flags = riskFlags([m], [{ title: "CPI", when: "8:30 AM", impact: "High", country: "USD" }]).map((f) => f.text);
  assert.ok(flags.some((t) => t.startsWith("ES below the prior-day low")));
  assert.ok(flags.some((t) => t.startsWith("ES -1.50% since the 4pm close")));
  assert.ok(flags.some((t) => t.includes("High-impact release 8:30 AM")));
});

test("Yahoo chart JSON parses to bars and keeps gaps as null", () => {
  const { bars, meta } = parseChart(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 5, regularMarketTime: 10 }, timestamp: [1, 2], indicators: { quote: [{ open: [1, null], high: [2, null], low: [0.5, null], close: [1.5, null] }] } }] } }));
  assert.deepEqual(bars[0], { t: 1000, o: 1, h: 2, l: 0.5, c: 1.5 });
  assert.equal(bars[1]!.c, null);
  assert.equal(meta.price, 5);
});

test("the same story stored twice is listed once", () => {
  const a = h("a", close15 + step, -80, { energy: -80 });
  const b = { ...h("b", close15 + 2 * step, -60, { energy: -60 }), title: "Headline A!" };
  const rows = rankDrivers([a, b], close15, close15 + 10 * step);
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
});
