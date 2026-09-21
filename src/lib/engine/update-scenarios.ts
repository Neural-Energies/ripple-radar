/**
 * Evidence-driven scenario update (Dirichlet, deterministic).
 *
 * `scenariosFor` produces the prior — a heuristic, family-appropriate mass
 * over mutually exclusive outcomes. This module is what MOVES that mass when
 * evidence arrives, and records why, so "when did this go from 28% to 41%,
 * and on what?" has an answer that is not "the model changed its mind".
 *
 * Model: the prior is treated as Dirichlet concentration α = p · κ, i.e. the
 * heuristic prior is worth κ pseudo-observations. Each evidence item adds its
 * weight to the scenarios it favours; the posterior is the renormalized mean.
 * Nothing here is calibrated — it is a documented, reproducible rule over
 * evidence classes, and its provenance stays `heuristic` until the freeze-at-T
 * ledger has enough scored resolutions to earn anything stronger.
 *
 * Which scenario does a piece of evidence favour? `scenariosFor` emits every
 * family ordered along one axis — materialization first, fade last (the
 * generator's own variables are `material`, `partial`, `noise`, `fade`). So a
 * scenario's position on that axis is structural, not inferred from its prose,
 * and escalatory evidence shifts mass toward index 0 while de-escalatory
 * evidence shifts it toward the last index. Neutral evidence sharpens the
 * prior without moving it, which is what a Dirichlet update should do.
 */
import type { EvidenceItem, ProbabilityAudit, RippleNode, Scenario, TradeIdea } from "@/data/types";

/**
 * How many observations the heuristic prior is worth. Low enough that real
 * evidence moves the book within a session, high enough that a single noisy
 * print cannot flip it.
 */
export const PRIOR_STRENGTH = 12;

/** One burst of correlated tape must not slam the distribution. */
const MAX_EVIDENCE_MASS = PRIOR_STRENGTH * 2;

/** A fundamental print outranks a narrative one. Mirrors evidence.ts strength. */
const CLASS_WEIGHT: Record<EvidenceItem["evidenceClass"], number> = {
  fundamental: 3,
  market: 2.5,
  expectation: 2,
  narrative: 1,
};

const RELIABILITY_WEIGHT: Record<string, number> = { A: 1, B: 0.8, C: 0.6, D: 0.4 };

/**
 * A syndicated re-run of one story is not a second observation. Without this,
 * twenty wires about one hurricane would read as twenty independent
 * confirmations — the same failure clustering exists to prevent.
 */
const DUPLICATE_DISCOUNT = 0.25;

export function evidenceWeight(e: EvidenceItem): number {
  const cls = CLASS_WEIGHT[e.evidenceClass] ?? 1;
  const rel = e.reliability ? (RELIABILITY_WEIGHT[e.reliability] ?? 0.6) : 0.6;
  return cls * rel * (e.duplicateOf ? DUPLICATE_DISCOUNT : 1);
}

/** 0 = most escalatory scenario, 1 = most fade-ward. */
function axisPosition(index: number, count: number): number {
  return count <= 1 ? 0 : index / (count - 1);
}

/** Round to integers that still sum to exactly 100 (largest remainder). */
function roundTo100(weights: number[]): number[] {
  const total = weights.reduce((a, w) => a + w, 0) || 1;
  const exact = weights.map((w) => (w / total) * 100);
  const floors = exact.map((x) => Math.floor(x));
  let remaining = 100 - floors.reduce((a, n) => a + n, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    out[i] = out[i]! + 1;
    remaining -= 1;
  }
  return out;
}

function summarize(items: EvidenceItem[], netDirection: "up" | "down" | "flat"): string {
  if (items.length === 0) return "No new evidence since the last freeze — mass unchanged.";
  const byClass = new Map<string, number>();
  for (const e of items) byClass.set(e.evidenceClass, (byClass.get(e.evidenceClass) ?? 0) + 1);
  const parts = [...byClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cls, n]) => `${n} ${cls}`);
  const tone =
    netDirection === "up" ? "net escalatory" : netDirection === "down" ? "net de-escalatory" : "net neutral";
  const dupes = items.filter((e) => e.duplicateOf).length;
  const dupeNote = dupes > 0 ? `, ${dupes} discounted as duplicate` : "";
  return `${parts.join(", ")} since the last freeze; ${tone}${dupeNote}.`;
}

export interface ScenarioUpdate {
  scenarios: Scenario[];
  /** Parallel to `scenarios`, already attached to each `scenario.audit`. */
  audits: ProbabilityAudit[];
  /** Total evidence mass actually applied, after the burst cap. */
  appliedMass: number;
}

/**
 * Apply an evidence batch to a prior scenario mass.
 *
 * `prior` supplies the probabilities to move (typically the last frozen
 * snapshot); `current` supplies identity and prose. Scenarios are joined on
 * `id` — a renamed scenario keeps its history rather than minting a new
 * forecast, which is what makes the ledger's freeze-at-T meaningful.
 */
export function updateScenarios(opts: {
  current: Scenario[];
  prior?: { id: string; probability: number }[];
  evidence: EvidenceItem[];
  nodes?: RippleNode[];
  trades?: TradeIdea[];
}): ScenarioUpdate {
  const { current, evidence, nodes = [], trades = [] } = opts;
  if (current.length === 0) return { scenarios: [], audits: [], appliedMass: 0 };

  const priorById = new Map((opts.prior ?? []).map((p) => [p.id, p.probability]));
  const priorProbs = current.map((s) => priorById.get(s.id) ?? s.probability);

  const alpha = priorProbs.map((p) => (p / 100) * PRIOR_STRENGTH);
  const gained = current.map(() => 0);

  let applied = 0;
  let escalatory = 0;
  let deEscalatory = 0;

  for (const e of evidence) {
    if (applied >= MAX_EVIDENCE_MASS) break;
    const w = Math.min(evidenceWeight(e), MAX_EVIDENCE_MASS - applied);
    if (w <= 0) continue;

    // Affinity across the materialization → fade axis, normalized so one item
    // contributes exactly `w` of mass regardless of how many scenarios exist.
    const raw = current.map((_, i) => {
      const pos = axisPosition(i, current.length);
      if (e.direction === "up") return 1 - pos;
      if (e.direction === "down") return pos;
      return priorProbs[i]! / 100; // neutral: sharpen the prior, do not tilt it
    });
    const rawTotal = raw.reduce((a, n) => a + n, 0);
    if (rawTotal <= 0) continue;

    for (let i = 0; i < current.length; i += 1) {
      const share = (raw[i]! / rawTotal) * w;
      alpha[i] = alpha[i]! + share;
      gained[i] = gained[i]! + share;
    }

    applied += w;
    if (e.direction === "up") escalatory += w;
    else if (e.direction === "down") deEscalatory += w;
  }

  const posterior = roundTo100(alpha);
  const net: "up" | "down" | "flat" =
    escalatory > deEscalatory ? "up" : deEscalatory > escalatory ? "down" : "flat";
  const evidenceNote = summarize(evidence, net);

  const scenarios: Scenario[] = current.map((s, i) => {
    const previous = priorProbs[i]!;
    const updated = posterior[i]!;
    const moved = updated - previous;

    // Nodes whose own direction agrees with where this scenario went, and the
    // ranked expressions sitting on them — what a trader would re-read first.
    const wantDirection = moved >= 0 ? "up" : "down";
    const affectedNodes = nodes
      .filter((n) => n.direction === wantDirection || n.direction === "mixed")
      .slice(0, 6)
      .map((n) => n.id);
    const nodeTickers = new Set(
      nodes.filter((n) => affectedNodes.includes(n.id)).map((n) => n.ticker).filter(Boolean),
    );
    const rescoredAssets = trades
      .filter((t) => nodeTickers.has(t.ticker))
      .slice(0, 6)
      .map((t) => t.ticker);

    const audit: ProbabilityAudit = {
      previous,
      updated,
      evidence: evidenceNote,
      direction: moved >= 0 ? "up" : "down",
      weight: Math.round(gained[i]! * 100) / 100,
      affectedNodes,
      rescoredAssets,
    };

    return { ...s, probability: updated, prevProbability: previous, audit };
  });

  return { scenarios, audits: scenarios.map((s) => s.audit), appliedMass: applied };
}
