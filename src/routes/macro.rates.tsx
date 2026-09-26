import { createFileRoute } from "@tanstack/react-router";
import { RatesDetail } from "@/components/macro/mirror";

export const Route = createFileRoute("/macro/rates")({
  component: RatesDetail,
});
