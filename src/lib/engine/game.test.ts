/**
 * The pure-strategy Nash solve, checked against its definition (PR #5 A01).
 *
 * The actor picks the ROW, the counterpart the COLUMN. A cell is a pure Nash
 * equilibrium when neither side gains by deviating alone: no other ROW pays
 * the actor more in that column, and no other COLUMN pays the counterpart more
 * in that row. Every test here compares `readMatrix` with that inequality
 * enumerated directly, so the solver cannot pass by agreeing with itself.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameTheory } from "../../data/types.ts";
import type { EventFamily } from "./extract.ts";
import { readMatrix } from "./game.ts";
import { gameTheoryFor } from "./hypothesize.ts";

function game(cells: number[][][], rows: string[], cols: string[]): GameTheory {
  return {
    actor: "A",
    counterpart: "B",
    columns: cols,
    rows: rows.map((name, i) => ({
      name,
      cells: cols.map((c, j) => ({ label: `${name}/${c}`, a: cells[i]![j]![0]!, b: cells[i]![j]![1]! })),
    })),
    insight: "",
    players: [],
  };
}

/** Every cell from which no unilateral deviation pays — the definition. */
function bruteNash(gt: GameTheory): string[] {
  const out: string[] = [];
  gt.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      const actorCannotGain = gt.rows.every((other) => (other.cells[c]?.a ?? -Infinity) <= cell.a);
      const counterpartCannotGain = row.cells.every((other) => other.b <= cell.b);
      if (actorCannotGain && counterpartCannotGain) out.push(`${row.name}|${gt.columns[c]}`);
      void r;
    });
  });
  return out.sort();
}

const solved = (gt: GameTheory) => readMatrix(gt).nash.map((n) => `${n.row}|${n.col}`).sort();

test("the audit's prisoner's dilemma solves to mutual defection, not cooperation", () => {
  const pd = game([[[3, 3], [0, 5]], [[5, 0], [1, 1]]], ["C", "D"], ["C", "D"]);
  assert.deepEqual(solved(pd), ["D|D"]);
  // (C,C) is not an equilibrium: either side defects from it and gains.
  assert.ok(!solved(pd).includes("C|C"));
});

test("best responses hold the OTHER side's move fixed", () => {
  const pd = game([[[3, 3], [0, 5]], [[5, 0], [1, 1]]], ["C", "D"], ["C", "D"]);
  const m = readMatrix(pd);
  // The actor's best row against each column is D (5 > 3, 1 > 0).
  assert.deepEqual(m.actorBest.map((x) => `${x.row}|${x.col}`).sort(), ["D|C", "D|D"]);
  // The counterpart's best column against each row is D (5 > 3, 1 > 0).
  assert.deepEqual(m.counterpartBest.map((x) => `${x.row}|${x.col}`).sort(), ["C|D", "D|D"]);
});

test("an asymmetric rectangular game", () => {
  // 2 rows x 3 columns, payoffs chosen so the inverted solve disagrees.
  const g = game(
    [
      [[4, 1], [0, 3], [2, 2]],
      [[1, 0], [3, 1], [5, 4]],
    ],
    ["Up", "Down"],
    ["L", "M", "R"],
  );
  assert.deepEqual(solved(g), bruteNash(g));
  assert.deepEqual(solved(g), ["Down|R"]);
});

test("ties are kept on both sides", () => {
  // The actor is indifferent between the rows in column X; the counterpart is
  // indifferent between the columns in row P. Both of P's cells are
  // equilibria; (Q,X) is not — the counterpart leaves it for Y.
  const g = game([[[2, 1], [2, 1]], [[2, 0], [1, 3]]], ["P", "Q"], ["X", "Y"]);
  assert.deepEqual(solved(g), bruteNash(g));
  assert.deepEqual(solved(g), ["P|X", "P|Y"]);
});

test("a game with no pure equilibrium returns none", () => {
  const pennies = game([[[1, -1], [-1, 1]], [[-1, 1], [1, -1]]], ["H", "T"], ["H", "T"]);
  assert.deepEqual(solved(pennies), []);
  assert.deepEqual(bruteNash(pennies), []);
});

test("random rectangular games agree with direct enumeration", () => {
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let k = 0; k < 500; k++) {
    const nR = 1 + Math.floor(next() * 4);
    const nC = 1 + Math.floor(next() * 4);
    const cells = Array.from({ length: nR }, () =>
      Array.from({ length: nC }, () => [Math.floor(next() * 7) - 3, Math.floor(next() * 7) - 3]),
    );
    const g = game(cells, cells.map((_, i) => `r${i}`), cells[0]!.map((_, j) => `c${j}`));
    assert.deepEqual(solved(g), bruteNash(g), JSON.stringify(cells));
  }
});

const FAMILIES: EventFamily[] = [
  "physical", "policy", "credit", "tech", "fx", "weather", "corporate", "kinetic", "commodity", "other",
];

test("every shipped family matrix: each equilibrium survives unilateral deviation, and none is missed", () => {
  for (const family of FAMILIES) {
    const gt = gameTheoryFor({ family, players: [] });
    const m = readMatrix(gt);
    for (const n of m.nash) {
      const r = gt.rows.findIndex((x) => x.name === n.row);
      const c = gt.columns.indexOf(n.col);
      for (const other of gt.rows) {
        assert.ok(other.cells[c]!.a <= n.a, `${family}: actor gains by leaving ${n.row}/${n.col} for ${other.name}`);
      }
      for (const other of gt.rows[r]!.cells) {
        assert.ok(other.b <= n.b, `${family}: counterpart gains by leaving ${n.row}/${n.col} for ${other.label}`);
      }
    }
    assert.deepEqual(solved(gt), bruteNash(gt), family);
  }
});
