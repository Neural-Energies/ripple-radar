import { createServerFn } from "@tanstack/react-start";
import type { RadarEvent } from "@/data/types";

export const getLiveDesk = createServerFn({ method: "POST" }).handler(async () => {
  const { buildDesk } = await import("./build.server");
  return buildDesk();
});

export const rescoreBook = createServerFn({ method: "POST" })
  .validator((input: { eventId: string; snapshot?: RadarEvent }) => input)
  .handler(async ({ data }) => {
    const { rescore } = await import("./rescore.server");
    return rescore(data.eventId, data.snapshot);
  });

export const analyzeEvent = createServerFn({ method: "POST" })
  .validator((input: { text: string }) => input)
  .handler(async ({ data }) => {
    const { analyze } = await import("@/lib/engine/analyze.server");
    return analyze(data.text);
  });

export const getLiveCalibration = createServerFn({ method: "GET" }).handler(async () => {
  const { getCalibration } = await import("./forecast-ledger.server");
  return getCalibration();
});

/** Manual trigger — there is no background job runner in this app, so a
 * resolution pass runs on demand rather than silently on a timer. Real no-op
 * without XAI_API_KEY (see forecast-ledger.server), same as Analyze/Rescore. */
export const runForecastResolution = createServerFn({ method: "POST" }).handler(async () => {
  const { runResolutionPass } = await import("./forecast-ledger.server");
  return runResolutionPass();
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
