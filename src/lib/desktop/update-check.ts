/**
 * Decides whether a published release is newer than the running app, and
 * whether an update would land on top of the user's data directory.
 * The installer itself is electron-updater; this is the decision the desk
 * and the tests share.
 */

export interface ReleaseDecision {
  state: "available" | "current" | "none" | "error";
  current: string;
  latest: string | null;
  message: string;
}

export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[+]/)[0]!
      .split("-")[0]!
      .split(".")
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 1);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** `version:` line from an electron-builder latest.yml. */
export function readLatestYmlVersion(yml: string): string | null {
  const match = yml.match(/^version:\s*([0-9][^\s#]*)/m);
  return match?.[1] ?? null;
}

export function decideRelease(current: string, latest: string | null, problem?: string): ReleaseDecision {
  if (problem) {
    return { state: "error", current, latest, message: problem };
  }
  if (!latest) {
    return {
      state: "none",
      current,
      latest: null,
      message: "No published release yet. The installed copy stays as it is.",
    };
  }
  const cmp = compareSemver(current, latest);
  if (cmp < 0) {
    return {
      state: "available",
      current,
      latest,
      message: `Version ${latest} is published. This copy is ${current}.`,
    };
  }
  return {
    state: "current",
    current,
    latest,
    message: cmp === 0 ? `This copy is ${current}, the latest published release.` : `This copy is ${current}, ahead of the published ${latest}.`,
  };
}

/**
 * An update replaces the install directory. Desk data (PGLite, settings)
 * survives only when it lives somewhere else — Electron's userData folder.
 */
export function dataDirSurvivesInstall(dataDir: string, installDir: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const data = norm(dataDir);
  const install = norm(installDir);
  if (!data || !install) return false;
  if (data === install) return false;
  return !data.startsWith(`${install}/`);
}
