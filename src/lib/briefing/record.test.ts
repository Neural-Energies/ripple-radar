/**
 * Stored tape: lexicon rows land once, a model score wins when it exists,
 * and a snapshot is not written on every poll.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { scoreBots } from "./assemble.ts";
import { loadScored } from "./read.server.ts";
import { recordTape, scorePendingXai } from "./record.server.ts";

const MIGRATIONS = join(process.cwd(), "migrations");
const NOW = Date.parse("2026-10-16T14:00:00Z");

async function freshDb(): Promise<Sql> {
  const pg = new PGlite();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + (i ? `$${i}` : "") + part, "");
    return (await pg.query(text, values)).rows;
  }) as Sql;
  sql.query = async (text: string, params?: unknown[]) => (await pg.query(text, params)).rows as never;
  return sql;
}

test("recording scores a headline once and prefers a later model score", async () => {
  const sql = await freshDb();
  const item = {
    id: "h1",
    title: "Chip stocks plunge on earnings",
    source: "MarketWatch",
    url: "https://example.test/h1",
    publishedMs: NOW - 3_600_000,
  };
  await recordTape([item, item], { sql, now: NOW, env: {} });
  await recordTape([item], { sql, now: NOW, env: {} });
  const lexicon = await sql.query<{ n: number | string }>(
    `select count(*) as n from tape_scores where method = 'lexicon'`,
  );
  assert.equal(Number(lexicon[0]?.n), 1);
  const wrote = await scorePendingXai(
    sql,
    "test-key",
    async () => JSON.stringify({ items: [{ id: "h1", sentiment: -0.8 }] }),
    NOW,
  );
  assert.equal(wrote, 1);
  const scored = await loadScored(sql, NOW);
  assert.equal(scored.length, 1);
  assert.equal(scored[0]?.method, "xai");
  assert.ok((scored[0]?.bots.equities ?? 0) < 0);
  const view = scoreBots(scored, NOW);
  assert.ok((view.bots.find((b) => b.id === "equities")?.today.score ?? 0) < 0);
});

test("snapshots are at least 15 minutes apart and old headlines age out", async () => {
  const sql = await freshDb();
  await recordTape(
    [{ id: "old", title: "stocks plunge", source: "BBC Business", url: "", publishedMs: NOW - 100 * 24 * 3_600_000 }],
    { sql, now: NOW, env: {} },
  );
  const left = await sql.query<{ n: number | string }>(`select count(*) as n from tape_headlines`);
  assert.equal(Number(left[0]?.n), 0);
  await recordTape(
    [{ id: "new", title: "Bitcoin rallies", source: "CoinDesk", url: "", publishedMs: NOW }],
    { sql, now: NOW, env: {} },
  );
  await recordTape(
    [{ id: "newer", title: "Bitcoin rallies again", source: "CoinDesk", url: "", publishedMs: NOW }],
    { sql, now: NOW + 60_000, env: {} },
  );
  const snaps = await sql.query<{ n: number | string }>(`select count(*) as n from bot_snapshots`);
  assert.equal(Number(snaps[0]?.n), 1);
});
