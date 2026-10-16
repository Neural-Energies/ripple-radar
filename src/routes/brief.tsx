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
    <div className="flex flex-col gap-6">
      <MorningBriefing />
      <details className="group rounded-xl bg-card shadow-[var(--shadow-border)]" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="text-base font-semibold tracking-tight">Your desk brief</span>
          <span className="text-tiny text-subtle transition-transform duration-200 group-open:rotate-90">›</span>
        </summary>
        <div className="px-3 pb-3">
          <BriefView brief={brief} macro={macro} onMarkRead={markRead} />
        </div>
      </details>
    </div>
  );
}
