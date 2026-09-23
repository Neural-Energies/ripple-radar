import { Link, useRouterState } from "@tanstack/react-router";
import { Badge, Delta } from "@/components/ui";
import type {
  Confirmation,
  Crowding,
  ForecastProvenance,
  RadarEvent,
  TriageDisposition,
} from "@/data/types";
import { useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const RESEARCH_TABS = [
  { to: "/maps", label: "Map" },
  { to: "/scenarios", label: "Scenarios" },
  { to: "/game-theory", label: "Game Theory" },
  { to: "/assets", label: "Assets" },
] as const;

function crowdingTone(c?: Crowding): "up" | "warn" | "core" | "neutral" | "primary" {
  if (c === "low" || c === "emerging") return "up";
  if (c === "medium") return "primary";
  if (c === "high") return "warn";
  if (c === "saturated") return "core";
  return "neutral";
}

function confirmationTone(c?: Confirmation): "up" | "warn" | "core" | "neutral" | "primary" {
  if (c === "confirming" || c === "strong") return "up";
  if (c === "early") return "primary";
  if (c === "diverging") return "warn";
  if (c === "invalidating") return "core";
  return "neutral";
}

function dispositionTone(d: TriageDisposition): "up" | "warn" | "core" | "neutral" | "primary" {
  if (d === "onRadar") return "core";
  if (d === "watch") return "primary";
  if (d === "duplicate") return "neutral";
  return "warn"; // drop
}

/** Separate Crowding / Confirmation (+ reserved disposition / modelsDisagree / provenance). */
export function BookStateChips({
  event,
  className,
}: {
  event: Pick<
    RadarEvent,
    | "crowdingState"
    | "confirmationState"
    | "disposition"
    | "modelsDisagree"
    | "provenance"
  >;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {event.crowdingState ? (
        <Badge tone={crowdingTone(event.crowdingState)} title="Positioning / awareness crowding — not confirmation">
          Crowding · {event.crowdingState}
        </Badge>
      ) : null}
      {event.confirmationState && event.confirmationState !== "none" ? (
        <Badge
          tone={confirmationTone(event.confirmationState)}
          title="Market confirmation of the transmission — not crowding"
        >
          Confirmation · {event.confirmationState}
        </Badge>
      ) : null}
      {event.disposition ? (
        <Badge tone={dispositionTone(event.disposition)} title="Triage disposition — not a probability">
          {event.disposition}
        </Badge>
      ) : null}
      {event.modelsDisagree === true ? (
        <Badge tone="neutral" className="opacity-70" title="Ensemble samples disagreed">
          models disagree
        </Badge>
      ) : null}
      {event.provenance ? <ProvenanceChip provenance={event.provenance} /> : null}
    </div>
  );
}

function ProvenanceChip({ provenance }: { provenance: ForecastProvenance }) {
  return (
    <Badge tone="neutral" title="Probability / scenario mass provenance">
      {provenance === "llm_proposal"
        ? "llm"
        : provenance === "calibrated"
          ? "calibrated"
          : provenance === "unchanged"
            ? "unchanged"
            : "heuristic"}
    </Badge>
  );
}

/** Shared chrome for research surfaces — reads global active event (no local chips). */
export function ResearchHeader({
  subtitle,
  showTabs = true,
}: {
  subtitle: string;
  showTabs?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const eventId = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(eventId);
  const empty = !event.id || event.title === "Listening to the world tape";
  const title = empty ? "No active book" : event.title?.trim() || "No active book";

  return (
    <header className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {event.lifecycle ? <Badge tone="up">{event.lifecycle}</Badge> : null}
        {event.eventSubtype || event.eventType ? (
          <Badge tone="primary">{event.eventSubtype ?? event.eventType}</Badge>
        ) : null}
        {event.region && event.region !== "—" ? <Badge tone="neutral">{event.region}</Badge> : null}
        <BookStateChips event={event} />
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-caption tabular-nums text-muted" title="Importance 0–99">
            Imp <span className="text-foreground">{!empty && event.importance != null ? event.importance : "—"}</span>
          </span>
          <span className="font-mono text-caption tabular-nums" title="Probability">
            {empty ? (
              <span className="text-subtle">—%</span>
            ) : (
              <>
                <span className="text-primary">{event.probability}%</span>
                {typeof event.probabilityDelta === "number" && event.probabilityDelta !== 0 ? (
                  <>
                    {" "}
                    <Delta n={event.probabilityDelta} digits={0} />
                  </>
                ) : null}
              </>
            )}
          </span>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-micro uppercase tracking-wider text-subtle">Research · {subtitle}</div>
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h1>
        </div>
        {showTabs ? (
          <nav className="flex shrink-0 gap-0.5" aria-label="Research views">
            {RESEARCH_TABS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                  pathname === t.to || (t.to !== "/" && pathname.startsWith(t.to + "/"))
                    ? "bg-primary/15 text-primary"
                    : "text-muted hover:bg-card-2 hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
