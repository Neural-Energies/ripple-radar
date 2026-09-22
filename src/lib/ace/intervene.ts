/**
 * ACE intervention kernel (§14/§15) — "what if this cell is played?"
 *
 * The payoff matrix has always told the reader that "a mutual best-response
 * cell is the likely play; that cell — not the headline — rewrites the causal
 * graph." Nothing implemented the rewrite, so the cells were decoration. This
 * module is the promised operation: fix a joint play, and report what the book
 * would look like conditional on it.
 *
 * What makes this honest rather than invented:
 *
 *  - It is a CONDITIONAL, never a forecast. `intervene` returns a view; no
 *    caller may write it back onto the event. The book's probabilities are
 *    what the evidence says, not what a hypothetical play implies.
 *  - The severity axis is structural, not parsed from prose. Every family's
 *    matrix in `gameTheoryFor` orders its columns benign → severe (hold
 *    throughput → bargain → ration; depositors stay → slow run → fast run;
 *    spare capacity holds → local outage → regional halt). Column position is
 *    therefore a fact about the generator, the same way scenario order is.
 *  - Rows are deliberately NOT used for severity. Most families order them
 *    escalation-first, but `policy` runs the other way (ease → hold → hike)
 *    and `corporate` is not ordered by severity at all. Reading a row index as
 *    escalation would silently invert two families, so it is left out.
 *  - The conditioning reuses the same Dirichlet axis machinery as the
 *    probability kernel rather than introducing a second, divergent adjuster.
 *
 * Provenance is `heuristic` and stays there. The conditioning strength is a
 * declared assumption, not a measured quantity.
 */
import type { CausalLink, GameTheory, RippleNode, Scenario } from "@/data/types";
import { PRIOR_STRENGTH, axisPosition, roundTo100 } from "./probability";

/** How many pseudo-observations a fully severe play is worth. Declared, not fit. */
export const CONDITIONING_STRENGTH = PRIOR_STRENGTH * 0.75;

/** How much a fully severe play scales transmission through a certain link. */
const NODE_SENSITIVITY = 0.4;

export interface Play {
  row: string;
  col: string;
  label: string;
  a: number;
  b: number;
}

export interface ConditionalScenario {
  id: string;
  name: string;
  base: number;
  conditional: number;
  delta: number;
}

export interface ConditionalNode {
  id: string;
  label: string;
  ticker?: string;
  base: number;
  conditional: number;
  delta: number;
}

export interface InterventionResult {
  play: Play;
  /** −1 fully benign … 0 neutral … +1 fully severe. From column position. */
  severity: number;
  scenarios: ConditionalScenario[];
  /** Nodes whose transmission the play changes most, strongest first. */
  nodes: ConditionalNode[];
  /** Links that carry the play, with the confidence that earns them the weight. */
  links: { source: string; dest: string; confidence: number; invalidation: string }[];
  note: string;
  /** A conditional view, never a calibrated claim. */
  provenance: "heuristic";
}

/** Resolve a (row, col) pair to the cell the matrix actually holds. */
export function playAt(gt: GameTheory, rowName: string, colName: string): Play | null {
  const r = gt.rows.find((x) => x.name === rowName);
  const i = gt.columns.indexOf(colName);
  if (!r || i < 0) return null;
  const cell = r.cells[i];
  if (!cell) return null;
  return { row: rowName, col: colName, label: cell.label, a: cell.a, b: cell.b };
}

/**
 * −1 … +1 from the counterpart's column, which the matrix generator orders
 * benign → severe for every family. A single-column matrix carries no severity
 * information, so it returns 0 rather than guessing.
 */
export function severityOf(gt: GameTheory, colName: string): number {
  const i = gt.columns.indexOf(colName);
  if (i < 0 || gt.columns.length < 2) return 0;
  return (i / (gt.columns.length - 1)) * 2 - 1;
}

/**
 * Condition the book on a joint play.
 *
 * Returns null when the play is not in the matrix — callers render the
 * engine's own read instead of an invented one.
 */
export function intervene(opts: {
  gameTheory: GameTheory;
  scenarios: Scenario[];
  nodes?: RippleNode[];
  links?: CausalLink[];
  play: { row: string; col: string };
}): InterventionResult | null {
  const { gameTheory: gt, scenarios, nodes = [], links = [] } = opts;
  const play = playAt(gt, opts.play.row, opts.play.col);
  if (!play || scenarios.length === 0) return null;

  const severity = severityOf(gt, play.col);
  const mass = CONDITIONING_STRENGTH * Math.abs(severity);

  // Same axis as the probability kernel: index 0 is materialization, last is
  // fade. A severe play pushes mass toward materialization, a benign one
  // toward fade, and a mid column leaves the book where the evidence put it.
  const alpha = scenarios.map((s) => (s.probability / 100) * PRIOR_STRENGTH);
  if (mass > 0) {
    const affinity = scenarios.map((_, i) => {
      const pos = axisPosition(i, scenarios.length);
      return severity > 0 ? 1 - pos : pos;
    });
    const total = affinity.reduce((a, n) => a + n, 0);
    if (total > 0) {
      for (let i = 0; i < alpha.length; i += 1) {
        alpha[i] = alpha[i]! + (affinity[i]! / total) * mass;
      }
    }
  }
  const posterior = roundTo100(alpha);

  const conditionalScenarios: ConditionalScenario[] = scenarios.map((s, i) => ({
    id: s.id,
    name: s.name,
    base: s.probability,
    conditional: posterior[i]!,
    delta: posterior[i]! - s.probability,
  }));

  // Transmission scales with severity, weighted by how well evidenced the path
  // into a node is. A speculative link should not amplify as confidently as a
  // documented one — that is what `confidence` is for.
  const confByDest = new Map<string, number>();
  for (const l of links) {
    const prev = confByDest.get(l.dest) ?? 0;
    if (l.confidence > prev) confByDest.set(l.dest, l.confidence);
  }
  const conditionalNodes: ConditionalNode[] = nodes
    .filter((n) => n.level > 0) // level 0 is the event itself; the play is not evidence about it
    .map((n) => {
      const conf = confByDest.get(n.id) ?? 0.5;
      const scaled = n.impact * (1 + severity * NODE_SENSITIVITY * conf);
      const conditional = Math.round(Math.min(100, Math.max(0, scaled)));
      return {
        id: n.id,
        label: n.label,
        ticker: n.ticker,
        base: n.impact,
        conditional,
        delta: conditional - n.impact,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const carrying = links
    .filter((l) => (severity > 0 ? l.direction === 1 : l.direction === -1))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((l) => ({
      source: l.source,
      dest: l.dest,
      confidence: l.confidence,
      invalidation: l.invalidation,
    }));

  const tone =
    severity > 0.15
      ? `pushes mass toward materialization`
      : severity < -0.15
        ? `pushes mass toward the fade`
        : `is the middle column — it sharpens the book without tilting it`;
  const moved = conditionalScenarios.filter((s) => s.delta !== 0).length;
  const note =
    `${gt.actor} plays ${play.row}, ${gt.counterpart} plays ${play.col} — ${play.label}. ` +
    `On this matrix that ${tone}${moved ? `, moving ${moved} of ${scenarios.length} scenarios` : ""}. ` +
    `Conditional on the play, not a forecast of it: the book keeps the probabilities the evidence supports.`;

  return {
    play,
    severity: Math.round(severity * 100) / 100,
    scenarios: conditionalScenarios,
    nodes: conditionalNodes,
    links: carrying,
    note,
    provenance: "heuristic",
  };
}
