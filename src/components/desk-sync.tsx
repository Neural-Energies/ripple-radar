import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadDesk, saveDesk } from "@/lib/desk-sync";
import { snapshotDesk, useApp } from "@/lib/store";

export type SyncMode = "pending" | "local" | "cloud";

const SyncModeContext = createContext<SyncMode>("pending");

export function useSyncMode() {
  return useContext(SyncModeContext);
}

export function DeskHint() {
  const { user, isPending } = useCurrentUserState();
  const sync = useSyncMode();
  // Auth session resolves at a different speed server- vs client-side (no
  // cookie can resolve client-side before the server's session check
  // returns), so the first client paint must match the server's `null`
  // exactly — react to the real state only after mount, not hydration
  // mismatch bait.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || isPending) return null;
  if (user && sync === "cloud") {
    return <p className="text-tiny text-muted">This blotter follows the account on every device.</p>;
  }
  if (user) {
    return <p className="text-tiny text-muted">Saving on this device. Cloud sync paused.</p>;
  }
  return (
    <p className="text-tiny text-muted">
      <Link to="/login" className="text-primary hover:underline">
        Sign in
      </Link>{" "}
      to carry watchlists and alerts across devices. Tape stays live either way.
    </p>
  );
}

export function DeskSync({ children }: { children: ReactNode }) {
  const hydrated = useApp((s) => s.hydrated);
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<SyncMode>("pending");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastJson = useRef("");
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!hydrated || isPending) return;
    if (!userId) {
      setMode("local");
      return;
    }
    let dead = false;
    setMode("pending");
    void (async () => {
      try {
        const cloud = await loadDesk();
        if (dead) return;
        if (cloud) {
          useApp.getState().replaceDesk(cloud);
          lastJson.current = JSON.stringify(cloud);
        } else {
          const payload = snapshotDesk(useApp.getState());
          lastJson.current = JSON.stringify(payload);
          await saveDesk({ data: payload });
        }
        if (!dead) setMode("cloud");
      } catch {
        if (!dead) setMode("local");
      }
    })();
    return () => {
      dead = true;
    };
  }, [hydrated, isPending, userId]);

  useEffect(() => {
    if (mode !== "cloud") return;
    let timer = 0;
    const unsub = useApp.subscribe((state) => {
      if (modeRef.current !== "cloud") return;
      const payload = snapshotDesk(state);
      const json = JSON.stringify(payload);
      if (json === lastJson.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lastJson.current = json;
        void saveDesk({ data: payload }).catch(() => setMode("local"));
      }, 500);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [mode]);

  return <SyncModeContext.Provider value={mode}>{children}</SyncModeContext.Provider>;
}
