import { createFileRoute, Link } from "@tanstack/react-router";
import { RippleMap } from "@/components/ripple-map";
import { Badge, Panel } from "@/components/ui";
import { LEVEL_META } from "@/data/catalog";
import { useLiveEvent, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/maps")({ component: MapsPage });

function MapsPage() {
  const id = useApp((s) => s.selectedEventId);
  const setId = useApp((s) => s.setSelectedEventId);
  const events = useLiveEvents();
  const event = useLiveEvent(id);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setId(e.id)}
            title={e.title}
            className={`max-w-52 truncate rounded-md px-3 py-1.5 text-caption ${
              e.id === event.id ? "bg-primary/15 text-foreground" : "bg-card text-muted hover:text-foreground"
            }`}
          >
            {e.title}
          </button>
        ))}
      </div>
      <Panel
        title={`Ripple graph · ${event.title}`}
        action={<Badge tone="primary">{event.probability}%</Badge>}
      >
        <p className="mb-2 text-caption text-muted">
          Each link stores direction, causal distance, confidence, expected lag, and an invalidation
          condition. Click a labeled node to open the asset.
        </p>
        <RippleMap event={event} />
      </Panel>
      <Panel title="Causal links" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-caption">
            <thead className="text-left text-micro uppercase tracking-wider text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Dest</th>
                <th className="px-3 py-2 font-medium">Dir</th>
                <th className="px-3 py-2 font-medium">Dist</th>
                <th className="px-3 py-2 font-medium">Conf</th>
                <th className="px-3 py-2 font-medium">Lag</th>
                <th className="px-3 py-2 font-medium">Invalidation</th>
              </tr>
            </thead>
            <tbody>
              {event.links.map((l) => {
                const src = event.nodes.find((n) => n.id === l.source);
                const dst = event.nodes.find((n) => n.id === l.dest);
                return (
                  <tr key={`${l.source}-${l.dest}`} className="border-b border-border/70">
                    <td className="px-3 py-2">{src?.label}</td>
                    <td className="px-3 py-2">
                      {dst?.ticker ? (
                        <Link
                          to="/assets/$ticker"
                          params={{ ticker: dst.ticker }}
                          className="text-primary hover:underline"
                        >
                          {dst.label}
                        </Link>
                      ) : (
                        dst?.label
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">{l.direction > 0 ? "+" : "−"}</td>
                    <td className="px-3 py-2 font-mono">{l.distance}</td>
                    <td className="px-3 py-2 font-mono">{Math.round(l.confidence * 100)}%</td>
                    <td className="px-3 py-2 text-muted">{l.expectedLag}</td>
                    <td className="px-3 py-2 text-muted">{l.invalidation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="grid gap-2 sm:grid-cols-5">
        {(Object.keys(LEVEL_META) as unknown as Array<0 | 1 | 2 | 3 | 4>).map((lv) => (
          <div key={lv} className="rounded-md bg-card p-3 shadow-[var(--shadow-border)]">
            <div className="mb-1 flex items-center gap-2 text-caption font-medium">
              <span className="size-2 rounded-full" style={{ background: LEVEL_META[lv].color }} />
              {LEVEL_META[lv].label}
            </div>
            <p className="text-tiny text-muted">{LEVEL_META[lv].hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
