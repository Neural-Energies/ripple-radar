/**
 * One save of the local desk, merging through any conflict (PR #5 B03).
 *
 * Dependencies are injected so the same loop runs in the browser against the
 * server function and in tests against the real SQL.
 */
import { mergeDesk, type SyncMeta } from "@/lib/desk-merge";
import type { DeskSnapshot } from "@/lib/desk-model";

export type SaveReply =
  | { ok: true; version: number }
  | { ok: false; conflict: true; desk: DeskSnapshot; version: number }
  | { ok: false; conflict: false; error: string };

export interface PushDeps {
  /** The local desk right now. */
  desk: () => DeskSnapshot;
  sync: () => SyncMeta;
  setSync: (sync: SyncMeta) => void;
  replace: (desk: DeskSnapshot) => void;
  save: (desk: DeskSnapshot, baseVersion: number) => Promise<SaveReply>;
  /** False once the signed-in identity has changed: a late reply must not touch the next user's desk. */
  current: () => boolean;
}

export type PushOutcome = "saved" | "stale" | "failed";

export async function pushDesk(deps: PushDeps, maxConflicts = 3): Promise<PushOutcome> {
  for (let attempt = 0; attempt <= maxConflicts; attempt += 1) {
    if (!deps.current()) return "stale";
    const sent = deps.desk();
    const base = deps.sync();
    const reply = await deps.save(sent, base.version);
    if (!deps.current()) return "stale";
    if (reply.ok) {
      const changedInFlight = JSON.stringify(deps.desk()) !== JSON.stringify(sent);
      deps.setSync({ version: reply.version, base: sent, dirty: changedInFlight });
      if (!changedInFlight) return "saved";
      continue;
    }
    if (reply.conflict) {
      // Someone else saved since `base`. Merge our changes onto theirs and try
      // again against their version.
      deps.replace(mergeDesk(base.base, deps.desk(), reply.desk));
      deps.setSync({ version: reply.version, base: reply.desk, dirty: true });
      continue;
    }
    throw new Error(reply.error);
  }
  return "failed";
}
