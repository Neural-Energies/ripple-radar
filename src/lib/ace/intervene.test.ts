/**
 * The matrix primer has always claimed the likely cell "rewrites the causal
 * graph". These check that the rewrite is real, reproducible, and — above all
 * — that it stays a conditional view rather than leaking into the book.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CausalLink, GameTheory, RippleNode, Scenario } from "../../data/types.ts";
import { ASSERTED_WEIGHT, intervene, linkWeight, playAt, severityOf } from "./intervene.ts";

const GT: GameTheory = {
  actor: "Storm",
  counterpart: "Spare capacity",
  columns: ["Spare capacity holds", "Local outage", "Regional halt"],
  rows: [
    {
      name: "Landfall cat",
      cells: [
        { a: -1, b: 2, label: "Overfit" },
        { a: 3, b: -2, label: "Cracks / power" },
        { a: 4, b: -4, label: "System event" },
      ],
    },
    {
      name: "Miss",
      cells: [
        { a: -2, b: 2, label: "Vol crush" },
        { a: 0, b: 1, label: "Inventory rebuild" },
        { a: -3, b: 2, label: "False alarm" },
      ],
    },
  ],
  insight: "",
  players: [],
};

function scen(id: string, p: number): Scenario {
  return {
    id,
    name: id,
    detail: "",
    probability: p,
    prevProbability: p,
    range: "",
    keyOutcomes: "",
    audit: {
      previous: p,
      updated: p,
      evidence: "",
      direction: "up",
      weight: 0,
      affectedNodes: [],
      rescoredAssets: [],
    },
  };
}

// Ordered materialization → fade, as the generator emits them.
const SCENARIOS = [scen("material", 30), scen("partial", 40), scen("fade", 30)];

const NODES: RippleNode[] = [
  { id: "n0", label: "Event", level: 0, kind: "event", angle: 0, impact: 90, direction: "up", blurb: "" },
  { id: "n1", label: "Refiner", ticker: "VLO", level: 2, kind: "company", angle: 1, impact: 50, direction: "up", blurb: "" },
  { id: "n2", label: "Freight", ticker: "MATX", level: 3, kind: "industry", angle: 2, impact: 40, direction: "up", blurb: "" },
];

const LINKS: CausalLink[] = [
  { source: "n0", dest: "n1", direction: 1, distance: 1, confidence: 0.9, support: "measured", evidence: "", expectedLag: "", invalidation: "Spare capacity absorbs", historicalSupport: "" },
  { source: "n1", dest: "n2", direction: 1, distance: 1, confidence: 0.3, support: "measured", evidence: "", expectedLag: "", invalidation: "Freight reroutes", historicalSupport: "" },
];

/** An edge the panel cannot measure: no proxy, so no confidence to report. */
const ASSERTED_LINK: CausalLink = {
  source: "n0", dest: "n2", direction: 1, distance: 2, confidence: null,
  support: "asserted", evidence: "", expectedLag: "", invalidation: "", historicalSupport: "",
};

const base = { gameTheory: GT, scenarios: SCENARIOS, nodes: NODES, links: LINKS };

test("column position gives severity; the benign end is negative", () => {
  assert.equal(severityOf(GT, "Spare capacity holds"), -1);
  assert.equal(severityOf(GT, "Local outage"), 0);
  assert.equal(severityOf(GT, "Regional halt"), 1);
});

test("a one-column matrix carries no severity rather than guessing one", () => {
  const thin: GameTheory = { ...GT, columns: ["Only"], rows: [] };
  assert.equal(severityOf(thin, "Only"), 0);
});

test("the severe play moves mass toward materialization", () => {
  const out = intervene({ ...base, play: { row: "Landfall cat", col: "Regional halt" } })!;
  const material = out.scenarios.find((s) => s.id === "material")!;
  const fade = out.scenarios.find((s) => s.id === "fade")!;
  assert.ok(material.delta > 0, "materialization should gain");
  assert.ok(fade.delta < 0, "fade should lose");
});

test("the benign play moves mass the other way", () => {
  const out = intervene({ ...base, play: { row: "Miss", col: "Spare capacity holds" } })!;
  assert.ok(out.scenarios.find((s) => s.id === "material")!.delta < 0);
  assert.ok(out.scenarios.find((s) => s.id === "fade")!.delta > 0);
});

test("the middle column sharpens without tilting", () => {
  const out = intervene({ ...base, play: { row: "Landfall cat", col: "Local outage" } })!;
  assert.equal(out.severity, 0);
  assert.deepEqual(
    out.scenarios.map((s) => s.conditional),
    SCENARIOS.map((s) => s.probability),
    "a neutral column must not move the book",
  );
});

test("conditional mass still sums to exactly 100", () => {
  for (const col of GT.columns) {
    const out = intervene({ ...base, play: { row: "Landfall cat", col } })!;
    const sum = out.scenarios.reduce((a, s) => a + s.conditional, 0);
    assert.equal(sum, 100, `mass must close for ${col}`);
  }
});

test("a well-evidenced path amplifies more than a speculative one", () => {
  const out = intervene({ ...base, play: { row: "Landfall cat", col: "Regional halt" } })!;
  const strong = out.nodes.find((n) => n.id === "n1")!; // confidence 0.9
  const weak = out.nodes.find((n) => n.id === "n2")!; // confidence 0.3
  assert.ok(strong.delta > weak.delta, "link confidence must govern how far transmission scales");
});

test("the event node itself is not rescored by a play about its consequences", () => {
  const out = intervene({ ...base, play: { row: "Landfall cat", col: "Regional halt" } })!;
  assert.equal(out.nodes.some((n) => n.id === "n0"), false);
});

test("the input book is never mutated — this is a view, not an update", () => {
  const snapshot = SCENARIOS.map((s) => s.probability);
  const nodeSnapshot = NODES.map((n) => n.impact);
  intervene({ ...base, play: { row: "Landfall cat", col: "Regional halt" } });
  assert.deepEqual(SCENARIOS.map((s) => s.probability), snapshot);
  assert.deepEqual(NODES.map((n) => n.impact), nodeSnapshot);
});

test("a conditional never claims to be more than heuristic", () => {
  const out = intervene({ ...base, play: { row: "Landfall cat", col: "Regional halt" } })!;
  assert.equal(out.provenance, "heuristic");
  assert.match(out.note, /not a forecast/i);
});

test("an off-matrix play returns null instead of inventing a cell", () => {
  assert.equal(playAt(GT, "Landfall cat", "No such column"), null);
  assert.equal(intervene({ ...base, play: { row: "Nope", col: "Regional halt" } }), null);
  assert.equal(intervene({ ...base, scenarios: [], play: { row: "Miss", col: "Regional halt" } }), null);
});

test("intervening is deterministic", () => {
  const a = intervene({ ...base, play: { row: "Landfall cat", col: "Regional halt" } });
  const b = intervene({ ...base, play: { row: "Landfall cat", col: "Regional halt" } });
  assert.deepEqual(a, b);
});


// --------------------------------------------------- measured vs asserted

test("an unmeasured edge is weighted below a measured one, and above nothing", () => {
  // 34 of the graph's 42 edges have no market proxy. Treating them as zero
  // would silently delete most of the graph from this analysis; treating them
  // as measured would launder an assertion into a number.
  assert.equal(linkWeight(LINKS[0]!), 0.9);
  assert.equal(linkWeight(ASSERTED_LINK), ASSERTED_WEIGHT);
  assert.ok(ASSERTED_WEIGHT > 0, "'no proxy for shipping insurance' is not 'it transmits nothing'");
  assert.ok(ASSERTED_WEIGHT < linkWeight(LINKS[0]!));
});

test("an edge with no material coupling carries no weight at all", () => {
  const dead: CausalLink = { ...ASSERTED_LINK, support: "no_material_coupling" };
  const self: CausalLink = { ...ASSERTED_LINK, support: "degenerate" };
  assert.equal(linkWeight(dead), 0, "measured to be indistinguishable from zero");
  assert.equal(linkWeight(self), 0, "a series against itself transmits nothing new");
});

test("a measured edge outranks an asserted one whatever the ontology claimed", () => {
  const weakMeasured: CausalLink = { ...LINKS[0]!, confidence: 0.1, support: "measured" };
  const strongAsserted: CausalLink = { ...ASSERTED_LINK, assertedConfidence: 0.95 };
  const out = intervene({
    ...base,
    links: [weakMeasured, { ...strongAsserted, dest: "n1" }],
    play: { row: "Landfall cat", col: "Regional halt" },
  })!;
  const carried = out.links.map((l) => l.support);
  assert.equal(carried[0], "measured", `measured must lead, got ${carried.join(",")}`);
});

test("the result reports both the confidence and the weight it actually used", () => {
  const out = intervene({
    ...base,
    links: [ASSERTED_LINK],
    play: { row: "Landfall cat", col: "Regional halt" },
  })!;
  if (out.links.length) {
    assert.equal(out.links[0]!.confidence, null, "no measurement means no number");
    assert.equal(out.links[0]!.weight, ASSERTED_WEIGHT, "but the weight used is explicit");
    assert.equal(out.links[0]!.support, "asserted");
  }
});
