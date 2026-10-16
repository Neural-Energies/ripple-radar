import { createServerFn } from "@tanstack/react-start";

/** Public tape scores, mood, and today's calendar. No per-user data. */
export const getMorningBriefing = createServerFn({ method: "GET" }).handler(async () => {
  const { loadMorningBriefing } = await import("./read.server");
  return loadMorningBriefing();
});
