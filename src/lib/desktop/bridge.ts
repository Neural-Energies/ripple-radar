import type { ReleaseDecision } from "./update-check";

export interface DesktopInfo {
  version: string;
  name: string;
  userData: string;
}

export interface DesktopBridge {
  getInfo(): Promise<DesktopInfo>;
  checkForUpdates(): Promise<ReleaseDecision>;
  installUpdate(): Promise<ReleaseDecision>;
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
