/** World Tape choices. Light-default desk; these only change what the tape shows. */
export const TAPE_PREFS_KEY = "ripple-tape-prefs";

export const REFRESH_CHOICES = [15_000, 30_000, 60_000] as const;
export type RefreshMs = (typeof REFRESH_CHOICES)[number];

export interface TapePrefs {
  /** When true, the list is the shock gate. Off shows every live headline. */
  shockOnly: boolean;
  /** True shows every configured source. False uses `sources` as the allow-list. */
  allSources: boolean;
  sources: string[];
  refreshMs: RefreshMs;
}

export function defaultTapePrefs(): TapePrefs {
  return { shockOnly: false, allSources: true, sources: [], refreshMs: 15_000 };
}

export function parseTapePrefs(raw: unknown): TapePrefs {
  const base = defaultTapePrefs();
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Partial<TapePrefs>;
  const refresh = REFRESH_CHOICES.find((n) => n === row.refreshMs) ?? base.refreshMs;
  const sources = Array.isArray(row.sources)
    ? row.sources.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length < 80).slice(0, 40)
    : [];
  return {
    shockOnly: row.shockOnly === true,
    allSources: row.allSources !== false,
    sources,
    refreshMs: refresh,
  };
}

export function readTapePrefs(): TapePrefs {
  try {
    const raw = globalThis.localStorage?.getItem(TAPE_PREFS_KEY);
    if (!raw) return defaultTapePrefs();
    return parseTapePrefs(JSON.parse(raw));
  } catch {
    return defaultTapePrefs();
  }
}

export function writeTapePrefs(prefs: TapePrefs): TapePrefs {
  const next = parseTapePrefs(prefs);
  try {
    globalThis.localStorage?.setItem(TAPE_PREFS_KEY, JSON.stringify(next));
  } catch {
    // The in-memory copy still drives this page.
  }
  return next;
}
