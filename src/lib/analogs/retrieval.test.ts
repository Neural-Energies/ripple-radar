/**
 * The port must BE the validated engine, not a second engine with the same name.
 *
 * Retrieval was validated in Python. The request path cannot call Python, so it
 * was reimplemented here — and a reimplementation is exactly where a validated
 * method quietly stops being the validated method. The Python run exported its
 * exact answers for nine query dates spread across regimes (2013 calm, 2015
 * and 2018 vol shocks, March 2020, 2022 tightening, August 2024, April 2025).
 * These tests replay them.
 *
 * The rest pin the two leakage guards, which are the difference between a
 * historical analog and a lookahead.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  covariance,
  jacobiEigen,
  pseudoInverseSymmetric,
  retrieveAnalogs,
  type PoolRow,
} from "./retrieval.ts";

const artifact = JSON.parse(readFileSync("src/lib/analogs/pool.json", "utf8")) as {
  features: string[];
  forward_days: number;
  k: number;
  rows: PoolRow[];
  references: {
    query: string;
    as_of: string;
    analogs: { date: string; distance: number; forward_return: number }[];
    outcome_distribution: { median: number; p10: number; p90: number; share_positive: number };
    agreement: number;
  }[];
};

const OPTS = { features: artifact.features, forwardDays: artifact.forward_days, k: artifact.k };

// --------------------------------------------- the port reproduces Python

test("the port returns Python's analogs, in Python's order, on every reference", () => {
  assert.ok(artifact.references.length >= 5, "not enough reference queries to trust this");
  for (const ref of artifact.references) {
    const out = retrieveAnalogs(artifact.rows, ref.query, OPTS);
    assert.equal(out.available, true, `${ref.query} unavailable`);
    assert.equal(out.asOf, ref.as_of, `${ref.query} snapped to a different state`);
    assert.deepEqual(
      out.analogs.map((a) => a.date),
      ref.analogs.map((a) => a.date),
      `${ref.query} retrieved a different set or order`,
    );
  }
});

test("distances match Python to the precision Python exported", () => {
  for (const ref of artifact.references) {
    const out = retrieveAnalogs(artifact.rows, ref.query, OPTS);
    out.analogs.forEach((a, i) => {
      assert.ok(
        Math.abs(a.distance - ref.analogs[i]!.distance) < 1e-3,
        `${ref.query} analog ${i}: ${a.distance} vs ${ref.analogs[i]!.distance}`,
      );
    });
  }
});

test("the outcome distribution and agreement match Python", () => {
  for (const ref of artifact.references) {
    const out = retrieveAnalogs(artifact.rows, ref.query, OPTS);
    assert.ok(Math.abs(out.distribution!.median - ref.outcome_distribution.median) < 1e-6, ref.query);
    assert.ok(Math.abs(out.distribution!.p10 - ref.outcome_distribution.p10) < 1e-6, ref.query);
    assert.ok(Math.abs(out.distribution!.p90 - ref.outcome_distribution.p90) < 1e-6, ref.query);
    assert.ok(Math.abs(out.agreement! - ref.agreement) < 1e-6, ref.query);
  }
});

// ------------------------------------------------------- leakage guards

test("no analog is dated on or after the query", () => {
  for (const ref of artifact.references) {
    const out = retrieveAnalogs(artifact.rows, ref.query, OPTS);
    for (const a of out.analogs) {
      assert.ok(Date.parse(a.date) < Date.parse(out.asOf!), `${a.date} is not before ${out.asOf}`);
    }
  }
});

test("every analog's own forward window had closed before the query", () => {
  // The guard that matters most: without it an analog from last week arrives
  // carrying a forward return that has not finished happening.
  const factor = 1.6;
  for (const ref of artifact.references) {
    const out = retrieveAnalogs(artifact.rows, ref.query, OPTS);
    const cutoff =
      Date.parse(out.asOf!) - Math.trunc(artifact.forward_days * factor) * 86_400_000;
    for (const a of out.analogs) {
      assert.ok(Date.parse(a.date) < cutoff, `${a.date} window had not closed by ${out.asOf}`);
    }
  }
});

test("a query before any history is refused, not guessed", () => {
  const out = retrieveAnalogs(artifact.rows, "1990-01-01", OPTS);
  assert.equal(out.available, false);
  assert.match(out.reason!, /no state history/i);
  assert.deepEqual(out.analogs, []);
});

test("too thin a candidate set is refused rather than padded", () => {
  const early = artifact.rows[0]!.d;
  const out = retrieveAnalogs(artifact.rows, early, OPTS);
  assert.equal(out.available, false);
  assert.match(out.reason!, /eligible historical states|no state history/i);
});

test("an unparseable date is a reason, not a throw", () => {
  const out = retrieveAnalogs(artifact.rows, "not-a-date", OPTS);
  assert.equal(out.available, false);
  assert.match(out.reason!, /unparseable/i);
});

// ------------------------------------------------------- honest output

test("the result is a distribution, never a direction", () => {
  const ref = artifact.references[0]!;
  const out = retrieveAnalogs(artifact.rows, ref.query, OPTS);
  const d = out.distribution!;
  assert.ok(d.p10 <= d.p25 && d.p25 <= d.median && d.median <= d.p75 && d.p75 <= d.p90);
  assert.equal(d.n, out.analogs.length);
  assert.ok(d.sharePositive >= 0 && d.sharePositive <= 1);
});

test("agreement is 0 on an even split and 1 when unanimous", () => {
  // Reported so a wide, contradictory analog set cannot read like a signal.
  for (const ref of artifact.references) {
    const out = retrieveAnalogs(artifact.rows, ref.query, OPTS);
    const share = out.distribution!.sharePositive;
    assert.ok(Math.abs(out.agreement! - Math.abs(2 * share - 1)) < 1e-9);
    assert.ok(out.agreement! >= 0 && out.agreement! <= 1);
  }
});

test("every analog explains what separates it from the query", () => {
  const out = retrieveAnalogs(artifact.rows, artifact.references[0]!.query, OPTS);
  for (const a of out.analogs) {
    assert.ok(a.drivers.length > 0, `${a.date} has no drivers`);
    for (const d of a.drivers) {
      assert.ok(artifact.features.includes(d.feature), `unknown feature ${d.feature}`);
      assert.ok(d.share >= 0 && d.share <= 1);
    }
    const shares = a.drivers.map((d) => d.share);
    assert.deepEqual(shares, [...shares].sort((x, y) => y - x), "largest contributor must lead");
  }
});

test("analogs come back nearest-first", () => {
  const out = retrieveAnalogs(artifact.rows, artifact.references[2]!.query, OPTS);
  const d = out.analogs.map((a) => a.distance);
  assert.deepEqual(d, [...d].sort((x, y) => x - y));
});

// ------------------------------------------------------------ linear algebra

test("covariance matches the ddof=1 convention numpy uses", () => {
  const rows = [[1, 2], [3, 5], [5, 4], [7, 11]];
  const c = covariance(rows);
  // means 4 and 5.5; unbiased variances 20/3 and 15
  assert.ok(Math.abs(c[0]![0]! - 20 / 3) < 1e-9);
  assert.ok(Math.abs(c[1]![1]! - 15) < 1e-9);
  assert.ok(Math.abs(c[0]![1]! - c[1]![0]!) < 1e-12, "covariance must be symmetric");
});

test("the eigendecomposition reconstructs its input", () => {
  const m = [
    [4, 1, 0],
    [1, 3, 1],
    [0, 1, 2],
  ];
  const { values, vectors } = jacobiEigen(m);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += vectors[i]![k]! * values[k]! * vectors[j]![k]!;
      assert.ok(Math.abs(acc - m[i]![j]!) < 1e-8, `reconstruction failed at ${i},${j}`);
    }
  }
});

test("the pseudo-inverse satisfies the Moore-Penrose identity", () => {
  const m = [
    [4, 1, 0],
    [1, 3, 1],
    [0, 1, 2],
  ];
  const inv = pseudoInverseSymmetric(m);
  // A A+ A = A
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) acc += m[i]![a]! * inv[a]![b]! * m[b]![j]!;
      assert.ok(Math.abs(acc - m[i]![j]!) < 1e-7, `identity failed at ${i},${j}`);
    }
  }
});

test("a singular matrix gets a pseudo-inverse, not an explosion", () => {
  // A covariance over perfectly correlated channels is singular; inverting it
  // naively would blow one direction up to dominate every distance.
  const singular = [
    [1, 1],
    [1, 1],
  ];
  const inv = pseudoInverseSymmetric(singular);
  for (const row of inv) for (const v of row) assert.ok(Number.isFinite(v), "non-finite entry");
  let acc = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) acc += singular[0]![a]! * inv[a]![b]! * singular[b]![0]!;
  assert.ok(Math.abs(acc - 1) < 1e-7, "A A+ A = A must still hold");
});
