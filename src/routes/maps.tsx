import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ResearchHeader } from "@/components/research-header";
import { RippleMap } from "@/components/ripple-map";
import { KnowledgePanel, PipelineStrip, RelatedEventsPanel } from "@/components/engine-panels";
import { Badge, Panel } from "@/components/ui";
import { LEVEL_META } from "@/data/catalog";
import type { RadarEvent, RippleNode } from "@/data/types";
import { nodeNavTarget } from "@/lib/engine/instruments";
import { validateEventSearch } from "@/lib/hooks/use-event-param-sync";
import { useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/maps")({
  validateSearch: validateEventSearch,
  component: MapsPage,
});

function MapsPage() {
  const id = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(id);
  const core = event.nodes.find((n) => n.level === 0) ?? event.nodes[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(core?.id ?? null);

  const selected = useMemo(
    () => event.nodes.find((n) => n.id === selectedId) ?? core,
    [event.nodes, selectedId, core],
  );

  function pickNode(node: RippleNode) {
    setSelectedId(node.id);
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <ResearchHeader subtitle="Ripple Map" showTabs={false} />
      <div className="grid min-h-[calc(100vh-10rem)] grid-cols-1 items-start gap-1.5 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Panel
          title="Causal map"
          className="min-h-[26rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col p-1"
        >
          <div className="min-h-[24rem] flex-1 xl:min-h-[32rem]">
            <RippleMap event={event} selectedId={selected?.id} onSelect={pickNode} />
          </div>
        </Panel>
        <Panel
          title="Node inspector"
          action={
            selected ? (
              <span className="font-mono text-micro text-muted">{LEVEL_META[selected.level].label}</span>
            ) : null
          }
          className="min-h-[16rem]"
        >
          <NodeInspector event={event} node={selected} onSelect={setSelectedId} />
        </Panel>
        <PipelineStrip lifecycle={event.lifecycle} />
        <RelatedEventsPanel event={event} />
        <KnowledgePanel event={event} />
      </div>
      <Panel title="Causal links" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-caption">
            <thead className="text-left text-micro uppercase tracking-wider text-subtle">
              <tr className="border-b border-border">
                <th className="px-2 py-1 font-medium">Source</th>
                <th className="px-2 py-1 font-medium">Dest</th>
                <th className="px-2 py-1 font-medium">Dir</th>
                <th className="px-2 py-1 font-medium">Dist</th>
                <th className="px-2 py-1 font-medium">Conf</th>
                <th className="px-2 py-1 font-medium">Lag</th>
                <th className="px-2 py-1 font-medium">Invalidation</th>
              </tr>
            </thead>
            <tbody>
              {event.links.map((l) => {
                const src = event.nodes.find((n) => n.id === l.source);
                const dst = event.nodes.find((n) => n.id === l.dest);
                const hot = selected && (l.source === selected.id || l.dest === selected.id);
                return (
                  <tr
                    key={`${l.source}-${l.dest}`}
                    className={cn(
                      "cursor-pointer border-b border-border/70 hover:bg-card-2",
                      hot && "bg-primary/10",
                    )}
                    onClick={() => {
                      const n = dst ?? src;
                      if (n) setSelectedId(n.id);
                    }}
                  >
                    <td className="px-2 py-1">{src?.label}</td>
                    <td className="px-2 py-1">
                      {dst ? (
                        (() => {
                          const t = nodeNavTarget(dst, event);
                          if (t?.kind === "ticker") {
                            return (
                              <Link
                                to="/assets/$ticker"
                                params={{ ticker: t.ticker }}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {dst.label}
                              </Link>
                            );
                          }
                          if (t?.kind === "filter") {
                            return (
                              <Link
                                to="/assets"
                                search={{ q: t.q }}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {dst.label}
                              </Link>
                            );
                          }
                          return dst.label;
                        })()
                      ) : null}
                    </td>
                    <td className="px-2 py-1 font-mono">{l.direction > 0 ? "+" : "−"}</td>
                    <td className="px-2 py-1 font-mono tabular-nums">{l.distance}</td>
                    <td className="px-2 py-1 font-mono tabular-nums">{Math.round(l.confidence * 100)}%</td>
                    <td className="px-2 py-1 text-muted">{l.expectedLag}</td>
                    <td className="max-w-[18rem] truncate px-2 py-1 text-muted">{l.invalidation}</td>
                  </tr>
                );
              })}
              {event.links.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-muted">
                    No links on this book yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function NodeInspector({
  event,
  node,
  onSelect,
}: {
  event: RadarEvent;
  node: RippleNode | null;
  onSelect: (id: string) => void;
}) {
  if (!node) {
    return <p className="text-caption text-muted">Click a node to inspect transmission.</p>;
  }
  const nav = nodeNavTarget(node, event);
  const tradeTicker = node.ticker ?? (nav?.kind === "ticker" ? nav.ticker : undefined);
  const trade = tradeTicker ? event.trades.find((t) => t.ticker === tradeTicker) : undefined;
  const incoming = event.links.filter((l) => l.dest === node.id);
  const outgoing = event.links.filter((l) => l.source === node.id);
  const meta = LEVEL_META[node.level];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-caption font-medium leading-snug">{node.label}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {nav?.kind === "ticker" ? (
              <Link
                to="/assets/$ticker"
                params={{ ticker: nav.ticker }}
                className="font-mono text-micro text-primary hover:underline"
              >
                {nav.ticker}
              </Link>
            ) : nav?.kind === "filter" ? (
              <Link
                to="/assets"
                search={{ q: nav.q }}
                className="text-micro text-primary hover:underline"
              >
                assets · {nav.q}
              </Link>
            ) : null}
            <Badge tone="neutral">{node.kind}</Badge>
            <Badge tone={node.direction === "down" ? "down" : node.direction === "up" ? "up" : "neutral"}>
              {node.direction}
            </Badge>
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-micro tabular-nums text-muted">
          <div>impact {node.impact}</div>
          <div className="text-subtle">{meta.label}</div>
        </div>
      </div>
      <p className="text-caption leading-snug text-muted">{node.blurb}</p>
      {trade ? (
        <div className="rounded-sm bg-card-2 px-2 py-1.5">
          <div className="text-micro uppercase tracking-wider text-subtle">Expression</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption">
            <Link
              to="/assets/$ticker"
              params={{ ticker: trade.ticker }}
              className="font-mono text-primary hover:underline"
            >
              {trade.ticker}
            </Link>
            <span className="text-muted">{trade.side}</span>
            {trade.crowding ? <Badge tone="warn">{trade.crowding}</Badge> : null}
            {trade.confirmation ? <Badge tone="primary">{trade.confirmation}</Badge> : null}
          </div>
          {trade.causalPath ? <p className="mt-1 text-micro text-subtle">{trade.causalPath}</p> : null}
        </div>
      ) : null}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <div>
          <div className="text-micro uppercase tracking-wider text-subtle">Links</div>
          <ul className="mt-1 flex flex-col gap-1">
            {/* Walking the chain is the point of a causal map: each link steps
                the inspector to the node on the other end of it. */}
            {incoming.map((l) => {
              const src = event.nodes.find((n) => n.id === l.source);
              return (
                <LinkStep
                  key={`in-${l.source}`}
                  arrow="←"
                  label={src?.label ?? l.source}
                  distance={l.distance}
                  confidence={l.confidence}
                  disabled={!src}
                  onSelect={() => src && onSelect(src.id)}
                />
              );
            })}
            {outgoing.map((l) => {
              const dst = event.nodes.find((n) => n.id === l.dest);
              return (
                <LinkStep
                  key={`out-${l.dest}`}
                  arrow="→"
                  label={dst?.label ?? l.dest}
                  distance={l.distance}
                  confidence={l.confidence}
                  disabled={!dst}
                  onSelect={() => dst && onSelect(dst.id)}
                />
              );
            })}
          </ul>
        </div>
      )}
      {incoming[0]?.invalidation ? (
        <p className="text-micro text-subtle">Kill: {incoming[0].invalidation}</p>
      ) : outgoing[0]?.invalidation ? (
        <p className="text-micro text-subtle">Kill: {outgoing[0].invalidation}</p>
      ) : null}
    </div>
  );
}

/** One hop of the causal chain — click or Enter to step the inspector there. */
function LinkStep({
  arrow,
  label,
  distance,
  confidence,
  disabled,
  onSelect,
}: {
  arrow: string;
  label: string;
  distance: number;
  confidence: number;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        title={disabled ? "This node is not on the current graph" : `Inspect ${label}`}
        className={cn(
          "flex w-full items-baseline gap-1 rounded-sm px-1 py-0.5 text-left text-caption text-muted",
          disabled ? "cursor-default" : "hover:bg-card-2 hover:text-foreground",
        )}
      >
        <span className="text-subtle">{arrow}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 font-mono text-micro tabular-nums">
          d{distance} · {Math.round(confidence * 100)}%
        </span>
      </button>
    </li>
  );
}
