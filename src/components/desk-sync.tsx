import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { GUEST_DESK_KEY, importGuest, isEmptyDesk, planLoad, type SyncMeta } from "@/lib/desk-merge";
import type { DeskSnapshot } from "@/lib/desk-model";
import { pushDesk, type PushDeps } from "@/lib/desk-push";
import { loadDesk, saveDesk } from "@/lib/desk-sync";
import { readPartition, snapshotDesk, switchIdentity, useApp } from "@/lib/store";

/**
 * pending   auth or the first cloud load has not resolved
 * local     signed out: this browser's signed-out desk only
 * cloud     signed in and the account's copy matches this device
 * saving    a save is in flight
 * retrying  there are unsynced changes on this device; the save is retried
 */
export type SyncMode = "pending" | "local" | "cloud" | "saving" | "retrying";

const SyncModeContext = createContext<{ mode: SyncMode; savedAt: number | null }>({ mode: "pending", savedAt: null });

export function useSyncMode() {
  return useContext(SyncModeContext).mode;
}

function clock(ms: number | null) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DeskHint() {
  const { user, isPending } = useCurrentUserState();
  const { mode, savedAt } = useContext(SyncModeContext);
  const identity = useApp((s) => s.identity);
  // Auth session resolves at a different speed server- vs client-side (no
  // cookie can resolve client-side before the server's session check
  // returns), so the first client paint must match the server's `null`
  // exactly — react to the real state only after mount, not hydration
  // mismatch bait.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || isPending) return null;
  if (!user) {
    return (
      <p className="text-tiny text-muted">
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>{" "}
        to carry watchlists, theses and alerts across devices. Tape stays live either way.
      </p>
    );
  }
  const guest = identity === user.id ? readPartition(GUEST_DESK_KEY) : null;
  const canImport = guest && !isEmptyDesk(guest.desk);
  return (
    <div className="flex flex-wrap items-center gap-2 text-tiny text-muted">
      <span>
        {mode === "cloud"
          ? `Saved to your account${savedAt ? ` · ${clock(savedAt)}` : ""}.`
          : mode === "saving"
            ? "Saving…"
            : mode === "retrying"
              ? "Unsynced changes are kept on this device and retried."
              : "Loading your desk…"}
      </span>
      {canImport ? (
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            const current = snapshotDesk(useApp.getState());
            useApp.getState().replaceDesk(importGuest(current, guest.desk));
          }}
        >
          Import this browser's signed-out desk
        </button>
      ) : null}
    </div>
  );
}

const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export function DeskSync({ children }: { children: ReactNode }) {
  const hydrated = useApp((s) => s.hydrated);
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<SyncMode>("pending");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const userId = user?.id ?? null;
  const lastJson = useRef("");
  const retries = useRef(0);
  const retryTimer = useRef(0);
  const inFlight = useRef(false);

  // Identity first: the in-memory desk always belongs to whoever is signed in.
  useEffect(() => {
    if (!hydrated || isPending) return;
    if (useApp.getState().identity !== userId) switchIdentity(userId);
    lastJson.current = JSON.stringify(snapshotDesk(useApp.getState()));
    window.clearTimeout(retryTimer.current);
    retries.current = 0;
    if (!userId) {
      setMode("local");
      return;
    }

    const current = () => useApp.getState().identity === userId;
    const deps: PushDeps = {
      desk: () => snapshotDesk(useApp.getState()),
      sync: () => useApp.getState().sync,
      setSync: (sync: SyncMeta) => useApp.getState().setSync(sync),
      replace: (desk: DeskSnapshot) => {
        useApp.getState().replaceDesk(desk);
        lastJson.current = JSON.stringify(snapshotDesk(useApp.getState()));
      },
      save: (desk, baseVersion) => saveDesk({ data: { desk, baseVersion } }),
      current,
    };

    const push = async () => {
      if (inFlight.current || !current() || !useApp.getState().sync.dirty) return;
      inFlight.current = true;
      setMode("saving");
      try {
        const outcome = await pushDesk(deps);
        if (outcome === "stale") return;
        if (outcome === "saved") {
          retries.current = 0;
          setMode("cloud");
          setSavedAt(Date.now());
          return;
        }
        throw new Error("conflicts did not settle");
      } catch {
        if (!current()) return;
        setMode("retrying");
        const wait = RETRY_MS[Math.min(retries.current, RETRY_MS.length - 1)]!;
        retries.current += 1;
        window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => void push(), wait);
      } finally {
        inFlight.current = false;
      }
    };

    let dead = false;
    setMode("pending");
    void (async () => {
      try {
        const remote = await loadDesk();
        if (dead || !current()) return;
        const state = useApp.getState();
        const plan = planLoad(snapshotDesk(state), state.sync, remote);
        deps.replace(plan.desk);
        if (plan.save) {
          useApp.getState().setSync({ version: plan.baseVersion, base: remote?.desk ?? state.sync.base, dirty: true });
          await push();
        } else {
          useApp.getState().setSync({ version: remote?.version ?? 0, base: remote?.desk ?? null, dirty: false });
          setMode("cloud");
        }
      } catch {
        if (!dead && current()) {
          // Keep working on this device; unsynced work stays marked dirty.
          setMode("retrying");
          retryTimer.current = window.setTimeout(() => void push(), RETRY_MS[0]);
        }
      }
    })();

    let debounce = 0;
    const unsub = useApp.subscribe((state) => {
      if (state.identity !== userId) return;
      const json = JSON.stringify(snapshotDesk(state));
      if (json === lastJson.current) return;
      lastJson.current = json;
      if (!state.sync.dirty) state.setSync({ ...state.sync, dirty: true });
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void push(), 500);
    });
    const online = () => void push();
    window.addEventListener("online", online);

    return () => {
      dead = true;
      unsub();
      window.clearTimeout(debounce);
      window.clearTimeout(retryTimer.current);
      window.removeEventListener("online", online);
    };
  }, [hydrated, isPending, userId]);

  return <SyncModeContext.Provider value={{ mode, savedAt }}>{children}</SyncModeContext.Provider>;
}
