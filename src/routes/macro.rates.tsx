import { createFileRoute } from "@tanstack/react-router";
import { RatesPage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/rates")({
  component: RatesPage,
});
