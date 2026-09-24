import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvidenceItem, RippleNode, Scenario, TradeIdea } from "../../data/types.ts";
import { PRIOR_STRENGTH, evidenceWeight, roundTo100, updateScenarios } from "./probability.ts";

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

test("every family's prior closes to exactly 100 — mass over exclusive outcomes must sum", async () => {
  const { scenariosFor } = await import("../engine/hypothesize.ts");
  const families = [
    "physical", "policy", "credit", "tech", "fx",
    "weather", "corporate", "kinetic", "commodity", "other",
  ] as const;
  // Sweep what actually drives the weights. It used to be escalation and
  // de-escalation keyword counts feeding authored constants; the prior now
  // comes from a competing-risks curve read at the book's HORIZON, so the
  // horizon is the axis that has to close at every point — including the two
  // ends of the grid and the sub-floor case that returns no prior at all.
  const horizons = [1, 12, 24, 72, 168, 720, 24 * 365];
  for (const family of families) {
    for (const hits of [0, 3, 9, 20]) {
      for (const horizonHours of horizons) {
        const rows = scenariosFor({
          entity: "X", tags: [], family, tone: "neutral", hits, horizonHours,
        });
        const sum = rows.reduce((a, s) => a + s.probability, 0);
        const label = `${family} h${hits} ${horizonHours}h`;
        assert.ok(rows.every((s) => s.probability >= 0), `${label} produced negative mass`);
        if (horizonHours < 12) {
          // Below the modelled floor the engine offers no prior rather than
          // extrapolating; a book of zeros is the honest output, not a bug.
          assert.ok(sum === 0 || sum === 100, `${label} summed to ${sum}`);
        } else {
          assert.equal(sum, 100, `${label} summed to ${sum}`);
        }
      }
    }
  }
});

test("the prior no longer moves with how many articles were written", async () => {
  const { scenariosFor } = await import("../engine/hypothesize.ts");
  // Coverage volume is not probability. The old formula added 2 points of
  // materialization mass per headline, so a heavily covered story looked more
  // likely purely for being heavily covered — and coverage peaks after the
  // move is already priced.
  const quiet = scenariosFor({ entity: "X", tags: [], family: "physical", tone: "neutral", hits: 1 });
  const loud = scenariosFor({ entity: "X", tags: [], family: "physical", tone: "neutral", hits: 40 });
  assert.deepEqual(
    quiet.map((s) => s.probability),
    loud.map((s) => s.probability),
    "forty articles about a thing does not make the thing more likely",
  );
});

test("the prior DOES move with the horizon", async () => {
  const { scenariosFor } = await import("../engine/hypothesize.ts");
  const day = scenariosFor({ entity: "X", tags: [], family: "physical", tone: "neutral", hits: 3, horizonHours: 24 });
  const month = scenariosFor({ entity: "X", tags: [], family: "physical", tone: "neutral", hits: 3, horizonHours: 24 * 30 });
  assert.ok(
    month[0]!.probability > day[0]!.probability,
    "escalation incidence accumulates with time and the book must reflect it",
  );
});

test("every row states where its prior came from", async () => {
  const { scenariosFor } = await import("../engine/hypothesize.ts");
  const rows = scenariosFor({ entity: "X", tags: [], family: "physical", tone: "neutral", hits: 3 });
  for (const r of rows) {
    assert.ok(r.prior, `${r.id} has no prior provenance`);
    assert.ok(
      ["reference_class", "residual", "insufficient", "empirical_ledger"].includes(r.prior!.source),
      `${r.id} has an unknown prior source`,
    );
    assert.ok(r.prior!.basis.length > 40);
  }
});

test("a book's headline probability IS its materialization mass — never a separate number", async () => {
  const { composeEvent } = await import("../engine/compose.ts");
  const { probabilityFromScenarios } = await import("./probability.ts");
  const mk = (n: number, tone: "up" | "down" | "neutral") =>
    Array.from({ length: n }, (_, i) => ({
      id: `h${i}`,
      title:
        tone === "up"
          ? `Strike escalates as sanctions widen on refinery ${i}`
          : tone === "down" ? `Talks ease as output resumes at plant ${i}`
          : `Officials review shipping schedules at terminal ${i}`,
      source: "Wire",
      url: "",
      published: Date.now(),
      eventTimeMs: Date.now(),
      availableTimeMs: Date.now(),
      eventIds: [],
      tone,
    }));

  for (const n of [1, 3, 8, 20]) {
    for (const tone of ["up", "down", "neutral"] as const) {
      const ev = composeEvent({ id: `e-${n}-${tone}`, title: "Refinery outage", headlines: mk(n, tone) });
      assert.equal(
        ev.probability,
        probabilityFromScenarios(ev.scenarios),
        `n=${n} tone=${tone}: headline probability must equal the top scenario's mass`,
      );
      assert.equal(ev.scenarios.reduce((a, s) => a + s.probability, 0), 100, "mix must still close");
      assert.ok(ev.probability >= 0 && ev.probability <= 100);
    }
  }
});

test("probability no longer climbs just because a story is covered more", async () => {
  const { composeEvent } = await import("../engine/compose.ts");
  const neutral = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `h${i}`,
      title: `Officials review shipping schedules at terminal ${i}`,
      source: "Wire",
      url: "",
      published: Date.now(),
      eventTimeMs: Date.now(),
      availableTimeMs: Date.now(),
      eventIds: [],
      tone: "neutral" as const,
    }));
  const thin = composeEvent({ id: "thin", title: "Port congestion", headlines: neutral(2) });
  const heavy = composeEvent({ id: "heavy", title: "Port congestion", headlines: neutral(20) });
  // The old formula was 16 + hits*4, so 2 -> 24% and 20 -> 82% on identical,
  // directionally neutral coverage. Volume alone must not do that any more.
  assert.ok(
    Math.abs(heavy.probability - thin.probability) < 25,
    `coverage volume alone moved probability ${thin.probability}% -> ${heavy.probability}%`,
  );
});

test("roundTo100 returns zeros for zero mass instead of inventing points", () => {
  // It used to fall through `total || 1` and hand a point to each row: four
  // zero-weight scenarios came back 1/1/1/1 and summed to 4. The posterior
  // update calls this too, so a kernel that invents mass from nothing is not
  // a display bug.
  assert.deepEqual(roundTo100([0, 0, 0, 0]), [0, 0, 0, 0]);
  assert.deepEqual(roundTo100([0, 0]), [0, 0]);
  assert.deepEqual(roundTo100([]), []);
  assert.deepEqual(roundTo100([0, -0]), [0, 0]);
});

test("roundTo100 still closes a real distribution to exactly 100", () => {
  for (const w of [[31.7, 44.6, 23.7], [1, 1, 1], [99, 0.5, 0.5], [5, 5, 5, 5, 5]]) {
    const out = roundTo100(w);
    assert.equal(out.reduce((a, b) => a + b, 0), 100, `${w} did not close`);
    assert.ok(out.every((n) => n >= 0));
  }
});
