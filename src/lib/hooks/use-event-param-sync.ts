import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";

/** Routes that are views of the active research book and sync `?event=`. */
export const EVENT_PARAM_PATHS = [
  "/",
  "/maps",
  "/scenarios",
  "/game-theory",
  "/assets",
  "/portfolio",
] as const;

export type EventSearch = { event?: string };

export function validateEventSearch(raw: Record<string, unknown>): EventSearch {
  return { event: typeof raw.event === "string" ? raw.event : undefined };
}

export function pathUsesEventParam(pathname: string): boolean {
  return (EVENT_PARAM_PATHS as readonly string[]).includes(pathname);
}

/**
 * Keep `useApp.selectedEventId` and `?event=` in sync on book-view routes.
 * - URL known id → store
 * - URL missing/unknown → heal to selected or first live event, write URL (replace)
 */
export function useEventParamSync() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const urlEvent = useRouterState({
    select: (s) => {
      const search = s.location.search as Record<string, unknown>;
      return typeof search?.event === "string" ? search.event : undefined;
    },
  });
  const navigate = useNavigate();
  const selected = useApp((s) => s.selectedEventId);
  const setSelected = useApp((s) => s.setSelectedEventId);
  const events = useLiveEvents();
  const enabled = pathUsesEventParam(pathname);

  useEffect(() => {
    if (!enabled) return;
    if (events.length === 0) return;

    const known = (id: string) => events.some((e) => e.id === id);

    if (urlEvent && known(urlEvent)) {
      if (urlEvent !== selected) setSelected(urlEvent);
      return;
    }

    const healed = known(selected) ? selected : events[0]!.id;
    if (healed !== selected) setSelected(healed);
    if (urlEvent !== healed) {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, event: healed }),
        replace: true,
      });
    }
  }, [enabled, events, navigate, selected, setSelected, urlEvent]);
}
