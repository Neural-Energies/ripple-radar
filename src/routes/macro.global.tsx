import { createFileRoute } from "@tanstack/react-router";
import { GlobalPage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/global")({
  component: GlobalPage,
});
