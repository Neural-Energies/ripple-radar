/**
 * The prior engine's job is to never invent a number.
 *
 * Every probability the product displayed used to trace back to
 * `clamp(16 + esc*6 + hits*2 - de*4, 8, 42)` — authored constants over a count
 * of headlines. These tests pin the replacement: the numbers come from a
 * validated competing-risks fit, they move with the horizon, the part the model
 * does not measure is labelled, and "insufficient" is a real answer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_RATE_PROVENANCE, SHOCK_BASE_RATES, baseRateAt } from "./base-rates.ts";
import { MIN_MODELLED_DAYS, priorFor, type PriorRole } from "./prior.ts";

const FOUR: PriorRole[] = ["material", "partial", "noise", "fade"];
const THREE: PriorRole[] = ["material", "partial", "fade"];

// ------------------------------------------------------------- base rates

test("the base-rate curves came from a model that beat its baseline", () => {
  assert.ok(BASE_RATE_PROVENANCE.nSubjects > 1000);
  assert.ok(
    BASE_RATE_PROVENANCE.worstHoldoutError < BASE_RATE_PROVENANCE.naiveBaselineWorstError,
    "a prior sourced from a model that loses to its baseline is not an improvement",
  );
  assert.ok(BASE_RATE_PROVENANCE.worstHoldoutError < 0.1);
});

test("cumulative incidence is monotone and never leaves the simplex", () => {
  let prevEsc = -1;
  let prevCont = -1;
  for (const row of SHOCK_BASE_RATES) {
    assert.ok(row.escalation >= prevEsc - 1e-9, `escalation fell at ${row.days}d`);
    assert.ok(row.continuation >= prevCont - 1e-9, `continuation fell at ${row.days}d`);
    const total = row.escalation + row.continuation + row.neither;
    assert.ok(Math.abs(total - 1) < 1e-6, `mass ${total} at ${row.days}d`);
    assert.ok(row.neither >= 0, `negative residual at ${row.days}d`);
    prevEsc = row.escalation;
    prevCont = row.continuation;
  }
});

test("reading between grid points interpolates rather than jumping", () => {
  const a = baseRateAt(7);
  const b = baseRateAt(14);
  const mid = baseRateAt(10.5);
  assert.ok(mid.escalation > a.escalation && mid.escalation < b.escalation);
});

test("reading outside the grid clamps instead of extrapolating a survival curve", () => {
  const first = SHOCK_BASE_RATES[0]!;
  const last = SHOCK_BASE_RATES[SHOCK_BASE_RATES.length - 1]!;
  assert.deepEqual(baseRateAt(-5), first);
  assert.deepEqual(baseRateAt(10_000), last);
});

// ----------------------------------------------------------------- priors

test("a book's mass closes to exactly 100", () => {
  for (const roles of [FOUR, THREE]) {
    for (const hours of [12, 24, 72, 168, 720]) {
      const book = priorFor({ horizonHours: hours, roles });
      const sum = book.components.reduce((a, c) => a + c.probability, 0);
      assert.equal(sum, 100, `${roles.length} roles at ${hours}h summed to ${sum}`);
    }
  }
});

test("the prior moves with the horizon — a 1-day book is not a 30-day book", () => {
  const short = priorFor({ horizonHours: 24, roles: FOUR });
  const long = priorFor({ horizonHours: 24 * 30, roles: FOUR });
  const mat = (b: typeof short) => b.components.find((c) => c.role === "material")!.probability;
  const par = (b: typeof short) => b.components.find((c) => c.role === "partial")!.probability;
  assert.ok(mat(long) > mat(short), "escalation incidence accumulates with time");
  assert.ok(par(long) > par(short));
});

test("modelled roles cite the model; unmodelled ones say they are residual", () => {
  const book = priorFor({ horizonHours: 168, roles: FOUR });
  const byRole = new Map(book.components.map((c) => [c.role, c]));
  assert.equal(byRole.get("material")!.source, "reference_class");
  assert.equal(byRole.get("partial")!.source, "reference_class");
  assert.equal(byRole.get("noise")!.source, "residual");
  assert.equal(byRole.get("fade")!.source, "residual");
});

test("every component explains where its number came from", () => {
  const book = priorFor({ horizonHours: 168, roles: FOUR });
  for (const c of book.components) {
    assert.ok(c.basis.length > 60, `${c.role} has no real basis string`);
  }
  const modelled = book.components.find((c) => c.source === "reference_class")!;
  assert.match(modelled.basis, /Aalen-Johansen/);
  assert.match(modelled.basis, /holdout/i);
});

test("the reference-class transfer is stated, never buried", () => {
  const book = priorFor({ horizonHours: 168, roles: FOUR });
  const modelled = book.components.find((c) => c.source === "reference_class")!;
  assert.match(
    modelled.basis,
    /market shocks/i,
    "applying a market-shock base rate to a news book is a transfer and must say so",
  );
});

test("the residual split is flagged as unmeasured", () => {
  const book = priorFor({ horizonHours: 168, roles: FOUR });
  const residual = book.components.filter((c) => c.source === "residual");
  assert.equal(residual.length, 2);
  for (const c of residual) {
    assert.match(c.basis, /not a measurement|does not distinguish/i);
  }
  assert.ok(book.notes.some((n) => /split the model does not measure/i.test(n)));
});

test("weakestSource reports the book's real standing, not its best part", () => {
  const book = priorFor({ horizonHours: 168, roles: FOUR });
  assert.equal(book.weakestSource, "residual", "two rows rest on an unmeasured split");
  assert.equal(book.modelBacked, true, "but the modelled rows are still model-backed");
});

// ---------------------------------------------------------- insufficient

test("below the modelled floor the engine refuses rather than extrapolating", () => {
  const book = priorFor({ horizonHours: MIN_MODELLED_DAYS * 24 - 1, roles: THREE });
  assert.equal(book.weakestSource, "insufficient");
  assert.equal(book.modelBacked, false);
  assert.ok(book.components.every((c) => c.source === "insufficient"));
  assert.ok(book.notes.some((n) => /insufficient/i.test(n)));
});

test("a non-finite horizon is insufficient, not a crash", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY * 0, -5]) {
    const book = priorFor({ horizonHours: bad, roles: THREE });
    assert.equal(book.weakestSource, "insufficient", `horizon ${bad}`);
  }
});

test("an insufficient book offers no probabilities to display", () => {
  const book = priorFor({ horizonHours: 1, roles: THREE });
  assert.ok(book.components.every((c) => c.probability === 0));
  assert.match(book.components[0]!.basis, /extrapolation/i);
});

// ------------------------------------------------- the behavioural change

test("the model prior is far less confident about materialization than the old formula", () => {
  // The authored formula produced material in the 16-42 band regardless of
  // horizon. The measured escalation incidence is a single digit inside a week.
  const week = priorFor({ horizonHours: 168, roles: FOUR });
  const material = week.components.find((c) => c.role === "material")!.probability;
  assert.ok(
    material < 16,
    `measured materialization at 7d is ${material}%, and the old formula's floor was 16%`,
  );
});

test("a three-row book renormalizes rather than losing the missing role's mass", () => {
  const book = priorFor({ horizonHours: 168, roles: THREE });
  assert.equal(book.components.reduce((a, c) => a + c.probability, 0), 100);
  assert.equal(book.components.length, 3);
  assert.ok(book.components.every((c) => c.role !== "noise"));
});

test("components come back in the order the book asked for", () => {
  const book = priorFor({ horizonHours: 168, roles: FOUR });
  assert.deepEqual(book.components.map((c) => c.role), FOUR);
});
