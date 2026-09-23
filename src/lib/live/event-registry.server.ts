/**
 * Persistence for the canonical event registry.
 *
 * Every write here is best-effort and swallows its own errors: this runs on
 * the live desk poll, and a database hiccup must degrade identity to the old
 * per-request behaviour rather than take the desk down. What it must never do
 * is fail silently in a way that looks like success — a failed resolve returns
 * the in-memory fallback and says so in `degraded`.
 */
import type { Sql } from "@/lib/db";
import type { Cluster } from "@/lib/engine/cluster";
import {
  MAX_DORMANT_MS,
  fingerprintOf,
  resolveIdentities,
  topTokens,
  type EventCandidate,
  type KnownEvent,
  type Resolution,
} from "./event-identity";

/** Matching only ever considers events inside the dormancy window; one extra
 *  day of slack keeps a borderline event available across a slow poll. */
const LOOKBACK_MS = MAX_DORMANT_MS + 24 * 60 * 60 * 1000;
/** How many live events a poll will match against, newest first. */
const MATCH_POOL = 500;

export interface ResolvedCluster {
  cluster: Cluster;
  resolution: Resolution;
  /** Headlines on this cluster not already attached to the event. */
  newHeadlineIds: string[];
}

export interface RegistryResult {
  resolved: ResolvedCluster[];
  /** True when the registry was unreachable and ids fell back to cluster ids. */
  degraded: boolean;
}

export function candidateFrom(c: Cluster): EventCandidate {
  return {
    clusterId: c.id,
    title: c.title,
    entities: c.entities,
    tokens: topTokens(c.tokens),
    tags: c.tags,
    newestMs: c.newest,
    oldestMs: c.oldest,
    headlineIds: c.headlines.map((h) => h.id),
  };
}

async function loadKnown(sql: Sql, nowMs: number): Promise<KnownEvent[]> {
  const cutoff = new Date(nowMs - LOOKBACK_MS).toISOString();
  const rows = await sql<{
    id: string; fingerprint: string; title: string;
    entities: string; tokens: string; last_seen: string;
  }>`
    select id, fingerprint, title, entities, tokens, last_seen
    from events
    where last_seen >= ${cutoff}
    order by last_seen desc
    limit ${MATCH_POOL}
  `;
  if (rows.length === MATCH_POOL) {
    // At the cap, the oldest live events fall out of the matching pool and
    // their next poll opens a duplicate instead of continuing them. Silent
    // duplication is exactly the failure this module exists to stop, so say so.
    console.warn(
      `[event-registry] matching pool saturated at ${MATCH_POOL} events — ` +
        "older live events cannot be matched and may duplicate",
    );
  }
  return rows.map((r) => ({
    id: r.id,
    fingerprint: r.fingerprint,
    title: r.title,
    entities: safeArray(r.entities),
    tokens: safeArray(r.tokens),
    lastSeenMs: new Date(r.last_seen).getTime(),
  }));
}

function safeArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Give every cluster a persistent event id, then record what happened.
 *
 * Returns which headlines are NEW to each event, because "three items arrived
 * since the last poll" is the fact a probability-change alert is built on, and
 * it cannot be recovered later from a headline count alone.
 */
export async function resolveAndRecord(
  clusters: Cluster[],
  nowMs = Date.now(),
): Promise<RegistryResult> {
  if (clusters.length === 0) return { resolved: [], degraded: false };
  try {
    const { getSql } = await import("@/lib/db");
    return await resolveAndRecordWith(await getSql(), clusters, nowMs);
  } catch (err) {
    console.error("[event-registry] resolve failed, falling back to cluster ids:", err);
    return { resolved: clusters.map(fallbackFor), degraded: true };
  }
}

/** Identity for a poll the registry could not reach: per-request, as before,
 *  and flagged `degraded` so a caller never mistakes it for a persisted id. */
function fallbackFor(c: Cluster): ResolvedCluster {
  return {
    cluster: c,
    resolution: {
      clusterId: c.id, eventId: c.id, isNew: true, method: "new" as const,
      score: 0, matchedOn: [], entityOverlap: 0, tokenOverlap: 0,
    },
    newHeadlineIds: c.headlines.map((h) => h.id),
  };
}

/**
 * The real work, against a caller-supplied connection.
 *
 * Split out so an integration test can drive it with a live PGLite instance
 * instead of mocking the database module — the SQL in this file is most of its
 * behaviour, and a test that stubs it out would prove nothing.
 */
export async function resolveAndRecordWith(
  sql: Sql,
  clusters: Cluster[],
  nowMs = Date.now(),
): Promise<RegistryResult> {
  if (clusters.length === 0) return { resolved: [], degraded: false };
  try {
    const known = await loadKnown(sql, nowMs);
    const candidates = clusters.map(candidateFrom);
    const resolutions = resolveIdentities(candidates, known, nowMs);
    const byCluster = new Map(resolutions.map((r) => [r.clusterId, r]));

    // Which headlines does each matched event already hold? One query, not one
    // per event: this is the live poll path.
    const existingIds = resolutions.filter((r) => !r.isNew).map((r) => r.eventId);
    const seen = new Map<string, Set<string>>();
    if (existingIds.length) {
      const rows = await sql<{ event_id: string; headline_id: string }>`
        select event_id, headline_id from event_evidence
        where event_id = any(${existingIds})
      `;
      for (const r of rows) {
        if (!seen.has(r.event_id)) seen.set(r.event_id, new Set());
        seen.get(r.event_id)!.add(r.headline_id);
      }
    }

    const resolved: ResolvedCluster[] = [];
    for (const c of clusters) {
      const resolution = byCluster.get(c.id)!;
      const had = seen.get(resolution.eventId) ?? new Set<string>();
      const newHeadlineIds = c.headlines.map((h) => h.id).filter((id) => !had.has(id));
      resolved.push({ cluster: c, resolution, newHeadlineIds });
    }

    await persist(sql, resolved, nowMs);
    return { resolved, degraded: false };
  } catch (err) {
    console.error("[event-registry] resolve failed, falling back to cluster ids:", err);
    return { resolved: clusters.map(fallbackFor), degraded: true };
  }
}

/**
 * Write the cycle in three statements, not three hundred.
 *
 * The first cut issued one query per event plus one per new headline. A busy
 * poll carries ~30 clusters and can bring a few hundred fresh items, which is
 * a few hundred sequential round-trips on the live desk path — enough to make
 * the poll itself the slowest thing on the page. These are multi-row inserts
 * with the same conflict semantics.
 */
async function persist(sql: Sql, resolved: ResolvedCluster[], nowMs: number): Promise<void> {
  if (resolved.length === 0) return;
  const at = new Date(nowMs).toISOString();

  const eventRows: unknown[] = [];
  const eventTuples: string[] = [];
  for (const { cluster, resolution, newHeadlineIds } of resolved) {
    const i = eventRows.length;
    eventTuples.push(
      `($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},$${i + 7},$${i + 8},$${i + 9},1)`,
    );
    eventRows.push(
      resolution.eventId,
      fingerprintOf(cluster.entities, cluster.tokens),
      cluster.title,
      JSON.stringify(cluster.entities.slice(0, 16)),
      JSON.stringify(topTokens(cluster.tokens)),
      JSON.stringify(cluster.tags.slice(0, 12)),
      new Date(cluster.oldest || nowMs).toISOString(),
      at,
      newHeadlineIds.length,
    );
  }
  // headline_count is seeded with this cycle's new items and incremented by
  // the same number on a later collision, so it counts distinct evidence
  // rather than re-syndication.
  await sql.query(
    `insert into events (
       id, fingerprint, title, entities, tokens, tags,
       first_seen, last_seen, headline_count, observation_count
     ) values ${eventTuples.join(",")}
     on conflict (id) do update set
       title = excluded.title,
       entities = excluded.entities,
       tokens = excluded.tokens,
       tags = excluded.tags,
       last_seen = excluded.last_seen,
       headline_count = events.headline_count + excluded.headline_count,
       observation_count = events.observation_count + 1`,
    eventRows,
  );

  const evRows: unknown[] = [];
  const evTuples: string[] = [];
  for (const { cluster, resolution, newHeadlineIds } of resolved) {
    const isNew = new Set(newHeadlineIds);
    for (const h of cluster.headlines) {
      if (!isNew.has(h.id)) continue;
      const i = evRows.length;
      evTuples.push(
        `($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},$${i + 7},$${i + 8},$${i + 9},$${i + 10},$${i + 11})`,
      );
      evRows.push(
        resolution.eventId, h.id, h.title, h.source, h.url ?? "",
        new Date(h.eventTimeMs ?? h.published).toISOString(),
        new Date(h.availableTimeMs ?? h.published).toISOString(),
        resolution.method, resolution.score,
        JSON.stringify(resolution.matchedOn), at,
      );
    }
  }
  if (evTuples.length) {
    await sql.query(
      `insert into event_evidence (
         event_id, headline_id, title, source, url, published, available_at,
         attach_method, attach_score, matched_on, attached_at
       ) values ${evTuples.join(",")}
       on conflict (event_id, headline_id) do nothing`,
      evRows,
    );
  }

  const obsRows: unknown[] = [];
  const obsTuples: string[] = [];
  for (const { cluster, resolution, newHeadlineIds } of resolved) {
    const i = obsRows.length;
    obsTuples.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},$${i + 7})`);
    obsRows.push(
      `obs-${resolution.eventId}-${nowMs.toString(36)}`,
      resolution.eventId, at, resolution.method, resolution.score,
      newHeadlineIds.length, cluster.title,
    );
  }
  await sql.query(
    `insert into event_observations (id, event_id, observed_at, method, score, new_headlines, title)
     values ${obsTuples.join(",")}
     on conflict (id) do nothing`,
    obsRows,
  );
}

export interface EventHistoryRow {
  observedAtMs: number;
  method: string;
  score: number;
  newHeadlines: number;
  title: string;
}

/** Observation history for one event — what the desk saw and when. */
export async function eventHistory(eventId: string, limit = 60): Promise<EventHistoryRow[]> {
  try {
    const { getSql } = await import("@/lib/db");
    return await eventHistoryWith(await getSql(), eventId, limit);
  } catch (err) {
    console.error("[event-registry] history lookup failed:", err);
    return [];
  }
}

export async function eventHistoryWith(
  sql: Sql,
  eventId: string,
  limit = 60,
): Promise<EventHistoryRow[]> {
  try {
    const rows = await sql<{
      observed_at: string; method: string; score: number;
      new_headlines: number; title: string;
    }>`
      select observed_at, method, score, new_headlines, title
      from event_observations
      where event_id = ${eventId}
      order by observed_at desc
      limit ${limit}
    `;
    return rows.map((r) => ({
      observedAtMs: new Date(r.observed_at).getTime(),
      method: r.method,
      score: Number(r.score),
      newHeadlines: Number(r.new_headlines),
      title: r.title,
    }));
  } catch (err) {
    console.error("[event-registry] history lookup failed:", err);
    return [];
  }
}
