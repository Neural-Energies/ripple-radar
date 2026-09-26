import { createFileRoute } from "@tanstack/react-router";
import { InflationDetail } from "@/components/macro/mirror";

export const Route = createFileRoute("/macro/inflation")({
  component: InflationDetail,
});
