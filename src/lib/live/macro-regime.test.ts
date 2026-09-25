import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignRegime,
  basketRegime,
  changeInRate,
  lastOfMonth,
  legPath,
  parseFredCsv,
  quadOf,
  regimeFlips,
  yearOverYear,
} from "./macro-regime.ts";

test("year-over-year matches the same month a year earlier", () => {
  const rates = yearOverYear([
    { date: "2024-08-01", value: 100 },
    { date: "2025-08-01", value: 104 },
  ]);
  assert.equal(rates.length, 1);
  assert.ok(Math.abs(rates[0]!.rate - 4) < 1e-9);
});

test("three-month change in the rate is the acceleration", () => {
  const rates = yearOverYear([
    { date: "2024-05-01", value: 100 },
    { date: "2024-08-01", value: 100 },
    { date: "2025-05-01", value: 102 },
    { date: "2025-08-01", value: 104 },
  ]);
  const delta = changeInRate(rates, 3);
  const aug = delta.find((row) => row.date === "2025-08-01");
  assert.ok(aug);
  assert.ok(Math.abs(aug.rate - 4) < 1e-9);
  assert.ok(Math.abs(aug.delta - 2) < 1e-9);
});

test("the sign pair is the quad", () => {
  assert.equal(quadOf(1, -1), 1);
  assert.equal(quadOf(1, 1), 2);
  assert.equal(quadOf(-1, 1), 3);
  assert.equal(quadOf(-1, -1), 4);
  assert.equal(quadOf(0, -0.2), 1);
});

test("csv skips missing prints", () => {
  const rows = parseFredCsv("observation_date,CPIAUCSL\n2025-08-01,334.1\n2025-09-01,.\n");
  assert.deepEqual(rows, [{ date: "2025-08-01", value: 334.1 }]);
});

test("growth and inflation align on the shared month", () => {
  const growth = changeInRate(
    yearOverYear([
      { date: "2024-05-01", value: 100 },
      { date: "2024-08-01", value: 100 },
      { date: "2025-05-01", value: 110 },
      { date: "2025-08-01", value: 108 },
    ]),
  );
  const inflation = changeInRate(
    yearOverYear([
      { date: "2024-05-01", value: 100 },
      { date: "2024-08-01", value: 100 },
      { date: "2025-05-01", value: 102 },
      { date: "2025-08-01", value: 106 },
    ]),
  );
  const regime = alignRegime(growth, inflation);
  assert.ok(regime);
  assert.equal(regime.date, "2025-08-01");
  assert.equal(regime.quad, 3);
});

test("daily prints collapse to the last reading of the month", () => {
  const monthly = lastOfMonth([
    { date: "2026-08-03", value: 1 },
    { date: "2026-08-22", value: 9 },
    { date: "2026-09-01", value: 4 },
  ]);
  assert.deepEqual(monthly, [
    { date: "2026-08-01", value: 9 },
    { date: "2026-09-01", value: 4 },
  ]);
});

test("a rising claims rate counts against growth", () => {
  const points = [
    { date: "2024-05-01", value: 100 },
    { date: "2024-08-01", value: 100 },
    { date: "2025-05-01", value: 100 },
    { date: "2025-08-01", value: 110 },
  ];
  const plain = legPath(points).at(-1);
  const flipped = legPath(points, true).at(-1);
  assert.ok(plain && flipped);
  assert.ok(plain.delta > 0);
  assert.equal(flipped.delta, -plain.delta);
});

test("the basket quad follows the majority, not one loud series", () => {
  const slowing = changeInRate(
    yearOverYear([
      { date: "2024-05-01", value: 100 },
      { date: "2024-08-01", value: 100 },
      { date: "2025-05-01", value: 110 },
      { date: "2025-08-01", value: 104 },
    ]),
  );
  const rising = changeInRate(
    yearOverYear([
      { date: "2024-05-01", value: 100 },
      { date: "2024-08-01", value: 100 },
      { date: "2025-05-01", value: 100 },
      { date: "2025-08-01", value: 106 },
    ]),
  );
  const regime = basketRegime([slowing, slowing, slowing], [rising, rising, rising]);
  assert.ok(regime);
  assert.equal(regime.quad, 3);
  assert.equal(regime.growth.up, 0);
  assert.equal(regime.inflation.up, 3);
});

test("the nearest one-vote cross is the growth trigger, inflation needs three", () => {
  const flips = regimeFlips([
    { id: "pay", label: "Payrolls", side: "growth", delta: 0.2 },
    { id: "hou", label: "Housing", side: "growth", delta: 7 },
    { id: "clm", label: "Claims", side: "growth", delta: 4 },
    { id: "ip", label: "IP", side: "growth", delta: -0.2 },
    { id: "rs", label: "Sales", side: "growth", delta: -0.4 },
    { id: "core", label: "Core", side: "inflation", delta: -0.4 },
    { id: "cpi", label: "CPI", side: "inflation", delta: -0.8 },
    { id: "ppi", label: "PPI", side: "inflation", delta: -2.3 },
    { id: "wti", label: "WTI", side: "inflation", delta: -13 },
    { id: "be", label: "Breakeven", side: "inflation", delta: -5 },
  ]);
  const growth = flips.find((row) => row.side === "growth");
  const inflation = flips.find((row) => row.side === "inflation");
  assert.equal(growth?.to, 4);
  assert.deepEqual(growth?.legs.map((leg) => leg.id), ["pay"]);
  assert.equal(inflation?.to, 2);
  assert.deepEqual(inflation?.legs.map((leg) => leg.id), ["core", "cpi", "ppi"]);
});

