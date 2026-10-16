import type { Sql } from "@/lib/db";
import { botsFromSentiment, parseXaiScores, scoreBots, scoreHeadline } from "./assemble";
import { loadScored } from "./read.server";

export interface TapeItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedMs: number;
}

const SNAPSHOT_MS = 15 * 60_000;
const XAI_BATCH = 12;
const MODEL = "grok-4.5";

let xaiInflight = false;
let nextXaiAt = 0;

export async function recordTape(items: TapeItem[], deps?: { sql?: Sql; now?: number; env?: NodeJS.ProcessEnv }): Promise<void> {
  const now = deps?.now ?? Date.now();
  const sql = deps?.sql ?? (await (await import("@/lib/db")).getSql());
  const fresh = dedupe(items).slice(0, 500);
  for (const h of fresh) {
    await sql`
      insert into tape_headlines (id, title, source, url, published)
      values (${h.id}, ${h.title.slice(0, 500)}, ${h.source.slice(0, 120)}, ${h.url.slice(0, 2000)}, to_timestamp(${h.publishedMs / 1000}))
      on conflict (id) do nothing
    `;
  }
  if (fresh.length) {
    const ids = fresh.map((h) => h.id);
    const have = await sql.query<{ headline_id: string }>(
      `select headline_id from tape_scores where method = 'lexicon' and headline_id = any($1)`,
      [ids],
    );
    const done = new Set(have.map((r) => r.headline_id));
    for (const h of fresh) {
      if (done.has(h.id)) continue;
      const scored = scoreHeadline(h.title);
      await sql`
        insert into tape_scores (headline_id, method, sentiment, bots)
        values (${h.id}, ${"lexicon"}, ${scored.sentiment}, ${JSON.stringify(scored.bots)})
        on conflict (headline_id, method) do nothing
      `;
    }
  }
  await sql.query(`delete from tape_headlines where published < to_timestamp($1)`, [(now - 90 * 24 * 3_600_000) / 1000]);
  await sql.query(`delete from bot_snapshots where taken_at < to_timestamp($1)`, [(now - 90 * 24 * 3_600_000) / 1000]);
  await maybeSnapshot(sql, now);
  const env = deps?.env ?? process.env;
  scheduleXai(sql, env, now);
}

export async function scorePendingXai(
  sql: Sql,
  apiKey: string,
  callModel: (prompt: string, apiKey: string) => Promise<string>,
  now = Date.now(),
): Promise<number> {
  const since = (now - 24 * 3_600_000) / 1000;
  const pending = await sql.query<{ id: string; title: string }>(
    `select h.id, h.title
     from tape_headlines h
     where h.published >= to_timestamp($1)
       and not exists (
         select 1 from tape_scores s where s.headline_id = h.id and s.method = 'xai'
       )
     order by h.published desc
     limit ${XAI_BATCH}`,
    [since],
  );
  if (!pending.length) return 0;
  const prompt = [
    "Score each financial headline's risk sentiment from -1 (risk-off) to 1 (risk-on).",
    "Use 0 only when the headline is clearly neutral. Omit any id you cannot score.",
    'Return JSON only: {"items":[{"id":"...","sentiment":0.2}]}',
    "Headlines:",
    ...pending.map((h) => `${h.id}: ${h.title}`),
  ].join("\n");
  const raw = await callModel(prompt, apiKey);
  const scored = parseXaiScores(raw);
  const wanted = new Map(pending.map((h) => [h.id, h.title]));
  let wrote = 0;
  for (const row of scored) {
    const title = wanted.get(row.id);
    if (!title) continue;
    const bots = botsFromSentiment(title, row.sentiment);
    await sql`
      insert into tape_scores (headline_id, method, sentiment, bots)
      values (${row.id}, ${"xai"}, ${row.sentiment}, ${JSON.stringify(bots)})
      on conflict (headline_id, method) do nothing
    `;
    wrote += 1;
  }
  return wrote;
}

async function maybeSnapshot(sql: Sql, now: number): Promise<void> {
  const rows = await sql.query<{ taken_at: string | Date }>(
    `select taken_at from bot_snapshots order by taken_at desc limit 1`,
  );
  const last = rows[0] ? new Date(rows[0].taken_at).getTime() : 0;
  if (Number.isFinite(last) && now - last < SNAPSHOT_MS) return;
  const scored = await loadScored(sql, now);
  const view = scoreBots(scored, now);
  const payload = JSON.stringify({ at: now, bots: view.bots, mood: view.mood });
  await sql`insert into bot_snapshots (taken_at, payload) values (to_timestamp(${now / 1000}), ${payload})`;
}

function scheduleXai(sql: Sql, env: NodeJS.ProcessEnv, now: number): void {
  const key = env.XAI_API_KEY?.trim();
  if (!key || xaiInflight || now < nextXaiAt) return;
  xaiInflight = true;
  void scorePendingXai(sql, key, callXai, now)
    .then(() => {
      nextXaiAt = Date.now() + 60_000;
    })
    .catch((err) => {
      nextXaiAt = Date.now() + 10 * 60_000;
      console.error("[briefing] model scoring skipped:", err instanceof Error ? err.message : err);
    })
    .finally(() => {
      xaiInflight = false;
    });
}

async function callXai(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

function dedupe(items: TapeItem[]): TapeItem[] {
  const seen = new Set<string>();
  const out: TapeItem[] = [];
  for (const item of items) {
    if (!item.id || !item.title || !Number.isFinite(item.publishedMs)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
