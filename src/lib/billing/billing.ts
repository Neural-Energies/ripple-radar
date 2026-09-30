import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/** Where the signed-in account's plan stands, and whether billing is set up at all. */
export const getBillingStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { billingConfigured, customerOf } = await import("./stripe.server");
    const { paidAccess } = await import("@/lib/engine/compute-access.server");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const [access, customer, rows] = await Promise.all([
      paidAccess(sql, context.userId),
      customerOf(sql, context.userId),
      sql<{ plan: string; status: string; current_period_end: string | Date | null }>`
        select plan, status, current_period_end from entitlements where user_id = ${context.userId} limit 1
      `,
    ]);
    const row = rows[0];
    return {
      configured: billingConfigured(),
      access,
      hasBillingAccount: Boolean(customer),
      plan: row
        ? { plan: row.plan, status: row.status, periodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null }
        : null,
    };
  });

async function origin() {
  const { getRequest } = await import("@tanstack/react-start/server");
  return new URL(getRequest().url).origin;
}

/** Start a subscription: a Stripe Checkout URL for this account. */
export const startCheckout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
    const { checkoutUrl } = await import("./stripe.server");
    const { getSql } = await import("@/lib/db");
    try {
      return { ok: true, url: await checkoutUrl(await getSql(), context.userId, await origin()) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Checkout failed." };
    }
  });

/** Manage or cancel: a Stripe Customer Portal URL for this account. */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
    const { portalUrl } = await import("./stripe.server");
    const { getSql } = await import("@/lib/db");
    try {
      return { ok: true, url: await portalUrl(await getSql(), context.userId, await origin()) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Billing portal unavailable." };
    }
  });
