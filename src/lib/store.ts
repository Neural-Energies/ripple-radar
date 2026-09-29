import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AlertRule, DeskBook, Thesis } from "@/data/types";
import { CLEAN_SYNC, deskKey, GUEST_DESK_KEY, type SyncMeta } from "@/lib/desk-merge";
import { EMPTY_DESK, normalizeDesk, snapshotDesk, type CustomScenario, type DeskSnapshot } from "@/lib/desk-model";

export type { CustomScenario, DeskSnapshot, Watchlist } from "@/lib/desk-model";
export { EMPTY_DESK, normalizeDesk, snapshotDesk } from "@/lib/desk-model";

interface AppState extends DeskSnapshot {
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  /** Whose desk is in memory: undefined until auth resolves, null signed out. */
  identity: string | null | undefined;
  /** Cloud agreement for this partition. Persisted, so a reload cannot lose unsynced work. */
  sync: SyncMeta;
  setSync: (sync: SyncMeta) => void;
  setSelectedEventId: (id: string) => void;
  addToWatchlist: (listId: string, ticker: string) => void;
  removeFromWatchlist: (listId: string, ticker: string) => void;
  createWatchlist: (name: string) => void;
  toggleAlert: (id: string) => void;
  addAlert: (alert: Omit<AlertRule, "id" | "created">) => void;
  dismissAlert: (id: string) => void;
  addScenario: (s: CustomScenario) => void;
  addDeskBook: (book: DeskBook) => void;
  removeDeskBook: (id: string) => void;
  addThesis: (thesis: Thesis) => void;
  reviewThesis: (id: string, review: NonNullable<Thesis["review"]>) => void;
  removeThesis: (id: string) => void;
  replaceDesk: (desk: DeskSnapshot) => void;
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...EMPTY_DESK,
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
      identity: undefined,
      sync: CLEAN_SYNC,
      setSync: (sync) => set({ sync }),
      setSelectedEventId: (id) => set({ selectedEventId: id }),
      addToWatchlist: (listId, ticker) => {
        set({
          watchlists: get().watchlists.map((w) =>
            w.id === listId && !w.tickers.includes(ticker)
              ? { ...w, tickers: [...w.tickers, ticker] }
              : w,
          ),
        });
      },
      removeFromWatchlist: (listId, ticker) => {
        set({
          watchlists: get().watchlists.map((w) =>
            w.id === listId ? { ...w, tickers: w.tickers.filter((t) => t !== ticker) } : w,
          ),
        });
      },
      createWatchlist: (name) => {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
        set({ watchlists: [...get().watchlists, { id, name, tickers: [] }] });
      },
      toggleAlert: (id) =>
        set({
          alerts: get().alerts.map((a) => (a.id === id ? { ...a, active: !a.active } : a)),
        }),
      addAlert: (alert) =>
        set({
          alerts: [
            {
              ...alert,
              id: newId("a"),
              created: new Date().toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }),
            },
            ...get().alerts,
          ],
        }),
      dismissAlert: (id) => set({ alerts: get().alerts.filter((a) => a.id !== id) }),
      addScenario: (s) => set({ customScenarios: [...get().customScenarios, s] }),
      addDeskBook: (book) =>
        set({
          deskBooks: [book, ...get().deskBooks.filter((b) => b.id !== book.id)],
          selectedEventId: book.id,
        }),
      removeDeskBook: (id) => set({ deskBooks: get().deskBooks.filter((b) => b.id !== id) }),
      addThesis: (thesis) => set({ theses: [thesis, ...get().theses.filter((t) => t.id !== thesis.id)] }),
      reviewThesis: (id, review) =>
        set({
          theses: get().theses.map((t) => (t.id === id ? { ...t, status: "reviewed", review } : t)),
        }),
      removeThesis: (id) => set({ theses: get().theses.filter((t) => t.id !== id) }),
      replaceDesk: (desk) => set(normalizeDesk(desk)),
      commandOpen: false,
      setCommandOpen: (v) => set({ commandOpen: v }),
    }),
    {
      name: GUEST_DESK_KEY,
      // The global, not `window.localStorage`: identical in the browser, and
      // it lets the partition tests run against a real Storage in Node.
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ ...snapshotDesk(s), sync: s.sync }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DeskSnapshot> & { sync?: SyncMeta };
        return { ...current, ...normalizeDesk(p), sync: p.sync ?? CLEAN_SYNC };
      },
    },
  ),
);

/** The stored desk in one partition, read without touching any other. */
export function readPartition(key: string): { desk: DeskSnapshot; sync: SyncMeta } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: Partial<DeskSnapshot> & { sync?: SyncMeta } };
    if (!parsed?.state) return null;
    return { desk: normalizeDesk(parsed.state), sync: parsed.state.sync ?? CLEAN_SYNC };
  } catch {
    return null;
  }
}

/**
 * Point the store at `userId`'s partition and load exactly what is stored
 * there — nothing from the previous identity stays in memory, and nothing is
 * written into either partition until the new identity changes something.
 */
export function switchIdentity(userId: string | null) {
  const key = deskKey(userId);
  const stored = readPartition(key);
  useApp.persist.setOptions({ name: key });
  useApp.setState({
    ...EMPTY_DESK,
    ...(stored?.desk ?? {}),
    sync: stored?.sync ?? CLEAN_SYNC,
    identity: userId,
  });
}
