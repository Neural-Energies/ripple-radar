import type { EvidenceClass, Reliability } from "@/data/types";
import type { LiveCluster, LiveHeadline } from "@/lib/live/types";

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
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return "—";
  }
}

export function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="min-w-[6.5rem] rounded-md border border-border bg-card px-2.5 py-1.5">
      <div className="text-micro uppercase tracking-wider text-subtle" title={hint}>
        {label}
      </div>
      <div className="font-mono text-lg font-semibold tabular-nums leading-tight">{value}</div>
    </div>
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
