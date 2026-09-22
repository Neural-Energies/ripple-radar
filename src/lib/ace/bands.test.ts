import assert from "node:assert/strict";
import { test } from "node:test";
import { betaCdf, betaQuantile, forecastBands } from "./bands.ts";

test("betaCdf matches known closed-form values", () => {
  // Beta(1,1) is uniform: I(x;1,1) = x.
  for (const x of [0.1, 0.25, 0.5, 0.9]) {
    assert.ok(Math.abs(betaCdf(x, 1, 1) - x) < 1e-9, `uniform CDF wrong at ${x}`);
  }
  // Beta(2,1) has CDF x^2.
  assert.ok(Math.abs(betaCdf(0.5, 2, 1) - 0.25) < 1e-9);
  // Beta(1,2) has CDF 1-(1-x)^2.
  assert.ok(Math.abs(betaCdf(0.5, 1, 2) - 0.75) < 1e-9);
});

test("betaQuantile inverts betaCdf", () => {
  for (const [a, b] of [[2, 5], [5, 5], [0.5, 0.5], [20, 3]]) {
    for (const p of [0.1, 0.5, 0.9]) {
      const x = betaQuantile(p, a!, b!);
      assert.ok(Math.abs(betaCdf(x, a!, b!) - p) < 1e-6, `inverse failed for Beta(${a},${b}) at p=${p}`);
    }
  }
});

test("a symmetric posterior gives a median at the mean and a symmetric band", () => {
  const [band] = forecastBands(["s1"], [5, 5]);
  assert.ok(Math.abs(band!.p50 - 50) < 1.5, "median of Beta(5,5) should sit at ~50%");
  assert.ok(Math.abs((50 - band!.p10) - (band!.p90 - 50)) < 1.5, "band should be symmetric");
});

test("more evidence narrows the band — the width means something", () => {
  // Same 40/60 split, but ten times the concentration.
  const thin = forecastBands(["s1"], [4, 6])[0]!;
  const rich = forecastBands(["s1"], [40, 60])[0]!;
  assert.ok(Math.abs(thin.p50 - rich.p50) < 2, "central estimate should be unchanged");
  assert.ok(rich.width < thin.width / 2, "ten times the evidence should roughly halve-or-better the band");
});

test("bands bracket the point estimate and stay inside 0-100", () => {
  const alpha = [3, 6, 2, 1];
  const total = alpha.reduce((a, n) => a + n, 0);
  const bands = forecastBands(["s1", "s2", "s3", "s4"], alpha);
  bands.forEach((b, i) => {
    const mean = (alpha[i]! / total) * 100;
    assert.ok(b.p10 <= b.p50 && b.p50 <= b.p90, "quantiles must be ordered");
    assert.ok(b.p10 >= 0 && b.p90 <= 100, "bands must stay in range");
    assert.ok(Math.abs(b.p50 - mean) < 8, `median should track the posterior mean for s${i + 1}`);
  });
});

test("a degenerate posterior yields no bands rather than a fabricated one", () => {
  assert.deepEqual(forecastBands(["s1"], [0]), []);
  assert.deepEqual(forecastBands([], []), []);
});

test("bands are deterministic — no sampling", () => {
  const a = forecastBands(["s1", "s2"], [7, 13]);
  const b = forecastBands(["s1", "s2"], [7, 13]);
  assert.deepEqual(a, b);
});
