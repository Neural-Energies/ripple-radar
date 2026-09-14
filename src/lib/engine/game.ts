import type { GameTheory } from "@/data/types";

export interface MatrixRead {
  /** How to read the table. Generic — not event-specific. */
  primer: string[];
  actorBest: { row: string; col: string; a: number; b: number }[];
  counterpartBest: { row: string; col: string; a: number; b: number }[];
  /** Mutual best-response cells (pure-strategy Nash if the set is small). */
  nash: { row: string; col: string; a: number; b: number; label: string }[];
  likely: { row: string; col: string; a: number; b: number; label: string } | null;
}

export function readMatrix(gt: GameTheory): MatrixRead {
  const primer = [
    `Rows are ${gt.actor}'s available moves. Columns are ${gt.counterpart}'s.`,
    `Each cell is (payoff to ${gt.actor}, payoff to ${gt.counterpart}) — relative scores, not dollars.`,
    `${gt.actor} wants the cell with the highest first number given what ${gt.counterpart} is likely to do.`,
    `${gt.counterpart} wants the cell with the highest second number given ${gt.actor}'s move.`,
    "A mutual best-response cell is the likely play. That cell — not the headline — rewrites the causal graph.",
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
