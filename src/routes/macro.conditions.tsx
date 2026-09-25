import { createFileRoute } from "@tanstack/react-router";
import { ConditionsPage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/conditions")({
  component: ConditionsPage,
});
