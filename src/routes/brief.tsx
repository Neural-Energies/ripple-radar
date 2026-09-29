import { createFileRoute } from "@tanstack/react-router";
import { BriefView } from "@/components/brief";
import { useMacroState } from "@/lib/ace/macro-state";
import { useBrief } from "@/lib/use-brief";

export const Route = createFileRoute("/brief")({ component: BriefPage });

function BriefPage() {
  const { brief, markRead } = useBrief();
  const macro = useMacroState();
  return <BriefView brief={brief} macro={macro} onMarkRead={markRead} />;
}
