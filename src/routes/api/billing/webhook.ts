import { createFileRoute } from "@tanstack/react-router";

/** Stripe webhook → entitlements (PR #5 B06); see stripe.server.ts. */
export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleStripeWebhook } = await import("@/lib/billing/stripe.server");
        return handleStripeWebhook(request);
      },
    },
  },
});
