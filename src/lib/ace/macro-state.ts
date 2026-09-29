/**
 * Client entry point for the factor-engine state behind /macro.
 */
import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import type { MacroState, MacroStateUnavailable } from "./macro-state.server";

export type * from "./macro-state.server";

export const getMacroState = createServerFn({ method: "GET" }).handler(
  async (): Promise<MacroState | MacroStateUnavailable> => {
    const { macroState } = await import("./macro-state.server.ts");
    return macroState();
  },
);

/** Null while loading; an explicit unavailable state on failure. */
export function useMacroState() {
  const [state, setState] = useState<MacroState | MacroStateUnavailable | null>(null);
  useEffect(() => {
    let dead = false;
    void getMacroState()
      .then((row) => {
        if (!dead) setState(row);
      })
      .catch(() => {
        if (!dead) setState({ available: false, reason: "the factor-engine state could not be loaded" });
      });
    return () => {
      dead = true;
    };
  }, []);
  return state;
}
