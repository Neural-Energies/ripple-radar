import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { desktopNotify } from "@/lib/desktop/bridge";
import { plainError } from "@/lib/plain-error";
import { create } from "zustand";
import { useApp } from "@/lib/store";
import { ackAlertDeliveries, getAlertInbox } from "./alert-inbox";
import { evaluateAlerts, stepRule, type Evaluation, type RuleState } from "./alerts";
import { analyzeEvent, getLiveDesk, getQuotes, rescoreBook } from "./desk";
import { readTapePrefs } from "./tape-prefs";
import { EMPTY_BOOKS, EMPTY_CLUSTERS, EMPTY_HEADLINES } from "./empty";
import { liveAssets, liveEventsList, liveGetAsset, liveGetEvent } from "./overlay";
import { DESK_TICKERS } from "./symbols";
import type { AlertHit, LiveDesk, LiveQuote, RescoreResult } from "./types";

type Inbox = Awaited<ReturnType<typeof getAlertInbox>>;

interface LiveState {
  desk: LiveDesk | null;
  status: "idle" | "connecting" | "live" | "degraded";
  error: string | null;
  updatedAt: number;
  rescores: Record<string, RescoreResult>;
  hits: AlertHit[];
  /** Live reading of every rule by id — the same evaluation the server pass runs. */
  alertStatus: Record<string, Evaluation>;
  /** The signed-in account's server-side alert record; null signed out or before the first load. */
  inbox: Inbox | null;
  /** Quotes for held names outside the desk list, merged into `desk.quotes`. */
  extraQuotes: Record<string, LiveQuote>;
  rescoring: string | null;
  analyzing: boolean;
  setDesk: (desk: LiveDesk) => void;
  setExtraQuotes: (quotes: Record<string, LiveQuote>) => void;
  setError: (error: string | null) => void;
  setConnecting: () => void;
  setRescore: (r: RescoreResult) => void;
  setAlerts: (status: Record<string, Evaluation>, hits: AlertHit[]) => void;
  setInbox: (inbox: Inbox | null) => void;
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
  alertStatus: {},
  inbox: null,
  extraQuotes: {},
  rescoring: null,
  analyzing: false,
  setDesk: (desk) =>
    set((s) => ({
      // The desk's own quotes win; held names it does not cover keep their last on-demand quote.
      desk: { ...desk, quotes: { ...s.extraQuotes, ...desk.quotes } },
      status: desk.status === "live" ? "live" : "degraded",
      error: null,
      updatedAt: Date.now(),
    })),
  setExtraQuotes: (extraQuotes) =>
    set((s) => ({
      extraQuotes,
      desk: s.desk ? { ...s.desk, quotes: { ...extraQuotes, ...s.desk.quotes } } : s.desk,
    })),
  setError: (error) => set({ error, status: "degraded" }),
  setConnecting: () => set({ status: "connecting" }),
  setRescore: (r) => set((s) => ({ rescores: { ...s.rescores, [r.eventId]: r }, rescoring: null })),
  setAlerts: (alertStatus, hits) => set({ alertStatus, hits }),
  setInbox: (inbox) => set({ inbox }),
  setRescoring: (id) => set({ rescoring: id }),
  setAnalyzing: (v) => set({ analyzing: v }),
}));

const LiveCtx = createContext(true);

const POLL_MS = 15_000;

function pollDelay() {
  if (typeof window === "undefined") return POLL_MS;
  return readTapePrefs().refreshMs;
}

/** Pull the desk now. `fresh` skips the short server cache so a click is a new fetch. */
export async function refreshDesk(fresh = false) {
  if (!useLive.getState().desk) useLive.getState().setConnecting();
  const desk = await getLiveDesk({ data: { fresh } });
  useLive.getState().setDesk(desk);
  return desk;
}

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
        const desk = await getLiveDesk({ data: { fresh: false } });
        useLive.getState().setDesk(desk);
      } catch (err) {
        useLive.getState().setError(plainError(err, "The tape did not answer. Open Data sources to see which feed failed."));
      } finally {
        window.setTimeout(loop, pollDelay());
      }
    })();
  };
  loop();
}

if (typeof window !== "undefined") startDeskPoll();

const INBOX_POLL_MS = 30_000;

export function LiveProvider({ children }: { children: ReactNode }) {
  const setAlerts = useLive((s) => s.setAlerts);
  const setInbox = useLive((s) => s.setInbox);
  const alerts = useApp((s) => s.alerts);
  const deskBooks = useApp((s) => s.deskBooks);
  const identity = useApp((s) => s.identity);
  const primed = useRef(false);
  const local = useRef<Record<string, RuleState>>({});
  /** Inbox rows already toasted in this tab, so a failed acknowledgement cannot repeat them. */
  const shown = useRef(new Set<number>());

  useEffect(() => {
    startDeskPoll();
  }, []);

  // Live status for the rule list. Signed out, this is also the only monitor,
  // so it notifies on the same episode rule the server uses (fire on the
  // transition into satisfied; outages hold). Signed in, notifications come
  // from the server's durable inbox instead, so nothing is announced twice.
  const desk = useLive((s) => s.desk);
  useEffect(() => {
    if (!desk) return;
    const { status, hits } = evaluateAlerts(alerts, desk, deskBooks ?? EMPTY_BOOKS);
    setAlerts(status, hits);
    const now = Date.now();
    for (const a of alerts) {
      const e = status[a.id];
      if (!e) continue;
      const { next, fired } = stepRule(local.current[a.id] ?? null, e, now);
      local.current[a.id] = next;
      if (fired && primed.current && identity === null && e.status === "ok") {
        const title = a.title || "Alert";
        toast(title, { description: e.reason });
        desktopNotify(title, e.reason);
      }
    }
    primed.current = true;
  }, [alerts, desk, deskBooks, identity, setAlerts]);

  // Held names outside the desk list (watchlists, open theses, alert rules)
  // get their own quotes, refreshed with each desk poll, so an alert or a
  // thesis on them has a price to read.
  const watchlists = useApp((s) => s.watchlists);
  const theses = useApp((s) => s.theses);
  const deskAsOf = desk?.asOf;
  const held = useMemo(() => {
    const onDesk = new Set<string>(DESK_TICKERS);
    const names = new Set<string>([
      ...watchlists.flatMap((w) => w.tickers),
      ...theses.filter((t) => t.status === "open").flatMap((t) => t.instruments.map((i) => i.ticker)),
      ...alerts.map((a) => a.ticker ?? "").filter(Boolean),
    ]);
    return [...names].filter((t) => !onDesk.has(t)).sort().slice(0, 40);
  }, [watchlists, theses, alerts]);
  useEffect(() => {
    if (!deskAsOf || held.length === 0) return;
    let dead = false;
    void getQuotes({ data: { tickers: held } })
      .then((quotes) => {
        if (!dead) useLive.getState().setExtraQuotes(quotes);
      })
      .catch(() => {
        // Keep the last quotes; the next desk poll retries.
      });
    return () => {
      dead = true;
    };
  }, [deskAsOf, held]);

  // The account's server-side alert record: firings recorded while no tab was
  // open are shown once, then acknowledged.
  useEffect(() => {
    if (typeof identity !== "string") {
      setInbox(null);
      return;
    }
    let dead = false;
    let timer = 0;
    const poll = async () => {
      try {
        const inbox = await getAlertInbox();
        if (dead || useApp.getState().identity !== identity) return;
        setInbox(inbox);
        const unseen = inbox.deliveries.filter((d) => d.channel === "inbox" && d.status === "pending");
        const fresh = unseen.filter((d) => !shown.current.has(d.id));
        for (const d of fresh.slice(0, 5)) {
          toast(d.title, { description: d.reason });
          desktopNotify(d.title, d.reason);
        }
        if (fresh.length > 5) {
          const more = `${fresh.length - 5} more alerts`;
          toast(more, { description: "See Alerts for the full record." });
          desktopNotify(more, "See Alerts for the full record.");
        }
        fresh.forEach((d) => shown.current.add(d.id));
        if (unseen.length) await ackAlertDeliveries({ data: { ids: unseen.map((d) => d.id) } });
      } catch {
        // Offline or signed out mid-request: the next poll retries; nothing is acknowledged.
      } finally {
        if (!dead) timer = window.setTimeout(() => void poll(), INBOX_POLL_MS);
      }
    };
    void poll();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [identity, setInbox]);

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
      toast("Book rescored", { description: out.notice ?? out.result.takeaway });
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
    // A notice says why the model was not used (plan, allowance, failure) or
    // that an earlier identical analysis was reused. It is never swallowed.
    toast(out.source === "model" ? "Book constructed" : "Book constructed from the tape", {
      description: out.notice ?? event.summary,
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
