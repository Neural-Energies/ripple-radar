import { createFileRoute } from "@tanstack/react-router";
import { GrowthDetail } from "@/components/macro/mirror";

export const Route = createFileRoute("/macro/growth")({
  component: GrowthDetail,
});
