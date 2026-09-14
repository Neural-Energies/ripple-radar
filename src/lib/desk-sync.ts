import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { DeskSnapshot } from "@/lib/store";

function parsePayload(raw: string): DeskSnapshot | null {
  try {
    const v = JSON.parse(raw) as DeskSnapshot;
    if (!v || typeof v !== "object") return null;
    if (typeof v.selectedEventId !== "string") return null;
    if (!Array.isArray(v.watchlists) || !Array.isArray(v.alerts) || !Array.isArray(v.customScenarios)) {
      return null;
    }
    if (!Array.isArray(v.deskBooks)) v.deskBooks = [];
    return v;
  } catch {
    return null;
  }
}

export const loadDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ payload: string }>`
      select payload from desk_state where user_id = ${context.userId} limit 1
    `;
    const raw = rows[0]?.payload;
    return raw ? parsePayload(raw) : null;
  });

export const saveDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: DeskSnapshot) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const payload = JSON.stringify({
      selectedEventId: data.selectedEventId,
      watchlists: data.watchlists,
      alerts: data.alerts,
      customScenarios: data.customScenarios,
      deskBooks: data.deskBooks ?? [],
    });
    await sql`
      insert into desk_state (user_id, payload, updated_at)
      values (${context.userId}, ${payload}, now())
      on conflict (user_id) do update
      set payload = excluded.payload, updated_at = now()
    `;
    return { ok: true as const };
  });
