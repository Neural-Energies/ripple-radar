import { Badge, Panel } from "@/components/ui";
import type { EvidenceItem, RadarEvent, RippleLevel } from "@/data/types";

const ORDER: Record<RippleLevel, string> = {
  0: "Event",
  1: "Direct",
  2: "Second-order",
  3: "Third-order",
  4: "Further",
};

/**
 * The book's own causal graph, read in order.
 * A later hop is inferred from the ontology unless a story on this book names it.
 * Nothing here is added that the graph did not already contain.
 */
export function RippleChain({ event }: { event: RadarEvent }) {
  const blob = [
    event.title,
    event.story,
    ...(event.evidence ?? []).map((e: EvidenceItem) => `${e.headline} ${e.source}`),
  ]
    .join(" \n ")
    .toLowerCase();

  const byLevel = [0, 1, 2, 3, 4].map((level) => ({
    level: level as RippleLevel,
    nodes: event.nodes.filter((n) => n.level === level),
  })).filter((row) => row.nodes.length > 0);

  if (byLevel.length === 0) {
    return (
      <Panel title="Ripple chain">
        <p className="text-caption text-muted">No chain on this book yet.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Ripple chain" action={<span className="text-micro text-subtle">event → markets</span>}>
      <ol className="flex flex-col gap-2">
        {byLevel.map((row) => (
          <li key={row.level}>
            <div className="text-micro uppercase tracking-wider text-subtle">{ORDER[row.level]}</div>
            <ul className="mt-1 flex flex-col gap-1">
              {row.nodes.map((n) => {
                const link = event.links.find((l) => l.dest === n.id);
                const named =
                  row.level === 0 ||
                  blob.includes(n.label.toLowerCase()) ||
                  (n.ticker ? blob.includes(n.ticker.toLowerCase()) : false);
                return (
                  <li key={n.id} className="rounded-sm bg-card-2 px-2 py-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-caption font-medium leading-snug">
                        {n.ticker ? <span className="font-mono text-primary">{n.ticker} </span> : null}
                        {n.label}
                      </span>
                      <Badge tone={named ? "up" : "neutral"}>{named ? "named" : "inferred"}</Badge>
                    </div>
                    <p className="mt-0.5 text-micro text-muted">{n.blurb}</p>
                    {link ? (
                      <p className="mt-0.5 font-mono text-micro text-subtle">
                        {link.direction > 0 ? "up" : "down"} · {link.expectedLag} ·{" "}
                        {link.confidence == null
                          ? "unmeasured link"
                          : `${Math.round(link.confidence * 100)}% link`}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
