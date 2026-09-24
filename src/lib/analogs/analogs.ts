/**
 * Client-facing entry point for historical analogs.
 *
 * The pool stays on the server; the client receives the retrieved analogs and
 * their outcome distribution only.
 */
import { createServerFn } from "@tanstack/react-start";
import type { AnalogLookup } from "./pool.server";

export type { AnalogLookup };

export const getAnalogs = createServerFn({ method: "POST" }).handler(
  async (): Promise<AnalogLookup> => {
    const { analogsFor } = await import("./pool.server.ts");
    return analogsFor();
  },
);
