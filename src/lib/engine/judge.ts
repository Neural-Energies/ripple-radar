/**
 * Cluster judge label types (schema v0) + ensemble disagreement helper.
 * Labels are ordinal routing signals — never calibrated desk probabilities.
 */

import type { EventFamily } from "./extract";

export type TriageDisposition = "onRadar" | "watch" | "drop" | "duplicate";

/** Ordinal routing confidence — NOT a calibrated probability. */
export type JudgeConfidence = "low" | "medium" | "high" | "very_high";

export type { EventFamily };

export interface ClusterJudgeLabel {
  /** Schema version for ML/AI router. */
  schemaVersion: "cluster-judge/v0";
  clusterId: string;
  /** World Tape / hero disposition chip. No % on this field. */
  disposition: TriageDisposition;
  /** Separate from disposition — market-moving vs merely on radar. */
  marketMoving: boolean;
  family: EventFamily;
  confidence: JudgeConfidence;
  /** Short human rationale (desk / eval). Not a probability. */
  why: string;
  /**
   * Optional. Crypto narratives only when delayed-policy compatible / data-honest.
   * Prefer ontology/tags + TradeCategory:"crypto" over inventing a crypto EventFamily.
   */
  cryptoHonest?: boolean;
  /** Set only when a real dual-sample ensemble disagreed (see modelsDisagree). */
  modelsDisagree?: boolean;
}

const DISPOSITION_RANK: Record<TriageDisposition, number> = {
  drop: 0,
  duplicate: 1,
  watch: 2,
  onRadar: 3,
};

const CONFIDENCE_RANK: JudgeConfidence[] = ["low", "medium", "high", "very_high"];

/**
 * True ONLY when two real judge samples disagree on disposition, family, or marketMoving.
 * Do not invent disagreement for UI chrome.
 */
export function modelsDisagree(a: ClusterJudgeLabel, b: ClusterJudgeLabel): boolean {
  return a.disposition !== b.disposition || a.family !== b.family || a.marketMoving !== b.marketMoving;
}

/** Keep the more conservative disposition; floor confidence one step. Never raise confidence on agree. */
export function mergeConservative(a: ClusterJudgeLabel, b: ClusterJudgeLabel): ClusterJudgeLabel {
  const disagree = modelsDisagree(a, b);
  const pick =
    DISPOSITION_RANK[a.disposition] <= DISPOSITION_RANK[b.disposition] ? a : b;
  let confidence = pick.confidence;
  if (disagree) {
    const idx = Math.max(0, CONFIDENCE_RANK.indexOf(pick.confidence) - 1);
    confidence = CONFIDENCE_RANK[idx]!;
  }
  return {
    ...pick,
    confidence,
    modelsDisagree: disagree || undefined,
  };
}
