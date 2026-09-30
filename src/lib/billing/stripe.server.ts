/**
 * Stripe billing → `entitlements` (PR #5 B06 "buy, use and cancel").
 *
 * Checkout carries the account id (`client_reference_id` and the
 * subscription's `metadata.user_id`), so every later event maps back to an
 * account. The webhook verifies Stripe's signature, applies each event id at
 * most once (`billing_events`), and never lets an older event overwrite a
 * newer state (`entitlements.source_event_at`). paidAccess reads the row:
 * active or trialing with an unexpired period.
 *
 * No SDK: two form-encoded REST calls and one HMAC. Unconfigured
 * (no STRIPE_SECRET_KEY / STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET) means
 * checkout is refused and the webhook answers 503.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Sql } from "@/lib/db";

const API = "https://api.stripe.com/v1/";
/** Seconds a signed delivery stays valid (Stripe's own default). */
export const SIGNATURE_TOLERANCE_S = 300;

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

// ---------------------------------------------------------------- signature --

/** Verify a `Stripe-Signature` header against the raw body. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** A header for `payload`, as Stripe would sign it (tests and local replay). */
export function signStripePayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

// ------------------------------------------------------------------ events --

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function accountFor(sql: Sql, metadataUser: string | null, customer: string | null): Promise<string | null> {
  if (metadataUser) return metadataUser;
  if (!customer) return null;
  const rows = await sql<{ user_id: string }>`select user_id from billing_customers where customer_id = ${customer} limit 1`;
  return rows[0]?.user_id ?? null;
}

async function linkCustomer(sql: Sql, userId: string, customer: string) {
  await sql`
    insert into billing_customers (user_id, customer_id) values (${userId}, ${customer})
    on conflict (user_id) do update set customer_id = excluded.customer_id
  `;
}

async function writeEntitlement(sql: Sql, userId: string, plan: string, status: string, periodEndS: number | null, eventCreatedS: number) {
  const periodEnd = periodEndS != null ? new Date(periodEndS * 1000).toISOString() : null;
  const at = new Date(eventCreatedS * 1000).toISOString();
  const rows = await sql<{ user_id: string }>`
    insert into entitlements (user_id, plan, status, current_period_end, source, updated_at, source_event_at)
    values (${userId}, ${plan}, ${status}, ${periodEnd}, 'stripe', now(), ${at})
    on conflict (user_id) do update set
      plan = excluded.plan, status = excluded.status, current_period_end = excluded.current_period_end,
      source = excluded.source, updated_at = excluded.updated_at, source_event_at = excluded.source_event_at
      where entitlements.source_event_at is null or entitlements.source_event_at <= excluded.source_event_at
    returning user_id
  `;
  return rows.length > 0;
}

/** The subscription's period end: top level on older API versions, per item since 2025-03. */
function periodEnd(sub: Record<string, unknown>): number | null {
  const top = num(sub.current_period_end);
  if (top != null) return top;
  const items = (sub.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [];
  const ends = items.map((i) => num(i.current_period_end)).filter((n): n is number => n != null);
  return ends.length ? Math.max(...ends) : null;
}

function planOf(sub: Record<string, unknown>): string {
  const price = ((sub.items as { data?: { price?: Record<string, unknown> }[] } | undefined)?.data ?? [])[0]?.price;
  return str(price?.lookup_key) ?? str(price?.nickname) ?? "pro";
}

export type Outcome = "applied" | "stale" | "duplicate" | "unmatched" | "ignored";

/** Apply one verified event. Safe to call again with the same event. */
export async function applyStripeEvent(sql: Sql, event: StripeEvent): Promise<Outcome> {
  const seen = await sql<{ id: string }>`select id from billing_events where id = ${event.id} limit 1`;
  if (seen.length) return "duplicate";
  const o = event.data?.object ?? {};
  let outcome: Outcome = "ignored";
  switch (event.type) {
    case "checkout.session.completed": {
      const userId = str(o.client_reference_id);
      const customer = str(o.customer);
      if (userId && customer) {
        await linkCustomer(sql, userId, customer);
        outcome = "applied";
      } else outcome = "unmatched";
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const meta = (o.metadata as Record<string, unknown> | undefined) ?? {};
      const customer = str(o.customer);
      const userId = await accountFor(sql, str(meta.user_id), customer);
      if (!userId) {
        outcome = "unmatched";
        break;
      }
      if (customer) await linkCustomer(sql, userId, customer);
      const deleted = event.type === "customer.subscription.deleted";
      const status = deleted ? "canceled" : (str(o.status) ?? "incomplete");
      // A deleted subscription's access ends when it ended, not at the old period end.
      const end = deleted ? (num(o.ended_at) ?? event.created) : periodEnd(o);
      outcome = (await writeEntitlement(sql, userId, planOf(o), status, end, event.created)) ? "applied" : "stale";
      break;
    }
    case "charge.refunded": {
      // A full refund ends access now; a partial refund (a credit) does not.
      const userId = await accountFor(sql, null, str(o.customer));
      if (!userId) {
        outcome = "unmatched";
        break;
      }
      const full = o.refunded === true || (num(o.amount) != null && num(o.amount_refunded) === num(o.amount));
      if (!full) break;
      const rows = await sql<{ plan: string }>`select plan from entitlements where user_id = ${userId} limit 1`;
      outcome = (await writeEntitlement(sql, userId, rows[0]?.plan ?? "pro", "refunded", event.created, event.created)) ? "applied" : "stale";
      break;
    }
  }
  await sql`
    insert into billing_events (id, type, outcome) values (${event.id}, ${event.type}, ${outcome})
    on conflict (id) do nothing
  `;
  return outcome;
}

export async function handleStripeWebhook(request: Request, deps: { sql?: Sql; nowS?: number } = {}): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ ok: false, error: "STRIPE_WEBHOOK_SECRET is not configured" }, { status: 503 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret, deps.nowS)) {
    return Response.json({ ok: false, error: "bad signature" }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return Response.json({ ok: false, error: "bad payload" }, { status: 400 });
  }
  if (!event?.id || !event.type || !Number.isFinite(event.created)) return Response.json({ ok: false, error: "bad event" }, { status: 400 });
  const sql = deps.sql ?? (await (await import("@/lib/db")).getSql());
  // A throw here answers 500, so Stripe retries; the event is recorded only once applied.
  const outcome = await applyStripeEvent(sql, event);
  return Response.json({ ok: true, outcome });
}

// --------------------------------------------------------- checkout/portal --

export function billingConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID && env.STRIPE_WEBHOOK_SECRET);
}

async function stripePost(path: string, form: Record<string, string>, key: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(API + path, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!res.ok || !json.url) throw new Error(json.error?.message ?? `Stripe ${res.status}`);
  return json.url;
}

export async function customerOf(sql: Sql, userId: string) {
  const rows = await sql<{ customer_id: string }>`select customer_id from billing_customers where user_id = ${userId} limit 1`;
  return rows[0]?.customer_id ?? null;
}

/** A Checkout Session URL for this account's subscription. */
export async function checkoutUrl(sql: Sql, userId: string, origin: string, deps: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}) {
  const env = deps.env ?? process.env;
  if (!billingConfigured(env)) throw new Error("Billing is not configured.");
  const customer = await customerOf(sql, userId);
  const form: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": env.STRIPE_PRICE_ID!,
    "line_items[0][quantity]": "1",
    client_reference_id: userId,
    "subscription_data[metadata][user_id]": userId,
    success_url: `${origin}/brief?billing=done`,
    cancel_url: `${origin}/brief`,
  };
  if (customer) form.customer = customer;
  return stripePost("checkout/sessions", form, env.STRIPE_SECRET_KEY!, deps.fetchImpl);
}

/** A Customer Portal URL, where the account updates payment, cancels or resumes. */
export async function portalUrl(sql: Sql, userId: string, origin: string, deps: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}) {
  const env = deps.env ?? process.env;
  if (!billingConfigured(env)) throw new Error("Billing is not configured.");
  const customer = await customerOf(sql, userId);
  if (!customer) throw new Error("No billing account yet.");
  return stripePost("billing_portal/sessions", { customer, return_url: `${origin}/brief` }, env.STRIPE_SECRET_KEY!, deps.fetchImpl);
}
