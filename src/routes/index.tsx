import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard";
import { useActiveEvent } from "@/lib/live/provider";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const event = useActiveEvent();
  return <Dashboard event={event} />;
}
