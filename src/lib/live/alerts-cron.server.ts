/**
 * The scheduled alert pass's HTTP entry (PR #5 B02). Vercel Cron calls
 * /api/alerts/run with `Authorization: Bearer $CRON_SECRET` (cron entry in
 * vite.config.ts). Without CRON_SECRET configured it refuses rather than run
 * for anyone.
 */
import { timingSafeEqual } from "node:crypto";

export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function handleAlertCron(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { buildDesk } = await import("./build.server");
  const { getSql } = await import("@/lib/db");
  const { runAlertPass } = await import("./alerts.server");
  try {
    const summary = await runAlertPass(await getSql(), await buildDesk());
    return Response.json({ ok: true, summary });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "alert pass failed" }, { status: 500 });
  }
}
