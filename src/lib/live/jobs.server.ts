/**
 * Scheduled jobs and their health (PR #5 B06 "operate a dependable service").
 *
 * Every background job records its last run in `job_runs`. `/api/health`
 * reads those rows and reports a job as stale once it has gone longer than
 * its schedule allows, answering 503 so an uptime monitor can page on it.
 * The resolution pass runs hourly from /api/ledger/resolve under the same
 * CRON_SECRET as the alert pass.
 */
import type { Sql } from "@/lib/db";
import { cronAuthorized } from "./alerts-cron.server";

/** Longest gap, in minutes, before a job counts as stale (schedule plus slack). */
export const JOB_MAX_AGE_MIN: Record<string, number> = {
  alerts: 15,
  resolution: 3 * 60,
};

export interface JobHealth {
  name: string;
  lastRunAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
  summary: unknown;
}

export async function recordJobRun(sql: Sql, name: string, at: number, summary: unknown) {
  await sql`
    insert into job_runs (name, last_run_at, summary) values (${name}, ${new Date(at).toISOString()}, ${JSON.stringify(summary)})
    on conflict (name) do update set last_run_at = excluded.last_run_at, summary = excluded.summary
  `;
}

export async function jobHealth(sql: Sql, now: number): Promise<{ ok: boolean; jobs: JobHealth[] }> {
  const rows = await sql<{ name: string; last_run_at: string | Date; summary: string }>`select name, last_run_at, summary from job_runs`;
  const byName = new Map(rows.map((r) => [r.name, r]));
  const jobs = Object.entries(JOB_MAX_AGE_MIN).map(([name, maxAge]) => {
    const row = byName.get(name);
    if (!row) return { name, lastRunAt: null, ageMinutes: null, stale: true, summary: null };
    const at = new Date(row.last_run_at).getTime();
    const ageMinutes = Math.round((now - at) / 60_000);
    let summary: unknown = null;
    try {
      summary = JSON.parse(row.summary);
    } catch {
      summary = row.summary;
    }
    return { name, lastRunAt: new Date(at).toISOString(), ageMinutes, stale: ageMinutes > maxAge, summary };
  });
  return { ok: jobs.every((j) => !j.stale), jobs };
}

/** The hourly resolution pass: grade due snapshots and record the run. */
export async function handleResolutionCron(request: Request, deps: { sql?: Sql; now?: () => number } = {}): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sql = deps.sql ?? (await (await import("@/lib/db")).getSql());
  const now = (deps.now ?? Date.now)();
  try {
    const { runResolutionPass } = await import("./forecast-ledger.server");
    const judge = Boolean(process.env.XAI_API_KEY?.trim());
    const result = await runResolutionPass(25, { sql });
    const summary = { at: new Date(now).toISOString(), judgeConfigured: judge, ...result };
    await recordJobRun(sql, "resolution", now, summary);
    return Response.json({ ok: true, summary });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "resolution pass failed" }, { status: 500 });
  }
}

export async function handleHealth(deps: { sql?: Sql; now?: () => number } = {}): Promise<Response> {
  try {
    const sql = deps.sql ?? (await (await import("@/lib/db")).getSql());
    const health = await jobHealth(sql, (deps.now ?? Date.now)());
    return Response.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "database unreachable", jobs: [] }, { status: 503 });
  }
}
