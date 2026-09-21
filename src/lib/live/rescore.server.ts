import type { RadarEvent } from "@/data/types";
import {
  defaultBudgetGate,
  isModelRoutingEnabled,
  route,
  routeContextFromEnv,
} from "@/lib/engine/routing";
import { buildDesk } from "./build.server";
import type { LiveBook, RescoreResult } from "./types";

/** Routing-only annotation; optional so legacy callers stay unchanged. */
type RoutedRescore = RescoreResult & { provenance?: "llm_proposal" | "unchanged" };

const MIN_GAP_MS = 90_000;
const lastCall = new Map<string, number>();
const cache = new Map<string, RescoreResult>();

function unchangedPrior(eventId: string, event: RadarEvent, book?: LiveBook): RoutedRescore {
  const scenarios = book?.scenarios ?? event.scenarios;
  return {
    eventId,
    probability: book?.probability ?? event.probability,
    takeaway: "Unchanged prior — model path unavailable.",
    narrative: event.summary,
    scenarioShifts: scenarios.map((s) => ({ id: s.id, probability: s.probability })),
    asOf: Date.now(),
    provenance: "unchanged",
  };
}

export async function rescore(
  eventId: string,
  snapshot?: RadarEvent,
): Promise<{ ok: true; result: RescoreResult } | { ok: false; error: string }> {
  const routingOn = isModelRoutingEnabled();
  const apiKey = process.env.XAI_API_KEY;

  if (!routingOn && !apiKey) return { ok: false, error: "AI is not available in this environment" };

  const desk = await buildDesk();
  const event = desk.liveEvents.find((e) => e.id === eventId) ?? snapshot;
  if (!event) return { ok: false, error: "Unknown book — pick a live or analyzed event." };

  const book = desk.books[eventId];

  if (routingOn) {
    const ctx = routeContextFromEnv({ hasXaiKey: Boolean(apiKey?.trim()) });
    const decision = defaultBudgetGate.allow("rescore", eventId, ctx);
    if (!decision.allow) return { ok: true, result: unchangedPrior(eventId, event, book) };

    const plan = route("rescore", { ...ctx, budgetOk: true });
    if (!plan.model || !apiKey) return { ok: true, result: unchangedPrior(eventId, event, book) };

    const headlines = desk.headlines
      .filter((h) => h.eventIds.includes(eventId) || h.title === event.title)
      .slice(0, 8);
    const fingerprint =
      headlines.map((h) => h.id).join("|") + ":" + Math.round((book?.probability ?? event.probability) * 10);
    const hit = cache.get(fingerprint);
    if (hit) return { ok: true, result: hit };

    const quotes = (book?.marketReaction ?? event.marketReaction)
      .map((m) => {
        const q = desk.quotes[m.ticker];
        return q ? `${m.ticker} ${q.last} (${q.changePct.toFixed(2)}%)` : `${m.ticker} n/a`;
      })
      .join("; ");

    const prompt = buildRescorePrompt(event, book, quotes, headlines);

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
        signal: AbortSignal.timeout(plan.timeoutMs || 25_000),
      });

      if (!res.ok) return { ok: true, result: unchangedPrior(eventId, event, book) };
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content ?? "";
      let parsed: {
        probability?: number;
        takeaway?: string;
        narrative?: string;
        scenarioShifts?: { id: string; probability: number }[];
      };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        return { ok: true, result: unchangedPrior(eventId, event, book) };
      }

      const result: RoutedRescore = {
        eventId,
        probability: Math.round(
          Math.min(92, Math.max(6, Number(parsed.probability) || book?.probability || event.probability)),
        ),
        takeaway: String(parsed.takeaway || "Rescore complete.").slice(0, 280),
        narrative: String(parsed.narrative || event.summary).slice(0, 480),
        scenarioShifts: Array.isArray(parsed.scenarioShifts)
          ? parsed.scenarioShifts
              .filter((s) => s && typeof s.id === "string")
              .map((s) => ({ id: s.id, probability: Math.round(Number(s.probability) || 0) }))
          : [],
        asOf: Date.now(),
        provenance: "llm_proposal",
      };
      cache.set(eventId, result);
      cache.set(fingerprint, result);
      defaultBudgetGate.markAccepted("rescore", eventId);
      return { ok: true, result };
    } catch {
      return { ok: true, result: unchangedPrior(eventId, event, book) };
    } finally {
      defaultBudgetGate.endFlight();
    }
  }

  // Legacy path (flag OFF)
  const now = Date.now();
  const prev = lastCall.get(eventId) ?? 0;
  if (now - prev < MIN_GAP_MS) {
    const cached = cache.get(eventId);
    if (cached) return { ok: true, result: cached };
    return { ok: false, error: "Rescore cooling down — wait a minute." };
  }

  const headlines = desk.headlines.filter((h) => h.eventIds.includes(eventId) || h.title === event.title).slice(0, 8);
  const fingerprint = headlines.map((h) => h.id).join("|") + ":" + Math.round((book?.probability ?? event.probability) * 10);
  const hit = cache.get(fingerprint);
  if (hit) return { ok: true, result: hit };

  lastCall.set(eventId, now);

  const quotes = (book?.marketReaction ?? event.marketReaction)
    .map((m) => {
      const q = desk.quotes[m.ticker];
      return q ? `${m.ticker} ${q.last} (${q.changePct.toFixed(2)}%)` : `${m.ticker} n/a`;
    })
    .join("; ");

  const prompt = buildRescorePrompt(event, book, quotes, headlines);

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: 700,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) return { ok: false, error: `xAI API error ${res.status}` };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? "";
  let parsed: {
    probability?: number;
    takeaway?: string;
    narrative?: string;
    scenarioShifts?: { id: string; probability: number }[];
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return { ok: false, error: "Model returned unreadable JSON" };
  }

  const result: RescoreResult = {
    eventId,
    probability: Math.round(Math.min(92, Math.max(6, Number(parsed.probability) || book?.probability || event.probability))),
    takeaway: String(parsed.takeaway || "Rescore complete.").slice(0, 280),
    narrative: String(parsed.narrative || event.summary).slice(0, 480),
    scenarioShifts: Array.isArray(parsed.scenarioShifts)
      ? parsed.scenarioShifts
          .filter((s) => s && typeof s.id === "string")
          .map((s) => ({ id: s.id, probability: Math.round(Number(s.probability) || 0) }))
      : [],
    asOf: Date.now(),
  };
  cache.set(eventId, result);
  cache.set(fingerprint, result);
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
