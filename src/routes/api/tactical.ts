import { createFileRoute } from "@tanstack/react-router";

/**
 * Precomputed tactical futures book (NQ, ES, GC, CL).
 * Research output only. No page renders it.
 */
export const Route = createFileRoute("/api/tactical")({
  server: {
    handlers: {
      GET: async () => {
        const { readTacticalBook } = await import("@/lib/tactical/book");
        return Response.json(readTacticalBook());
      },
    },
  },
});
