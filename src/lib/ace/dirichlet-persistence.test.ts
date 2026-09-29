/**
 * The Dirichlet state survives a poll (PR #5 A03).
 *
 * Only rounded percentages used to be frozen, and every poll rebuilt the
 * concentration from them at PRIOR_STRENGTH — so each poll forgot the evidence
 * the book had absorbed, and its bands widened with no new information. These
 * tests run the real update and the real snapshot row mapping through a JSON
 * round trip, the way a poll does.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvidenceItem, Scenario } from "../../data/types.ts";
import { snapshotRows } from "../live/forecast-ledger.server.ts";
import { forecastBands } from "./bands.ts";
import { PRIOR_STRENGTH, updateScenarios } from "./probability.ts";

function book(probs: number[]): Scenario[] {
  return probs.map((p, i) => ({
    id: `s${i + 1}`,
    name: `scenario ${i + 1}`,
    detail: "fixture",
    probability: p,
    prevProbability: p,
    range: "days",
    keyOutcomes: "fixture",
    audit: {
      previous: p, updated: p, evidence: "genesis", direction: "up" as const,
      weight: 1, affectedNodes: [], rescoredAssets: [],
    },
  }));
}

let n = 0;
function ev(over: Partial<EvidenceItem> = {}): EvidenceItem {
  n += 1;
  return {
    id: `e${n}`, time: "10:00", eventTimeMs: 1_000, availableTimeMs: 1_000, source: "Reuters",
    evidenceClass: "narrative", kind: "news", headline: "fixture", delayed: false,
    reliability: "B", direction: "neutral", ...over,
  };
}

/** Freeze → store → reload, exactly as the ledger and the next poll do it. */
function persisted(scenarios: Scenario[]) {
  return JSON.parse(JSON.stringify(snapshotRows(scenarios))) as {
    id: string; probability: number; alpha?: number;
  }[];
}

const bandsOf = (u: ReturnType<typeof updateScenarios>) =>
  forecastBands(u.scenarios.map((s) => s.id), u.alpha);

test("the audit's reproduction: a no-evidence poll keeps [9, 6] and its bands exactly", () => {
  const first = updateScenarios({
    current: book([50, 50]),
    evidence: [ev({ direction: "up", evidenceClass: "fundamental", reliability: "A" })],
  });
  assert.deepEqual(first.alpha, [9, 6]);
  assert.deepEqual(first.scenarios.map((s) => s.probability), [60, 40]);

  const again = updateScenarios({ current: first.scenarios, prior: persisted(first.scenarios), evidence: [] });
  assert.deepEqual(again.alpha, [9, 6]);
  assert.deepEqual(bandsOf(again), bandsOf(first));
  assert.deepEqual(again.scenarios.map((s) => s.probability), [60, 40]);
});

test("a snapshot without concentration is rebuilt at the prior's strength, as documented", () => {
  const first = updateScenarios({
    current: book([50, 50]),
    evidence: [ev({ direction: "up", evidenceClass: "fundamental", reliability: "A" })],
  });
  const legacy = persisted(first.scenarios).map(({ alpha: _alpha, ...row }) => row);
  const rebuilt = updateScenarios({ current: first.scenarios, prior: legacy, evidence: [] });
  assert.deepEqual(rebuilt.alpha.map((a) => +a.toFixed(10)), [7.2, 4.8]);
  // ...which is exactly the loss: the band is wider with nothing new known.
  assert.ok(bandsOf(rebuilt)[0]!.width > bandsOf(first)[0]!.width);
  assert.equal(PRIOR_STRENGTH, 12);
});

test("one batch and the same evidence over three polls end in the same place", () => {
  const items = [
    ev({ direction: "up", evidenceClass: "fundamental", reliability: "A" }),
    ev({ direction: "down", evidenceClass: "market", reliability: "B" }),
    ev({ direction: "neutral", evidenceClass: "narrative", reliability: "B" }),
  ];
  const together = updateScenarios({ current: book([30, 40, 30]), evidence: items });

  let step = updateScenarios({ current: book([30, 40, 30]), evidence: [items[0]!] });
  for (const e of items.slice(1)) {
    step = updateScenarios({ current: step.scenarios, prior: persisted(step.scenarios), evidence: [e] });
  }
  together.alpha.forEach((a, i) => assert.ok(Math.abs(a - step.alpha[i]!) < 1e-12, `${a} vs ${step.alpha[i]}`));
  assert.deepEqual(step.scenarios.map((s) => s.probability), together.scenarios.map((s) => s.probability));
});

test("the burst cap is per poll — the one stated exception to batch equivalence", () => {
  const burst = Array.from({ length: 10 }, () =>
    ev({ direction: "up", evidenceClass: "fundamental", reliability: "A" }),
  );
  const together = updateScenarios({ current: book([50, 50]), evidence: burst });
  assert.equal(together.appliedMass, PRIOR_STRENGTH * 2, "one burst is capped");

  let step = updateScenarios({ current: book([50, 50]), evidence: [burst[0]!] });
  for (const e of burst.slice(1)) {
    step = updateScenarios({ current: step.scenarios, prior: persisted(step.scenarios), evidence: [e] });
  }
  const total = step.alpha.reduce((a, b) => a + b, 0);
  assert.equal(total, PRIOR_STRENGTH + 30, "spread over polls, every item counts");
});

test("neutral evidence sharpens without tilting, and the sharpening persists", () => {
  const start = updateScenarios({ current: book([30, 40, 30]), evidence: [] });
  const sharp = updateScenarios({
    current: start.scenarios,
    prior: persisted(start.scenarios),
    evidence: [ev({ direction: "neutral", evidenceClass: "fundamental", reliability: "A" })],
  });
  const mean = (a: number[]) => a.map((x) => x / a.reduce((s, y) => s + y, 0));
  mean(sharp.alpha).forEach((m, i) => assert.ok(Math.abs(m - mean(start.alpha)[i]!) < 1e-12));
  assert.ok(Math.abs(sharp.alpha.reduce((s, x) => s + x, 0) - (PRIOR_STRENGTH + 3)) < 1e-12);
  // Same rounded percentages, narrower bands — and the next poll keeps them.
  assert.deepEqual(sharp.scenarios.map((s) => s.probability), [30, 40, 30]);
  const next = updateScenarios({ current: sharp.scenarios, prior: persisted(sharp.scenarios), evidence: [] });
  assert.deepEqual(next.alpha, sharp.alpha);
  assert.ok(bandsOf(next)[1]!.width < bandsOf(start)[1]!.width);
});

test("the frozen row carries the concentration only when there is one", () => {
  assert.equal(snapshotRows(book([50, 50]))[0]!.alpha, undefined);
  const u = updateScenarios({ current: book([50, 50]), evidence: [] });
  assert.equal(snapshotRows(u.scenarios)[0]!.alpha, 6);
});
