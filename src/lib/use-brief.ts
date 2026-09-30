import { useCallback, useEffect, useMemo, useState } from "react";
import { baselineFrom, baselineKey, briefTickers, buildBrief, readBaseline, writeBaseline, type BriefBaseline } from "@/lib/brief";
import { deskKey } from "@/lib/desk-merge";
import { getReleaseCalendar } from "@/lib/live/desk";
import type { ReleaseCalendar } from "@/lib/live/release-calendar";
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

  const [calendar, setCalendar] = useState<ReleaseCalendar | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void getReleaseCalendar()
        .then((c) => live && setCalendar(c))
        .catch(() => live && setCalendar({ status: "unavailable", detail: "Release calendar request failed.", fetchedAt: new Date().toISOString(), items: [] }));
    load();
    const t = window.setInterval(load, 60 * 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);

  const brief = useMemo(
    () => buildBrief({ events, quotes, watchlists, theses, baseline, now, calendar }),
    [events, quotes, watchlists, theses, baseline, now, calendar],
  );

  const markRead = useCallback(() => {
    if (!key) return;
    const next = baselineFrom(events, quotes, briefTickers(watchlists, theses), new Date());
    writeBaseline(key, next);
    setBaseline(next);
  }, [key, events, quotes, watchlists, theses]);

  return { brief, markRead, ready: key !== null && events.some((e) => !!e.id) };
}
