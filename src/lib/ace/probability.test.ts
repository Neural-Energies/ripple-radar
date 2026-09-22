import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvidenceItem, RippleNode, Scenario, TradeIdea } from "../../data/types.ts";
import { PRIOR_STRENGTH, evidenceWeight, updateScenarios } from "./probability.ts";

/** Materialization → fade, the order every family in scenariosFor emits. */
function priorBook(probs = [30, 40, 30]): Scenario[] {
  return probs.map((p, i) => ({
    id: `s${i + 1}`,
    name: ["Binding constraint", "Partial / contained", "Fades"][i] ?? `s${i + 1}`,
    detail: "fixture",
    probability: p,
    prevProbability: p,
    range: "days",
    keyOutcomes: "fixture",
    audit: {
      previous: p,
      updated: p,
      evidence: "genesis",
      direction: "up" as const,
      weight: 1,
      affectedNodes: [],
      rescoredAssets: [],
    },
  }));
}

function ev(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: over.id ?? `e${Math.random().toString(36).slice(2, 8)}`,
    time: "10:00",
    eventTimeMs: 1_000,
    availableTimeMs: 1_000,
    source: "Reuters",
    evidenceClass: "narrative",
    kind: "news",
    headline: "fixture headline",
    delayed: false,
    reliability: "B",
    direction: "neutral",
    ...over,
  };
}

test("posterior mass always sums to exactly 100", () => {
  for (const probs of [[30, 40, 30], [25, 25, 25, 25], [8, 42, 30, 20], [100]]) {
    const out = updateScenarios({
      current: priorBook(probs),
      evidence: [ev({ direction: "up", evidenceClass: "fundamental" }), ev({ direction: "down" })],
    });
    const sum = out.scenarios.reduce((a, s) => a + s.probability, 0);
    assert.equal(sum, 100, `expected 100 for prior ${probs.join("/")}, got ${sum}`);
  }
});

test("escalatory evidence moves mass toward materialization, de-escalatory away", () => {
  const book = priorBook();
  const up = updateScenarios({
    current: book,
    evidence: [ev({ direction: "up", evidenceClass: "fundamental", reliability: "A" })],
  });
  const down = updateScenarios({
    current: book,
    evidence: [ev({ direction: "down", evidenceClass: "fundamental", reliability: "A" })],
  });

  assert.ok(up.scenarios[0]!.probability > 30, "escalatory evidence should raise s1");
  assert.ok(up.scenarios[2]!.probability < 30, "escalatory evidence should lower the fade case");
  assert.ok(down.scenarios[0]!.probability < 30, "de-escalatory evidence should lower s1");
  assert.ok(down.scenarios[2]!.probability > 30, "de-escalatory evidence should raise the fade case");
});

test("neutral evidence sharpens the prior without tilting the ranking", () => {
  const out = updateScenarios({
    current: priorBook([20, 50, 30]),
    evidence: [ev({ direction: "neutral" }), ev({ direction: "neutral" })],
  });
  const [a, b, c] = out.scenarios.map((s) => s.probability);
  assert.ok(b! > a! && b! > c!, "the leading scenario must stay the leader");
  assert.deepEqual([a, b, c], [20, 50, 30], "neutral evidence must not shift the mass");
});

test("identical evidence produces an identical audit (reproducible, not vibes)", () => {
  const evidence = [
    ev({ id: "fixed-1", direction: "up", evidenceClass: "fundamental", reliability: "A" }),
    ev({ id: "fixed-2", direction: "down", evidenceClass: "market", reliability: "C" }),
  ];
  const a = updateScenarios({ current: priorBook(), evidence });
  const b = updateScenarios({ current: priorBook(), evidence });
  assert.deepEqual(a.scenarios, b.scenarios);
  assert.deepEqual(a.audits, b.audits);
});

test("a fundamental A-tier print outweighs a narrative D-tier one", () => {
  assert.ok(
    evidenceWeight(ev({ evidenceClass: "fundamental", reliability: "A" })) >
      evidenceWeight(ev({ evidenceClass: "narrative", reliability: "D" })),
  );
});

test("a duplicate is discounted, so one syndicated story is not twenty confirmations", () => {
  const original = evidenceWeight(ev({ evidenceClass: "fundamental", reliability: "A" }));
  const echo = evidenceWeight(
    ev({ evidenceClass: "fundamental", reliability: "A", duplicateOf: "fixed-1" }),
  );
  assert.ok(echo < original, "a duplicate must weigh less than the print it repeats");

  const many = Array.from({ length: 20 }, (_, i) =>
    ev({ id: `dupe-${i}`, direction: "up", evidenceClass: "fundamental", duplicateOf: "root" }),
  );
  const out = updateScenarios({ current: priorBook(), evidence: many });
  assert.ok(
    out.scenarios[0]!.probability < 85,
    "twenty echoes of one story must not near-certainty the book",
  );
});

test("one burst cannot slam the distribution past the mass cap", () => {
  const flood = Array.from({ length: 200 }, (_, i) =>
    ev({ id: `f${i}`, direction: "up", evidenceClass: "fundamental", reliability: "A" }),
  );
  const out = updateScenarios({ current: priorBook(), evidence: flood });
  assert.ok(out.appliedMass <= PRIOR_STRENGTH * 2, "applied mass must respect the cap");
  assert.equal(
    out.scenarios.reduce((a, s) => a + s.probability, 0),
    100,
  );
});

test("the audit answers 'why did this move', with nodes and rescored assets", () => {
  const nodes: RippleNode[] = [
    { id: "n1", label: "Refinery capacity", ticker: "VLO", level: 1, kind: "industry", angle: 0, impact: 80, direction: "up", blurb: "" },
    { id: "n2", label: "Demand", ticker: "XRT", level: 2, kind: "industry", angle: 90, impact: 40, direction: "down", blurb: "" },
  ];
  const trades: TradeIdea[] = [
    { ticker: "VLO", name: "Valero", score: 90, reason: "r", side: "long", category: "stock", horizon: "days" },
    { ticker: "XRT", name: "Retail", score: 40, reason: "r", side: "short", category: "etf", horizon: "days" },
  ];
  const out = updateScenarios({
    current: priorBook(),
    evidence: [ev({ direction: "up", evidenceClass: "fundamental", reliability: "A" })],
    nodes,
    trades,
  });

  const lead = out.scenarios[0]!.audit;
  assert.equal(lead.previous, 30);
  assert.ok(lead.updated > lead.previous);
  assert.equal(lead.direction, "up");
  assert.ok(lead.weight > 0, "weight must record the mass that actually landed");
  assert.match(lead.evidence, /fundamental/, "the audit must name what moved it");
  assert.ok(lead.affectedNodes.includes("n1"), "an up-scenario should cite up-direction nodes");
  assert.ok(lead.rescoredAssets.includes("VLO"), "expressions on those nodes are rescored");
});

test("scenarios join on id, so a rename keeps its history instead of minting a new forecast", () => {
  const renamed = priorBook();
  renamed[0]!.name = "Binding constraint (revised wording)";
  const out = updateScenarios({
    current: renamed,
    prior: [
      { id: "s1", probability: 55 },
      { id: "s2", probability: 25 },
      { id: "s3", probability: 20 },
    ],
    evidence: [],
  });
  assert.equal(out.scenarios[0]!.audit.previous, 55, "prior must attach by id, not by name");
  assert.equal(out.scenarios[0]!.probability, 55, "no evidence means no movement");
  assert.match(out.scenarios[0]!.audit.evidence, /No new evidence/);
});

test("an empty book is handled without inventing scenarios", () => {
  const out = updateScenarios({ current: [], evidence: [ev()] });
  assert.deepEqual(out.scenarios, []);
  assert.deepEqual(out.audits, []);
});
