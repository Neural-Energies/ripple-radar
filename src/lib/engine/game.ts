import type { GameTheory } from "@/data/types";
import { roundTo100 } from "@/lib/ace/probability";

export interface MatrixRead {
  /** How to read the table. Generic — not event-specific. */
  primer: string[];
  actorBest: { row: string; col: string; a: number; b: number }[];
  counterpartBest: { row: string; col: string; a: number; b: number }[];
  /** Mutual best-response cells (pure-strategy Nash if the set is small). */
  nash: { row: string; col: string; a: number; b: number; label: string }[];
  likely: { row: string; col: string; a: number; b: number; label: string } | null;
}

/** Joint and marginal chances of each move. Integers, each set sums to 100. */
export interface PlayMix {
  cells: Map<string, number>;
  rows: Map<string, number>;
  cols: Map<string, number>;
  /** Single most likely cell. Null when the matrix is empty. */
  mode: { row: string; col: string; probability: number; label: string } | null;
}

export function cellKey(row: string, col: string) {
  return `${row}\0${col}`;
}

/**
 * Quantal response: each side leans toward the moves that pay them, given what
 * the other side is likely to do. Cell percent is the joint chance that pair
 * is played. Temperature is wide on purpose — the underlying scores are
 * ordinal, so a sharp distribution would pretend to a precision they don't have.
 */
const RESPONSE_TEMPERATURE = 1.7;

function softmax(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return [];
  const peak = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - peak) / temperature));
  const z = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => w / z);
}

export function playMix(gt: GameTheory): PlayMix {
  const empty: PlayMix = { cells: new Map(), rows: new Map(), cols: new Map(), mode: null };
  const nR = gt.rows.length;
  const nC = gt.columns.length;
  if (!nR || !nC) return empty;

  let pCol = Array.from({ length: nC }, () => 1 / nC);
  let pRow = Array.from({ length: nR }, () => 1 / nR);
  for (let iter = 0; iter < 24; iter++) {
    const rowPay = gt.rows.map((row) =>
      row.cells.reduce((sum, cell, j) => sum + (pCol[j] ?? 0) * cell.a, 0),
    );
    pRow = softmax(rowPay, RESPONSE_TEMPERATURE);
    const colPay = gt.columns.map((_, j) =>
      gt.rows.reduce((sum, row, i) => sum + (pRow[i] ?? 0) * (row.cells[j]?.b ?? 0), 0),
    );
    pCol = softmax(colPay, RESPONSE_TEMPERATURE);
  }

  const keys: string[] = [];
  const weights: number[] = [];
  gt.rows.forEach((row, i) => {
    gt.columns.forEach((col, j) => {
      keys.push(cellKey(row.name, col));
      weights.push((pRow[i] ?? 0) * (pCol[j] ?? 0));
    });
  });
  const rounded = roundTo100(weights);
  const cells = new Map<string, number>();
  rounded.forEach((p, i) => cells.set(keys[i]!, p));

  const rows = new Map<string, number>();
  for (const row of gt.rows) {
    rows.set(
      row.name,
      gt.columns.reduce((sum, col) => sum + (cells.get(cellKey(row.name, col)) ?? 0), 0),
    );
  }
  const cols = new Map<string, number>();
  for (const col of gt.columns) {
    cols.set(
      col,
      gt.rows.reduce((sum, row) => sum + (cells.get(cellKey(row.name, col)) ?? 0), 0),
    );
  }

  let mode: PlayMix["mode"] = null;
  gt.rows.forEach((row) => {
    row.cells.forEach((cell, j) => {
      const col = gt.columns[j] ?? "";
      const probability = cells.get(cellKey(row.name, col)) ?? 0;
      if (!mode || probability > mode.probability) {
        mode = { row: row.name, col, probability, label: cell.label };
      }
    });
  });

  return { cells, rows, cols, mode };
}

export function readMatrix(gt: GameTheory): MatrixRead {
  const primer = [
    `${gt.actor} and ${gt.counterpart} are scored separately. Do not combine their moves into a pair.`,
    `Each side has its own list of moves. Each move has one chance, and that list sums to 100.`,
    "Outcomes are listed on their own, each with one chance. Nothing is read as a pair.",
    "The highlighted outcome is simply the single most likely one.",
  ];

  const actorBest: MatrixRead["actorBest"] = [];
  const counterpartBest: MatrixRead["counterpartBest"] = [];
  const nash: MatrixRead["nash"] = [];

  for (const row of gt.rows) {
    let best = -Infinity;
    const cols: number[] = [];
    row.cells.forEach((c, i) => {
      if (c.a > best) {
        best = c.a;
        cols.length = 0;
        cols.push(i);
      } else if (c.a === best) cols.push(i);
    });
    for (const i of cols) {
      const col = gt.columns[i] ?? "";
      const cell = row.cells[i]!;
      actorBest.push({ row: row.name, col, a: cell.a, b: cell.b });
    }
  }

  gt.columns.forEach((col, i) => {
    let best = -Infinity;
    const rows: number[] = [];
    gt.rows.forEach((row, r) => {
      const b = row.cells[i]?.b ?? -Infinity;
      if (b > best) {
        best = b;
        rows.length = 0;
        rows.push(r);
      } else if (b === best) rows.push(r);
    });
    for (const r of rows) {
      const row = gt.rows[r]!;
      const cell = row.cells[i]!;
      counterpartBest.push({ row: row.name, col, a: cell.a, b: cell.b });
    }
  });

  for (const a of actorBest) {
    if (counterpartBest.some((c) => c.row === a.row && c.col === a.col)) {
      const row = gt.rows.find((r) => r.name === a.row);
      const i = gt.columns.indexOf(a.col);
      const label = row?.cells[i]?.label ?? "";
      if (!nash.some((n) => n.row === a.row && n.col === a.col)) {
        nash.push({ ...a, label });
      }
    }
  }

  const likely =
    nash.slice().sort((x, y) => y.a + y.b - (x.a + x.b))[0] ??
    actorBest
      .map((a) => {
        const row = gt.rows.find((r) => r.name === a.row);
        const i = gt.columns.indexOf(a.col);
        return { ...a, label: row?.cells[i]?.label ?? "" };
      })
      .sort((x, y) => y.a - x.a)[0] ??
    null;

  return { primer, actorBest, counterpartBest, nash, likely };
}

export function isNash(read: MatrixRead, row: string, col: string) {
  return read.nash.some((n) => n.row === row && n.col === col);
}