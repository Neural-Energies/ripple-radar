/**
 * The durable alert pass (PR #5 B02): evaluate every account's rules against
 * the tape, record firings, deliver them, retry failures.
 *
 * Runs from the scheduled route (/api/alerts/run), so monitoring continues
 * with every browser closed. Rules are read from each account's saved desk;
 * each account's rules only ever see the tape plus that account's own books.
 *
 * Delivery is at-most-once per firing per channel: a firing is claimed by a
 * conditional state transition, and its delivery rows are unique on the
 * episode. Channels:
 *   inbox    always. Shown on the account's next visit from any device, then
 *            acknowledged.
 *   webhook  optional HTTPS endpoint per account, POSTed with an
 *            Idempotency-Key, retried with backoff, marked failed after
 *            MAX_ATTEMPTS.
 */
import type { AlertRule, DeskBook } from "@/data/types";
import type { Sql } from "@/lib/db";
import { normalizeDesk } from "@/lib/desk-model";
import { episodeKey, evaluateRule, stepRule, worldFromDesk, type AlertWorld, type Evaluation, type RuleState } from "./alerts";
import type { LiveDesk } from "./types";

export const MAX_ATTEMPTS = 5;
/** Minutes to wait after the n-th failed attempt. */
export const BACKOFF_MIN = [1, 5, 15, 60];
const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_BATCH = 50;

export interface AlertPassDeps {
  now?: () => number;
  fetch?: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
}

export interface AlertPassSummary {
  at: string;
  accounts: number;
  rules: number;
  fired: number;
  suspended: number;
  unavailable: number;
  webhooks: { delivered: number; retrying: number; failed: number };
}

/**
 * A webhook URL this server will call. HTTPS only, default port, and never a
 * literal IP or an internal host name — the server must not be steered into
 * its own network. (DNS that resolves a public name to a private address is
 * not caught here.)
 */
export function checkWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Not a URL." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Webhooks must use https." };
  if (u.port && u.port !== "443") return { ok: false, error: "Webhooks must use the default https port." };
  if (u.username || u.password) return { ok: false, error: "Credentials in the URL are not accepted." };
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return { ok: false, error: "Use a host name, not an IP address." };
  if (host === "localhost" || !host.includes(".") || /\.(local|internal|localhost|lan|home|corp)$/.test(host)) {
    return { ok: false, error: "Internal host names are not accepted." };
  }
  if (u.href.length > 2048) return { ok: false, error: "URL too long." };
  return { ok: true, url: u.href };
}

function parseDesk(payload: string): { alerts: AlertRule[]; deskBooks: DeskBook[] } | null {
  try {
    const d = normalizeDesk(JSON.parse(payload));
    return { alerts: d.alerts ?? [], deskBooks: d.deskBooks ?? [] };
  } catch {
    return null;
  }
}

function withBooks(base: AlertWorld, desk: LiveDesk, deskBooks: DeskBook[]): AlertWorld {
  if (!deskBooks.length) return base;
  // The account's own books, built the way the desk builds them; the tape's
  // books are shared and computed once.
  const own = worldFromDesk({ ...desk, liveEvents: [] }, deskBooks);
  return { books: { ...base.books, ...own.books }, quotes: base.quotes };
}

async function recordState(sql: Sql, userId: string, ruleId: string, next: RuleState, e: Evaluation, now: number) {
  const value = e.status === "ok" ? e.value : null;
  await sql`
    insert into alert_state (user_id, rule_id, satisfied, since_ms, status, reason, value, evaluated_at)
    values (${userId}, ${ruleId}, ${next.satisfied}, ${next.since}, ${e.status}, ${e.reason}, ${value}, ${new Date(now).toISOString()})
    on conflict (user_id, rule_id) do update set
      satisfied = excluded.satisfied, since_ms = excluded.since_ms, status = excluded.status,
      reason = excluded.reason, value = excluded.value, evaluated_at = excluded.evaluated_at
  `;
}

/** Claim the transition into "satisfied". Only one pass can win it. */
async function claimFiring(sql: Sql, userId: string, ruleId: string, since: number, e: Evaluation & { status: "ok" }): Promise<boolean> {
  const rows = await sql<{ since_ms: number }>`
    insert into alert_state (user_id, rule_id, satisfied, since_ms, status, reason, value, evaluated_at)
    values (${userId}, ${ruleId}, true, ${since}, 'ok', ${e.reason}, ${e.value}, ${new Date(since).toISOString()})
    on conflict (user_id, rule_id) do update set
      satisfied = true, since_ms = excluded.since_ms, status = 'ok',
      reason = excluded.reason, value = excluded.value, evaluated_at = excluded.evaluated_at
      where alert_state.satisfied = false
    returning since_ms
  `;
  return rows.length > 0;
}

export async function runAlertPass(sql: Sql, desk: LiveDesk, deps: AlertPassDeps = {}): Promise<AlertPassSummary> {
  const now = (deps.now ?? Date.now)();
  const summary: AlertPassSummary = {
    at: new Date(now).toISOString(),
    accounts: 0,
    rules: 0,
    fired: 0,
    suspended: 0,
    unavailable: 0,
    webhooks: { delivered: 0, retrying: 0, failed: 0 },
  };
  const tape = worldFromDesk(desk, []);
  const accounts = await sql<{ user_id: string; payload: string }>`select user_id, payload from desk_state`;
  const channels = new Map(
    (await sql<{ user_id: string; webhook_url: string | null }>`select user_id, webhook_url from alert_channels`).map((r) => [r.user_id, r.webhook_url]),
  );

  for (const account of accounts) {
    const parsed = parseDesk(account.payload);
    if (!parsed) continue;
    const rules = parsed.alerts.filter((a) => a.metric);
    summary.accounts += 1;
    const world = withBooks(tape, desk, parsed.deskBooks);
    const prior = new Map(
      (
        await sql<{ rule_id: string; satisfied: boolean; since_ms: number | null }>`
          select rule_id, satisfied, since_ms from alert_state where user_id = ${account.user_id}
        `
      ).map((r) => [r.rule_id, { satisfied: !!r.satisfied, since: r.since_ms == null ? null : Number(r.since_ms) }]),
    );

    for (const rule of rules) {
      summary.rules += 1;
      const e = evaluateRule(rule, world);
      if (e.status === "suspended") summary.suspended += 1;
      if (e.status === "unavailable") summary.unavailable += 1;
      const { next, fired } = stepRule(prior.get(rule.id) ?? null, e, now);
      if (fired && e.status === "ok") {
        if (!(await claimFiring(sql, account.user_id, rule.id, next.since!, e))) continue;
        summary.fired += 1;
        const episode = episodeKey(rule.id, next.since!);
        const title = rule.title || rule.id;
        const at = new Date(now).toISOString();
        const targets = channels.get(account.user_id) ? ["inbox", "webhook"] : ["inbox"];
        for (const channel of targets) {
          await sql`
            insert into alert_deliveries (user_id, rule_id, episode, channel, title, reason, value, fired_at, next_attempt_at)
            values (${account.user_id}, ${rule.id}, ${episode}, ${channel}, ${title}, ${e.reason}, ${e.value}, ${at}, ${at})
            on conflict (user_id, rule_id, episode, channel) do nothing
          `;
        }
      } else {
        await recordState(sql, account.user_id, rule.id, next, e, now);
      }
    }

    // Rules that were deleted or lost their structure stop being tracked.
    const live = new Set(rules.map((r) => r.id));
    for (const id of prior.keys()) {
      if (!live.has(id)) await sql`delete from alert_state where user_id = ${account.user_id} and rule_id = ${id}`;
    }
  }

  summary.webhooks = await deliverWebhooks(sql, now, deps.fetch ?? defaultFetch);
  await sql`
    insert into job_runs (name, last_run_at, summary) values ('alerts', ${summary.at}, ${JSON.stringify(summary)})
    on conflict (name) do update set last_run_at = excluded.last_run_at, summary = excluded.summary
  `;
  return summary;
}

async function defaultFetch(url: string, init: RequestInit) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, redirect: "manual" });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Send due webhook deliveries; failures back off and give up after MAX_ATTEMPTS. */
export async function deliverWebhooks(sql: Sql, now: number, send: NonNullable<AlertPassDeps["fetch"]>) {
  const out = { delivered: 0, retrying: 0, failed: 0 };
  const due = await sql<{
    id: number;
    user_id: string;
    rule_id: string;
    episode: string;
    title: string;
    reason: string;
    value: number | null;
    fired_at: string;
    attempts: number;
    webhook_url: string | null;
  }>`
    select d.id, d.user_id, d.rule_id, d.episode, d.title, d.reason, d.value, d.fired_at, d.attempts, c.webhook_url
    from alert_deliveries d left join alert_channels c on c.user_id = d.user_id
    where d.channel = 'webhook' and d.status = 'pending' and d.next_attempt_at <= ${new Date(now).toISOString()}
    order by d.id limit ${WEBHOOK_BATCH}
  `;
  for (const d of due) {
    const attempts = Number(d.attempts) + 1;
    const target = d.webhook_url ? checkWebhookUrl(d.webhook_url) : null;
    let error: string | null = null;
    if (!target || !target.ok) {
      error = "no valid webhook configured";
    } else {
      try {
        const res = await send(target.url, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": d.episode },
          body: JSON.stringify({
            text: `${d.title}: ${d.reason}`,
            alert: { rule: d.rule_id, episode: d.episode, title: d.title, reason: d.reason, value: d.value, firedAt: d.fired_at },
          }),
        });
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (err) {
        error = err instanceof Error ? err.message : "request failed";
      }
    }
    if (!error) {
      out.delivered += 1;
      await sql`
        update alert_deliveries set status = 'delivered', attempts = ${attempts}, delivered_at = ${new Date(now).toISOString()}, last_error = null
        where id = ${d.id}
      `;
    } else if (attempts >= MAX_ATTEMPTS) {
      out.failed += 1;
      await sql`update alert_deliveries set status = 'failed', attempts = ${attempts}, last_error = ${error} where id = ${d.id}`;
    } else {
      out.retrying += 1;
      const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)]! * 60_000;
      await sql`
        update alert_deliveries set attempts = ${attempts}, last_error = ${error}, next_attempt_at = ${new Date(now + wait).toISOString()}
        where id = ${d.id}
      `;
    }
  }
  return out;
}

// ------------------------------------------------------ per-account reads --

export interface InboxRow {
  id: number;
  ruleId: string;
  channel: "inbox" | "webhook";
  title: string;
  reason: string;
  firedAt: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastError: string | null;
}

export interface RuleStatusRow {
  ruleId: string;
  status: string;
  reason: string;
  satisfied: boolean;
  evaluatedAt: string;
}

export async function inboxFor(sql: Sql, userId: string) {
  const deliveries = await sql<{
    id: number;
    rule_id: string;
    channel: "inbox" | "webhook";
    title: string;
    reason: string;
    fired_at: string | Date;
    status: InboxRow["status"];
    attempts: number;
    last_error: string | null;
  }>`
    select id, rule_id, channel, title, reason, fired_at, status, attempts, last_error
    from alert_deliveries where user_id = ${userId}
    order by fired_at desc, id desc limit 50
  `;
  const states = await sql<{ rule_id: string; status: string; reason: string; satisfied: boolean; evaluated_at: string | Date }>`
    select rule_id, status, reason, satisfied, evaluated_at from alert_state where user_id = ${userId}
  `;
  const channel = await sql<{ webhook_url: string | null }>`select webhook_url from alert_channels where user_id = ${userId}`;
  const run = await sql<{ last_run_at: string | Date }>`select last_run_at from job_runs where name = 'alerts'`;
  const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  return {
    deliveries: deliveries.map<InboxRow>((d) => ({
      id: Number(d.id),
      ruleId: d.rule_id,
      channel: d.channel,
      title: d.title,
      reason: d.reason,
      firedAt: iso(d.fired_at),
      status: d.status,
      attempts: Number(d.attempts),
      lastError: d.last_error,
    })),
    states: states.map<RuleStatusRow>((s) => ({
      ruleId: s.rule_id,
      status: s.status,
      reason: s.reason,
      satisfied: !!s.satisfied,
      evaluatedAt: iso(s.evaluated_at),
    })),
    webhookUrl: channel[0]?.webhook_url ?? null,
    lastPassAt: run[0] ? iso(run[0].last_run_at) : null,
  };
}

/** Mark inbox deliveries as shown. Scoped to the account; other ids are ignored. */
export async function ackFor(sql: Sql, userId: string, ids: number[], now = Date.now()) {
  let n = 0;
  for (const id of ids.slice(0, 100)) {
    if (!Number.isInteger(id)) continue;
    const rows = await sql`
      update alert_deliveries set status = 'delivered', delivered_at = ${new Date(now).toISOString()}
      where id = ${id} and user_id = ${userId} and channel = 'inbox' and status = 'pending'
      returning id
    `;
    n += rows.length;
  }
  return n;
}

export async function setWebhookFor(sql: Sql, userId: string, raw: string | null) {
  if (raw == null || raw.trim() === "") {
    await sql`delete from alert_channels where user_id = ${userId}`;
    return { ok: true as const, url: null };
  }
  const checked = checkWebhookUrl(raw);
  if (!checked.ok) return checked;
  await sql`
    insert into alert_channels (user_id, webhook_url, updated_at) values (${userId}, ${checked.url}, now())
    on conflict (user_id) do update set webhook_url = excluded.webhook_url, updated_at = excluded.updated_at
  `;
  return { ok: true as const, url: checked.url };
}
