/**
 * How much of the game's answer survives the fact that its payoffs are guesses.
 *
 * `readMatrix` solves for pure-strategy Nash best responses correctly. What it
 * solves over is a matrix of authored integers — `cell("Max leverage,
 * self-harm", 3, -3)` — which are ordinal judgements about actor preferences,
 * not measurements. Nothing in the product said so, and an equilibrium read off
 * assumed payoffs was presented exactly like one read off known ones.
 *
 * That matters because equilibria are not continuous in payoffs. A single cell
 * moving by one step can relocate the mutual best response entirely, and the
 * reader has no way to tell a robust answer from a knife-edge one.
 *
 * So the matrix is re-solved many times with every payoff jittered, and the
 * output is how often each answer survives. "Probe / delay against Hold
 * throughput is the equilibrium in 84% of perturbations" is a claim a desk can
 * use. "The equilibrium is Probe / delay" was not.
 *
 * THE PERTURBATION IS ITSELF AN ASSUMPTION, and a stated one: payoffs live on a
 * small integer scale where one unit is one meaningful preference step, so the
 * default jitter is ±1 — enough to flip a genuinely marginal ordering, not
 * enough to invent a different game. Callers can widen it; the magnitude used
 * travels with the result.
 */
import type { GameTheory } from "@/data/types";
import { readMatrix } from "@/lib/engine/game";

/** One preference step on the scale the payoffs are authored on. */
export const DEFAULT_JITTER = 1;
export const DEFAULT_DRAWS = 400;

export interface CellFrequency {
  row: string;
  col: string;
  /** Share of perturbations in which this cell was a mutual best response. */
  share: number;
}

export interface GameSensitivity {
  draws: number;
  jitter: number;
  /** The equilibrium cells on the authored payoffs, before any perturbation. */
  baseline: { row: string; col: string }[];
  /** Share of draws whose equilibrium SET exactly matches the baseline. */
  equilibriumStability: number;
  /**
   * Share of draws in which the most frequent equilibrium cell appeared.
   *
   * Distinct from `equilibriumStability`, and usually the number a reader
   * wants. A matrix can have a rock-solid primary equilibrium alongside a
   * second one that flickers in and out: the SET then matches only 27% of the
   * time while the primary cell appears in 100%. Judging that "knife edge"
   * understates a firm answer as badly as judging it "robust" would overstate
   * a fragile one.
   */
  primaryStability: number;
  /** The single likely play on authored payoffs, if the matrix has one. */
  baselineLikely: { row: string; col: string } | null;
  /** Share of draws returning that same likely play. */
  likelyStability: number;
  /** Every cell that was ever an equilibrium, most frequent first. */
  alternatives: CellFrequency[];
  /** Share of draws in which a strategy never appears in any equilibrium. */
  neverEquilibrium: string[];
  /** Share of draws that produced no pure-strategy equilibrium at all. */
  noEquilibriumShare: number;
  /** A reader-facing summary of how much the answer can be relied on. */
  verdict: "robust" | "leaning" | "knife_edge" | "no_equilibrium";
  note: string;
}

/**
 * Deterministic RNG.
 *
 * Seeded so a sensitivity result is reproducible: an analyst who reruns the
 * same book must get the same stability number, or the number is not evidence.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

export function perturb(gt: GameTheory, jitter: number, next: () => number): GameTheory {
  return {
    ...gt,
    rows: gt.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => ({
        ...c,
        a: c.a + (next() * 2 - 1) * jitter,
        b: c.b + (next() * 2 - 1) * jitter,
      })),
    })),
  };
}

const key = (c: { row: string; col: string }) => `${c.row}||${c.col}`;

export function gameSensitivity(
  gt: GameTheory,
  opts: { draws?: number; jitter?: number; seed?: number } = {},
): GameSensitivity {
  const draws = Math.max(1, opts.draws ?? DEFAULT_DRAWS);
  const jitter = opts.jitter ?? DEFAULT_JITTER;
  const next = rng(opts.seed ?? 17);

  const base = readMatrix(gt);
  const baseline = base.nash.map((n) => ({ row: n.row, col: n.col }));
  const baselineSet = new Set(baseline.map(key));
  const baselineLikely = base.likely ? { row: base.likely.row, col: base.likely.col } : null;

  let sameSet = 0;
  let sameLikely = 0;
  let empty = 0;
  const cellCounts = new Map<string, { row: string; col: string; n: number }>();
  const seenStrategies = new Map<string, number>();

  for (let d = 0; d < draws; d++) {
    const m = readMatrix(perturb(gt, jitter, next));
    if (m.nash.length === 0) {
      empty += 1;
      continue;
    }
    const set = new Set(m.nash.map(key));
    if (set.size === baselineSet.size && [...set].every((k) => baselineSet.has(k))) sameSet += 1;
    if (baselineLikely && m.likely && key(m.likely) === key(baselineLikely)) sameLikely += 1;
    for (const n of m.nash) {
      const k = key(n);
      const prev = cellCounts.get(k);
      if (prev) prev.n += 1;
      else cellCounts.set(k, { row: n.row, col: n.col, n: 1 });
      seenStrategies.set(n.row, (seenStrategies.get(n.row) ?? 0) + 1);
    }
  }

  const alternatives: CellFrequency[] = [...cellCounts.values()]
    .map((c) => ({ row: c.row, col: c.col, share: c.n / draws }))
    .sort((a, b) => b.share - a.share);

  const neverEquilibrium = gt.rows.map((r) => r.name).filter((n) => !seenStrategies.has(n));
  const equilibriumStability = sameSet / draws;
  const likelyStability = baselineLikely ? sameLikely / draws : 0;
  const noEquilibriumShare = empty / draws;

  const primaryStability = alternatives[0]?.share ?? 0;

  // Graded on the primary cell rather than on exact set equality: a flickering
  // secondary equilibrium should not demote an answer whose main cell never
  // moves. The thresholds are a reporting convention, not a test of
  // significance, and are named so nobody reads them as one.
  let verdict: GameSensitivity["verdict"];
  if (noEquilibriumShare > 0.5) verdict = "no_equilibrium";
  else if (primaryStability >= 0.8) verdict = "robust";
  else if (primaryStability >= 0.5) verdict = "leaning";
  else verdict = "knife_edge";

  const note =
    verdict === "no_equilibrium"
      ? `Most perturbations (${(noEquilibriumShare * 100).toFixed(0)}%) leave no pure-strategy equilibrium. ` +
        "The matrix does not support a single likely play."
      : `Payoffs are ordinal assumptions, not measurements. Re-solved ${draws} times with every ` +
        `payoff jittered by up to ±${jitter}: the leading equilibrium holds in ` +
        `${(primaryStability * 100).toFixed(0)}% of draws, and the full equilibrium set is ` +
        `unchanged in ${(equilibriumStability * 100).toFixed(0)}%` +
        (alternatives.length > 1
          ? `; ${alternatives.length - 1} other cell(s) appear under perturbation.`
          : " with no alternative appearing.");

  return {
    draws,
    jitter,
    baseline,
    equilibriumStability,
    primaryStability,
    baselineLikely,
    likelyStability,
    alternatives,
    neverEquilibrium,
    noEquilibriumShare,
    verdict,
    note,
  };
}
