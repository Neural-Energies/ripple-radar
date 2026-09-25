/**
 * Client-facing entry point for the macro regime detail.
 *
 * The generated `macro-quads.ts` carries the live reading and its
 * qualifications; this fetches the history and scorecards behind them, so only
 * the page that shows them pays for them.
 */
import { createServerFn } from "@tanstack/react-start";
import type { MacroDetail, MacroDetailUnavailable } from "./macro-detail.server";

export type { MacroDetail, MacroDetailUnavailable };

export const getMacroDetail = createServerFn({ method: "POST" }).handler(
  async (): Promise<MacroDetail | MacroDetailUnavailable> => {
    const { macroDetail } = await import("./macro-detail.server.ts");
    return macroDetail();
  },
);
