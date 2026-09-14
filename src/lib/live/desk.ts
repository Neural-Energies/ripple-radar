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
