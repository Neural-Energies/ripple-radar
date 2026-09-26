import { createFileRoute } from "@tanstack/react-router";
import { MacroMirror } from "@/components/macro/mirror";

export const Route = createFileRoute("/macro/")({
  component: MacroMirror,
});
