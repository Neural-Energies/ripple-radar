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
import {
  CASCADE_RATES,
  CASCADE_RUN,
  allCascades,
  cascadeFor,
  cascadesForEntities,
} from "./cascade-rates.ts";

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
