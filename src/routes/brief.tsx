import { createFileRoute } from "@tanstack/react-router";
import { BriefView } from "@/components/brief";
import { MorningBriefing } from "@/components/morning-briefing";
import { useMacroState } from "@/lib/ace/macro-state";
import { useBrief } from "@/lib/use-brief";

export const Route = createFileRoute("/brief")({ component: BriefPage });

function BriefPage() {
  const { brief, markRead } = useBrief();
  const macro = useMacroState();
  return (
    <div className="flex flex-col gap-3">
      <MorningBriefing />
      <BriefView brief={brief} macro={macro} onMarkRead={markRead} />
    </div>
  );
}
