/**
 * Scheduled resolution and job health (PR #5 B06): the resolution pass runs
 * only with the cron secret, records its run, and /api/health goes 503 when a
 * job misses its schedule.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { handleHealth, handleResolutionCron, jobHealth, recordJobRun } from "./jobs.server.ts";

async function db(): Promise<Sql> {
  const pg = new PGlite();
  const dir = join(process.cwd(), "migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(dir, f), "utf8"));
  }
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + (i ? `$${i}` : "") + part, "");
    return (await pg.query(text, values)).rows;
  }) as Sql;
  sql.query = async (text: string, params?: unknown[]) => (await pg.query(text, params)).rows as never;
  return sql;
}

const T0 = Date.parse("2026-09-30T12:00:00Z");
const MIN = 60_000;

test("a job that never ran, or missed its schedule, is stale; on-schedule jobs are not", async () => {
  const sql = await db();
  let h = await jobHealth(sql, T0);
  assert.equal(h.ok, false, "nothing has run yet");
  assert.deepEqual(h.jobs.map((j) => [j.name, j.stale]), [["alerts", true], ["resolution", true]]);

  await recordJobRun(sql, "alerts", T0 - 4 * MIN, { fired: 0 });
  await recordJobRun(sql, "resolution", T0 - 50 * MIN, { checked: 0 });
  h = await jobHealth(sql, T0);
  assert.equal(h.ok, true);
  assert.deepEqual(h.jobs.find((j) => j.name === "alerts")!.summary, { fired: 0 });

  h = await jobHealth(sql, T0 + 20 * MIN);
  assert.deepEqual(h.jobs.map((j) => [j.name, j.stale, j.ageMinutes]), [["alerts", true, 24], ["resolution", false, 70]]);
  const res = await handleHealth({ sql, now: () => T0 + 20 * MIN });
  assert.equal(res.status, 503);
});

test("the resolution cron refuses without the secret, and records its run with it", async () => {
  const sql = await db();
  const prev = { secret: process.env.CRON_SECRET, xai: process.env.XAI_API_KEY };
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await handleResolutionCron(new Request("http://x/api/ledger/resolve"), { sql })).status, 503);
    process.env.CRON_SECRET = "s3cret";
    assert.equal((await handleResolutionCron(new Request("http://x/api/ledger/resolve", { headers: { authorization: "Bearer nope!!" } }), { sql })).status, 401);
    delete process.env.XAI_API_KEY;
    const ok = await handleResolutionCron(new Request("http://x/api/ledger/resolve", { headers: { authorization: "Bearer s3cret" } }), { sql, now: () => T0 });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { summary: { judgeConfigured: boolean; checked: number } };
    assert.equal(body.summary.judgeConfigured, false, "no judge key: an honest no-op, and it says so");
    assert.equal(body.summary.checked, 0);
    const h = await jobHealth(sql, T0 + MIN);
    assert.equal(h.jobs.find((j) => j.name === "resolution")!.stale, false);
  } finally {
    if (prev.secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev.secret;
    if (prev.xai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prev.xai;
  }
});
