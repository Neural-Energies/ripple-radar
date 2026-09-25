import { createFileRoute } from "@tanstack/react-router";
import { InflationPage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/inflation")({
  component: InflationPage,
});
