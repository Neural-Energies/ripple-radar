import type { EvidenceClass, Reliability } from "@/data/types";
import { etParts } from "@/lib/live/clock";
import { isTapeShock } from "@/lib/engine/relevance";
import type { LiveCluster, LiveHeadline } from "@/lib/live/types";
import { cn } from "@/lib/utils";

export const HIGH_IMP = 70;

export function classTone(c: EvidenceClass): "up" | "warn" | "primary" | "core" {
  if (c === "fundamental") return "up";
  if (c === "market") return "warn";
  if (c === "expectation") return "core";
  return "primary";
}

export function relTone(r: Reliability): "up" | "primary" | "neutral" | "warn" {
  if (r === "A") return "up";
  if (r === "B") return "primary";
  if (r === "C") return "neutral";
  return "warn";
}

export function toneBadge(tone: LiveCluster["tone"] | LiveHeadline["tone"]): "up" | "down" | "neutral" {
  if (tone === "up") return "up";
  if (tone === "down") return "down";
  return "neutral";
}

export function ageLabel(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function clockLabel(ms: number): string {
  try {
    const p = etParts(ms);
    return `${p.date} ${p.time}`;
  } catch {
    return "—";
  }
}

const STORY_STOP = new Set([
  "with",
  "from",
  "that",
  "this",
  "after",
  "over",
  "into",
  "about",
  "their",
  "they",
  "have",
  "been",
  "will",
  "would",
  "could",
  "than",
  "then",
  "when",
  "what",
  "why",
  "how",
  "are",
  "was",
  "were",
  "the",
  "and",
  "for",
  "not",
  "its",
  "one",
  "off",
  "along",
  "ever",
  "hurricane",
  "storm",
  "category",
  "strongest",
]);

function storyTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STORY_STOP.has(w));
}

function sameStory(a: string[], b: string[]): boolean {
  const set = new Set(a);
  let shared = 0;
  for (const w of b) if (set.has(w)) shared += 1;
  return shared >= 2 || (shared === 1 && a.length <= 4 && b.length <= 4);
}

/** Newest shock per story. Layout of the tape does not change — the list does. */
export function currentShocks(headlines: LiveHeadline[]): LiveHeadline[] {
  const sorted = headlines.filter((h) => isTapeShock(h.title)).sort((a, b) => b.published - a.published);
  const out: LiveHeadline[] = [];
  const seenCluster = new Set<string>();
  const seenTokens: string[][] = [];
  for (const h of sorted) {
    const cluster = h.eventIds[0];
    if (cluster) {
      if (seenCluster.has(cluster)) continue;
      seenCluster.add(cluster);
    }
    const tokens = storyTokens(h.title);
    if (seenTokens.some((prev) => sameStory(prev, tokens))) continue;
    seenTokens.push(tokens);
    out.push(h);
  }
  return out;
}

export function Stamp({ ms }: { ms: number }) {
  let date = "—";
  let time = "";
  try {
    const p = etParts(ms);
    date = p.date;
    time = p.time;
  } catch {
    /* keep the dash */
  }
  return (
    <time
      dateTime={new Date(ms).toISOString()}
      className="flex flex-col pt-0.5 font-mono text-micro tabular-nums leading-tight text-subtle"
    >
      <span>{date}</span>
      <span>{time}</span>
    </time>
  );
}

export function Kpi({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint ?? `Show the ${value} ${label.toLowerCase()}`}
      className={cn(
        "min-w-[6.5rem] rounded-md border bg-card px-2.5 py-1.5 text-left",
        active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
      )}
    >
      <div className="text-micro uppercase tracking-wider text-subtle">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums leading-tight">{value}</div>
    </button>
  );
}

/** Recency (x) × significance (y) — real axes only. */
export function ClusterLandscape({
  clusters,
  activeId,
  onSelect,
}: {
  clusters: LiveCluster[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const now = Date.now();
  const newest = Math.max(...clusters.map((c) => c.newest));
  const oldest = Math.min(...clusters.map((c) => c.newest));
  const maxSig = Math.max(...clusters.map((c) => c.significance), 1);
  const minSig = Math.min(...clusters.map((c) => c.significance));
  const spanT = Math.max(newest - oldest, 1);
  const spanS = Math.max(maxSig - minSig, 1);
  const W = 320;
  const H = 64;
  const pad = 10;

  return (
    <div className="border-t border-border px-2 py-1">
      <div className="mb-0.5 flex justify-between font-mono text-micro text-subtle">
        <span>older → newer</span>
        <span>sig ↑</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label="Cluster landscape">
        {clusters.map((c) => {
          const x = pad + ((c.newest - oldest) / spanT) * (W - pad * 2);
          const y = H - pad - ((c.significance - minSig) / spanS) * (H - pad * 2);
          const r = 3 + Math.min(6, Math.sqrt(c.headlineCount));
          const fill =
            c.tone === "up" ? "var(--color-up)" : c.tone === "down" ? "var(--color-down)" : "var(--color-muted)";
          const active = c.id === activeId;
          return (
            <circle
              key={c.id}
              cx={x}
              cy={y}
              r={r}
              fill={fill}
              fillOpacity={active ? 0.95 : 0.55}
              stroke={active ? "var(--color-primary)" : "transparent"}
              strokeWidth={active ? 2 : 0}
              className="cursor-pointer"
              onClick={() => onSelect(c.id)}
            >
              <title>
                {c.title} · sig {c.significance} · {ageLabel(c.newest, now)} ago
              </title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
