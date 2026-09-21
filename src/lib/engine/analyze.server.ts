import type { RadarEvent } from "@/data/types";
import { composeFromText } from "./compose";
import { tagsFromText } from "./ontology";
import {
  defaultBudgetGate,
  isModelRoutingEnabled,
  route,
  routeContextFromEnv,
} from "./routing";

const MIN_GAP_MS = 45_000;
let lastCall = 0;
const cache = new Map<string, RadarEvent>();

function fingerprint(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 280);
}

export async function analyze(
  text: string,
): Promise<{ ok: true; event: RadarEvent; source: "model" | "engine" } | { ok: false; error: string }> {
  const q = text.trim();
  if (q.length < 8) return { ok: false, error: "Describe the event in a sentence." };

  const { buildDesk } = await import("@/lib/live/build.server");
  const desk = await buildDesk();
  const fallback = composeFromText(q, desk.headlines, desk.quotes);

  const fp = fingerprint(q);
  const hit = cache.get(fp);
  if (hit) return { ok: true, event: { ...hit, id: "desk-" + Date.now().toString(36) }, source: "model" };

  const apiKey = process.env.XAI_API_KEY;
  const routingOn = isModelRoutingEnabled();

  if (routingOn) {
    const ctx = routeContextFromEnv({ hasXaiKey: Boolean(apiKey?.trim()) });
    const decision = defaultBudgetGate.allow("analyze", fp, ctx);
    if (!decision.allow) return { ok: true, event: fallback, source: "engine" };

    const plan = route("analyze", { ...ctx, budgetOk: true });
    if (!plan.model || !apiKey) return { ok: true, event: fallback, source: "engine" };

    const related = relatedHeadlines(desk.headlines, q);
    const prompt = buildAnalyzePrompt(q, related);

    defaultBudgetGate.beginFlight();
    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: plan.model,
          max_tokens: plan.maxTokens,
          temperature: plan.temperature,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(plan.timeoutMs || 28_000),
      });

      if (!res.ok) return { ok: true, event: fallback, source: "engine" };
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = body.choices?.[0]?.message?.content ?? "";
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return { ok: true, event: fallback, source: "engine" };
      }

      const event = hydrate(parsed, fallback);
      cache.set(fp, event);
      defaultBudgetGate.markAccepted("analyze", fp);
      return { ok: true, event, source: "model" };
    } catch {
      return { ok: true, event: fallback, source: "engine" };
    } finally {
      defaultBudgetGate.endFlight();
    }
  }

  // Legacy path (flag OFF) — behavior unchanged, including pre-flight cooldown stamp.
  if (!apiKey) return { ok: true, event: fallback, source: "engine" };

  const now = Date.now();
  if (now - lastCall < MIN_GAP_MS) return { ok: true, event: fallback, source: "engine" };
  lastCall = now;

  const related = relatedHeadlines(desk.headlines, q);
  const prompt = buildAnalyzePrompt(q, related);

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: 2400,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(28000),
  });

  if (!res.ok) return { ok: true, event: fallback, source: "engine" };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = body.choices?.[0]?.message?.content ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: true, event: fallback, source: "engine" };
  }

  const event = hydrate(parsed, fallback);
  cache.set(fp, event);
  return { ok: true, event, source: "model" };
}

function relatedHeadlines(
  headlines: { title: string; source: string }[],
  q: string,
) {
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
  return `You are Alpha Recon, an event-agnostic intelligence engine. You know HOW to reason about events. You do NOT know which events will happen. Construct a research object for a NEW event from the description. Do not reuse a canned Hormuz/Taiwan/Red Sea/rare-earth report. Do not default to bull/base/bear. Do not start from a stock list.
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
