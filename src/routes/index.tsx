import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard";
import { useActiveEvent } from "@/lib/live/provider";
import { validateEventSearch } from "@/lib/hooks/use-event-param-sync";

export const Route = createFileRoute("/")({
  validateSearch: validateEventSearch,
  component: Home,
});

function Home() {
  const event = useActiveEvent();
  return <Dashboard event={event} />;
}
