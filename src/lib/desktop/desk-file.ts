/** Browser-side copy of the saved desk. The Windows app also backs up the whole data folder. */
export const DESK_FILE_KIND = "ripple-radar-desk";

const KEY_PREFIX = "ripple-radar-v2";

export interface DeskFileEntry {
  key: string;
  value: string;
}

export function isDeskStorageKey(key: string): boolean {
  return key === KEY_PREFIX || key.startsWith(`${KEY_PREFIX}:`);
}

export function deskFileFromStorage(entries: DeskFileEntry[], now = new Date()): string {
  const kept = entries.filter((e) => isDeskStorageKey(e.key));
  return JSON.stringify(
    { kind: DESK_FILE_KIND, version: 1, savedAt: now.toISOString(), entries: kept },
    null,
    2,
  );
}

export function parseDeskFile(text: string): { ok: true; entries: DeskFileEntry[] } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file is not a Ripple Radar desk copy." };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, message: "That file is not a Ripple Radar desk copy." };
  const doc = parsed as { kind?: unknown; entries?: unknown };
  if (doc.kind !== DESK_FILE_KIND || !Array.isArray(doc.entries)) {
    return { ok: false, message: "That file is not a Ripple Radar desk copy." };
  }
  const entries: DeskFileEntry[] = [];
  for (const row of doc.entries) {
    if (!row || typeof row !== "object") continue;
    const key = (row as { key?: unknown }).key;
    const value = (row as { value?: unknown }).value;
    if (typeof key !== "string" || typeof value !== "string" || !isDeskStorageKey(key)) continue;
    entries.push({ key, value });
  }
  if (entries.length === 0) return { ok: false, message: "The file has no saved desk in it." };
  return { ok: true, entries };
}
