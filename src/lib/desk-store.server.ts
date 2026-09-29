/**
 * Per-user desk persistence with compare-and-swap (PR #5 B03).
 *
 * Every query is scoped to the authenticated user id passed in by the server
 * function; nothing here trusts an id from the client payload.
 */
import type { Sql } from "@/lib/db";
import { normalizeDesk, type DeskSnapshot } from "@/lib/desk-model";

/** A desk larger than this is refused rather than silently truncated. */
export const MAX_DESK_BYTES = 1_000_000;

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; desk: DeskSnapshot; version: number }
  | { ok: false; conflict: false; error: string };

export function validateDesk(input: unknown): DeskSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Partial<DeskSnapshot>;
  if (typeof v.selectedEventId !== "string") return null;
  for (const key of ["watchlists", "alerts", "customScenarios"] as const) {
    if (!Array.isArray(v[key])) return null;
  }
  return normalizeDesk(v);
}

function parse(raw: string | undefined): DeskSnapshot | null {
  if (!raw) return null;
  try {
    return validateDesk(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function loadDeskFor(sql: Sql, userId: string): Promise<{ desk: DeskSnapshot; version: number } | null> {
  const rows = await sql<{ payload: string; version: number }>`
    select payload, version from desk_state where user_id = ${userId} limit 1
  `;
  const row = rows[0];
  const desk = parse(row?.payload);
  return row && desk ? { desk, version: Number(row.version) } : null;
}

export async function saveDeskFor(
  sql: Sql,
  userId: string,
  input: unknown,
  baseVersion: number,
): Promise<SaveResult> {
  const desk = validateDesk(input);
  if (!desk) return { ok: false, conflict: false, error: "invalid desk payload" };
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    return { ok: false, conflict: false, error: "invalid base version" };
  }
  const payload = JSON.stringify(desk);
  if (payload.length > MAX_DESK_BYTES) return { ok: false, conflict: false, error: "desk too large" };

  const written =
    baseVersion === 0
      ? await sql<{ version: number }>`
          insert into desk_state (user_id, payload, version, updated_at)
          values (${userId}, ${payload}, 1, now())
          on conflict (user_id) do update
          set payload = excluded.payload, version = desk_state.version + 1, updated_at = now()
          where desk_state.version = 0
          returning version
        `
      : await sql<{ version: number }>`
          update desk_state
          set payload = ${payload}, version = version + 1, updated_at = now()
          where user_id = ${userId} and version = ${baseVersion}
          returning version
        `;
  if (written[0]) return { ok: true, version: Number(written[0].version) };

  const current = await loadDeskFor(sql, userId);
  if (!current) return { ok: false, conflict: false, error: "desk vanished during save" };
  return { ok: false, conflict: true, desk: current.desk, version: current.version };
}
