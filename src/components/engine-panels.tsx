import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { FilterLink, TickerLink } from "@/components/desk-nav";
import { Badge, Panel } from "@/components/ui";
import type { KnowledgeKind, RadarEvent } from "@/data/types";
import { observedShare } from "@/lib/ace/expected-evidence";
import { ENGINE_STEPS, stageOf } from "@/lib/engine/pipeline";
import { goToEvent } from "@/lib/hooks/use-event-param-sync";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const STEP_HREF: Record<string, "/events" | "/scenarios" | "/game-theory" | "/maps" | "/assets" | "/learning" | "/"> = {
  detect: "/events",
  understand: "/events",
  hypothesize: "/scenarios",
  probability: "/scenarios",
  players: "/game-theory",
  graph: "/maps",
  exposures: "/assets",
  markets: "/assets",
  update: "/",
  invalidate: "/",
  learn: "/learning",
};

const KIND_TONE: Record<KnowledgeKind, "up" | "primary" | "warn" | "neutral" | "core"> = {
  known: "up",
  likely: "primary",
  uncertain: "warn",
  unknown: "neutral",
  critical: "core",
};

export function PipelineStrip({ lifecycle }: { lifecycle?: string }) {
  const current = stageOf(lifecycle);
  const idx = ENGINE_STEPS.findIndex((s) => s.id === current);
  return (
    <Panel title="Engine">
      <ol className="flex flex-wrap gap-1">
        {ENGINE_STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1">
            <Link
              to={STEP_HREF[s.id] ?? "/"}
              className={cn(
                "rounded-sm px-2 py-1 text-micro uppercase tracking-wider hover:underline",
                i === idx ? "bg-primary/15 text-primary" : i < idx ? "bg-card-3 text-foreground" : "text-subtle",
              )}
            >
              {s.label}
            </Link>
            {i < ENGINE_STEPS.length - 1 && <span className="text-subtle">→</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
