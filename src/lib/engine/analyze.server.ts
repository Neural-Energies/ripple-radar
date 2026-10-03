import { createHash } from "node:crypto";
import type { RadarEvent } from "@/data/types";
import type { Sql } from "@/lib/db";
import type { LiveDesk } from "@/lib/live/types";
import { composeFromText } from "./compose";
import { claimCompute, claimNotice, paidAccess } from "./compute-access.server";
import { tagsFromText } from "./ontology";
import { route, routeContextFromEnv } from "./routing";

/**
 * Analyze: build a research object for a described event (PR #5 B05).
 *
 * Paid-model analysis runs only for a signed-in account with paid access and
 * allowance left (see compute-access.server). Everyone else, and any model
 * failure, gets the engine's own construction with a notice saying why.
 *
 * The cache used to be process-global and keyed on the first 280 characters,
 * with no expiry: two theses sharing a prefix collided, and the same thesis
 * after new evidence returned the old object. A cached result is now reused
 * only for the same account, the same full description, the same evidence
 * (the related headlines that went into the prompt) and the same model and
 * prompt version, within CACHE_TTL_MS. The cache is bounded.
 */

/** Bump when the prompt or hydration changes: results from another version are not reused. */
export const ANALYZE_PROMPT_VERSION = "analyze-v2";
export const CACHE_TTL_MS = 30 * 60_000;
export const CACHE_MAX = 200;
export const MAX_TEXT = 4_000;
const LEGACY_PLAN = { model: "grok-4.5", maxTokens: 2400, temperature: 0.25, timeoutMs: 28_000 };

export interface ModelRequest {
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  prompt: string;
  apiKey: string;
}

export interface AnalyzeDeps {
  sql: () => Promise<Sql>;
  desk: () => Promise<Pick<LiveDesk, "headlines" | "quotes">>;
  /** One model call; resolves to the reply's JSON text, or throws. */
  callModel: (req: ModelRequest) => Promise<string>;
  now: () => number;
  env: Record<string, string | undefined>;
}

export type AnalyzeResult =
  | { ok: true; event: RadarEvent; source: "model" | "engine"; notice?: string; cached?: boolean }
  | { ok: false; error: string };

const cache = new Map<string, { event: RadarEvent; at: number }>();

export function clearAnalyzeCache() {
  cache.clear();
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Account, full description, evidence, model and prompt version: all of it, hashed. */
export function analyzeCacheKey(parts: {
  userId: string;
  text: string;
  model: string;
  evidence: { id?: string; title: string; published?: number }[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: ANALYZE_PROMPT_VERSION,
        model: parts.model,
        user: parts.userId,
        text: normalize(parts.text),
        evidence: parts.evidence.map((h) => [h.id ?? null, h.title, h.published ?? null]),
      }),
    )
    .digest("hex");
}

function readCache(key: string, now: number) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh recency for the size bound.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function writeCache(key: string, value: { event: RadarEvent; at: number }) {
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

function modelPlan(env: Record<string, string | undefined>) {
  if (env.RIPPLE_MODEL_ROUTING !== "1") return LEGACY_PLAN;
  const plan = route("analyze", routeContextFromEnv({ hasXaiKey: true }));
  return plan.model ? { model: plan.model, maxTokens: plan.maxTokens, temperature: plan.temperature, timeoutMs: plan.timeoutMs || 28_000 } : null;
}

export async function callXai(req: ModelRequest): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${req.apiKey}` },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: req.prompt }],
    }),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

function defaultDeps(): AnalyzeDeps {
  return {
    sql: async () => (await import("@/lib/db")).getSql(),
    desk: async () => (await import("@/lib/live/build.server")).buildDesk(),
    callModel: callXai,
    now: () => Date.now(),
    env: process.env,
  };
}

function deskId(now: number) {
  return "desk-" + now.toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function analyze(text: string, userId: string, deps: AnalyzeDeps = defaultDeps()): Promise<AnalyzeResult> {
  const q = typeof text === "string" ? text.trim() : "";
  if (q.length < 8) return { ok: false, error: "Describe the event in a sentence." };
  if (q.length > MAX_TEXT) return { ok: false, error: `Keep the description under ${MAX_TEXT} characters.` };
  if (!userId) return { ok: false, error: "Sign in to analyze an event." };

  const desk = await deps.desk();
  const fallback = composeFromText(q, desk.headlines, desk.quotes);
  const apiKey = deps.env.XAI_API_KEY?.trim();
  const plan = apiKey ? modelPlan(deps.env) : null;
  if (!apiKey || !plan) return { ok: true, event: fallback, source: "engine" };

  const sql = await deps.sql();
  const now = deps.now();
  const access = await paidAccess(sql, userId, now, deps.env);
  if (!access.ok) return { ok: true, event: fallback, source: "engine", notice: access.reason };

  const related = relatedHeadlines(desk.headlines, q);
  const key = analyzeCacheKey({ userId, text: q, model: plan.model, evidence: related });
  const hit = readCache(key, now);
  if (hit) {
    return {
      ok: true,
      event: { ...hit.event, id: deskId(now) },
      source: "model",
      cached: true,
      notice: `Same description and evidence as ${Math.round((now - hit.at) / 60_000)} min ago: that analysis is reused.`,
    };
  }

  const claim = await claimCompute(sql, userId, "analyze", now);
  if (!claim.ok) return { ok: true, event: fallback, source: "engine", notice: claimNotice(claim) };

  let raw: string;
  try {
    raw = await deps.callModel({ ...plan, apiKey, prompt: buildAnalyzePrompt(q, related) });
  } catch (err) {
    const why = err instanceof Error ? err.message : "request failed";
    return { ok: true, event: fallback, source: "engine", notice: `Model call failed (${why}); showing the engine's construction.` };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: true, event: fallback, source: "engine", notice: "The model's reply was not valid JSON; showing the engine's construction." };
  }
  const event = hydrate(parsed, fallback);
  writeCache(key, { event, at: now });
  return { ok: true, event, source: "model" };
}

function relatedHeadlines<T extends { title: string; source: string }>(headlines: T[], q: string): T[] {
  return headlines
    .filter((h) => {
      const hay = h.title.toLowerCase();
      return (
        tagsFromText(q).some((t) => hay.includes(t)) ||
        q.split(/\s+/).filter((w) => w.length > 4 && hay.includes(w.toLowerCase())).length >= 2
      );
    })
    .slice(0, 8);
}

function buildAnalyzePrompt(q: string, related: { title: string; source: string }[]) {
  return `You are Ripple Radar, an event-agnostic intelligence engine. You know HOW to reason about events. You do NOT know which events will happen. Construct a research object for a NEW event from the description. Do not reuse a canned Hormuz/Taiwan/Red Sea/rare-earth report. Do not default to bull/base/bear. Do not start from a stock list.
Event: ${q}
Live evidence (may be empty or loosely related):
${related.map((h) => `- [${h.source}] ${h.title}`).join("\n") || "- none yet"}
Return JSON with:
title (short), region, theme, eventType, eventSubtype,
summary (2 sentences; tell the user not to trade the headline),
probability (integer 8-86) — this is NOT importance,
importance (integer 8-99) — a 10% event can still be extremely important,
entities, organizations, people (string arrays discovered from the event — no preloaded actor list),
lifecycle (candidate|emerging|active|escalating|de-escalating|stabilizing),
forecastHorizon,
headlineTicker (liquid ticker),
horizons: 2-3 {horizon (e.g. 7d, 30d, 12m), probability, note} — do not collapse into one probability,
nodes: 8-12 {id,label,ticker?,level (0-4),kind,angle,impact,direction (up|down|mixed),blurb} — level 0 is the event, no ticker. Build the CAUSAL graph first (economic variable, bottleneck, industry), THEN attach real liquid tickers (CL,BWET,HO,TSM,NVDA,TLT,UUP,KRE,BTC,JPY,HG,ITA,JETS,VIX,SPX,GC,TNX,…). Invent no fake tickers.
links: {source,dest,direction (1|-1),distance,confidence (0-1),evidence,expectedLag,invalidation,historicalSupport,scenarioDependence?}
scenarios: 3-5 {id,name,detail,probability,range,keyOutcomes} mutually distinguishable, SUM to 100, named as futures that could actually happen for THIS event.
players: 3-4 {name,objective,incentives,constraints,moves (string array),batna} discovered from who can change the outcome,
actor, counterpart, insight,
trades: 6-8 {ticker,name,score,reason,side (long|short),category (etf|stock|futures|forex|commodities|crypto),horizon,headline (bool on crowded first-order only),causalPath,invalidation,distance} each with a traceable path from the event,
questions: 4 {q,value (critical|high|medium),unknown} ranked by information value,
knowledge: 4-6 {kind (known|likely|uncertain|unknown|critical), text, value},
expectedEvidence: 3 {id,scenarioId,ifTrue,observe,lag,appeared (false)},
invalidation: 3 strings specific to this thesis,
takeaways: 3 strings
`;
}

function num(v: unknown, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function str(v: unknown, d: string) {
  return typeof v === "string" && v.trim() ? v.trim() : d;
}

function hydrate(p: Record<string, unknown>, base: RadarEvent): RadarEvent {
  const id = "desk-" + Date.now().toString(36);
  const nodes = Array.isArray(p.nodes) && p.nodes.length ? (p.nodes as RadarEvent["nodes"]) : base.nodes;
  const links = Array.isArray(p.links) && p.links.length ? (p.links as RadarEvent["links"]) : base.links;
  const scenarios = Array.isArray(p.scenarios) && p.scenarios.length
    ? (p.scenarios as Array<Record<string, unknown>>).map((s, i) => ({
        id: str(s.id, "s" + (i + 1)),
        name: str(s.name, base.scenarios[i]?.name ?? "Scenario"),
        detail: str(s.detail, ""),
        probability: Math.round(num(s.probability, 20)),
        prevProbability: Math.round(num(s.probability, 20)),
        range: str(s.range, ""),
        keyOutcomes: str(s.keyOutcomes, ""),
        audit: {
          previous: Math.round(num(s.probability, 20)),
          updated: Math.round(num(s.probability, 20)),
          evidence: "Model-constructed prior from the user's event description.",
          direction: "up" as const,
          weight: 2,
          affectedNodes: [],
          rescoredAssets: [],
        },
      }))
    : base.scenarios;
  const players = Array.isArray(p.players) && p.players.length
    ? (p.players as Array<Record<string, unknown>>).map((x) => ({
        name: str(x.name, "Actor"),
        objective: str(x.objective, ""),
        incentives: str(x.incentives, ""),
        constraints: str(x.constraints, ""),
        moves: Array.isArray(x.moves) ? x.moves.map((m) => String(m)) : [],
        batna: str(x.batna, ""),
      }))
    : base.gameTheory.players;
  const trades = Array.isArray(p.trades) && p.trades.length
    ? (p.trades as Array<Record<string, unknown>>).map((t, i) => ({
        ticker: str(t.ticker, "SPX").toUpperCase(),
        name: str(t.name, str(t.ticker, "SPX")),
        score: Math.round(num(t.score, 70 - i * 4)),
        reason: str(t.reason, ""),
        side: str(t.side, "long") === "short" ? ("short" as const) : ("long" as const),
        category: (["etf", "stock", "futures", "forex", "commodities", "crypto"].includes(String(t.category))
          ? t.category
          : "etf") as RadarEvent["trades"][number]["category"],
        horizon: str(t.horizon, "days–weeks"),
        headline: Boolean(t.headline) || i === 0,
        causalPath: str(t.causalPath, ""),
        invalidation: str(t.invalidation, ""),
        distance: num(t.distance, Math.min(4, i)) as 0 | 1 | 2 | 3 | 4,
      }))
    : base.trades;

  return {
    ...base,
    id,
    title: str(p.title, base.title),
    region: str(p.region, base.region),
    theme: str(p.theme, base.theme),
    summary: str(p.summary, base.summary),
    story: str(p.summary, base.story),
    probability: Math.round(Math.min(86, Math.max(8, num(p.probability, base.probability)))),
    nodes,
    links,
    scenarios,
    gameTheory: {
      ...base.gameTheory,
      actor: str(p.actor, players[0]?.name ?? base.gameTheory.actor),
      counterpart: str(p.counterpart, players[1]?.name ?? base.gameTheory.counterpart),
      insight: str(p.insight, base.gameTheory.insight),
      players,
    },
    trades,
    takeaways: Array.isArray(p.takeaways) ? p.takeaways.map((t) => String(t)).slice(0, 5) : base.takeaways,
    questions: Array.isArray(p.questions)
      ? (p.questions as Array<Record<string, unknown>>).map((x) => ({
          q: str(x.q, ""),
          value: (x.value === "critical" || x.value === "high" || x.value === "medium" ? x.value : "medium") as
            | "critical"
            | "high"
            | "medium",
          unknown: str(x.unknown, ""),
        }))
      : base.questions,
    invalidation: Array.isArray(p.invalidation) ? p.invalidation.map((t) => String(t)).slice(0, 5) : base.invalidation,
    entities: Array.isArray(p.entities) ? p.entities.map((t) => String(t)) : base.entities,
    lifecycle: (["emerging", "active", "escalating", "de-escalating"].includes(String(p.lifecycle))
      ? p.lifecycle
      : base.lifecycle) as RadarEvent["lifecycle"],
    forecastHorizon: str(p.forecastHorizon, base.forecastHorizon ?? ""),
    headlineTicker: str(p.headlineTicker, base.headlineTicker ?? trades[0]?.ticker),
    mode: "desk",
    badge: "WATCH",
    eventType: str(p.eventType, tagsFromText(str(p.theme, "") + " " + str(p.title, base.title))[0] ?? "unknown"),
    eventSubtype: str(p.eventSubtype, base.eventSubtype ?? ""),
    organizations: Array.isArray(p.organizations) ? p.organizations.map((t) => String(t)) : base.organizations,
    people: Array.isArray(p.people) ? p.people.map((t) => String(t)) : base.people,
    importance: Math.round(Math.min(99, Math.max(8, num(p.importance, base.importance ?? 40)))),
    horizons: Array.isArray(p.horizons)
      ? (p.horizons as Array<Record<string, unknown>>).map((h) => ({
          horizon: str(h.horizon, "30d"),
          probability: Math.round(num(h.probability, 20)),
          note: str(h.note, ""),
        }))
      : base.horizons,
    expectedEvidence: Array.isArray(p.expectedEvidence)
      ? (p.expectedEvidence as Array<Record<string, unknown>>).map((x, i) => ({
          id: str(x.id, "ee-" + i),
          scenarioId: str(x.scenarioId, "s1"),
          ifTrue: str(x.ifTrue, ""),
          observe: str(x.observe, ""),
          lag: str(x.lag, "days"),
          appeared: Boolean(x.appeared),
        }))
      : base.expectedEvidence,
    knowledge: Array.isArray(p.knowledge)
      ? (p.knowledge as Array<Record<string, unknown>>).map((x) => ({
          kind: (["known", "likely", "uncertain", "unknown", "critical"].includes(String(x.kind))
            ? x.kind
            : "unknown") as "known" | "likely" | "uncertain" | "unknown" | "critical",
          text: str(x.text, ""),
          value: (x.value === "critical" || x.value === "high" || x.value === "medium" ? x.value : "medium") as
            | "critical"
            | "high"
            | "medium",
        }))
      : base.knowledge,
    marketReaction: trades.slice(0, 6).map((t) => ({
      label: t.name,
      ticker: t.ticker,
      change: base.marketReaction.find((m) => m.ticker === t.ticker)?.change ?? 0,
    })),
    impacts: nodes
      .filter((n) => n.level > 0)
      .slice(0, 8)
      .map((n) => ({
        label: n.label,
        value: n.impact,
        direction: n.direction === "down" ? ("down" as const) : ("up" as const),
      })),
  };
}
