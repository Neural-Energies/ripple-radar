/** Marker written into every backup so restore can tell a data folder from any other directory. */
export const BACKUP_MARKER = "ripple-radar-backup.json";

/** Folders Chromium rebuilds. They are large and not the desk. */
export const SKIP_COPY_NAMES = new Set([
  "Cache",
  "GPUCache",
  "Code Cache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "blob_storage",
]);

export function backupFolderName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `RippleRadar-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** A chosen folder is a backup when it carries the marker or the local database. */
export function isBackupDir(names: string[]): boolean {
  return names.includes(BACKUP_MARKER) || names.includes("pglite");
}

export function shouldCopyName(name: string): boolean {
  return !SKIP_COPY_NAMES.has(name) && name !== "restore-after-restart.json";
}
