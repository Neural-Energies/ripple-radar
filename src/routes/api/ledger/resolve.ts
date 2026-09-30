import { createFileRoute } from "@tanstack/react-router";

/** The hourly forecast-resolution pass (PR #5 B06); see jobs.server.ts. */
async function run(request: Request) {
  const { handleResolutionCron } = await import("@/lib/live/jobs.server");
  return handleResolutionCron(request);
}

export const Route = createFileRoute("/api/ledger/resolve")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
