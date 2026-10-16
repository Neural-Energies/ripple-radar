import { createServerFn } from "@tanstack/react-start";

/** Public tape scores, mood, and today's calendar. No per-user data. */
export const getMorningBriefing = createServerFn({ method: "GET" }).handler(async () => {
  const { loadMorningBriefing } = await import("./read.server");
  return loadMorningBriefing();
});

/** Overnight: prior 4pm ET cash close to now. Public market data and the stored tape only. */
export const getOvernight = createServerFn({ method: "GET" }).handler(async () => {
  const { loadOvernight } = await import("./overnight.server");
  return loadOvernight();
});
