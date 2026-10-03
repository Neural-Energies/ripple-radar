import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LogoMark } from "@/components/logo";
import { Button, Panel } from "@/components/ui";
import { getDesktopBridge } from "@/lib/desktop/bridge";
import { checkPublishedRelease } from "@/lib/desktop/release";
import type { ReleaseDecision } from "@/lib/desktop/update-check";
import { APP_NAME, APP_VERSION } from "@/lib/desktop/version";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [version, setVersion] = useState(APP_VERSION);
  const [userData, setUserData] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [status, setStatus] = useState<ReleaseDecision | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setDesktop(true);
    void bridge.getInfo().then((info) => {
      setVersion(info.version);
      setUserData(info.userData);
    });
    return bridge.onUpdateStatus(setStatus);
  }, []);

  async function check() {
    setBusy(true);
    try {
      const bridge = getDesktopBridge();
      const next = bridge ? await bridge.checkForUpdates() : await checkPublishedRelease();
      setStatus(next);
    } catch (err) {
      setStatus({
        state: "error",
        current: version,
        latest: null,
        message: err instanceof Error ? err.message : "Update check failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy(true);
    try {
      setStatus(await bridge.installUpdate());
    } catch (err) {
      setStatus({
        state: "error",
        current: version,
        latest: status?.latest ?? null,
        message: err instanceof Error ? err.message : "The update did not start.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <LogoMark className="size-12" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{APP_NAME}</h1>
          <p className="text-caption text-muted">Don't trade the headline. Trade what the headline causes next.</p>
        </div>
      </header>

      <Panel title="About" padded>
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-caption text-muted">Version</span>
            <span className="font-mono text-sm text-foreground">{version}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void check()} disabled={busy}>
              {busy ? "Checking…" : "Check for updates"}
            </Button>
            {desktop && status?.state === "available" ? (
              <Button type="button" variant="secondary" onClick={() => void install()} disabled={busy}>
                Update
              </Button>
            ) : null}
          </div>
          <p className="text-caption text-foreground">
            {status?.message ??
              (desktop
                ? "Installed copies check GitHub Releases and update in one click. Your desk data stays on this PC."
                : "One-click install and update run in the Windows app. This page still checks whether a newer release is published.")}
          </p>
          {userData ? (
            <p className="text-micro text-subtle">
              Data and settings: <span className="font-mono text-foreground">{userData}</span>
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
