/**
 * The quad module must not let a failed claim through as a feature.
 *
 * The classification passed its test; the positioning claim did not. The risk
 * this file guards is the gap between those two: a generated module that says
 * "Goldilocks" is fine, a generated module that implies you should therefore
 * be long is the exact thing the validation run ruled out.
 *
 * It also guards the point-in-time discipline, which is the only reason the
 * classification is worth anything. A reading whose inputs are dated AFTER the
 * date it classifies is an almanac, not a nowcast, and it would be invisible
 * on screen.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURRENT_QUAD,
  POSITIONING_VALIDATED,
  PUBLICATION_LAGS,
  QUADS,
  QUAD_CHANNEL_EDGES,
  QUAD_HISTORY,
  QUAD_RUN,
  QUAD_TRANSITIONS,
  likelyNextQuads,
  stalenessDays,
  type QuadReading,
} from "./macro-quads.ts";

const readings: QuadReading[] = [CURRENT_QUAD, ...QUAD_HISTORY];
const day = (iso: string) => Date.parse(iso + "T00:00:00Z");

test("every reading uses only data published before the date it classifies", () => {
  for (const r of readings) {
    const asOf = day(r.asOf);
    for (const through of [r.growthThrough, r.inflationThrough]) {
      if (!through) continue;
      assert.ok(
        day(through) < asOf,
        `${r.asOf} claims to read data observed ${through} — that is an almanac, not a nowcast`,
      );
    }
    assert.ok(
      r.dataLagDays !== null && r.dataLagDays > 0,
      `${r.asOf} has a non-positive data lag (${r.dataLagDays}), which cannot happen point-in-time`,
    );
  }
});

test("the data lag is at least as long as the fastest input publishes", () => {
  // PAYEMS is the quickest at ~34 days; nothing can read fresher than that.
  const fastest = Math.min(...Object.values(PUBLICATION_LAGS).map((l) => l.medianDays));
  assert.ok(fastest > 0);
  const median = QUAD_RUN.medianDataLagDays ?? 0;
  assert.ok(
    median >= fastest,
    `median lag ${median}d is shorter than the fastest input's ${fastest}d publication lag`,
  );
});

test("the quad matches the rates of change it was derived from", () => {
  // The 2x2 itself: growth accelerating is the top row, inflation the right column.
  for (const r of readings) {
    if (r.growthRoc == null || r.inflationRoc == null) continue;
    const expected = r.growthRoc >= 0 ? (r.inflationRoc >= 0 ? 2 : 1) : r.inflationRoc >= 0 ? 3 : 4;
    assert.equal(
      r.quad,
      expected,
      `${r.asOf}: growth roc ${r.growthRoc}, inflation roc ${r.inflationRoc} is Q${expected}, module says Q${r.quad}`,
    );
    assert.equal(r.name, QUADS[r.quad]?.name);
  }
});

test("history is chronological and does not reach past the live reading", () => {
  for (let i = 1; i < QUAD_HISTORY.length; i++) {
    assert.ok(
      day(QUAD_HISTORY[i]!.asOf) > day(QUAD_HISTORY[i - 1]!.asOf),
      `history is out of order at ${QUAD_HISTORY[i]!.asOf}`,
    );
  }
  const last = QUAD_HISTORY[QUAD_HISTORY.length - 1];
  assert.ok(last && day(last.asOf) <= day(CURRENT_QUAD.asOf));
});

test("positioning stays gated while the holdout says it should", () => {
  // This is the whole point. The flag is written by the generator from the
  // validation run; if it is ever true, it must be because channels actually
  // beat the baseline — not because someone edited the module.
  const v = QUAD_RUN.validation;
  if (POSITIONING_VALIDATED) {
    assert.ok(
      v.channelsBeatingLongOnly.length >= 2,
      "positioning cannot be validated with fewer than two channels beating always-long",
    );
    assert.ok((v.signsHeld ?? 0) / (v.usableCells ?? 1) > 0.5, "sign stability is a coin flip");
  } else {
    assert.equal(v.channelsBeatingLongOnly.length, 0);
  }
});

test("no channel's edge over always-long excludes zero", () => {
  // Consistency between the flag and the numbers behind it: if some channel's
  // interval did exclude zero, the flag above is stale and the gate is wrong.
  for (const [ch, e] of Object.entries(QUAD_CHANNEL_EDGES)) {
    const [lo, hi] = e.edgeCi;
    if (lo == null || hi == null) continue;
    const excludesZero = lo > 0 || hi < 0;
    assert.equal(
      excludesZero,
      QUAD_RUN.validation.channelsBeatingLongOnly.includes(ch),
      `${ch}: CI [${lo}, ${hi}] disagrees with the recorded verdict`,
    );
  }
});

test("transition rows are distributions over OTHER quads", () => {
  for (const [from, row] of Object.entries(QUAD_TRANSITIONS)) {
    // Runs are collapsed, so a quad never transitions to itself.
    assert.equal(row[Number(from)], 0, `Q${from} transitions to itself`);
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.01, `Q${from} row sums to ${total}`);
  }
});

test("likelyNextQuads ranks by probability and drops impossible moves", () => {
  for (const q of [1, 2, 3, 4] as const) {
    const next = likelyNextQuads(q);
    assert.ok(
      next.every((n) => n.quad !== q),
      "a collapsed run cannot stay put",
    );
    assert.ok(next.every((n) => n.p > 0));
    for (let i = 1; i < next.length; i++) {
      assert.ok(next[i - 1]!.p >= next[i]!.p, "not sorted");
    }
  }
});

test("stalenessDays measures against the data, not the label", () => {
  // A reading's headline date can be today while its inputs are two months
  // old. The panel shows the second number, so it must come from the inputs.
  const r: QuadReading = {
    ...CURRENT_QUAD,
    asOf: "2026-09-25",
    growthThrough: "2026-08-01",
    inflationThrough: "2026-07-01",
  };
  assert.equal(stalenessDays(r, day("2026-09-25")), 55);
  assert.equal(
    stalenessDays({ ...r, growthThrough: null, inflationThrough: null }, Date.now()),
    null,
  );
});

test("the distribution covers every quad the history contains", () => {
  const seen = new Set(QUAD_HISTORY.map((r) => String(r.quad)));
  for (const q of seen) {
    assert.ok(
      (QUAD_RUN.distribution as Record<string, number>)[q]! > 0,
      `Q${q} missing from the run distribution`,
    );
  }
  const total = Object.values(QUAD_RUN.distribution as Record<string, number>).reduce(
    (a, b) => a + b,
    0,
  );
  assert.equal(total, QUAD_RUN.nClassified);
});

test("GDP is excluded, and the module says why", () => {
  const inputs = [...QUAD_RUN.growthSeries, ...QUAD_RUN.inflationSeries];
  assert.ok(
    !inputs.some((s) => s.toUpperCase().includes("GDP")),
    "GDP publishes too late to nowcast",
  );
  assert.ok(QUAD_RUN.gdpExcludedReason.length > 20);
});
