import type { Sql } from "@/lib/db";
import { scoreBots, type BotView, type Mood, type ScoredHeadline } from "./assemble";
import type { CalendarView } from "./calendar";

export interface MorningBriefing {
  asOf: number;
  stored: number;
  scored: number;
  /** "mixed" when any headline in the window was scored by the model. */
  method: "lexicon" | "mixed";
  xaiConfigured: boolean;
  bots: BotView[];
  mood: Mood;
  calendar: CalendarView;
}

interface ScoreRow {
  id: string;
  title: string;
  source: string;
  url: string;
  published_ms: number | string;
  method: string;
  sentiment: number | null;
  bots: string;
}

export async function loadScored(sql: Sql, now: number): Promise<ScoredHeadline[]> {
  const since = (now - 126 * 3_600_000) / 1000;
  const rows = await sql.query<ScoreRow>(
    `select h.id, h.title, h.source, h.url,
            extract(epoch from h.published) * 1000 as published_ms,
            s.method, s.sentiment, s.bots
     from tape_headlines h
     join tape_scores s on s.headline_id = h.id
     where h.published >= to_timestamp($1)`,
    [since],
  );
  const byId = new Map<string, ScoredHeadline>();
  for (const row of rows) {
    const method = row.method === "xai" ? "xai" : "lexicon";
    const prev = byId.get(row.id);
    if (prev?.method === "xai") continue;
    if (prev && method !== "xai") continue;
    byId.set(row.id, {
      id: row.id,
      title: row.title,
      source: row.source,
      url: row.url,
      publishedMs: Number(row.published_ms),
      sentiment: row.sentiment == null ? null : Number(row.sentiment),
      method,
      bots: parseBots(row.bots),
    });
  }
  return [...byId.values()];
}

export async function storedCount(sql: Sql, now: number): Promise<number> {
  const since = (now - 126 * 3_600_000) / 1000;
  const rows = await sql.query<{ n: number | string }>(
    `select count(*) as n from tape_headlines where published >= to_timestamp($1)`,
    [since],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function loadMorningBriefing(deps?: { sql?: Sql; now?: number }): Promise<MorningBriefing> {
  const now = deps?.now ?? Date.now();
  const resolved = deps?.sql ?? (await (await import("@/lib/db")).getSql());
  const [scored, stored, calendar] = await Promise.all([
    loadScored(resolved, now),
    storedCount(resolved, now),
    import("./calendar.server").then((m) => m.loadBriefingCalendar({ nowMs: now })),
  ]);
  const { bots, mood } = scoreBots(scored, now);
  return {
    asOf: now,
    stored,
    scored: scored.filter((h) => Object.keys(h.bots).length > 0).length,
    method: scored.some((h) => h.method === "xai") ? "mixed" : "lexicon",
    xaiConfigured: Boolean(process.env.XAI_API_KEY?.trim()),
    bots,
    mood,
    calendar,
  };
}

function parseBots(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
