import { useMemo, useState } from "react";
import type { RadarEvent } from "@/data/types";
import type { LiveHeadline } from "@/lib/live/types";
import { flattenTree, pageIntel, type IntelNode, type PageIntel, type StoryView } from "@/lib/engine/page-intel";
import { clockLabel } from "@/components/world-tape-helpers";
import { Badge, Panel } from "@/components/ui";
import { cn } from "@/lib/utils";

const PROV: Record<IntelNode["provenance"], string> = {
  observed: "Observed",
  official: "Official",
  supported: "Supported",
  model: "Model",
  hypothesis: "Hypothesis",
};

function age(ms: number, now = Date.now()): string {
  if (!ms) return "—";
  const mins = Math.max(0, Math.round((now - ms) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function usePageIntel(event: RadarEvent, headlines: LiveHeadline[]): PageIntel {
  return useMemo(() => pageIntel(event, headlines), [event, headlines]);
}

export function StoryList({
  intel,
}: {
  intel: PageIntel;
}) {
  const [sort, setSort] = useState<"newest" | "oldest" | "material">("newest");
  const rows = [...intel.stories];
  if (sort === "oldest") rows.sort((a, b) => a.at - b.at);
  if (sort === "material") rows.sort((a, b) => Number(b.material) - Number(a.material) || b.at - a.at);
  return (
    <div className="mt-1 border-t border-border pt-1">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-mono text-micro text-subtle">
          {intel.stories.length} stories · {intel.independentSources} sources
          {intel.reprints > 0 ? ` · ${intel.reprints} reprints` : ""}
        </span>
        <span className="text-micro text-subtle">
          Material {intel.latestMaterialAt ? age(intel.latestMaterialAt) : "—"}
        </span>
        {(["newest", "oldest", "material"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSort(k)}
            className={cn("text-micro uppercase tracking-wider", sort === k ? "text-primary" : "text-subtle")}
          >
            {k}
          </button>
        ))}
      </div>
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {rows.map((s) => (
          <StoryRow key={s.id} story={s} />
        ))}
      </ul>
    </div>
  );
}

function StoryRow({ story }: { story: StoryView }) {
  const badge = story.official ? "official" : story.role;
  return (
    <li className="rounded-sm bg-card px-1.5 py-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-mono text-micro tabular-nums text-subtle">{story.at ? clockLabel(story.at) : "—"}</span>
        <span className="truncate font-mono text-micro text-primary">{story.source}</span>
        <Badge tone={story.role === "de-escalation" ? "warn" : story.role === "escalation" ? "up" : "neutral"}>
          {badge}
        </Badge>
        {story.material ? <span className="text-micro text-subtle">material</span> : null}
      </div>
      {story.url ? (
        <a href={story.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-caption leading-snug hover:text-primary hover:underline">
          {story.title}
        </a>
      ) : (
        <p className="mt-0.5 text-caption leading-snug">{story.title}</p>
      )}
      {story.reprints.length > 0 ? (
        <p className="mt-0.5 text-micro text-subtle">
          {story.reprints.length} reprint{story.reprints.length === 1 ? "" : "s"}: {story.reprints.map((r) => r.source).join(", ")}. Not extra confirmations.
        </p>
      ) : null}
    </li>
  );
}

export function TransmissionTree({
  intel,
  focusId,
  onFocus,
}: {
  intel: PageIntel;
  focusId: string | null;
  onFocus: (id: string) => void;
}) {
  const focus = flattenTree(intel.tree).find((n) => n.id === focusId) ?? null;
  return (
    <Panel title="The chain" action={<span className="text-micro text-subtle">what this can cause</span>}>
      <TreeNode node={intel.tree} depth={0} focusId={focusId} onFocus={onFocus} />
      {intel.omitted.length > 0 ? (
        <p className="mt-1.5 text-micro text-subtle">
          Not on this path: {intel.omitted.join(", ")}. No story names a facility that would justify them.
        </p>
      ) : null}
      {focus ? (
        <div className="mt-1.5 rounded-sm bg-card-2 px-2 py-1.5">
          <div className="text-micro uppercase tracking-wider text-subtle">{PROV[focus.provenance]}</div>
          <p className="mt-0.5 text-caption text-foreground">{focus.why}</p>
          {focus.cite ? <p className="mt-1 text-micro text-muted">{focus.cite}</p> : null}
        </div>
      ) : (
        <p className="mt-1 text-micro text-subtle">Tap a node for why it is here.</p>
      )}
    </Panel>
  );
}

function TreeNode({
  node,
  depth,
  focusId,
  onFocus,
}: {
  node: IntelNode;
  depth: number;
  focusId: string | null;
  onFocus: (id: string) => void;
}) {
  return (
    <div className={depth ? "ml-3 border-l border-border pl-2" : ""}>
      <button
        type="button"
        onClick={() => onFocus(node.id)}
        className={cn(
          "flex w-full items-start justify-between gap-2 rounded-sm px-1 py-0.5 text-left",
          focusId === node.id ? "bg-primary/10" : "hover:bg-card-2",
        )}
      >
        <span className="text-caption leading-snug">{node.label}</span>
        <Badge tone={node.provenance === "hypothesis" ? "warn" : node.provenance === "observed" || node.provenance === "official" ? "up" : "neutral"}>
          {PROV[node.provenance]}
        </Badge>
      </button>
      {node.children.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1} focusId={focusId} onFocus={onFocus} />
      ))}
    </div>
  );
}

export function EventGeo({
  intel,
  focusId,
  onFocus,
}: {
  intel: PageIntel;
  focusId: string | null;
  onFocus: (id: string) => void;
}) {
  if (!intel.basin && intel.places.length === 0) {
    return (
      <Panel title="Map" action={<span className="text-micro text-subtle">nothing named</span>}>
        <p className="text-caption text-muted">No place is named in these stories, so nothing is plotted.</p>
      </Panel>
    );
  }
  const focus = intel.places.find((p) => p.id === focusId) ?? null;
  return (
    <Panel
      title="Map"
      action={<span className="text-micro text-subtle">{intel.basin ? "basin inferred" : "no geography"}</span>}
    >
      <p className="text-caption text-muted">
        {intel.basin
          ? `Stories mention ${intel.basin}. That is not a coordinate, so the storm is not pinned.`
          : "No place in the stories is specific enough to plot."}
      </p>
      {intel.places.length === 0 ? (
        <p className="mt-2 text-caption text-muted">
          No port, refinery, or city is named. Transmission does not invent one.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {intel.places.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onFocus(p.id)}
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left",
                  focusId === p.id ? "bg-primary/10" : "bg-card-2",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-caption font-medium">{p.name}</span>
                  <span className="font-mono text-micro text-subtle">{p.kind}</span>
                </div>
                <div className="font-mono text-micro text-muted">
                  {p.lat.toFixed(2)}°, {p.lon.toFixed(2)}° · published location
                </div>
                <p className="mt-0.5 text-micro text-muted">Distance to the storm is unknown. Status is not in the feed.</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {focus ? <p className="mt-1 text-micro text-muted">From the story: {focus.cite}</p> : null}
    </Panel>
  );
}

export function NextChecks({ intel }: { intel: PageIntel }) {
  return (
    <Panel title="What confirms or breaks it">
      <ul className="flex flex-col gap-1.5">
        {intel.watching.map((w) => (
          <li key={w.what} className="rounded-sm bg-card-2 px-2 py-1.5">
            <div className="text-caption font-medium text-foreground">{w.what}</div>
            <p className="mt-0.5 text-micro text-muted">Confirms: {w.confirms}</p>
            <p className="text-micro text-muted">Weakens: {w.weakens}</p>
          </li>
        ))}
      </ul>
      <div className="mt-1.5">
        <p className="text-micro uppercase tracking-wider text-subtle">Invalidation</p>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {intel.invalidation.map((x) => (
            <li key={x} className="text-caption text-muted">
              {x}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
