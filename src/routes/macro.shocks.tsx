import { createFileRoute } from "@tanstack/react-router";
import { ShocksPage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/shocks")({
  component: ShocksPage,
});
