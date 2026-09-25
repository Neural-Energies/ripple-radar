import assert from "node:assert/strict";
import { test } from "node:test";
import { cfnaiStatus, curveStatus, nberDuring, quadTrack, sahmStatus } from "./macro-monitors.ts";

test("Sahm gap is the distance under 0.50, and the last trip stays on the record", () => {
  const status = sahmStatus([
    { date: "2024-06-01", value: 0.43 },
    { date: "2024-07-01", value: 0.53 },
    { date: "2024-08-01", value: 0.57 },
    { date: "2024-09-01", value: 0.5 },
    { date: "2024-10-01", value: 0.43 },
    { date: "2026-08-01", value: -0.07 },
  ]);
  assert.ok(status);
  assert.equal(status.tripped, false);
  assert.ok(Math.abs(status.gap - 0.57) < 1e-9);
  assert.equal(status.lastTrip?.start, "2024-07-01");
  assert.equal(status.lastTrip?.end, "2024-09-01");
  assert.equal(status.lastTrip?.peak, 0.57);
});

test("an open Sahm trip is the current one", () => {
  const status = sahmStatus([
    { date: "2024-07-01", value: 0.53 },
    { date: "2024-08-01", value: 0.6 },
  ]);
  assert.equal(status?.tripped, true);
  assert.equal(status?.lastTrip?.end, "2024-08-01");
});

test("CFNAI trips at or below -0.70", () => {
  const calm = cfnaiStatus([{ date: "2026-08-01", value: 0.01 }]);
  const hit = cfnaiStatus([{ date: "2020-04-01", value: -0.7 }]);
  assert.equal(calm?.tripped, false);
  assert.ok(calm && calm.gap > 0.7);
  assert.equal(hit?.tripped, true);
});

test("the curve remembers the last negative print", () => {
  const status = curveStatus([
    { date: "2025-10-16", value: -0.02 },
    { date: "2026-09-24", value: 0.94 },
  ]);
  assert.equal(status?.inverted, false);
  assert.equal(status?.lastNegative, "2025-10-16");
});

test("NBER coverage is the flag inside the trip, not after it", () => {
  const points = [
    { date: "2020-04-01", value: 1 },
    { date: "2024-08-01", value: 0 },
  ];
  assert.equal(nberDuring(points, "2020-03-01", "2020-05-01"), true);
  assert.equal(nberDuring(points, "2024-07-01", "2024-09-01"), false);
});

test("quad track counts the current run and the changes", () => {
  const track = quadTrack([
    { date: "2026-06-01", quad: 4 },
    { date: "2026-07-01", quad: 4 },
    { date: "2026-08-01", quad: 1 },
  ]);
  assert.equal(track?.since, "2026-08-01");
  assert.equal(track?.months, 1);
  assert.deepEqual(track?.changes, [{ date: "2026-08-01", from: 4, to: 1 }]);
});
