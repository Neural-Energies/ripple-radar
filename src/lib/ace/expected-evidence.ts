/**
 * ACE expected-evidence monitor (§16).
 *
 * A forecast that says "if this scenario is real you will see X" is worthless
 * if nobody ever checks for X. Before this module every row rendered
 * `appeared: false` forever, because `appeared` was authored as a literal and
 * nothing in the system could flip it — the panel was a promise, not a test.
 *
 * What this does: takes the structured `watch` descriptor attached to each
 * expectation and looks for an evidence item that genuinely satisfies it —
 * right class, right direction, enough distinct declared observables present.
 * It never guesses from the prose, because a keyword sweep over a thesis
 * sentence would flip rows on coincidence, and a confirmation you cannot trust
 * is worse than an honest "awaiting".
 *
 * Semantics, stated plainly: this reports whether the CURRENT information set
 * satisfies the expectation. If the satisfying item ages out of the book, the
 * row goes back to awaiting — the monitor does not assert a permanent
 * historical fact it can no longer show you the evidence for. The matching
 * headline travels with the row so the claim is always auditable.
 *
 * Deterministic: same rows and same evidence in, same verdict out.
 */
import type { EvidenceItem, EvidenceWatch, ExpectedEvidence } from "@/data/types";

/** Word-boundary containment, case-insensitive, punctuation-tolerant. */
function mentions(haystack: string, needle: string): boolean {
  const term = needle.trim().toLowerCase();
  if (term.length < 2) return false;
  const text = haystack.toLowerCase();
  const at = text.indexOf(term);
  if (at < 0) return false;
  const before = at === 0 ? "" : text[at - 1]!;
  const after = text[at + term.length] ?? "";
  const isWord = (c: string) => /[a-z0-9]/.test(c);
  return !isWord(before) && !isWord(after);
}

/**
 * How many distinct declared observables this item shows.
 *
 * Distinct is the point: one headline repeating "freight" four times is one
 * observation, not four, so the `minHits` guard cannot be gamed by repetition.
 */
export function watchHits(item: EvidenceItem, watch: EvidenceWatch): string[] {
  const text = `${item.headline} ${item.source}`;
  const hits = new Set<string>();
  for (const t of watch.tickers) if (mentions(text, t)) hits.add(`ticker:${t.toLowerCase()}`);
  for (const t of watch.terms) if (mentions(text, t)) hits.add(`term:${t.toLowerCase()}`);
  return [...hits];
}

/** Does this one item satisfy the watch outright? */
export function satisfies(item: EvidenceItem, watch: EvidenceWatch): boolean {
  if (watch.classes.length > 0 && !watch.classes.includes(item.evidenceClass)) return false;
  if (watch.direction !== "any" && item.direction !== watch.direction) return false;
  return watchHits(item, watch).length >= Math.max(watch.minHits, 1);
}

/**
 * Re-evaluate every expectation against the live evidence book.
 *
 * Returns new rows; the input is never mutated. The earliest satisfying
 * observation wins, so `observedAt` is when we could first have known — not
 * whichever restatement happens to sort first in the feed.
 */
export function monitorExpectedEvidence(
  expected: ExpectedEvidence[],
  evidence: EvidenceItem[],
): ExpectedEvidence[] {
  if (expected.length === 0) return expected;
  return expected.map((row) => {
    // No declared observable means nothing testable was ever written down.
    // Leaving it `awaiting` is the honest outcome — do not invent a test.
    if (!row.watch) return { ...row, appeared: false };

    let best: EvidenceItem | undefined;
    for (const item of evidence) {
      if (!satisfies(item, row.watch)) continue;
      if (!best || item.availableTimeMs < best.availableTimeMs) best = item;
    }
    if (!best) {
      const { matchedBy: _m, matchedHeadline: _h, observedAt: _o, ...rest } = row;
      return { ...rest, appeared: false };
    }
    return {
      ...row,
      appeared: true,
      matchedBy: best.id,
      matchedHeadline: best.headline,
      observedAt: best.availableTimeMs,
    };
  });
}

/** How much of the book's expected evidence has actually shown up. */
export function observedShare(expected: ExpectedEvidence[]): { observed: number; total: number } {
  const testable = expected.filter((e) => e.watch);
  return { observed: testable.filter((e) => e.appeared).length, total: testable.length };
}
