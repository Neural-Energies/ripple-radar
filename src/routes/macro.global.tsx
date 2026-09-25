import { createFileRoute } from "@tanstack/react-router";
import { GlobalDetail } from "@/components/macro/mirror";

export const Route = createFileRoute("/macro/global")({
  component: GlobalDetail,
});
