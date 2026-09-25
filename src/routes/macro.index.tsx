import { createFileRoute } from "@tanstack/react-router";
import { MacroOverview } from "@/components/macro/overview";
import { useMacroRegime } from "@/components/macro-strip";

export const Route = createFileRoute("/macro/")({
  component: MacroOverviewPage,
});

function MacroOverviewPage() {
  const read = useMacroRegime();
  return <MacroOverview read={read} />;
}
