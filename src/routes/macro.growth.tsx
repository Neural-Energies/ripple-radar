import { createFileRoute } from "@tanstack/react-router";
import { GrowthPage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/growth")({
  component: GrowthPage,
});
