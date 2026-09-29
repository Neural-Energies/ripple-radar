/**
 * The signed-in account's alert inbox and delivery settings (PR #5 B02).
 * Every call is scoped to the authenticated user id.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type { InboxRow, RuleStatusRow } from "./alerts.server";

export const getAlertInbox = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { inboxFor } = await import("./alerts.server");
    return inboxFor(await getSql(), context.userId);
  });

export const ackAlertDeliveries = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: number[] }) => ({
    ids: Array.isArray(input?.ids) ? input.ids.filter((n) => Number.isInteger(n)).slice(0, 100) : [],
  }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { ackFor } = await import("./alerts.server");
    return ackFor(await getSql(), context.userId, data.ids);
  });

export const setAlertWebhook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { url: string | null }) => ({
    url: typeof input?.url === "string" ? input.url.slice(0, 2048) : null,
  }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { setWebhookFor } = await import("./alerts.server");
    return setWebhookFor(await getSql(), context.userId, data.url);
  });
