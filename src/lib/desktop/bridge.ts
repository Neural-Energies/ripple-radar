import type { ReleaseDecision } from "./update-check";

export interface DesktopInfo {
  version: string;
  name: string;
  userData: string;
  launchAtStartup?: boolean;
}

export interface FolderResult {
  ok: boolean;
  path?: string | null;
  message: string;
}

export interface DesktopBridge {
  getInfo(): Promise<DesktopInfo>;
  checkForUpdates(): Promise<ReleaseDecision>;
  installUpdate(): Promise<ReleaseDecision>;
  setLaunchAtStartup?(on: boolean): Promise<boolean>;
  backupData?(): Promise<FolderResult>;
  restoreData?(): Promise<FolderResult>;
  notify?(title: string, body: string): Promise<boolean>;
  onUpdateStatus(cb: (status: ReleaseDecision) => void): () => void;
}

declare global {
  interface Window {
    rippleDesktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.rippleDesktop ?? null;
}

export function desktopNotify(title: string, body: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.notify) return;
  void bridge.notify(title, body).catch(() => {
    // The in-app toast already showed. A missing tray must not break the desk.
  });
}
