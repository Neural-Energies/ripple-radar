import { createHash } from "node:crypto";
import type { RadarEvent } from "@/data/types";
import type { Sql } from "@/lib/db";
import { callXai, type ModelRequest } from "@/lib/engine/analyze.server";
import { claimCompute, paidAccess } from "@/lib/engine/compute-access.server";
import { route, routeContextFromEnv } from "@/lib/engine/routing";
import type { LiveBook, LiveDesk, RescoreResult } from "./types";

/**
 * Rescore one book with the paid model (PR #5 B05).
 *
 * Signed-in accounts with paid access and allowance left only. The cooldown
 * used to be a process-global map per book (one account's rescore blocked
 * every other account's, and each server instance kept its own), and the
 * cache also stored results under the bare book id. Access, allowance and
 * cache identity are now per account; failures are returned, not swallowed.
 */

/** Bump when the prompt changes: results from another version are not reused. */
export const RESCORE_PROMPT_VERSION = "rescore-v2";
export const MAX_SNAPSHOT_BYTES = 200_000;
export const RESCORE_CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 200;
const LEGACY_PLAN = { model: "grok-4.5", maxTokens: 700, temperature: 0.2, timeoutMs: 25_000 };

/** Routing-only annotation; optional so legacy callers stay unchanged. */
type RoutedRescore = RescoreResult & { provenance?: "llm_proposal" | "unchanged" };

export interface RescoreDeps {
  sql: () => Promise<Sql>;
  desk: () => Promise<Pick<LiveDesk, "headlines" | "quotes" | "books" | "liveEvents">>;
  callModel: (req: ModelRequest) => Promise<string>;
  now: () => number;
  env: Record<string, string | undefined>;
}

export type RescoreReply = { ok: true; result: RescoreResult; notice?: string } | { ok: false; error: string };

const cache = new Map<string, { result: RoutedRescore; at: number }>();

export function clearRescoreCache() {
  cache.clear();
}

function defaultDeps(): RescoreDeps {
  return {
    sql: async () => (await import("@/lib/db")).getSql(),
    desk: async () => (await import("./build.server")).buildDesk(),
    callModel: callXai,
    now: () => Date.now(),
    env: process.env,
  };
}

function plan(env: Record<string, string | undefined>) {
  if (env.RIPPLE_MODEL_ROUTING !== "1") return LEGACY_PLAN;
  const p = route("rescore", routeContextFromEnv({ hasXaiKey: true }));
  return p.model ? { model: p.model, maxTokens: p.maxTokens, temperature: p.temperature, timeoutMs: p.timeoutMs || 25_000 } : null;
}

export async function rescore(
  eventId: string,
  snapshot: RadarEvent | undefined,
  userId: string,
  deps: RescoreDeps = defaultDeps(),
): Promise<RescoreReply> {
  if (typeof eventId !== "string" || !eventId || eventId.length > 200) return { ok: false, error: "Unknown book." };
  if (snapshot && JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES) return { ok: false, error: "Book too large to rescore." };
  if (!userId) return { ok: false, error: "Sign in to rescore a book." };
  const apiKey = deps.env.XAI_API_KEY?.trim();
  const p = apiKey ? plan(deps.env) : null;
  if (!apiKey || !p) return { ok: false, error: "AI is not available in this environment" };

  const desk = await deps.desk();
  const event = desk.liveEvents.find((e) => e.id === eventId) ?? (snapshot?.id === eventId ? snapshot : undefined);
  if (!event) return { ok: false, error: "Unknown book — pick a live or analyzed event." };
  const book = desk.books[eventId];

  const sql = await deps.sql();
  const now = deps.now();
  const access = await paidAccess(sql, userId, now, deps.env);
  if (!access.ok) return { ok: false, error: access.reason };

  const headlines = desk.headlines.filter((h) => h.eventIds.includes(eventId) || h.title === event.title).slice(0, 8);
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        v: RESCORE_PROMPT_VERSION,
        model: p.model,
        user: userId,
        event: eventId,
        evidence: headlines.map((h) => [h.id, h.published]),
        probability: Math.round((book?.probability ?? event.probability) * 10),
        scenarios: event.scenarios.map((s) => [s.id, s.probability]),
      }),
    )
    .digest("hex");
  const hit = cache.get(key);
  if (hit && now - hit.at <= RESCORE_CACHE_TTL_MS) {
    return { ok: true, result: hit.result, notice: "Nothing new since this book was last rescored; that result is reused." };
  }

  const claim = await claimCompute(sql, userId, "rescore", now);
  if (!claim.ok) {
    return {
      ok: false,
      error: claim.reason === "cooldown"
        ? `Rescore available again in ${Math.ceil(claim.retryAfterMs / 1000)}s.`
        : "Today's rescore allowance is used.",
    };
  }

  const quotes = (book?.marketReaction ?? event.marketReaction)
    .map((m) => {
      const q = desk.quotes[m.ticker];
      return q ? `${m.ticker} ${q.last} (${q.changePct.toFixed(2)}%)` : `${m.ticker} n/a`;
    })
    .join("; ");

  let text: string;
  try {
    text = await deps.callModel({ ...p, apiKey, prompt: buildRescorePrompt(event, book, quotes, headlines) });
  } catch (err) {
    return { ok: false, error: `Model call failed (${err instanceof Error ? err.message : "request failed"}).` };
  }
  let parsed: {
    probability?: number;
    takeaway?: string;
    narrative?: string;
    scenarioShifts?: { id: string; probability: number }[];
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return { ok: false, error: "Model returned unreadable JSON." };
  }

  const result: RoutedRescore = {
    eventId,
    probability: Math.round(Math.min(92, Math.max(6, Number(parsed.probability) || book?.probability || event.probability))),
    takeaway: String(parsed.takeaway || "Rescore complete.").slice(0, 280),
    narrative: String(parsed.narrative || event.summary).slice(0, 480),
    scenarioShifts: Array.isArray(parsed.scenarioShifts)
      ? parsed.scenarioShifts
          .filter((s) => s && typeof s.id === "string")
          .map((s) => ({ id: s.id, probability: Math.round(Number(s.probability) || 0) }))
      : [],
    asOf: now,
    provenance: "llm_proposal",
  };
  cache.set(key, { result, at: now });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return { ok: true, result };
}

function buildRescorePrompt(
  event: RadarEvent,
  book: LiveBook | undefined,
  quotes: string,
  headlines: { source: string; title: string }[],
) {
  return `You are an event-agnostic sell-side risk desk. Rescore one tracked book using ONLY the live evidence below. Do not invent sources. Do not snap the book back to a canned fixture.
Book: ${event.title}
Region: ${event.region}
Theme: ${event.theme}
Prior model probability: ${event.probability}%
Live tape probability: ${book?.probability ?? event.probability}%
Live quotes: ${quotes || "none"}
Headlines:
${headlines.map((h) => `- [${h.source}] ${h.title}`).join("\n") || "- none"}
Scenarios:
${event.scenarios.map((s) => `- ${s.id}: ${s.name} ${s.probability}%`).join("\n")}
Return JSON with keys:
probability (integer 6-92),
takeaway (one sentence for the blotter),
narrative (two sentences),
scenarioShifts (array of {id, probability} that sum to ~100, same ids).`;
}
