import { createFileRoute } from "@tanstack/react-router";
import { CyclePage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/cycle")({
  component: CyclePage,
});
