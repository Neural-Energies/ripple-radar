/**
 * Desk persistence rules that must hold whatever the network does (PR #5 B03).
 *
 * 1. Private state is partitioned by identity. The signed-out desk lives in
 *    the legacy key; each account has its own key. Nothing moves between
 *    them except by an explicit import.
 * 2. Cloud saves are versioned. When two devices save from the same base, the
 *    second is rejected and merged three-way against the base both started
 *    from, so neither device's additions are lost.
 */
import type { DeskSnapshot } from "@/lib/desk-model";

/** The signed-out desk. Also where every desk lived before partitioning. */
export const GUEST_DESK_KEY = "ripple-radar-v2";

export function deskKey(userId: string | null): string {
  return userId ? `${GUEST_DESK_KEY}:u:${userId}` : GUEST_DESK_KEY;
}

/** What the client knows about the cloud copy it last agreed with. */
export interface SyncMeta {
  /** Server version of `base`; 0 when the account has never saved. */
  version: number;
  /** The snapshot last acknowledged by the server, for three-way merges. */
  base: DeskSnapshot | null;
  /** Local changes not yet acknowledged. Survives reloads. */
  dirty: boolean;
}

export const CLEAN_SYNC: SyncMeta = { version: 0, base: null, dirty: false };

type Keyed = { id: string };

function byId<T extends Keyed>(rows: T[] | undefined): Map<string, T> {
  return new Map((rows ?? []).map((r) => [r.id, r]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge of one id-keyed collection.
 *
 * A row the local side added, edited or deleted since `base` takes the local
 * outcome; every other row takes the remote one. Order follows remote, with
 * local-only additions first (the desk shows newest first).
 */
export function mergeRows<T extends Keyed>(
  base: T[] | undefined,
  local: T[] | undefined,
  remote: T[] | undefined,
  mergeRow: (b: T | undefined, l: T, r: T) => T = (_b, l) => l,
): T[] {
  const b = byId(base);
  const l = byId(local);
  const r = byId(remote);
  const out: T[] = [];
  for (const row of local ?? []) {
    if (!b.has(row.id) && !r.has(row.id)) out.push(row); // added locally
  }
  for (const row of remote ?? []) {
    const lr = l.get(row.id);
    const br = b.get(row.id);
    if (!lr) {
      // Deleted locally (it was in base) wins; otherwise it is new remotely.
      if (br && same(br, row)) continue;
      if (br) continue;
      out.push(row);
      continue;
    }
    const localChanged = !br || !same(br, lr);
    const remoteChanged = !br || !same(br, row);
    if (localChanged && remoteChanged) out.push(mergeRow(br, lr, row));
    else out.push(localChanged ? lr : row);
  }
  return out;
}

/** A watchlist's tickers merge as a set, so two devices' additions both survive. */
function mergeWatchlist(
  base: DeskSnapshot["watchlists"][number] | undefined,
  local: DeskSnapshot["watchlists"][number],
  remote: DeskSnapshot["watchlists"][number],
): DeskSnapshot["watchlists"][number] {
  const b = new Set(base?.tickers ?? []);
  const l = new Set(local.tickers);
  const removed = new Set([...b].filter((t) => !l.has(t)));
  const added = local.tickers.filter((t) => !b.has(t));
  const tickers = [...remote.tickers.filter((t) => !removed.has(t)), ...added.filter((t) => !remote.tickers.includes(t))];
  return { ...remote, ...(same(base?.name, local.name) ? {} : { name: local.name }), tickers };
}

export function mergeDesk(base: DeskSnapshot | null, local: DeskSnapshot, remote: DeskSnapshot): DeskSnapshot {
  return {
    selectedEventId: local.selectedEventId || remote.selectedEventId,
    watchlists: mergeRows(base?.watchlists, local.watchlists, remote.watchlists, mergeWatchlist),
    alerts: mergeRows(base?.alerts, local.alerts, remote.alerts),
    customScenarios: mergeRows(base?.customScenarios, local.customScenarios, remote.customScenarios),
    deskBooks: mergeRows(base?.deskBooks, local.deskBooks, remote.deskBooks),
    theses: mergeRows(base?.theses, local.theses, remote.theses),
  };
}

/** What to do when the account's cloud desk arrives. */
export function planLoad(
  local: DeskSnapshot,
  sync: SyncMeta,
  remote: { desk: DeskSnapshot; version: number } | null,
): { desk: DeskSnapshot; save: boolean; baseVersion: number } {
  if (!remote) {
    // Nothing in the cloud yet: this partition's own unsynced work is saved;
    // an untouched partition saves nothing. The signed-out desk is never
    // adopted here — that is an explicit import.
    return { desk: local, save: sync.dirty, baseVersion: 0 };
  }
  if (sync.dirty) {
    return { desk: mergeDesk(sync.base, local, remote.desk), save: true, baseVersion: remote.version };
  }
  return { desk: remote.desk, save: false, baseVersion: remote.version };
}

/** Explicit guest import: bring the signed-out desk's rows in without dropping any. */
export function importGuest(current: DeskSnapshot, guest: DeskSnapshot): DeskSnapshot {
  const union = <T extends Keyed>(a: T[] | undefined, b: T[] | undefined) => {
    const ids = new Set((a ?? []).map((r) => r.id));
    return [...(a ?? []), ...(b ?? []).filter((r) => !ids.has(r.id))];
  };
  const watchlists = current.watchlists.map((w) => {
    const g = guest.watchlists.find((x) => x.id === w.id);
    return g ? { ...w, tickers: [...w.tickers, ...g.tickers.filter((t) => !w.tickers.includes(t))] } : w;
  });
  return {
    ...current,
    watchlists: union(watchlists, guest.watchlists),
    alerts: union(current.alerts, guest.alerts),
    customScenarios: union(current.customScenarios, guest.customScenarios),
    deskBooks: union(current.deskBooks, guest.deskBooks),
    theses: union(current.theses, guest.theses),
  };
}

/** A desk with nothing a user put there. */
export function isEmptyDesk(desk: DeskSnapshot | null | undefined): boolean {
  if (!desk) return true;
  return (
    desk.watchlists.every((w) => w.tickers.length === 0) &&
    desk.alerts.length === 0 &&
    desk.customScenarios.length === 0 &&
    (desk.deskBooks ?? []).length === 0 &&
    (desk.theses ?? []).length === 0
  );
}
