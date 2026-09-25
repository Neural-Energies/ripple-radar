/**
 * The vol read must be one as-of date, not two.
 *
 * `premium` subtracts realized volatility from spot VIX. Those come from
 * different series that do not always end on the same session — VIX3M can lag,
 * or the index can print when the vol complex has not. Taking the index's last
 * close regardless meant the premium could compare today's realized vol
 * against yesterday's VIX and call the difference a risk premium.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { volRead, realizedVol, logReturns, percentileRank } from "./vol-regime.ts";

const day = (i: number) => {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const series = (n: number, fn: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ date: day(i), value: fn(i) }));

test("realized vol is computed as of the VIX date, not the index's last close", () => {
  const n = 400;
  // VIX and VIX3M stop one session early; the index keeps printing.
  const vix = series(n - 1, () => 18);
  const vix3m = series(n - 1, () => 20);
  // A violent final day the vol pair never saw. If it leaks in, rv21 moves.
  const spx = series(n, (i) => (i === n - 1 ? 5000 : 4000 + i));

  const read = volRead(vix, vix3m, spx);
  assert.ok(read, "expected a read");
  assert.equal(read!.date, day(n - 2), "as-of is the newest date both vol legs share");
  assert.equal(read!.spxDate, day(n - 2), "the index leg is cut to the same date");

  // Same inputs with the extra index day removed must give an identical read.
  const trimmed = volRead(vix, vix3m, spx.slice(0, n - 1));
  assert.deepEqual(read, trimmed, "a later index close must not change an earlier read");
});

test("the premium is spot minus realized on the same date", () => {
  const n = 300;
  const vix = series(n, () => 22);
  const vix3m = series(n, () => 24);
  const spx = series(n, (i) => 4000 * Math.exp(i * 0.0004));
  const read = volRead(vix, vix3m, spx)!;
  assert.ok(read);
  const expected = realizedVol(logReturns(spx.map((p) => p.value)), 21)!;
  assert.ok(Math.abs(read.premium - (22 - expected)) < 1e-9);
  assert.equal(read.rv21, expected);
});

test("percentile uses only history at or before the as-of date", () => {
  // A spike after the read must not change where today ranks.
  const n = 300;
  const vix = [...series(n, () => 15)];
  const vix3m = series(n, () => 17);
  const spx = series(n, (i) => 4000 + i);
  const base = volRead(vix, vix3m, spx)!;
  const withFuture = volRead(
    [...vix, { date: day(n), value: 80 }],
    vix3m,
    spx,
  )!;
  assert.equal(base.percentile, withFuture.percentile);
});

test("percentileRank is a share of history, never a probability", () => {
  assert.equal(percentileRank([1, 2, 3, 4], 3), 50);
  assert.equal(percentileRank([], 3), null);
  assert.equal(percentileRank([1, 2], Number.NaN), null);
});

test("realizedVol refuses a window it cannot fill", () => {
  assert.equal(realizedVol([0.01, 0.02], 21), null);
  assert.equal(realizedVol([0.01, 0.02, 0.03], 1), null, "one return has no dispersion");
});
