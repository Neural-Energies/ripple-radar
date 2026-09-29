/**
 * Paid compute is spent only for an entitled account, within that account's
 * own allowance, and a cached analysis is reused only for the same account,
 * text, evidence and model (PR #5 B05). Runs the real analyze/rescore paths
 * against the real schema in PGLite, with the model call replaced by a
 * counter.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { RadarEvent } from "../../data/types.ts";
import type { Sql } from "../db.ts";
import type { LiveHeadline } from "../live/types.ts";
import { analyze, clearAnalyzeCache, type AnalyzeDeps, type ModelRequest } from "./analyze.server.ts";
import { claimCompute, isOperator, LIMITS, paidAccess } from "./compute-access.server.ts";
import { clearRescoreCache, rescore } from "../live/rescore.server.ts";
import { EMPTY_EVENT } from "./placeholder.ts";

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

const headline = (id: string, title: string, published: number, eventIds: string[] = []): LiveHeadline => ({
  id,
  title,
  source: "Wire",
  url: "",
  published,
  eventTimeMs: published,
  availableTimeMs: published,
  eventIds,
  tone: "neutral",
});

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-29T12:00:00Z");

async function grant(sql: Sql, userId: string, status = "active", end: number | null = T0 + 30 * DAY) {
  await sql`
    insert into entitlements (user_id, plan, status, current_period_end)
    values (${userId}, 'desk', ${status}, ${end == null ? null : new Date(end).toISOString()})
    on conflict (user_id) do update set status = excluded.status, current_period_end = excluded.current_period_end
  `;
}

function harness(sql: Sql, headlines: LiveHeadline[] = []) {
  const calls: ModelRequest[] = [];
  let now = T0;
  let fail = false;
  const state = { headlines };
  const deps: AnalyzeDeps = {
    sql: async () => sql,
    desk: async () => ({ headlines: state.headlines, quotes: {} }),
    callModel: async (req) => {
      calls.push(req);
      if (fail) throw new Error("HTTP 503");
      return JSON.stringify({ title: `Model book ${calls.length}`, probability: 40 });
    },
    now: () => now,
    env: { XAI_API_KEY: "test-key" },
  };
  return {
    deps,
    calls,
    state,
    advance: (ms: number) => (now += ms),
    failNext: (v: boolean) => (fail = v),
  };
}

const TEXT = "Tanker traffic through the Strait of Hormuz is disrupted after a seizure";

test("anonymous, unentitled and expired accounts never reach the paid model", async () => {
  clearAnalyzeCache();
  const sql = await db();
  const h = harness(sql);
  assert.deepEqual(await analyze(TEXT, "", h.deps), { ok: false, error: "Sign in to analyze an event." });
  const none = await analyze(TEXT, "free-user", h.deps);
  assert.ok(none.ok && none.source === "engine" && /active plan/.test(none.notice ?? ""));
  await grant(sql, "lapsed", "active", T0 - DAY);
  const expired = await analyze(TEXT, "lapsed", h.deps);
  assert.ok(expired.ok && expired.source === "engine" && /ended/.test(expired.notice ?? ""));
  await grant(sql, "cancelled", "canceled");
  assert.ok((await analyze(TEXT, "cancelled", h.deps)).ok);
  assert.equal(h.calls.length, 0, "no paid call was made for any of them");
});

test("the same prefix with a different ending is a different analysis", async () => {
  clearAnalyzeCache();
  const sql = await db();
  await grant(sql, "a");
  const h = harness(sql);
  const prefix = "x".repeat(300);
  const one = await analyze(`${prefix} escalation`, "a", h.deps);
  h.advance(LIMITS.analyze.cooldownMs);
  const two = await analyze(`${prefix} de-escalation`, "a", h.deps);
  assert.equal(h.calls.length, 2, "two model calls, no collision on the first 280 characters");
  assert.ok(one.ok && two.ok && one.event.title !== two.event.title);
});

test("new evidence makes a fresh analysis; identical evidence reuses it, per account", async () => {
  clearAnalyzeCache();
  const sql = await db();
  await grant(sql, "a");
  await grant(sql, "b");
  const h = harness(sql, [headline("h1", "Strait of Hormuz tanker seized", T0 - 1000)]);
  await analyze(TEXT, "a", h.deps);
  h.advance(LIMITS.analyze.cooldownMs);
  const reused = await analyze(TEXT, "a", h.deps);
  assert.equal(h.calls.length, 1);
  assert.ok(reused.ok && reused.cached && /reused/.test(reused.notice ?? ""));

  const other = await analyze(TEXT, "b", h.deps);
  assert.equal(h.calls.length, 2, "another account's identical text is not served from a's cache");
  assert.ok(other.ok && !other.cached);

  h.state.headlines = [...h.state.headlines, headline("h2", "Hormuz tanker insurers suspend cover", T0 + 5)];
  h.advance(LIMITS.analyze.cooldownMs);
  const fresh = await analyze(TEXT, "a", h.deps);
  assert.equal(h.calls.length, 3, "new related evidence is a new analysis");
  assert.ok(fresh.ok && !fresh.cached);

  h.advance(31 * 60_000);
  await analyze(TEXT, "a", h.deps);
  assert.equal(h.calls.length, 4, "an expired cache entry is not reused");
});

test("one account's cooldown and daily cap never touch another's", async () => {
  clearAnalyzeCache();
  const sql = await db();
  await grant(sql, "a");
  await grant(sql, "b");
  const h = harness(sql);
  await analyze(`${TEXT} one`, "a", h.deps);
  const aAgain = await analyze(`${TEXT} two`, "a", h.deps);
  assert.ok(aAgain.ok && aAgain.source === "engine" && /again in/.test(aAgain.notice ?? ""), "a is cooling down");
  const b = await analyze(`${TEXT} three`, "b", h.deps);
  assert.ok(b.ok && b.source === "model", "b is unaffected by a's cooldown");
  assert.equal(h.calls.length, 2);
});

test("the allowance is enforced in the database, so two instances share it", async () => {
  const sql = await db();
  const now = T0;
  const first = await Promise.all([claimCompute(sql, "a", "analyze", now), claimCompute(sql, "a", "analyze", now)]);
  assert.equal(first.filter((c) => c.ok).length, 1, "two simultaneous claims: exactly one wins");
  let t = now;
  let granted = 1;
  for (let i = 0; i < LIMITS.analyze.perDay + 5; i += 1) {
    t += LIMITS.analyze.cooldownMs;
    if ((await claimCompute(sql, "a", "analyze", t)).ok) granted += 1;
  }
  assert.equal(granted, LIMITS.analyze.perDay, "the daily cap holds");
  const capped = await claimCompute(sql, "a", "analyze", t + LIMITS.analyze.cooldownMs);
  assert.ok(!capped.ok && capped.reason === "daily_cap");
  assert.ok((await claimCompute(sql, "a", "analyze", Date.parse("2026-09-30T00:00:01Z") + DAY)).ok, "a new day resets it");
});

test("a failed model call is visible, and does not poison the cache", async () => {
  clearAnalyzeCache();
  const sql = await db();
  await grant(sql, "a");
  const h = harness(sql);
  h.failNext(true);
  const failed = await analyze(TEXT, "a", h.deps);
  assert.ok(failed.ok && failed.source === "engine" && /Model call failed \(HTTP 503\)/.test(failed.notice ?? ""));
  h.failNext(false);
  h.advance(LIMITS.analyze.cooldownMs);
  const ok = await analyze(TEXT, "a", h.deps);
  assert.ok(ok.ok && ok.source === "model" && !ok.cached);
});

test("operators are named explicitly; nobody else is one", async () => {
  const env = { OPERATOR_USER_IDS: " ops-1 , ops-2" };
  assert.equal(isOperator("ops-2", env), true);
  assert.equal(isOperator("user", env), false);
  assert.equal(isOperator("user", {}), false);
  const sql = await db();
  assert.deepEqual(await paidAccess(sql, "ops-1", T0, env), { ok: true, basis: "operator" });
});

test("rescore: entitled accounts only, per-account cache and allowance, visible failures", async () => {
  clearRescoreCache();
  const sql = await db();
  const book: RadarEvent = { ...EMPTY_EVENT, id: "hormuz", title: "Hormuz", probability: 50 };
  const calls: ModelRequest[] = [];
  let now = T0;
  const deps = {
    sql: async () => sql,
    desk: async () => ({ headlines: [headline("h1", "Hormuz", T0, ["hormuz"])], quotes: {}, books: {}, liveEvents: [book] }),
    callModel: async (req: ModelRequest) => {
      calls.push(req);
      return JSON.stringify({ probability: 60, takeaway: "moved" });
    },
    now: () => now,
    env: { XAI_API_KEY: "k" } as Record<string, string | undefined>,
  };
  assert.deepEqual(await rescore("hormuz", undefined, "", deps), { ok: false, error: "Sign in to rescore a book." });
  const free = await rescore("hormuz", undefined, "free", deps);
  assert.ok(!free.ok && /active plan/.test(free.error));
  await grant(sql, "a");
  await grant(sql, "b");
  assert.ok((await rescore("hormuz", undefined, "a", deps)).ok);
  const again = await rescore("hormuz", undefined, "a", deps);
  assert.ok(again.ok && /reused/.test(again.notice ?? ""), "nothing new: reused, no second call");
  assert.ok((await rescore("hormuz", undefined, "b", deps)).ok);
  assert.equal(calls.length, 2, "b's rescore is its own");
  const huge = { ...book, summary: "x".repeat(300_000) };
  assert.ok(!(await rescore("hormuz", huge, "a", deps)).ok, "oversized snapshots are refused");
  now += 1;
  deps.callModel = async () => {
    throw new Error("HTTP 500");
  };
  deps.desk = async () => ({ headlines: [headline("h9", "Hormuz reopens", T0 + 9, ["hormuz"])], quotes: {}, books: {}, liveEvents: [book] });
  now += LIMITS.rescore.cooldownMs;
  const failed = await rescore("hormuz", undefined, "a", deps);
  assert.ok(!failed.ok && /Model call failed \(HTTP 500\)/.test(failed.error));
});
