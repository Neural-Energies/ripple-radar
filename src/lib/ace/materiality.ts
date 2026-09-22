/**
 * ACE materiality gate (§21).
 *
 * Not every headline is evidence. Without a gate, a widely syndicated story
 * re-publishes its way into a near-certainty: the same underlying fact, counted
 * once per outlet, dragging scenario mass with it. The probability engine
 * already discounts items flagged as duplicates, but that only helps when the
 * duplicate was detected upstream — this gate is the second line, and it is
 * also what decides whether an update is worth freezing a new snapshot for.
 *
 * Deliberately conservative: when in doubt an item is admitted with reduced
 * weight rather than silently dropped, because dropping real evidence is the
 * more expensive error for a forecasting desk.
 */
import type { EvidenceItem } from "@/data/types";

/** Below this, an update is not worth a new freeze-at-T snapshot. */
export const MATERIAL_MASS_THRESHOLD = 0.75;

export interface MaterialityVerdict {
  /** Items that may reach the probability engine. */
  admitted: EvidenceItem[];
  /** Items withheld, with the reason — surfaced, never silently dropped. */
  withheld: { item: EvidenceItem; reason: "duplicate-fact" | "stale" | "pre-freeze" }[];
  /** True when the admitted set is worth re-freezing the forecast over. */
  material: boolean;
}

/** Collapse a headline to the fact it asserts, so re-runs collide. */
export function factKey(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .slice(0, 12)
    .join("-");
}

/**
 * Filter an evidence batch down to what should actually move a forecast.
 *
 * `sinceMs` is the prior snapshot's as-of: anything already inside the frozen
 * information set has had its say and must not be counted twice.
 */
export function gateEvidence(
  evidence: EvidenceItem[],
  opts: { sinceMs: number; nowMs?: number; maxAgeHours?: number } = { sinceMs: 0 },
): MaterialityVerdict {
  const now = opts.nowMs ?? Date.now();
  const maxAge = (opts.maxAgeHours ?? 96) * 3_600_000;
  const admitted: EvidenceItem[] = [];
  const withheld: MaterialityVerdict["withheld"] = [];
  const seenFacts = new Set<string>();

  for (const item of evidence) {
    if (item.availableTimeMs <= opts.sinceMs) {
      withheld.push({ item, reason: "pre-freeze" });
      continue;
    }
    if (now - item.eventTimeMs > maxAge) {
      withheld.push({ item, reason: "stale" });
      continue;
    }
    const key = factKey(item.headline);
    if (key && seenFacts.has(key)) {
      withheld.push({ item, reason: "duplicate-fact" });
      continue;
    }
    if (key) seenFacts.add(key);
    admitted.push(item);
  }

  // Materiality is about mass, not count: one A-tier fundamental print can be
  // material where five narrative echoes are not.
  const mass = admitted.reduce((a, e) => {
    const cls = e.evidenceClass === "fundamental" ? 3 : e.evidenceClass === "market" ? 2.5 : e.evidenceClass === "expectation" ? 2 : 1;
    const rel = e.reliability === "A" ? 1 : e.reliability === "B" ? 0.8 : e.reliability === "C" ? 0.6 : 0.4;
    return a + cls * rel;
  }, 0);

  return { admitted, withheld, material: mass >= MATERIAL_MASS_THRESHOLD };
}
