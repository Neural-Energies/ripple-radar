import { createFileRoute } from "@tanstack/react-router";
import { PolicyPage } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro/policy")({
  component: PolicyPage,
});
