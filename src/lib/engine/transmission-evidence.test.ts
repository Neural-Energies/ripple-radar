/**
 * The Ripple graph's numbers must stay traceable to a measurement run.
 *
 * The defect these prevent is regression by drift: someone adds an edge to the
 * ontology, the generated artifact does not know about it, and the graph
 * quietly falls back to displaying an authored confidence as if it were
 * measured. That is precisely the state this work removed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { TRANSMIT } from "./ontology.ts";
import {
  TRANSMISSION_EVIDENCE,
  TRANSMISSION_RUN,
  edgeEvidence,
  type EdgeEvidence,
} from "./transmission-evidence.ts";

const all = Object.values(TRANSMISSION_EVIDENCE);

test("every ontology edge has a measurement verdict", () => {
  const missing = TRANSMIT.filter((e) => !edgeEvidence(e.from, e.to));
  assert.deepEqual(
    missing.map((e) => `${e.from}->${e.to}`),
    [],
    "an edge with no verdict would fall back to its authored confidence — re-run " +
      "scripts/export-transmit-edges.mjs and ace/ripple/edge_calibration.py",
  );
});

test("the evidence set does not carry edges the ontology dropped", () => {
  const live = new Set(TRANSMIT.map((e) => `${e.from}|${e.to}`));
  const stale = Object.keys(TRANSMISSION_EVIDENCE).filter((k) => !live.has(k));
  assert.deepEqual(stale, [], "stale measurements would describe a graph that no longer exists");
});

test("only a measured edge carries a confidence number", () => {
  for (const [key, e] of Object.entries(TRANSMISSION_EVIDENCE)) {
    if (e.status === "measured") {
      assert.equal(typeof e.signStability, "number", `${key} is measured but has no sign stability`);
      assert.equal(typeof e.coupling, "number", `${key} is measured but has no coupling`);
    } else {
      assert.equal(e.signStability, null, `${key} is ${e.status} but reports a confidence`);
    }
  }
});

test("a measured edge cleared the coupling floor it was measured against", () => {
  for (const [key, e] of Object.entries(TRANSMISSION_EVIDENCE)) {
    if (e.status !== "measured") continue;
    assert.ok(
      (e.coupling ?? 0) >= TRANSMISSION_RUN.couplingFloor,
      `${key} is marked measured at |r| ${e.coupling} but the floor is ${TRANSMISSION_RUN.couplingFloor}`,
    );
  }
});

test("probabilities stay in range", () => {
  for (const [key, e] of Object.entries(TRANSMISSION_EVIDENCE)) {
    if (e.signStability !== null) {
      assert.ok(e.signStability >= 0 && e.signStability <= 1, `${key} sign stability out of range`);
    }
    if (e.coupling !== null) {
      assert.ok(e.coupling >= 0 && e.coupling <= 1, `${key} coupling out of range`);
    }
  }
});

test("a degenerate edge is caught, not measured", () => {
  // rates->duration both proxy to UST10Y. Unguarded it returns r = 1.0 and
  // renders as the strongest link in the graph.
  const degenerate = all.filter((e) => e.status === "degenerate");
  for (const e of degenerate) {
    assert.equal(e.fromProxy, e.toProxy, "degenerate means both ends are the same series");
    assert.equal(e.signStability, null);
    assert.equal(e.coupling, null);
  }
  const ratesDuration = edgeEvidence("rates", "duration");
  if (ratesDuration) assert.equal(ratesDuration.status, "degenerate");
});

test("an unmeasured edge names at least one end with no proxy", () => {
  for (const [key, e] of Object.entries(TRANSMISSION_EVIDENCE)) {
    if (e.status !== "unmeasured") continue;
    assert.ok(
      e.fromProxy === null || e.toProxy === null || e.nTrain === 0,
      `${key} is unmeasured but both ends have proxies and data`,
    );
  }
});

test("no edge claims a surviving lagged horizon without having been measured", () => {
  for (const [key, e] of Object.entries(TRANSMISSION_EVIDENCE)) {
    if (e.laggedHorizons && e.laggedHorizons.length) {
      assert.equal(e.status, "measured", `${key} reports a lag but was never measured`);
    }
  }
});

test("the measured set is a minority, and the file says so honestly", () => {
  // Not a threshold to game — a standing reminder of what this graph is. If a
  // future panel makes most edges measurable this test should be updated with
  // the new run, not deleted.
  const measured = all.filter((e) => e.status === "measured").length;
  assert.ok(measured > 0, "at least some edges must be measurable or the exercise failed");
  assert.ok(
    measured < all.length / 2,
    `measured ${measured}/${all.length} — if this flipped, regenerate and update this test`,
  );
});

test("the run records how confidence was defined", () => {
  assert.ok(TRANSMISSION_RUN.confidenceDefinition.length > 40);
  assert.ok(TRANSMISSION_RUN.nBootstrap >= 500, "a sign-stability estimate needs real resamples");
  assert.ok(TRANSMISSION_RUN.holdoutFrac > 0 && TRANSMISSION_RUN.holdoutFrac < 1);
  assert.ok(TRANSMISSION_RUN.generatedAt.length > 0);
});

test("the asserted confidence is kept so the gap stays inspectable", () => {
  const measured = all.filter((e) => e.status === "measured");
  for (const e of measured) {
    assert.equal(typeof e.assertedConfidence, "number");
  }
  // The finding that motivated this module: the authored numbers were far off.
  const gaps = measured.map((e: EdgeEvidence) =>
    Math.abs(e.assertedConfidence - (e.signStability ?? 0)),
  );
  const mean = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
  assert.ok(mean > 0.05, `authored and measured agreed to within ${mean.toFixed(3)} — verify the run`);
});
