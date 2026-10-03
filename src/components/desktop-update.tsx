import { useEffect, useState } from "react";
import { getDesktopBridge } from "@/lib/desktop/bridge";
import type { ReleaseDecision } from "@/lib/desktop/update-check";

/** Shown in the installed Windows app when GitHub Releases has a newer build. */
export function DesktopUpdateNotice() {
  const [status, setStatus] = useState<ReleaseDecision | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    return bridge.onUpdateStatus((next) => {
      setStatus(next.state === "available" ? next : null);
    });
  }, []);

  if (!status) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5 text-caption text-foreground">
      <span>{status.message}</span>
      <button
        type="button"
        disabled={busy}
        className="rounded-md bg-primary px-2.5 py-1 text-caption font-medium text-primary-foreground disabled:opacity-50"
        onClick={() => {
          const bridge = getDesktopBridge();
          if (!bridge) return;
          setBusy(true);
          void bridge
            .installUpdate()
            .then(setStatus)
            .catch((err: unknown) => {
              setStatus({
                state: "error",
                current: status.current,
                latest: status.latest,
                message: err instanceof Error ? err.message : "The update did not start.",
              });
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Updating…" : "Update"}
      </button>
    </div>
  );
}
