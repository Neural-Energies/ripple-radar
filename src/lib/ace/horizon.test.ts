/**
 * Why these exist: calibration stayed empty because every grading came back
 * inconclusive, and a flat 72h horizon was half the cause — books were graded
 * before their own stated checkpoint, so "nothing has happened yet" was
 * recorded as an unresolved forecast.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_HORIZON_HOURS,
  MIN_HORIZON_HOURS,
  horizonHoursFor,
  parseHorizonHours,
} from "@/lib/live/forecast-ledger.server";

test("parses the horizon vocabulary the engine actually emits", () => {
  assert.equal(parseHorizonHours("24h"), 24);
  assert.equal(parseHorizonHours("7d"), 168);
  assert.equal(parseHorizonHours("30d"), 720);
  assert.equal(parseHorizonHours("2q"), 2 * 24 * 91);
  assert.equal(parseHorizonHours("12m"), 12 * 24 * 30);
  assert.equal(parseHorizonHours(" 3 days "), 72);
});

test("refuses to invent a number from an unparseable label", () => {
  for (const bad of ["", "soon", "hours–days", "-5d", "0h", "next quarter"]) {
    assert.equal(parseHorizonHours(bad), null, `should not parse ${JSON.stringify(bad)}`);
  }
});

test("grades at the book's own shortest checkpoint, not a flat 72h", () => {
  const weather = horizonHoursFor({
    horizons: [{ horizon: "24h" }, { horizon: "30d" }, { horizon: "2q" }],
  });
  assert.equal(weather, 24, "a weather book is knowable inside a day");

  const tech = horizonHoursFor({
    horizons: [{ horizon: "7d" }, { horizon: "90d" }, { horizon: "12m" }],
  });
  assert.equal(tech, 168, "a licensing book waits for its own first checkpoint");
});

test("falls back to the previous default when the book states no horizon", () => {
  assert.equal(horizonHoursFor({}), 72);
  assert.equal(horizonHoursFor({ horizons: [] }), 72);
  assert.equal(horizonHoursFor({ horizons: [{ horizon: "whenever" }] }), 72);
});

test("clamps so no book becomes instantly due or ungradeable", () => {
  assert.equal(horizonHoursFor({ horizons: [{ horizon: "1h" }] }), MIN_HORIZON_HOURS);
  assert.equal(horizonHoursFor({ horizons: [{ horizon: "10y" }] }), MAX_HORIZON_HOURS);
});

test("reads forecastHorizon when horizons are absent", () => {
  assert.equal(horizonHoursFor({ forecastHorizon: "7d / 30d / 12m" }), 168);
});
