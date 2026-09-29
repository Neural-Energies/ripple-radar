import { createFileRoute } from "@tanstack/react-router";

/** The scheduled alert pass (PR #5 B02); see alerts-cron.server.ts. */
async function run(request: Request) {
  const { handleAlertCron } = await import("@/lib/live/alerts-cron.server");
  return handleAlertCron(request);
}

export const Route = createFileRoute("/api/alerts/run")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
