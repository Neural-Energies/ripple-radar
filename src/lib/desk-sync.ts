import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { DeskSnapshot } from "@/lib/desk-model";

export const loadDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { loadDeskFor } = await import("@/lib/desk-store.server");
    return loadDeskFor(await getSql(), context.userId);
  });

/** Compare-and-swap: succeeds only if the stored version is still `baseVersion`. */
export const saveDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { desk: DeskSnapshot; baseVersion: number }) => input)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { saveDeskFor } = await import("@/lib/desk-store.server");
    return saveDeskFor(await getSql(), context.userId, data?.desk, Number(data?.baseVersion));
  });
