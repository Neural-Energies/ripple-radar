/**
 * An equilibrium read off assumed payoffs must not be presented like one read
 * off known payoffs.
 *
 * The solver is correct. Its inputs are ordinal judgements — `cell("Max
 * leverage, self-harm", 3, -3)` — and equilibria are not continuous in
 * payoffs, so a single cell moving one step can relocate the answer. These
 * tests pin that the measurement of that fragility is itself trustworthy:
 * deterministic, correctly ordered, and honest when there is no answer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameTheory } from "../../data/types.ts";
import { DEFAULT_JITTER, gameSensitivity, perturb } from "./game-sensitivity.ts";

function game(cells: number[][][], rows = ["R1", "R2"], cols = ["C1", "C2"]): GameTheory {
  return {
    actor: "A",
    counterpart: "B",
    columns: cols,
    rows: rows.map((name, i) => ({
      name,
      cells: cols.map((_, j) => ({ label: `${name}/${cols[j]}`, a: cells[i]![j]![0]!, b: cells[i]![j]![1]! })),
    })),
    insight: "",
    players: [],
  };
}

/**
 * A STRICTLY dominant-strategy game: R1 beats R2 for A against either column,
 * C1 beats C2 for B against either row, and every margin is 15 — far outside
 * a ±1 jitter. The unique equilibrium here must not move.
 *
 * (The first version of this fixture had a tie in the bottom-right, which made
 * (R2,C2) a second equilibrium that flickered under perturbation. That was a
 * bad fixture and a good finding: it is what showed that grading the verdict on
 * exact SET equality understates a firm primary answer.)
 */
const STRONG = game([
  [[10, 10], [5, -5]],
  [[-5, 5], [-10, -10]],
]);

/** A tie everywhere: every perturbation reshuffles it. */
const FLAT = game([
  [[0, 0], [0, 0]],
  [[0, 0], [0, 0]],
]);

test("the result is deterministic for a given seed", () => {
  const a = gameSensitivity(STRONG, { seed: 42, draws: 200 });
  const b = gameSensitivity(STRONG, { seed: 42, draws: 200 });
  assert.equal(a.equilibriumStability, b.equilibriumStability);
  assert.deepEqual(a.alternatives, b.alternatives);
});

test("a different seed draws a different sample, or the jitter is not random", () => {
  // Compared on the share vector, not on the coarse summary metrics: an
  // all-ties game gives stability 0 and four alternatives under every seed, so
  // those two agreeing proves nothing about whether the draws differed.
  const a = gameSensitivity(FLAT, { seed: 1, draws: 200 });
  const b = gameSensitivity(FLAT, { seed: 99999, draws: 200 });
  const shares = (s: typeof a) =>
    [...s.alternatives].sort((x, y) => (x.row + x.col).localeCompare(y.row + y.col)).map((c) => c.share);
  assert.notDeepEqual(shares(a), shares(b), "two seeds produced an identical sample");
});

test("a strictly dominant equilibrium survives perturbation", () => {
  const s = gameSensitivity(STRONG, { seed: 7, draws: 400 });
  assert.equal(s.equilibriumStability, 1, `expected an unmoved set, got ${s.equilibriumStability}`);
  assert.equal(s.primaryStability, 1);
  assert.equal(s.verdict, "robust");
  assert.equal(s.noEquilibriumShare, 0);
});

test("a firm primary answer is not demoted by a flickering secondary one", () => {
  // The tie in the bottom-right makes (R2,C2) a second equilibrium that comes
  // and goes, so the SET rarely matches — but (R1,C1) never moves. Grading on
  // set equality alone would call this knife-edge, which is false.
  const twoEq = game([
    [[10, 10], [-20, -20]],
    [[-20, -20], [-20, -20]],
  ]);
  const s = gameSensitivity(twoEq, { seed: 7, draws: 400 });
  assert.equal(s.primaryStability, 1, "the leading cell is present in every draw");
  assert.ok(s.equilibriumStability < 0.5, "while the full set is genuinely unstable");
  assert.equal(s.verdict, "robust");
});

test("a game decided by ties is reported as fragile, not as an answer", () => {
  const s = gameSensitivity(FLAT, { seed: 7, draws: 400 });
  assert.ok(s.equilibriumStability < 0.8, `a tie-decided game should not read robust: ${s.equilibriumStability}`);
  assert.notEqual(s.verdict, "robust");
});

test("stability rises as the jitter shrinks toward zero", () => {
  // 20 is wide enough to reorder a game whose margins are 15.
  const wide = gameSensitivity(STRONG, { seed: 3, draws: 300, jitter: 20 });
  const tight = gameSensitivity(STRONG, { seed: 3, draws: 300, jitter: 0.01 });
  assert.ok(tight.equilibriumStability >= wide.equilibriumStability);
  assert.equal(tight.equilibriumStability, 1, "a vanishing jitter cannot move the answer");
});

test("zero jitter reproduces the baseline exactly", () => {
  const s = gameSensitivity(STRONG, { seed: 3, draws: 50, jitter: 0 });
  assert.equal(s.equilibriumStability, 1);
  assert.equal(s.alternatives.length, s.baseline.length);
  assert.ok(s.alternatives.every((a) => a.share === 1));
});

test("perturb moves payoffs within the stated bound and nothing else", () => {
  let i = 0;
  const seq = () => [0, 1, 0.5][i++ % 3]!;
  const out = perturb(STRONG, DEFAULT_JITTER, seq);
  assert.equal(out.rows.length, STRONG.rows.length);
  assert.equal(out.columns.join(), STRONG.columns.join());
  for (let r = 0; r < out.rows.length; r++) {
    for (let c = 0; c < out.rows[r]!.cells.length; c++) {
      const before = STRONG.rows[r]!.cells[c]!;
      const after = out.rows[r]!.cells[c]!;
      assert.equal(after.label, before.label, "labels must not move");
      assert.ok(Math.abs(after.a - before.a) <= DEFAULT_JITTER + 1e-9);
      assert.ok(Math.abs(after.b - before.b) <= DEFAULT_JITTER + 1e-9);
    }
  }
});

test("shares are proportions and alternatives are ordered", () => {
  const s = gameSensitivity(FLAT, { seed: 11, draws: 300 });
  for (const alt of s.alternatives) {
    assert.ok(alt.share >= 0 && alt.share <= 1, `share ${alt.share} out of range`);
  }
  const shares = s.alternatives.map((a) => a.share);
  assert.deepEqual(shares, [...shares].sort((a, b) => b - a), "most frequent must lead");
  assert.ok(s.equilibriumStability >= 0 && s.equilibriumStability <= 1);
  assert.ok(s.noEquilibriumShare >= 0 && s.noEquilibriumShare <= 1);
});

test("the note always states that payoffs are assumptions", () => {
  for (const g of [STRONG, FLAT]) {
    const s = gameSensitivity(g, { seed: 2, draws: 100 });
    assert.ok(
      /assumption|does not support/i.test(s.note),
      `note must not present the payoffs as known: ${s.note}`,
    );
  }
});

test("the baseline is the unperturbed solve, whatever the draws do", () => {
  const s = gameSensitivity(STRONG, { seed: 4, draws: 200 });
  assert.equal(s.baseline.length, 1, "a strictly dominant game has one equilibrium");
  assert.equal(s.baseline[0]!.row, "R1");
  assert.equal(s.baseline[0]!.col, "C1");
  assert.equal(s.baselineLikely!.row, "R1");
});

test("a single draw does not divide by zero or throw", () => {
  const s = gameSensitivity(STRONG, { seed: 1, draws: 1 });
  assert.ok(Number.isFinite(s.equilibriumStability));
  assert.ok(s.equilibriumStability === 0 || s.equilibriumStability === 1);
});

test("a strategy that never reaches equilibrium is reported", () => {
  const s = gameSensitivity(STRONG, { seed: 8, draws: 300 });
  assert.ok(s.neverEquilibrium.includes("R2"), "R2 is dominated and should never appear");
});
