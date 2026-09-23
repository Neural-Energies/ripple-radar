/**
 * Stable event identity across polls.
 *
 * The defect this replaces: an event's id was a hash of its entities plus the
 * first 40 characters of its NEWEST headline. Headlines sort newest-first, so
 * every fresh wire item about an ongoing story minted a brand-new id. Probed
 * on a three-headline Lebanon story, adding one more headline moved the id
 * from `ev-fcj3qg` to `ev-aztugp`.
 *
 * That is not a cosmetic bug. `buildDesk` looks up the previous forecast by
 * event id and skips the Bayesian update when it finds none — so for any story
 * that was actually developing, the prior never resolved, the posterior never
 * ran, and the frozen snapshots scattered across single-use ids that could
 * never be scored against each other. Forecast history, forecast deltas and
 * calibration were all structurally unreachable.
 *
 * Identity here is assigned once, persisted, and matched on afterwards. It is
 * never recomputed from content, because content is exactly what changes.
 *
 * Matching is deliberately conservative. Over-merging is the worse failure:
 * two distinct stories fused into one event corrupt a forecast series that is
 * supposed to be about one thing, and nothing downstream can detect it. A
 * missed match only costs a duplicate event, which is visible and recoverable.
 */
import { hid, jaccard } from "@/lib/engine/tokenize";

/** Entities and tokens must both agree before two clusters are the same event. */
export const ENTITY_FLOOR = 0.34;
export const COMBINED_FLOOR = 0.42;
/** Weight on the "who and where" signal over the supporting vocabulary. */
export const ENTITY_WEIGHT = 0.65;
/** Token-only fallback, for clusters that carry no usable entity. Stricter,
 *  because vocabulary alone merges any two stories in the same domain. */
export const TOKEN_ONLY_FLOOR = 0.6;
/**
 * An event not seen for this long is over. A later story about the same actors
 * is a new event, not a continuation — otherwise "Israel/Lebanon" would be one
 * immortal event accumulating forecasts across unrelated flare-ups.
 */
export const MAX_DORMANT_MS = 72 * 60 * 60 * 1000;
/** Tokens carried into the fingerprint and match, longest-first (most specific). */
const TOKEN_DEPTH = 12;

export interface EventCandidate {
  clusterId: string;
  title: string;
  entities: string[];
  tokens: string[];
  tags: string[];
  newestMs: number;
  oldestMs: number;
  headlineIds: string[];
}

export interface KnownEvent {
  id: string;
  fingerprint: string;
  title: string;
  entities: string[];
  tokens: string[];
  lastSeenMs: number;
}

export type MatchMethod = "fingerprint" | "similarity" | "new";

export interface Resolution {
  clusterId: string;
  eventId: string;
  isNew: boolean;
  method: MatchMethod;
  /** 1 for an exact fingerprint hit, the similarity score otherwise, 0 for new. */
  score: number;
  /** The entities that drove the match — shown as provenance, not decoration. */
  matchedOn: string[];
  entityOverlap: number;
  tokenOverlap: number;
}

function norm(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.sort();
}

/** The most specific tokens, longest-first — a stable slice, not a random one. */
export function topTokens(tokens: Iterable<string>, depth = TOKEN_DEPTH): string[] {
  return [...new Set([...tokens].map((t) => t.toLowerCase()))]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, depth)
    .sort();
}

/**
 * A structural signature of what the story is ABOUT.
 *
 * Built from sorted entities and the most specific tokens, and never from a
 * headline — headline text is the part that changes every poll. Two clusters
 * with the same fingerprint are the same event with no similarity work needed,
 * which is the common case for a story that is simply still running.
 */
export function fingerprintOf(entities: string[], tokens: Iterable<string>): string {
  const ents = norm(entities);
  const toks = topTokens(tokens);
  // Entities alone when we have them: token drift is what erodes an otherwise
  // exact match, and entities are the part that actually identifies the story.
  const basis = ents.length >= 2 ? ents.join("|") : [...ents, ...toks].join("|");
  return hid(basis);
}

export interface Similarity {
  score: number;
  entityOverlap: number;
  tokenOverlap: number;
  shared: string[];
}

export function similarity(a: EventCandidate, b: KnownEvent): Similarity {
  const aEnts = new Set(norm(a.entities));
  const bEnts = new Set(norm(b.entities));
  const aToks = new Set(topTokens(a.tokens));
  const bToks = new Set(topTokens(b.tokens));

  const entityOverlap = jaccard(aEnts, bEnts);
  const tokenOverlap = jaccard(aToks, bToks);
  const shared = [...aEnts].filter((e) => bEnts.has(e));

  // No entity on either side: vocabulary is all we have, and it is weak
  // evidence, so it is scored on its own against a much higher floor rather
  // than blended into a number that looks like the entity-backed one.
  if (aEnts.size === 0 || bEnts.size === 0) {
    return { score: tokenOverlap, entityOverlap: 0, tokenOverlap, shared };
  }
  return {
    score: ENTITY_WEIGHT * entityOverlap + (1 - ENTITY_WEIGHT) * tokenOverlap,
    entityOverlap,
    tokenOverlap,
    shared,
  };
}

function admissible(sim: Similarity, hasEntities: boolean): boolean {
  if (!hasEntities) return sim.tokenOverlap >= TOKEN_ONLY_FLOOR;
  return sim.entityOverlap >= ENTITY_FLOOR && sim.score >= COMBINED_FLOOR;
}

/** `ev-` prefix keeps existing ids, routes and stored snapshots readable. */
export function mintEventId(fingerprint: string, atMs: number): string {
  return `ev-${fingerprint}-${atMs.toString(36).slice(-5)}`;
}

/**
 * Assign every cluster to an existing event or mint a new one.
 *
 * Greedy best-first over all admissible pairs, so the strongest match claims
 * its event before a weaker one can. Each event takes at most one cluster per
 * cycle and each cluster takes at most one event: letting two clusters land on
 * one event would silently fuse two stories into a single forecast series.
 */
export function resolveIdentities(
  candidates: EventCandidate[],
  known: KnownEvent[],
  nowMs: number,
): Resolution[] {
  const live = known.filter((k) => nowMs - k.lastSeenMs <= MAX_DORMANT_MS);
  const byFingerprint = new Map<string, KnownEvent>();
  for (const k of live) if (!byFingerprint.has(k.fingerprint)) byFingerprint.set(k.fingerprint, k);

  const out = new Map<string, Resolution>();
  const claimed = new Set<string>();

  // Pass 1 — exact structural match. Cheap, and it covers a running story.
  for (const c of candidates) {
    const fp = fingerprintOf(c.entities, c.tokens);
    const hit = byFingerprint.get(fp);
    if (!hit || claimed.has(hit.id)) continue;
    const sim = similarity(c, hit);
    claimed.add(hit.id);
    out.set(c.clusterId, {
      clusterId: c.clusterId, eventId: hit.id, isNew: false, method: "fingerprint",
      score: 1, matchedOn: sim.shared, entityOverlap: sim.entityOverlap,
      tokenOverlap: sim.tokenOverlap,
    });
  }

  // Pass 2 — similarity, for a story whose entity set has drifted.
  const pairs: { c: EventCandidate; k: KnownEvent; sim: Similarity }[] = [];
  for (const c of candidates) {
    if (out.has(c.clusterId)) continue;
    const hasEntities = norm(c.entities).length > 0;
    for (const k of live) {
      if (claimed.has(k.id)) continue;
      const sim = similarity(c, k);
      if (admissible(sim, hasEntities && norm(k.entities).length > 0)) pairs.push({ c, k, sim });
    }
  }
  pairs.sort((x, y) => y.sim.score - x.sim.score);
  for (const { c, k, sim } of pairs) {
    if (out.has(c.clusterId) || claimed.has(k.id)) continue;
    claimed.add(k.id);
    out.set(c.clusterId, {
      clusterId: c.clusterId, eventId: k.id, isNew: false, method: "similarity",
      score: sim.score, matchedOn: sim.shared, entityOverlap: sim.entityOverlap,
      tokenOverlap: sim.tokenOverlap,
    });
  }

  // Pass 3 — genuinely new. Mint once; the id is stored and never recomputed.
  const minted = new Set<string>();
  for (const c of candidates) {
    if (out.has(c.clusterId)) continue;
    const fp = fingerprintOf(c.entities, c.tokens);
    let id = mintEventId(fp, c.oldestMs || nowMs);
    // Two brand-new clusters can share a fingerprint within one cycle; they
    // still need distinct ids or one would overwrite the other's history.
    let n = 1;
    while (minted.has(id)) id = `${mintEventId(fp, c.oldestMs || nowMs)}-${n++}`;
    minted.add(id);
    out.set(c.clusterId, {
      clusterId: c.clusterId, eventId: id, isNew: true, method: "new",
      score: 0, matchedOn: [], entityOverlap: 0, tokenOverlap: 0,
    });
  }

  return candidates.map((c) => out.get(c.clusterId)!);
}
