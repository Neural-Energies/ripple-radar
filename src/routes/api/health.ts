import { createFileRoute } from "@tanstack/react-router";

/** Background-job freshness for uptime monitoring: 200 when every job is on schedule, 503 otherwise. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { handleHealth } = await import("@/lib/live/jobs.server");
        return handleHealth();
      },
    },
  },
});
