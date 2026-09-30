/**
 * Billing (PR #5 B06): purchase, renewal, cancel, expiry and refund reach
 * `entitlements` exactly once each, in the right order, and only from signed
 * deliveries; paidAccess reads the result.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { paidAccess } from "../engine/compute-access.server.ts";
import {
  applyStripeEvent,
  checkoutUrl,
  handleStripeWebhook,
  portalUrl,
  signStripePayload,
  verifyStripeSignature,
  type StripeEvent,
} from "./stripe.server.ts";

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

const T = 1_790_000_000; // seconds
const DAY = 86_400;
const noEnv = {};

const ev = (id: string, type: string, created: number, object: Record<string, unknown>): StripeEvent => ({ id, type, created, data: { object } });
const sub = (status: string, periodEnd: number, extra: Record<string, unknown> = {}) => ({
  id: "sub_1",
  customer: "cus_1",
  status,
  metadata: { user_id: "alice" },
  items: { data: [{ current_period_end: periodEnd, price: { id: "price_1", lookup_key: "pro_monthly" } }] },
  ...extra,
});

test("signatures: Stripe's scheme, within tolerance, any v1 may match", () => {
  const body = '{"id":"evt_1"}';
  const header = signStripePayload(body, "whsec_x", T);
  assert.ok(verifyStripeSignature(body, header, "whsec_x", T + 10));
  assert.ok(verifyStripeSignature(body, `${header},v1=deadbeef`, "whsec_x", T));
  assert.equal(verifyStripeSignature(body + " ", header, "whsec_x", T), false, "tampered body");
  assert.equal(verifyStripeSignature(body, header, "whsec_other", T), false, "wrong secret");
  assert.equal(verifyStripeSignature(body, header, "whsec_x", T + 301), false, "replayed after the tolerance");
  assert.equal(verifyStripeSignature(body, null, "whsec_x", T), false);
  assert.equal(verifyStripeSignature(body, "t=abc,v1=00", "whsec_x", T), false);
});

test("purchase → access; renewal extends; cancel at period end keeps access until the end, then not", async () => {
  const sql = await db();
  assert.equal((await paidAccess(sql, "alice", T * 1000, noEnv)).ok, false);
  assert.equal(await applyStripeEvent(sql, ev("evt_co", "checkout.session.completed", T, { client_reference_id: "alice", customer: "cus_1", subscription: "sub_1" })), "applied");
  assert.equal(await applyStripeEvent(sql, ev("evt_c", "customer.subscription.created", T + 1, sub("active", T + 30 * DAY))), "applied");
  assert.deepEqual(await paidAccess(sql, "alice", (T + 2) * 1000, noEnv), { ok: true, basis: "plan", plan: "pro_monthly" });

  // Renewal moves the period end.
  await applyStripeEvent(sql, ev("evt_r", "customer.subscription.updated", T + 30 * DAY, sub("active", T + 60 * DAY)));
  assert.ok((await paidAccess(sql, "alice", (T + 45 * DAY) * 1000, noEnv)).ok);

  // Cancel at period end: still active until then; past it, no access even before Stripe says deleted.
  await applyStripeEvent(sql, ev("evt_cx", "customer.subscription.updated", T + 40 * DAY, sub("active", T + 60 * DAY, { cancel_at_period_end: true })));
  assert.ok((await paidAccess(sql, "alice", (T + 59 * DAY) * 1000, noEnv)).ok);
  assert.equal((await paidAccess(sql, "alice", (T + 61 * DAY) * 1000, noEnv)).ok, false);

  await applyStripeEvent(sql, ev("evt_del", "customer.subscription.deleted", T + 60 * DAY, sub("canceled", T + 60 * DAY, { ended_at: T + 60 * DAY })));
  const access = await paidAccess(sql, "alice", (T + 60 * DAY + 5) * 1000, noEnv);
  assert.deepEqual(access, { ok: false, reason: "Plan is canceled." });
});

test("a replayed delivery is applied once, and an older event arriving late does not overwrite a newer state", async () => {
  const sql = await db();
  const created = ev("evt_a", "customer.subscription.created", T, sub("active", T + 30 * DAY));
  assert.equal(await applyStripeEvent(sql, created), "applied");
  assert.equal(await applyStripeEvent(sql, created), "duplicate");
  // Payment fails later: past_due.
  assert.equal(await applyStripeEvent(sql, ev("evt_pd", "customer.subscription.updated", T + 5 * DAY, sub("past_due", T + 30 * DAY))), "applied");
  // An earlier "active" update is delivered late.
  assert.equal(await applyStripeEvent(sql, ev("evt_old", "customer.subscription.updated", T + 2 * DAY, sub("active", T + 30 * DAY))), "stale");
  assert.deepEqual(await paidAccess(sql, "alice", (T + 6 * DAY) * 1000, noEnv), { ok: false, reason: "Plan is past_due." });
  const log = await sql<{ id: string; outcome: string }>`select id, outcome from billing_events order by id`;
  assert.deepEqual(log.map((r) => [r.id, r.outcome]), [["evt_a", "applied"], ["evt_old", "stale"], ["evt_pd", "applied"]]);
});

test("a full refund ends access now; a partial refund does not; unknown customers are recorded, not guessed", async () => {
  const sql = await db();
  await applyStripeEvent(sql, ev("evt_co", "checkout.session.completed", T, { client_reference_id: "alice", customer: "cus_1" }));
  await applyStripeEvent(sql, ev("evt_c", "customer.subscription.created", T, sub("active", T + 30 * DAY)));
  assert.equal(await applyStripeEvent(sql, ev("evt_p", "charge.refunded", T + DAY, { customer: "cus_1", amount: 25900, amount_refunded: 5000, refunded: false })), "ignored");
  assert.ok((await paidAccess(sql, "alice", (T + DAY + 1) * 1000, noEnv)).ok);
  assert.equal(await applyStripeEvent(sql, ev("evt_f", "charge.refunded", T + 2 * DAY, { customer: "cus_1", amount: 25900, amount_refunded: 25900, refunded: true })), "applied");
  assert.deepEqual(await paidAccess(sql, "alice", (T + 2 * DAY + 1) * 1000, noEnv), { ok: false, reason: "Plan is refunded." });
  assert.equal(await applyStripeEvent(sql, ev("evt_u", "charge.refunded", T, { customer: "cus_nobody", refunded: true })), "unmatched");
  // A subscription whose customer is known only from checkout maps back without metadata.
  const sql2 = await db();
  await applyStripeEvent(sql2, ev("evt_co", "checkout.session.completed", T, { client_reference_id: "bob", customer: "cus_b" }));
  assert.equal(await applyStripeEvent(sql2, ev("evt_s", "customer.subscription.created", T, { ...sub("trialing", T + 14 * DAY), customer: "cus_b", metadata: {} })), "applied");
  assert.ok((await paidAccess(sql2, "bob", (T + 1) * 1000, noEnv)).ok);
});

test("the webhook route: unconfigured 503, unsigned 400, signed and applied 200", async () => {
  const sql = await db();
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const body = JSON.stringify(ev("evt_w", "customer.subscription.created", T, sub("active", T + 30 * DAY)));
    const req = (headers: Record<string, string>) => new Request("http://x/api/billing/webhook", { method: "POST", body, headers });
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await handleStripeWebhook(req({}), { sql, nowS: T })).status, 503);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    assert.equal((await handleStripeWebhook(req({ "stripe-signature": "t=1,v1=00" }), { sql, nowS: T })).status, 400);
    const ok = await handleStripeWebhook(req({ "stripe-signature": signStripePayload(body, "whsec_x", T) }), { sql, nowS: T });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, outcome: "applied" });
    const again = await handleStripeWebhook(req({ "stripe-signature": signStripePayload(body, "whsec_x", T) }), { sql, nowS: T });
    assert.deepEqual(await again.json(), { ok: true, outcome: "duplicate" });
  } finally {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  }
});

test("checkout carries the account id to the subscription; the portal needs a billing account", async () => {
  const sql = await db();
  const env = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_ID: "price_1", STRIPE_WEBHOOK_SECRET: "whsec_x" };
  let sent: { url: string; body: URLSearchParams; auth: string | null } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent = { url, body: new URLSearchParams(String(init.body)), auth: new Headers(init.headers).get("authorization") };
    return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_1" }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await checkoutUrl(sql, "alice", "https://ripple.example", { env, fetchImpl }), "https://checkout.stripe.com/c/pay/cs_1");
  assert.equal(sent!.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(sent!.auth, "Bearer sk_test_x");
  assert.equal(sent!.body.get("client_reference_id"), "alice");
  assert.equal(sent!.body.get("subscription_data[metadata][user_id]"), "alice");
  assert.equal(sent!.body.get("line_items[0][price]"), "price_1");
  assert.equal(sent!.body.get("mode"), "subscription");
  await assert.rejects(portalUrl(sql, "alice", "https://ripple.example", { env, fetchImpl }), /No billing account/);
  await assert.rejects(checkoutUrl(sql, "alice", "https://ripple.example", { env: {}, fetchImpl }), /not configured/);
  const failing = (async () => new Response(JSON.stringify({ error: { message: "No such price" } }), { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(checkoutUrl(sql, "alice", "https://ripple.example", { env, fetchImpl: failing }), /No such price/);
});
