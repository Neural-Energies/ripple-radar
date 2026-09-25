import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { useApp } from "@/lib/store";
import { evaluateAlerts } from "./alerts";
import { analyzeEvent, getLiveDesk, rescoreBook } from "./desk";
import { EMPTY_BOOKS, EMPTY_CLUSTERS, EMPTY_HEADLINES } from "./empty";
import { liveAssets, liveEventsList, liveGetAsset, liveGetEvent } from "./overlay";
import type { AlertHit, LiveDesk, RescoreResult } from "./types";

interface LiveState {
  desk: LiveDesk | null;
  status: "idle" | "connecting" | "live" | "degraded";
  error: string | null;
  updatedAt: number;
  rescores: Record<string, RescoreResult>;
  hits: AlertHit[];
  rescoring: string | null;
  analyzing: boolean;
  setDesk: (desk: LiveDesk) => void;
  setError: (error: string | null) => void;
  setConnecting: () => void;
  setRescore: (r: RescoreResult) => void;
  setHits: (hits: AlertHit[]) => void;
  setRescoring: (id: string | null) => void;
  setAnalyzing: (v: boolean) => void;
}

export const useLive = create<LiveState>((set) => ({
  desk: null,
  status: "idle",
  error: null,
  updatedAt: 0,
  rescores: {},
  hits: [],
  rescoring: null,
  analyzing: false,
  setDesk: (desk) =>
    set({
      desk,
      status: desk.status === "live" ? "live" : "degraded",
      error: null,
      updatedAt: Date.now(),
    }),
  setError: (error) => set({ error, status: "degraded" }),
  setConnecting: () => set({ status: "connecting" }),
  setRescore: (r) => set((s) => ({ rescores: { ...s.rescores, [r.eventId]: r }, rescoring: null })),
  setHits: (hits) => set({ hits }),
  setRescoring: (id) => set({ rescoring: id }),
  setAnalyzing: (v) => set({ analyzing: v }),
}));

const LiveCtx = createContext(true);

const POLL_MS = 12_000;

/** One loop for the life of the tab. A remount must not clear it — that was
 * dropping the desk after the first pull while the clock kept ticking. */
function startDeskPoll() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __deskPoll?: boolean };
  if (w.__deskPoll) return;
  w.__deskPoll = true;
  const loop = () => {
    void (async () => {
      try {
        if (!useLive.getState().desk) useLive.getState().setConnecting();
        const desk = await getLiveDesk();
        useLive.getState().setDesk(desk);
      } catch (err) {
        useLive.getState().setError(err instanceof Error ? err.message : "Tape interrupted");
      } finally {
        window.setTimeout(loop, POLL_MS);
      }
    })();
  };
  loop();
}

if (typeof window !== "undefined") startDeskPoll();

export function LiveProvider({ children }: { children: ReactNode }) {
  const setHits = useLive((s) => s.setHits);
  const alerts = useApp((s) => s.alerts);
  const primed = useRef(false);
  const prevHits = useRef<Set<string>>(new Set());

  useEffect(() => {
    startDeskPoll();
  }, []);

  const desk = useLive((s) => s.desk);
  useEffect(() => {
    if (!desk) return;
    const next = evaluateAlerts(alerts, desk);
    setHits(next);
    const ids = new Set(next.map((h) => h.id));
    if (primed.current) {
      for (const hit of next) {
        if (!prevHits.current.has(hit.id)) {
          const rule = alerts.find((a) => a.id === hit.id);
          toast(rule?.title ?? "Alert", { description: hit.reason });
        }
      }
    }
    primed.current = true;
    prevHits.current = ids;
  }, [alerts, desk, setHits]);

  return <LiveCtx.Provider value>{children}</LiveCtx.Provider>;
}

export function useLiveDesk() {
  useContext(LiveCtx);
  return useLive();
}

export function useLiveEvents() {
  const desk = useLive((s) => s.desk);
  const rescores = useLive((s) => s.rescores);
  const deskBooks = useApp((s) => s.deskBooks);
  return useMemo(() => liveEventsList(desk, rescores, deskBooks ?? EMPTY_BOOKS), [desk, rescores, deskBooks]);
}

export function useLiveEvent(id: string) {
  const desk = useLive((s) => s.desk);
  const rescores = useLive((s) => s.rescores);
  const deskBooks = useApp((s) => s.deskBooks);
  return useMemo(() => liveGetEvent(id, desk, rescores, deskBooks ?? EMPTY_BOOKS), [id, desk, rescores, deskBooks]);
}

export function useLiveAssets() {
  const desk = useLive((s) => s.desk);
  const rescores = useLive((s) => s.rescores);
  const deskBooks = useApp((s) => s.deskBooks);
  const selected = useApp((s) => s.selectedEventId);
  const event = useMemo(() => liveGetEvent(selected, desk, rescores, deskBooks ?? EMPTY_BOOKS), [selected, desk, rescores, deskBooks]);
  return useMemo(() => liveAssets(desk, event), [desk, event]);
}

export function useLiveAsset(ticker: string) {
  const desk = useLive((s) => s.desk);
  const rescores = useLive((s) => s.rescores);
  const deskBooks = useApp((s) => s.deskBooks);
  const selected = useApp((s) => s.selectedEventId);
  const event = useMemo(() => liveGetEvent(selected, desk, rescores, deskBooks ?? EMPTY_BOOKS), [selected, desk, rescores, deskBooks]);
  return useMemo(() => liveGetAsset(ticker, desk, event), [ticker, desk, event]);
}

export function useQuote(ticker: string) {
  return useLive((s) => s.desk?.quotes[ticker]);
}

export function useActiveEvent() {
  const events = useLiveEvents();
  const selected = useApp((s) => s.selectedEventId);
  const setSelected = useApp((s) => s.setSelectedEventId);
  const id = events.some((e) => e.id === selected) ? selected : events[0]?.id ?? "";
  useEffect(() => {
    if (id && id !== selected) setSelected(id);
  }, [id, selected, setSelected]);
  return useLiveEvent(id);
}

export async function runRescore(eventId: string) {
  const { setRescoring, setRescore } = useLive.getState();
  const snapshot = liveGetEvent(
    eventId,
    useLive.getState().desk,
    useLive.getState().rescores,
    useApp.getState().deskBooks ?? EMPTY_BOOKS,
  );
  setRescoring(eventId);
  try {
    const out = await rescoreBook({ data: { eventId, snapshot: snapshot.id ? snapshot : undefined } });
    if (out.ok) {
      setRescore(out.result);
      toast("Book rescored", { description: out.result.takeaway });
      return out.result;
    }
    toast("Rescore failed", { description: out.error });
    setRescoring(null);
    return null;
  } catch (err) {
    setRescoring(null);
    toast("Rescore failed", { description: err instanceof Error ? err.message : "Tape error" });
    return null;
  }
}

export async function runAnalyze(text: string) {
  const { setAnalyzing } = useLive.getState();
  setAnalyzing(true);
  try {
    const out = await analyzeEvent({ data: { text } });
    if (!out.ok) {
      toast("Analyze failed", { description: out.error });
      return null;
    }
    const event = { ...out.event, bookSource: out.source };
    useApp.getState().addDeskBook({
      id: event.id,
      title: event.title,
      region: event.region,
      note: text,
      created: new Date().toLocaleString("en-GB", { timeZone: "America/New_York" }),
      payload: event,
    });
    toast(out.source === "model" ? "Book constructed" : "Book constructed from the tape", {
      description: event.summary,
    });
    return event;
  } catch (err) {
    toast("Analyze failed", { description: err instanceof Error ? err.message : "Tape error" });
    return null;
  } finally {
    useLive.getState().setAnalyzing(false);
  }
}

export function useLiveClusters() {
  return useLive((s) => s.desk?.clusters ?? EMPTY_CLUSTERS);
}

export function useAlertHits() {
  return useLive((s) => s.hits);
}

export function alertIsHit(id: string, hits: AlertHit[]) {
  return hits.some((h) => h.id === id);
}
