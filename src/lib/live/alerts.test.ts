/**
 * Alerts watch exactly what they were bound to, in one unit, and are
 * delivered once per firing by a pass that does not need a browser
 * (PR #5 B02). The server tests run the real pass against the real schema in
 * PGLite.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { AlertRule, DeskBook, RadarEvent, Scenario } from "../../data/types.ts";
import { EMPTY_DESK } from "../desk-model.ts";
import { EMPTY_EVENT } from "../engine/placeholder.ts";
import type { Sql } from "../db.ts";
import { evaluateRule, stepRule, validateRule, worldFromDesk, type RuleState } from "./alerts.ts";
import { cronAuthorized } from "./alerts-cron.server.ts";
import { ackFor, checkWebhookUrl, inboxFor, MAX_ATTEMPTS, runAlertPass } from "./alerts.server.ts";
import type { LiveDesk, LiveQuote } from "./types.ts";

const sc = (id: string, probability: number, prev = probability): Scenario => ({
  id,
  name: id,
  detail: "",
  probability,
  prevProbability: prev,
  range: "",
  keyOutcomes: "",
  audit: { previous: prev, updated: probability, evidence: "", direction: "up", weight: 0, affectedNodes: [], rescoredAssets: [] },
});

const event = (id: string, probability: number, scenarios: Scenario[] = []): RadarEvent => ({ ...EMPTY_EVENT, id, title: `Book ${id}`, probability, scenarios });

const quote = (ticker: string, last: number, changePct: number, state: LiveQuote["state"] = "live"): LiveQuote => ({
  ticker,
  last,
  prevClose: last / (1 + changePct / 100),
  change: 0,
  changePct,
  spark: [],
  state,
  asOf: 0,
  eventTimeMs: 0,
  availableTimeMs: 0,
  exchange: "",
});

function desk(events: RadarEvent[], quotes: LiveQuote[] = []): LiveDesk {
  return {
    asOf: 0,
    asOfLabel: "",
    status: "live",
    statusDetail: "",
    sessions: { ny: true, london: true, tokyo: true, futures: true },
    quotes: Object.fromEntries(quotes.map((q) => [q.ticker, q])),
    headlines: [],
    clusters: [],
    books: {},
    liveEvents: events,
    quoteLive: quotes.length,
    quoteCount: quotes.length,
  };
}

const rule = (over: Partial<AlertRule>): AlertRule => ({ id: "r1", title: "r1", detail: "", kind: "probability", active: true, created: "", ...over });

// --------------------------------------------------------------- binding --

test("a rule whose book left the desk is suspended; it never fires on another book", () => {
  const r = rule({ metric: "book_probability", operator: "above", threshold: 80, eventId: "deleted-book", targetLabel: "Old book" });
  const e = evaluateRule(r, worldFromDesk(desk([event("other", 90)])));
  assert.equal(e.status, "suspended");
  assert.match(e.reason, /Old book is no longer on the desk/);
  assert.equal(stepRule(null, e, 1).fired, false);
});

test("a scenario rule watches its own scenario, and is suspended if the book drops it", () => {
  const r = rule({ metric: "scenario_probability", operator: "above", threshold: 40, eventId: "b", scenarioId: "esc" });
  const w = worldFromDesk(desk([event("b", 50, [sc("esc", 45), sc("base", 90)])]));
  const e = evaluateRule(r, w);
  assert.ok(e.status === "ok" && e.satisfied && e.value === 45);
  const gone = evaluateRule(r, worldFromDesk(desk([event("b", 50, [sc("base", 90)])])));
  assert.equal(gone.status, "suspended");
  const move = evaluateRule(rule({ metric: "scenario_move", operator: "above", threshold: 5, eventId: "b", scenarioId: "esc" }), worldFromDesk(desk([event("b", 50, [sc("esc", 30, 41)])])));
  assert.ok(move.status === "ok" && move.value === 11 && move.satisfied);
});

test("the account's own desk books are targets; another account's are not", () => {
  const own: DeskBook = { id: "desk-1", title: "Mine", region: "", note: "", created: "", payload: event("desk-1", 70) };
  const r = rule({ metric: "book_probability", operator: "above", threshold: 60, eventId: "desk-1" });
  assert.equal(evaluateRule(r, worldFromDesk(desk([]), [own])).status, "ok");
  assert.equal(evaluateRule(r, worldFromDesk(desk([]), [])).status, "suspended");
});

// ----------------------------------------------------------------- units --

test("last price, signed percent and absolute percent are separate units", () => {
  const w = worldFromDesk(desk([], [quote("XLE", 101, -3)]));
  const last = evaluateRule(rule({ metric: "price_last", operator: "above", threshold: 100, ticker: "XLE" }), w);
  assert.ok(last.status === "ok" && last.satisfied, "101 is above 100");
  const signed = evaluateRule(rule({ metric: "price_change_pct", operator: "above", threshold: 2, ticker: "XLE" }), w);
  assert.ok(signed.status === "ok" && !signed.satisfied, "a −3% move cannot satisfy a +2% rule");
  const down = evaluateRule(rule({ metric: "price_change_pct", operator: "below", threshold: -2, ticker: "XLE" }), w);
  assert.ok(down.status === "ok" && down.satisfied);
  const abs = evaluateRule(rule({ metric: "price_abs_change_pct", operator: "above", threshold: 2, ticker: "XLE" }), w);
  assert.ok(abs.status === "ok" && abs.satisfied && abs.value === 3);
});

test("thresholds follow an explicit contract: zero, NaN and out-of-range are refused", () => {
  const ok = { metric: "price_last" as const, operator: "above" as const, ticker: "XLE" };
  assert.deepEqual(validateRule({ ...ok, threshold: 100 }), []);
  assert.ok(validateRule({ ...ok, threshold: 0 }).length);
  assert.ok(validateRule({ ...ok, threshold: Number.NaN }).length);
  assert.ok(validateRule({ ...ok, threshold: Number.POSITIVE_INFINITY }).length);
  assert.ok(validateRule({ metric: "price_change_pct", operator: "above", ticker: "XLE", threshold: 0 }).length);
  assert.ok(validateRule({ metric: "book_probability", operator: "above", eventId: "b", threshold: 100 }).length);
  assert.ok(validateRule({ metric: "book_probability", operator: "above", threshold: 50 }).length, "a book metric needs a book");
  assert.ok(validateRule({ metric: "scenario_probability", operator: "above", eventId: "b", threshold: 50 }).length, "and a scenario");
  assert.ok(validateRule({ metric: "scenario_move", operator: "below", eventId: "b", scenarioId: "s", threshold: 5 }).length);
  assert.ok(validateRule({ metric: "book_evidence", operator: "above", eventId: "b", threshold: 2.5 }).length);
  assert.ok(validateRule({ ...ok, ticker: "not a ticker", threshold: 100 }).length);
});

test("a missing or stale quote is no reading, not evidence, and an outage does not start a new episode", () => {
  const r = rule({ metric: "price_last", operator: "above", threshold: 100, ticker: "XLE" });
  assert.equal(evaluateRule(r, worldFromDesk(desk([]))).status, "unavailable");
  const stale = evaluateRule(r, worldFromDesk(desk([], [quote("XLE", 150, 0, "stale")])));
  assert.equal(stale.status, "unavailable");

  const met = evaluateRule(r, worldFromDesk(desk([], [quote("XLE", 101, 0)])));
  const first = stepRule(null, met, 1);
  assert.equal(first.fired, true);
  const outage = stepRule(first.next, stale, 2);
  assert.equal(outage.fired, false);
  assert.deepEqual(outage.next, first.next, "the episode is held through the outage");
  assert.equal(stepRule(outage.next, met, 3).fired, false, "and not re-fired when the quote returns");
});

test("a rule fires once per episode and re-arms only after it has been false", () => {
  const r = rule({ metric: "price_last", operator: "above", threshold: 100, ticker: "XLE" });
  const at = (p: number) => evaluateRule(r, worldFromDesk(desk([], [quote("XLE", p, 0)])));
  let s: RuleState | null = null;
  const fired: number[] = [];
  [99, 101, 102, 103, 98, 104].forEach((p, i) => {
    const out = stepRule(s, at(p), i);
    s = out.next;
    if (out.fired) fired.push(p);
  });
  assert.deepEqual(fired, [101, 104]);
});

test("rules without a structured target, and paused rules, never evaluate", () => {
  const w = worldFromDesk(desk([event("b", 90)]));
  assert.equal(evaluateRule(rule({ title: "Lead book probability ≥ 70%", threshold: 70 }), w).status, "inactive");
  assert.equal(evaluateRule(rule({ metric: "book_probability", operator: "above", threshold: 70, eventId: "b", active: false }), w).status, "inactive");
});

// ---------------------------------------------------------------- server --

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

async function saveRules(sql: Sql, userId: string, alerts: AlertRule[], deskBooks: DeskBook[] = []) {
  const payload = JSON.stringify({ ...EMPTY_DESK, alerts, deskBooks });
  await sql`
    insert into desk_state (user_id, payload, version) values (${userId}, ${payload}, 1)
    on conflict (user_id) do update set payload = excluded.payload
  `;
}

const priceRule = rule({ id: "px", title: "XLE over 100", metric: "price_last", operator: "above", threshold: 100, ticker: "XLE" });
const noSend = async () => ({ ok: true, status: 200 });

test("the server pass records a firing once, across repeated passes and a restart", async () => {
  const sql = await db();
  await saveRules(sql, "alice", [priceRule]);
  const high = desk([], [quote("XLE", 101, 0)]);
  const s1 = await runAlertPass(sql, high, { now: () => 1_000, fetch: noSend });
  assert.equal(s1.fired, 1);
  // A second pass, and a "restarted" process (no in-memory state at all), both see it already fired.
  assert.equal((await runAlertPass(sql, high, { now: () => 2_000, fetch: noSend })).fired, 0);
  assert.equal((await runAlertPass(sql, high, { now: () => 3_000, fetch: noSend })).fired, 0);
  let inbox = await inboxFor(sql, "alice");
  assert.equal(inbox.deliveries.length, 1);
  assert.equal(inbox.deliveries[0]!.status, "pending");
  // False, then true again: a new episode, a second delivery.
  await runAlertPass(sql, desk([], [quote("XLE", 99, 0)]), { now: () => 4_000, fetch: noSend });
  assert.equal((await runAlertPass(sql, high, { now: () => 5_000, fetch: noSend })).fired, 1);
  inbox = await inboxFor(sql, "alice");
  assert.equal(inbox.deliveries.length, 2);
  assert.ok(inbox.lastPassAt);
});

test("two overlapping passes deliver a firing exactly once", async () => {
  const sql = await db();
  await saveRules(sql, "alice", [priceRule]);
  const high = desk([], [quote("XLE", 101, 0)]);
  const [a, b] = await Promise.all([
    runAlertPass(sql, high, { now: () => 1_000, fetch: noSend }),
    runAlertPass(sql, high, { now: () => 1_001, fetch: noSend }),
  ]);
  assert.equal(a.fired + b.fired, 1);
  assert.equal((await inboxFor(sql, "alice")).deliveries.length, 1);
});

test("webhook delivery retries with backoff, sends one idempotency key per firing, and gives up visibly", async () => {
  const sql = await db();
  await saveRules(sql, "alice", [priceRule]);
  await sql`insert into alert_channels (user_id, webhook_url) values ('alice', 'https://hooks.example.com/x')`;
  const high = desk([], [quote("XLE", 101, 0)]);
  const keys: string[] = [];
  let up = false;
  const send = async (_url: string, init: RequestInit) => {
    keys.push(String((init.headers as Record<string, string>)["idempotency-key"]));
    return up ? { ok: true, status: 200 } : { ok: false, status: 503 };
  };
  const first = await runAlertPass(sql, high, { now: () => 0, fetch: send });
  assert.deepEqual(first.webhooks, { delivered: 0, retrying: 1, failed: 0 });
  // Inside the backoff window nothing is resent.
  assert.equal((await runAlertPass(sql, high, { now: () => 30_000, fetch: send })).webhooks.retrying, 0);
  up = true;
  const second = await runAlertPass(sql, high, { now: () => 61_000, fetch: send });
  assert.deepEqual(second.webhooks, { delivered: 1, retrying: 0, failed: 0 });
  assert.equal(new Set(keys).size, 1, "every attempt carries the same episode key");
  assert.equal((await runAlertPass(sql, high, { now: () => 999_000, fetch: send })).webhooks.delivered, 0, "delivered once");

  // A receiver that never comes back is marked failed after MAX_ATTEMPTS, with the error kept.
  await saveRules(sql, "bob", [priceRule]);
  await sql`insert into alert_channels (user_id, webhook_url) values ('bob', 'https://hooks.example.com/y')`;
  const down = async () => ({ ok: false, status: 500 });
  let t = 2_000_000;
  for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
    await runAlertPass(sql, high, { now: () => t, fetch: down });
    t += 2 * 3_600_000;
  }
  const bob = (await inboxFor(sql, "bob")).deliveries.find((d) => d.channel === "webhook")!;
  assert.equal(bob.status, "failed");
  assert.equal(bob.attempts, MAX_ATTEMPTS);
  assert.equal(bob.lastError, "HTTP 500");
});

test("accounts are isolated: rules see only their own desk books, and inboxes are per account", async () => {
  const sql = await db();
  const book: DeskBook = { id: "desk-a", title: "A's book", region: "", note: "", created: "", payload: event("desk-a", 80) };
  const r = rule({ id: "prob", metric: "book_probability", operator: "above", threshold: 50, eventId: "desk-a" });
  await saveRules(sql, "alice", [r], [book]);
  await saveRules(sql, "bob", [r]); // bob's rule names alice's private book
  const s = await runAlertPass(sql, desk([]), { now: () => 1, fetch: noSend });
  assert.equal(s.fired, 1);
  assert.equal(s.suspended, 1);
  assert.equal((await inboxFor(sql, "alice")).deliveries.length, 1);
  assert.equal((await inboxFor(sql, "bob")).deliveries.length, 0);
  const id = (await inboxFor(sql, "alice")).deliveries[0]!.id;
  assert.equal(await ackFor(sql, "bob", [id]), 0, "bob cannot acknowledge alice's alert");
  assert.equal(await ackFor(sql, "alice", [id]), 1);
  assert.equal((await inboxFor(sql, "alice")).deliveries[0]!.status, "delivered");
});

test("the scheduled pass refuses without the configured secret", () => {
  assert.equal(cronAuthorized("Bearer s3cret", undefined), false, "no secret configured: closed");
  assert.equal(cronAuthorized(null, "s3cret"), false);
  assert.equal(cronAuthorized("Bearer wrong!", "s3cret"), false);
  assert.equal(cronAuthorized("Bearer s3cret", "s3cret"), true);
});

test("webhook URLs: https host names only", () => {
  assert.ok(checkWebhookUrl("https://hooks.slack.com/services/x").ok);
  for (const bad of ["http://hooks.example.com", "https://127.0.0.1/x", "https://localhost/x", "https://[::1]/x", "https://db.internal/x", "https://a:b@hooks.example.com", "https://hooks.example.com:8443/x", "nope"]) {
    assert.equal(checkWebhookUrl(bad).ok, false, bad);
  }
});
