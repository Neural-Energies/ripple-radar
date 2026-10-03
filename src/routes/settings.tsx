import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LogoMark } from "@/components/logo";
import { Button, Panel } from "@/components/ui";
import { getDesktopBridge } from "@/lib/desktop/bridge";
import { deskFileFromStorage, parseDeskFile } from "@/lib/desktop/desk-file";
import { checkPublishedRelease } from "@/lib/desktop/release";
import type { ReleaseDecision } from "@/lib/desktop/update-check";
import { APP_NAME, APP_VERSION } from "@/lib/desktop/version";
import { THEME_ORDER, useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const THEME_LABEL: Record<ThemePref, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function SettingsPage() {
  const theme = useTheme();
  const [version, setVersion] = useState(APP_VERSION);
  const [userData, setUserData] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [status, setStatus] = useState<ReleaseDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [folderNote, setFolderNote] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setDesktop(true);
    void bridge.getInfo().then((info) => {
      setVersion(info.version);
      setUserData(info.userData);
      setLaunchAtStartup(info.launchAtStartup === true);
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

  async function toggleStartup(on: boolean) {
    const bridge = getDesktopBridge();
    if (!bridge?.setLaunchAtStartup) return;
    try {
      setLaunchAtStartup(await bridge.setLaunchAtStartup(on));
    } catch {
      setLaunchAtStartup(!on);
    }
  }

  async function backupFolder() {
    const bridge = getDesktopBridge();
    if (!bridge?.backupData) return;
    setBusy(true);
    setFolderNote("Saving a copy of the data folder. The tape pauses for a moment.");
    try {
      const result = await bridge.backupData();
      setFolderNote(result.message);
    } catch (err) {
      setFolderNote(err instanceof Error ? err.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreFolder() {
    const bridge = getDesktopBridge();
    if (!bridge?.restoreData) return;
    setBusy(true);
    setFolderNote("Pick a backup folder. Ripple Radar will close and reopen on that copy.");
    try {
      const result = await bridge.restoreData();
      setFolderNote(result.message);
      if (!result.ok) setBusy(false);
    } catch (err) {
      setFolderNote(err instanceof Error ? err.message : "Restore failed.");
      setBusy(false);
    }
  }

  function downloadDesk() {
    const entries: { key: string; value: string }[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value != null) entries.push({ key, value });
    }
    const text = deskFileFromStorage(entries);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ripple-radar-desk.json";
    a.click();
    URL.revokeObjectURL(url);
    setFileNote("Downloaded this browser's saved desk.");
  }

  async function restoreDeskFile(file: File) {
    const parsed = parseDeskFile(await file.text());
    if (!parsed.ok) {
      setFileNote(parsed.message);
      return;
    }
    for (const entry of parsed.entries) localStorage.setItem(entry.key, entry.value);
    setFileNote("Restored. Reloading so the desk picks it up.");
    window.location.reload();
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

      <Panel title="Appearance" padded>
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted">
            Light is the default. Dark screens can trigger migraines, so a new install stays light until you choose otherwise. System follows this computer.
          </p>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Theme">
            {THEME_ORDER.map((pref) => (
              <button
                key={pref}
                type="button"
                role="radio"
                aria-checked={theme.pref === pref}
                onClick={() => theme.set(pref)}
                className={cn(
                  "rounded-sm border px-2.5 py-1 text-caption",
                  theme.pref === pref
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card text-foreground hover:bg-card-2",
                )}
              >
                {THEME_LABEL[pref]}
              </button>
            ))}
          </div>
        </div>
      </Panel>

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

      <Panel title="This computer" padded>
        <div className="flex flex-col gap-3">
          <p className="text-caption text-muted">
            Closing the window leaves Ripple Radar in the tray, so alerts can still pop up. Quit from the tray icon when you want it to stop.
          </p>
          {desktop ? (
            <label className="flex items-center gap-2 text-caption text-foreground">
              <input
                type="checkbox"
                checked={launchAtStartup}
                onChange={(e) => void toggleStartup(e.target.checked)}
              />
              Launch Ripple Radar when Windows starts
            </label>
          ) : (
            <p className="text-caption text-muted">Launch at startup and the tray are part of the installed Windows app.</p>
          )}
          {desktop ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => void backupFolder()} disabled={busy}>
                Save a backup
              </Button>
              <Button type="button" variant="secondary" onClick={() => void restoreFolder()} disabled={busy}>
                Restore a backup
              </Button>
            </div>
          ) : null}
          {folderNote ? <p className="text-caption text-foreground">{folderNote}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={downloadDesk}>
              Download this desk
            </Button>
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
              Restore a desk file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void restoreDeskFile(file);
              }}
            />
          </div>
          <p className="text-micro text-subtle">
            {fileNote ??
              "The file is this browser's watchlists, alerts, and theses. The Windows backup also includes the local database."}
          </p>
        </div>
      </Panel>
    </div>
  );
}
