import assert from "node:assert/strict";
import { test } from "node:test";
import { logReturns, percentileRank, realizedVol, termStructure, volRead } from "./vol-regime.ts";

test("the 3-month index above spot is contango", () => {
  const term = termStructure(14.21, 17.61);
  assert.equal(term?.regime, "contango");
  assert.ok(term && term.slope > 0.2);
});

test("spot above the 3-month index is backwardation", () => {
  assert.equal(termStructure(32, 26)?.regime, "backwardation");
});

test("close-to-close vol uses the sample deviation", () => {
  const vol = realizedVol([0.01, -0.01], 2);
  const expected = Math.sqrt(0.0002) * Math.sqrt(252) * 100;
  assert.ok(vol != null && Math.abs(vol - expected) < 1e-9);
});

test("a flat history is not expanding", () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.01);
  const returns = logReturns(closes);
  const short = realizedVol(returns, 21);
  const long = realizedVol(returns, 252);
  assert.ok(short != null && long != null && short < 5);
});

test("percentile is the share of history underneath", () => {
  assert.equal(percentileRank([10, 12, 14, 20], 14), 50);
});

test("the read lines the two series up on the shared day", () => {
  const vix = [
    { date: "2026-09-21", value: 15 },
    { date: "2026-09-22", value: 14 },
  ];
  const vix3m = [
    { date: "2026-09-21", value: 18 },
    { date: "2026-09-22", value: 17 },
  ];
  const spx = Array.from({ length: 260 }, (_, i) => ({
    date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
    value: 5000 + i,
  }));
  // dates collide; volRead only needs enough positive closes
  const unique = spx.map((point, i) => ({ ...point, date: excelDay(i), value: 5000 * Math.exp(i * 0.0002) }));
  const read = volRead(vix, vix3m, unique);
  assert.equal(read?.date, "2026-09-22");
  assert.equal(read?.term, "contango");
  assert.equal(read?.realized, "compressing");
});

function excelDay(i: number) {
  const date = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000);
  return date.toISOString().slice(0, 10);
}
