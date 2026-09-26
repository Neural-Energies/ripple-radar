import { createFileRoute } from "@tanstack/react-router";
import { ModelsPage } from "@/components/macro/overview";

export const Route = createFileRoute("/macro/models")({
  component: ModelsPage,
});
