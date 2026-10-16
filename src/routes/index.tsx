import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard";
import { useActiveEvent } from "@/lib/live/provider";
import { validateEventSearch } from "@/lib/hooks/use-event-param-sync";

export const Route = createFileRoute("/")({
  validateSearch: validateEventSearch,
  component: Home,
});

const LANDED_KEY = "ripple-landed";

function Home() {
  const event = useActiveEvent();
  const navigate = useNavigate();
  // Read the URL as opened, before the desk syncs an event into it.
  const openedWithEvent = useRef(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("event"),
  );
  // Briefing-first: the first open of a session lands on the Morning Briefing.
  useEffect(() => {
    try {
      if (!openedWithEvent.current && !sessionStorage.getItem(LANDED_KEY)) {
        sessionStorage.setItem(LANDED_KEY, "1");
        void navigate({ to: "/brief", replace: true });
      }
    } catch {
      // Storage blocked: stay on the desk.
    }
  }, [navigate]);
  return <Dashboard event={event} />;
}
