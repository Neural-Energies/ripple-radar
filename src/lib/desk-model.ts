/**
 * The desk's data model, free of any storage or UI dependency so the server
 * can validate and normalize it too.
 */
import type { AlertRule, DeskBook, Scenario, Thesis } from "@/data/types";

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
  theses: Thesis[];
}

const DEFAULT_WATCHLISTS: Watchlist[] = [
  { id: "d1", name: "First-order prints", tickers: [] },
  { id: "d2", name: "Distance 2–3", tickers: [] },
  { id: "conditions", name: "Financial conditions", tickers: [] },
];

export const EMPTY_DESK: DeskSnapshot = {
  selectedEventId: "",
  watchlists: DEFAULT_WATCHLISTS,
  alerts: [],
  customScenarios: [],
  deskBooks: [],
  theses: [],
};

export function snapshotDesk(s: DeskSnapshot): DeskSnapshot {
  return {
    selectedEventId: s.selectedEventId,
    watchlists: s.watchlists,
    alerts: s.alerts,
    customScenarios: s.customScenarios,
    deskBooks: s.deskBooks ?? [],
    theses: s.theses ?? [],
  };
}

export function normalizeDesk(raw: Partial<DeskSnapshot> | null | undefined): DeskSnapshot {
  return {
    selectedEventId: typeof raw?.selectedEventId === "string" ? raw.selectedEventId : "",
    watchlists: Array.isArray(raw?.watchlists) ? raw.watchlists : DEFAULT_WATCHLISTS,
    alerts: Array.isArray(raw?.alerts) ? raw.alerts : [],
    customScenarios: Array.isArray(raw?.customScenarios) ? raw.customScenarios : [],
    deskBooks: Array.isArray(raw?.deskBooks) ? raw.deskBooks : [],
    theses: Array.isArray(raw?.theses) ? raw.theses : [],
  };
}
