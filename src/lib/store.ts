import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SEED_ALERTS } from "@/data/catalog";
import type { AlertRule, DeskBook, Scenario } from "@/data/types";

export interface CustomScenario extends Scenario {
  eventId: string;
  custom: true;
}

export interface Watchlist {
  id: string;
  name: string;
  tickers: string[];
}

export interface DeskSnapshot {
  selectedEventId: string;
  watchlists: Watchlist[];
  alerts: AlertRule[];
  customScenarios: CustomScenario[];
  deskBooks: DeskBook[];
}

interface AppState extends DeskSnapshot {
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
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
  replaceDesk: (desk: DeskSnapshot) => void;
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
}

const DEFAULT_WATCHLISTS: Watchlist[] = [
  { id: "d1", name: "First-order prints", tickers: [] },
  { id: "d2", name: "Distance 2–3", tickers: [] },
  { id: "conditions", name: "Financial conditions", tickers: [] },
];

export function snapshotDesk(s: DeskSnapshot): DeskSnapshot {
  return {
    selectedEventId: s.selectedEventId,
    watchlists: s.watchlists,
    alerts: s.alerts,
    customScenarios: s.customScenarios,
    deskBooks: s.deskBooks ?? [],
  };
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
      selectedEventId: "",
      setSelectedEventId: (id) => set({ selectedEventId: id }),
      watchlists: DEFAULT_WATCHLISTS,
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
      alerts: SEED_ALERTS,
      toggleAlert: (id) =>
        set({
          alerts: get().alerts.map((a) => (a.id === id ? { ...a, active: !a.active } : a)),
        }),
      addAlert: (alert) =>
        set({
          alerts: [
            {
              ...alert,
              id: "a-" + Date.now().toString(36),
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
      customScenarios: [],
      addScenario: (s) => set({ customScenarios: [...get().customScenarios, s] }),
      deskBooks: [],
      addDeskBook: (book) =>
        set({
          deskBooks: [book, ...get().deskBooks.filter((b) => b.id !== book.id)],
          selectedEventId: book.id,
        }),
      removeDeskBook: (id) => set({ deskBooks: get().deskBooks.filter((b) => b.id !== id) }),
      replaceDesk: (desk) =>
        set({
          selectedEventId: desk.selectedEventId,
          watchlists: desk.watchlists,
          alerts: desk.alerts,
          customScenarios: desk.customScenarios,
          deskBooks: desk.deskBooks ?? [],
        }),
      commandOpen: false,
      setCommandOpen: (v) => set({ commandOpen: v }),
    }),
    {
      name: "ripple-radar-v2",
      skipHydration: true,
      partialize: (s) => snapshotDesk(s),
    },
  ),
);
