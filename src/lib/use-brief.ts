import { useCallback, useEffect, useMemo, useState } from "react";
import { baselineFrom, baselineKey, briefTickers, buildBrief, readBaseline, writeBaseline, type BriefBaseline } from "@/lib/brief";
import { deskKey } from "@/lib/desk-merge";
import { useLive, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";

/** The signed-in identity's brief, compared against its own read-marker. */
export function useBrief() {
  const events = useLiveEvents();
  const quotes = useLive((s) => s.desk?.quotes);
  const watchlists = useApp((s) => s.watchlists);
  const theses = useApp((s) => s.theses);
  const identity = useApp((s) => s.identity);
  const key = identity === undefined ? null : baselineKey(deskKey(identity));
  const [baseline, setBaseline] = useState<BriefBaseline | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setBaseline(key ? readBaseline(key) : null);
  }, [key]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const brief = useMemo(
    () => buildBrief({ events, quotes, watchlists, theses, baseline, now }),
    [events, quotes, watchlists, theses, baseline, now],
  );

  const markRead = useCallback(() => {
    if (!key) return;
    const next = baselineFrom(events, quotes, briefTickers(watchlists, theses), new Date());
    writeBaseline(key, next);
    setBaseline(next);
  }, [key, events, quotes, watchlists, theses]);

  return { brief, markRead, ready: key !== null && events.some((e) => !!e.id) };
}
