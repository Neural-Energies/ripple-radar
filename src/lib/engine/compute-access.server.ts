/**
 * Paid compute access (PR #5 B05): entitlement, operator role and durable
 * per-account quotas. Every check here is keyed by the authenticated account.
 */
import type { Sql } from "@/lib/db";

export type Capability = "analyze" | "rescore";

/** Per account. The cooldown and the daily cap are both enforced in the database. */
export const LIMITS: Record<Capability, { cooldownMs: number; perDay: number }> = {
  analyze: { cooldownMs: 45_000, perDay: 60 },
  rescore: { cooldownMs: 20_000, perDay: 200 },
};

const PAID_STATUSES = new Set(["active", "trialing"]);

/** Accounts allowed to run operator jobs (forecast resolution). From OPERATOR_USER_IDS, comma-separated. */
export function operatorIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.OPERATOR_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isOperator(userId: string, env?: Record<string, string | undefined>): boolean {
  return operatorIds(env).has(userId);
}

export type Access = { ok: true; basis: "operator" | "plan"; plan?: string } | { ok: false; reason: string };

/** Whether this account may consume paid compute right now. */
export async function paidAccess(sql: Sql, userId: string, now = Date.now(), env?: Record<string, string | undefined>): Promise<Access> {
  if (!userId) return { ok: false, reason: "Sign in to use model analysis." };
  if (isOperator(userId, env)) return { ok: true, basis: "operator" };
  const rows = await sql<{ plan: string; status: string; current_period_end: string | Date | null }>`
    select plan, status, current_period_end from entitlements where user_id = ${userId} limit 1
  `;
  const row = rows[0];
  if (!row) return { ok: false, reason: "Model analysis needs an active plan." };
  if (!PAID_STATUSES.has(row.status)) return { ok: false, reason: `Plan is ${row.status}.` };
  if (row.current_period_end && new Date(row.current_period_end).getTime() <= now) {
    return { ok: false, reason: "Plan period has ended." };
  }
  return { ok: true, basis: "plan", plan: row.plan };
}

function utcDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export type Claim = { ok: true; used: number; limit: number } | { ok: false; reason: "cooldown" | "daily_cap"; retryAfterMs: number };

/**
 * Claim one paid call for this account. One conditional upsert: it succeeds
 * only if the cooldown has passed and today's count is under the cap, so two
 * instances (or two tabs) cannot both spend the same allowance.
 */
export async function claimCompute(sql: Sql, userId: string, capability: Capability, now = Date.now()): Promise<Claim> {
  const { cooldownMs, perDay } = LIMITS[capability];
  const day = utcDay(now);
  const rows = await sql<{ count: number }>`
    insert into compute_quota (user_id, capability, day, count, last_at_ms)
    values (${userId}, ${capability}, ${day}, 1, ${now})
    on conflict (user_id, capability) do update set
      count = case when compute_quota.day = excluded.day then compute_quota.count + 1 else 1 end,
      day = excluded.day,
      last_at_ms = excluded.last_at_ms
    where compute_quota.last_at_ms <= excluded.last_at_ms - ${cooldownMs}
      and (compute_quota.day <> excluded.day or compute_quota.count < ${perDay})
    returning count
  `;
  if (rows[0]) return { ok: true, used: Number(rows[0].count), limit: perDay };
  const [row] = await sql<{ day: string; count: number; last_at_ms: number }>`
    select day, count, last_at_ms from compute_quota where user_id = ${userId} and capability = ${capability}
  `;
  const wait = row ? Number(row.last_at_ms) + cooldownMs - now : 0;
  if (row && wait > 0) return { ok: false, reason: "cooldown", retryAfterMs: wait };
  const tomorrow = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  return { ok: false, reason: "daily_cap", retryAfterMs: Math.max(0, tomorrow - now) };
}

export function claimNotice(claim: Extract<Claim, { ok: false }>): string {
  return claim.reason === "cooldown"
    ? `Model analysis available again in ${Math.ceil(claim.retryAfterMs / 1000)}s; showing the engine's construction.`
    : "Today's model-analysis allowance is used; showing the engine's construction.";
}
