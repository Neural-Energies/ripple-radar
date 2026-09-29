import { createServerFn } from "@tanstack/react-start";
import type { RadarEvent } from "@/data/types";
import { authMiddleware } from "@/lib/auth/middleware";

export const getEmpiricalBook = createServerFn({ method: "POST" })
  .validator((input: { title: string; actors: string[] }) => {
    const title = typeof input?.title === "string" ? input.title.slice(0, 400) : "";
    const actors = Array.isArray(input?.actors)
      ? input.actors.filter((a): a is string => typeof a === "string").slice(0, 4)
      : [];
    return { title, actors };
  })
  .handler(async ({ data }) => {
    const { empiricalBook } = await import("./empirical.server");
    return empiricalBook(data.title, data.actors);
  });

export const getLiveDesk = createServerFn({ method: "POST" }).handler(async () => {
  const { buildDesk } = await import("./build.server");
  return buildDesk();
});

// Paid compute (PR #5 B05): signed in, scoped to the account; the entitlement
// and the per-account allowance are checked inside, before any model call.
export const rescoreBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { eventId: string; snapshot?: RadarEvent }) => ({
    eventId: typeof input?.eventId === "string" ? input.eventId.slice(0, 200) : "",
    snapshot: input?.snapshot && typeof input.snapshot === "object" ? input.snapshot : undefined,
  }))
  .handler(async ({ data, context }) => {
    const { rescore } = await import("./rescore.server");
    return rescore(data.eventId, data.snapshot, context.userId);
  });

export const analyzeEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { text: string }) => ({ text: typeof input?.text === "string" ? input.text : "" }))
  .handler(async ({ data, context }) => {
    const { analyze } = await import("@/lib/engine/analyze.server");
    return analyze(data.text, context.userId);
  });

export const getMacroRegime = createServerFn({ method: "GET" }).handler(async () => {
  const { loadMacroRegime } = await import("./macro.server");
  return loadMacroRegime();
});

export const getLiveCalibration = createServerFn({ method: "GET" }).handler(async () => {
  const { getCalibration } = await import("./forecast-ledger.server");
  return getCalibration();
});

/** Manual trigger for the resolution pass. It grades the shared ledger with a
 * paid judge, so it is an operator job (OPERATOR_USER_IDS), not a subscriber
 * action (PR #5 B05). Real no-op without XAI_API_KEY (see forecast-ledger.server). */
export const runForecastResolution = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true; checked: number; resolved: number } | { ok: false; error: string }> => {
    const { isOperator } = await import("@/lib/engine/compute-access.server");
    if (!isOperator(context.userId)) return { ok: false, error: "Resolution is an operator job." };
    const { runResolutionPass } = await import("./forecast-ledger.server");
    return { ok: true, ...(await runResolutionPass()) };
  });

/** The real scored ledger — forecasts frozen before the outcome, graded after. */
export const getScoredLedger = createServerFn({ method: "GET" }).handler(async () => {
  const { getScoredForecasts } = await import("./forecast-ledger.server");
  return getScoredForecasts();
});

/** Skill over time from resolved rows only. Short series = young ledger. */
export const getSkillOverTime = createServerFn({ method: "GET" }).handler(async () => {
  const { getSkillSeries } = await import("./forecast-ledger.server");
  return getSkillSeries();
});

/** Append-only as-of replay for one book: what the desk believed at each T. */
export const getReplay = createServerFn({ method: "GET" })
  .inputValidator((eventId: string) => eventId)
  .handler(async ({ data }) => {
    const { getReplayFrames } = await import("./forecast-ledger.server");
    return getReplayFrames(data);
  });
