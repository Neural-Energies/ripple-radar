import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Badge, Panel } from "@/components/ui";
import type { KnowledgeKind, RadarEvent } from "@/data/types";
import { observedShare } from "@/lib/ace/expected-evidence";
import { ENGINE_STEPS, stageOf } from "@/lib/engine/pipeline";
import { goToEvent } from "@/lib/hooks/use-event-param-sync";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

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
            <span
              className={cn(
                "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                i === idx ? "bg-primary/15 text-primary" : i < idx ? "bg-card-3 text-foreground" : "text-subtle",
              )}
            >
              {s.label}
            </span>
            {i < ENGINE_STEPS.length - 1 && <span className="text-subtle">→</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function HorizonPanel({ event }: { event: RadarEvent }) {
  const rows = event.horizons ?? [];
  if (!rows.length) return null;
  return (
    <Panel title="Horizon probabilities">
      <ul className="flex flex-col gap-2">
        {rows.map((h) => (
          <li key={h.horizon}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-tiny text-primary">{h.horizon}</span>
              <span className="font-mono text-sm tabular-nums">{h.probability}%</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-card-3">
              <div className="h-full rounded-full bg-primary" style={{ width: `${h.probability}%` }} />
            </div>
            <p className="mt-1 text-micro text-muted">{h.note}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function KnowledgePanel({ event }: { event: RadarEvent }) {
  const items = event.knowledge ?? [];
  if (!items.length) return null;
  return (
    <Panel title="Research state">
      <ul className="flex flex-col gap-2">
        {items.map((k) => (
          <li key={k.kind + k.text.slice(0, 24)} className="min-w-0 rounded-md bg-card-2 px-2.5 py-2">
            <Badge tone={KIND_TONE[k.kind]}>{k.kind}</Badge>
            <p className="mt-1 break-words text-caption text-foreground">{k.text}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ExpectedEvidencePanel({ event }: { event: RadarEvent }) {
  const rows = event.expectedEvidence ?? [];
  const byId = new Map(event.evidence.map((e) => [e.id, e]));
  if (!rows.length) return null;
  const { observed, total } = observedShare(rows);
  return (
    <Panel
      title="Expected evidence"
      action={
        total > 0 ? (
          <span className="font-mono text-micro text-muted">
            {observed}/{total} observed
          </span>
        ) : (
          <span className="font-mono text-micro text-subtle">not testable</span>
        )
      }
    >
      <ul className="flex flex-col gap-2">
        {rows.map((e) => {
          const source = e.matchedBy ? byId.get(e.matchedBy) : undefined;
          return (
            <li key={e.id} className="min-w-0 rounded-md bg-card-2 px-2.5 py-2">
              <div className="text-micro uppercase tracking-wider text-subtle">If {e.ifTrue}</div>
              <p className="mt-1 break-words text-caption">Then within {e.lag}: {e.observe}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={e.appeared ? "up" : e.watch ? "neutral" : "warn"}>
                  {e.appeared ? "observed" : e.watch ? "awaiting" : "no test defined"}
                </Badge>
                {e.watch && !e.appeared && (
                  <span className="font-mono text-micro text-subtle">
                    watching {[...e.watch.tickers, ...e.watch.terms].slice(0, 4).join(" · ")}
                  </span>
                )}
              </div>
              {/* The claim is only as good as the item behind it — always show it. */}
              {e.appeared && e.matchedHeadline && (
                <p className="mt-1 break-words text-micro text-muted">
                  Satisfied by{source ? ` ${source.source}` : ""}:{" "}
                  {source?.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline-offset-2 hover:text-primary hover:underline"
                    >
                      {e.matchedHeadline}
                    </a>
                  ) : (
                    <span className="text-foreground">{e.matchedHeadline}</span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function RelatedEventsPanel({ event }: { event: RadarEvent }) {
  const setEvent = useApp((s) => s.setSelectedEventId);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rows = event.relatedEvents ?? [];
  if (!rows.length) {
    return (
      <Panel title="Event graph">
        <p className="text-caption text-muted">No interacting books yet.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Event graph">
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.targetId}>
            <button
              type="button"
              onClick={() => {
                setEvent(r.targetId);
                goToEvent(navigate, pathname, r.targetId);
              }}
              className="w-full rounded-md bg-card-2 px-2.5 py-2 text-left hover:bg-card-3"
            >
              <Badge tone="primary">{r.kind.replace(/_/g, " ")}</Badge>
              <div className="mt-1 text-caption font-medium">{r.targetTitle}</div>
              <p className="mt-0.5 text-micro text-muted">{r.note}</p>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ActorsPanel({ event }: { event: RadarEvent }) {
  const orgs = event.organizations ?? [];
  const people = event.people ?? [];
  const entities = event.entities ?? [];
  if (!orgs.length && !people.length && !entities.length) return null;
  return (
    <Panel title="Discovered actors">
      <div className="flex flex-wrap gap-1">
        {orgs.map((n) => (
          <Badge key={n} tone="primary">
            {n}
          </Badge>
        ))}
        {people.map((n) => (
          <Badge key={n} tone="warn">
            {n}
          </Badge>
        ))}
        {entities
          .filter((e) => !orgs.includes(e) && !people.includes(e))
          .slice(0, 8)
          .map((n) => (
            <Badge key={n} tone="neutral">
              {n}
            </Badge>
          ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-micro text-muted">
        <div>Industries: {(event.industries ?? []).join(", ") || "—"}</div>
        <div>Commodities: {(event.commodities ?? []).join(", ") || "—"}</div>
        <div className="col-span-2">Macro: {(event.economicVariables ?? []).join(", ") || "—"}</div>
      </div>
      <Link to="/game-theory" className="mt-2 inline-block text-micro text-primary hover:underline">
        Open game theory →
      </Link>
    </Panel>
  );
}

export function ImportanceMeter({ event }: { event: RadarEvent }) {
  const imp = event.importance ?? 0;
  const p = event.probability;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-micro uppercase tracking-wider text-subtle">Importance</div>
        <div className="font-mono text-lg tabular-nums text-foreground">{imp}</div>
        <p className="text-micro text-muted">≠ probability</p>
      </div>
      <div>
        <div className="text-micro uppercase tracking-wider text-subtle">Scenario mass</div>
        <div className="font-mono text-lg tabular-nums text-primary">{p}%</div>
        <p className="text-micro text-muted">Leading family</p>
      </div>
    </div>
  );
}
