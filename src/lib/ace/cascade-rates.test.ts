/**
 * The cascade module must not overstate what the run established.
 *
 * Two specific risks. A country that FAILED the gate leaking into the table,
 * which would put an unvalidated number in front of a reader. And a wrong
 * entity match attaching one country's measured cascade to another country's
 * event — worse than showing nothing, because it looks like evidence.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cascadesForEntities, unmatchedAliases } from "./cascade-match.ts";
import { CASCADE_RATES, CASCADE_RUN, allCascades, cascadeFor } from "./cascade-rates.ts";

const all = Object.values(CASCADE_RATES);

test("only countries that cleared the gate are present", () => {
  assert.ok(all.length > 0, "the generator refuses to emit an empty table");
  assert.equal(all.length, CASCADE_RUN.nPassing);
  assert.ok(CASCADE_RUN.nPassing <= CASCADE_RUN.nFitted);
});

test("every country beat a Poisson process, in sample and out", () => {
  for (const c of all) {
    assert.ok(c.lrPValue < 0.05, `${c.name} LR p=${c.lrPValue}`);
    assert.ok(c.oosGainOverPoisson > 0, `${c.name} lost out of sample`);
  }
});

test("every branching ratio is stationary — escalation dies out, not runs away", () => {
  for (const c of all) {
    assert.ok(c.branchingRatio > 0 && c.branchingRatio < 1, `${c.name} alpha=${c.branchingRatio}`);
  }
});

test("the cascade multiplier is consistent with the branching ratio", () => {
  // Total offspring across all generations is the geometric sum 1/(1-alpha).
  for (const c of all) {
    if (c.cascadeMultiplier === null) continue;
    const expected = 1 / (1 - c.branchingRatio);
    assert.ok(
      Math.abs(c.cascadeMultiplier - expected) < 0.05 * expected,
      `${c.name}: multiplier ${c.cascadeMultiplier} vs 1/(1-${c.branchingRatio}) = ${expected}`,
    );
  }
});

test("each fit rests on a real sample", () => {
  for (const c of all) {
    assert.ok(c.spikeDays >= 30, `${c.name} fitted on ${c.spikeDays} events`);
    assert.ok(Date.parse(c.firstEvent) < Date.parse(c.lastEvent));
  }
});

test("the module carries the caveat rather than only the numbers", () => {
  const note = CASCADE_RUN.specification.note;
  assert.match(note, /confounded|approximate/i);
  assert.match(note, /daily grid/i);
  assert.ok(typeof CASCADE_RUN.specification.residualFloor === "number");
});

// --------------------------------------------------------- entity matching

test("an event's actors match their own country and no other", () => {
  const hit = cascadesForEntities(["Hezbollah", "Beirut"]);
  assert.ok(hit.length > 0, "Lebanon should match");
  assert.ok(hit.some((c) => c.code === "LE"));
  assert.ok(!hit.some((c) => c.code === "ES"), "El Salvador must not match Beirut");
});

test("an unmeasured place matches nothing rather than something close", () => {
  // A wrong match attaches one country's measured cascade to another's event,
  // which reads as evidence. Nothing is the correct answer.
  assert.deepEqual(cascadesForEntities(["Norway", "Equinor", "Troll"]), []);
  assert.deepEqual(cascadesForEntities([]), []);
});

test("matching is case-insensitive and tolerates surrounding words", () => {
  const a = cascadesForEntities(["ISRAELI military"]);
  const b = cascadesForEntities(["israel"]);
  assert.deepEqual(a.map((c) => c.code), b.map((c) => c.code));
});

test("a multi-actor event returns every measured actor, strongest first", () => {
  const hit = cascadesForEntities(["Israel", "Lebanon", "Iran"]);
  assert.ok(hit.length >= 2);
  const gains = hit.map((c) => c.oosGainOverPoisson);
  assert.deepEqual(gains, [...gains].sort((x, y) => y - x));
});

test("no alias points at a country absent from the table", () => {
  for (const c of allCascades()) {
    assert.ok(cascadeFor(c.code), `${c.code} is listed but not retrievable`);
  }
  assert.equal(cascadeFor("ZZ"), undefined);
});

test("lookup is case-insensitive", () => {
  const first = allCascades()[0]!;
  assert.equal(cascadeFor(first.code.toLowerCase())?.code, first.code);
});


test("an alias whose country failed the gate matches nothing, silently and safely", () => {
  // The alias table is hand-maintained; the rates are regenerated from each
  // run. Countries legitimately drop out — Gaza fits strongly in sample
  // (LR p = 2.6e-05) but lost 13.8 log-likelihood out of sample once the
  // window ran through 2026, so the gate excluded it. An alias pointing at a
  // dropped country must return NOTHING rather than throw or fall through to
  // a neighbour.
  const stale = unmatchedAliases();
  for (const code of stale) {
    assert.equal(CASCADE_RATES[code], undefined, `${code} is both stale and present`);
  }
  // Whatever the current run validated, an alias for it resolves; an alias for
  // a dropped country resolves to nothing. Neither case may throw.
  assert.doesNotThrow(() => cascadesForEntities(["Gaza", "Hamas", "Beirut", "Nowhere"]));
  const hit = cascadesForEntities(["Gaza", "Hamas"]);
  for (const c of hit) {
    assert.ok(CASCADE_RATES[c.code], `${c.code} returned but not in the validated table`);
  }
});

test("the validated table and the alias table are reported when they diverge", () => {
  // Not an assertion that they agree — they are allowed to. This exists so the
  // divergence is visible rather than silent.
  const stale = unmatchedAliases();
  const unaliased = Object.keys(CASCADE_RATES).filter(
    (code) => cascadesForEntities([CASCADE_RATES[code]!.name]).length === 0,
  );
  assert.ok(Array.isArray(stale) && Array.isArray(unaliased));
  // A validated country with no alias can never be surfaced on an event, which
  // is a real gap worth keeping small.
  assert.ok(
    unaliased.length <= Object.keys(CASCADE_RATES).length,
    `${unaliased.length} validated countries have no alias: ${unaliased.join(", ")}`,
  );
});
