import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LEVEL_META } from "@/data/catalog";
import type { RadarEvent, RippleLevel, RippleNode } from "@/data/types";
import { nodeNavTarget } from "@/lib/engine/instruments";
import { cn } from "@/lib/utils";

const CX = 320;
const CY = 268;
const RINGS = [0, 78, 128, 178, 228];
/** Minimum SVG hit radius — ~44 CSS px on a phone-width map. */
const MIN_HIT_R = 28;

function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
}

function wrapLabel(label: string, max = 14) {
  if (label.length <= max) return [label];
  const parts = label.split(/[\s/]+/);
  if (parts.length === 1) return [label.slice(0, max), label.slice(max, max * 2)];
  const lines: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + " " + p).trim().length > max && cur) {
      lines.push(cur);
      cur = p;
    } else {
      cur = (cur + " " + p).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

function nodeRadius(level: RippleLevel) {
  return level === 0 ? 36 : level === 1 ? 22 : 16;
}

function hitRadius(level: RippleLevel) {
  return Math.max(nodeRadius(level) + 6, MIN_HIT_R);
}

export function RippleMap({
  event,
  onSelect,
  selectedId,
  compact = false,
}: {
  event: RadarEvent;
  onSelect?: (node: RippleNode) => void;
  selectedId?: string | null;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<RippleLevel>>(new Set());

  const visible = event.nodes.filter((n) => !hidden.has(n.level));
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of event.nodes) {
      m.set(n.id, n.level === 0 ? { x: CX, y: CY } : polar(RINGS[n.level], n.angle));
    }
    return m;
  }, [event.nodes]);

  const focusId = hover;
  const related = useMemo(() => {
    if (!focusId) return new Set<string>();
    const s = new Set<string>([focusId]);
    for (const l of event.links) {
      if (l.source === focusId) s.add(l.dest);
      if (l.dest === focusId) s.add(l.source);
    }
    return s;
  }, [focusId, event.links]);

  const targets = useMemo(() => {
    const m = new Map<string, ReturnType<typeof nodeNavTarget>>();
    for (const n of event.nodes) m.set(n.id, nodeNavTarget(n, event));
    return m;
  }, [event]);

  function toggleLevel(lv: RippleLevel) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });
  }

  function activate(node: RippleNode) {
    if (onSelect) {
      onSelect(node);
      return;
    }
    const target = targets.get(node.id) ?? nodeNavTarget(node, event);
    if (!target) return;
    if (target.kind === "ticker") {
      void navigate({ to: "/assets/$ticker", params: { ticker: target.ticker } });
      return;
    }
    void navigate({ to: "/assets", search: { q: target.q } });
  }

  const hoveredNode = event.nodes.find((n) => n.id === hover);
  const hoveredTarget = hoveredNode ? targets.get(hoveredNode.id) : null;

  return (
    <div className={cn("relative", compact && "text-[0.95em]")}>
      <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        {(Object.keys(LEVEL_META) as unknown as RippleLevel[]).map((lv) => {
          const meta = LEVEL_META[lv];
          const off = hidden.has(lv);
          return (
            <button
              key={lv}
              type="button"
              onClick={() => toggleLevel(lv)}
              className={cn(
                "flex items-center gap-1.5 text-micro text-muted transition-opacity duration-150",
                off && "opacity-35",
              )}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: meta.color }}
              />
              {meta.label}
            </button>
          );
        })}
      </div>

      <svg
        viewBox="0 0 640 536"
        className="block h-auto w-full touch-manipulation"
        role="img"
        aria-label={`Ripple map for ${event.title}`}
      >
        <defs>
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={CX} cy={CY} r="250" fill="var(--color-primary)" fillOpacity="0.07" />

        {RINGS.slice(1).map((r, i) => (
          <circle
            key={r}
            cx={CX}
            cy={CY}
            r={r}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="1"
            strokeDasharray={i === 3 ? "2 4" : i === 0 ? undefined : "3 5"}
          />
        ))}

        {event.links.map((l) => {
          const a = pos.get(l.source);
          const b = pos.get(l.dest);
          if (!a || !b) return null;
          const src = event.nodes.find((n) => n.id === l.source);
          const dst = event.nodes.find((n) => n.id === l.dest);
          if (!src || !dst || hidden.has(src.level) || hidden.has(dst.level)) return null;
          const active = !focusId || related.has(l.source) || related.has(l.dest);
          return (
            <line
              key={`${l.source}-${l.dest}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={l.direction < 0 ? "var(--color-down)" : "var(--color-primary)"}
              // Opacity tracks measured sign stability where it exists. An
              // asserted edge draws at a fixed, dimmer weight — it is still a
              // real mechanism, it just has no measurement behind it, and
              // scaling it by an invented number would say otherwise.
              strokeOpacity={
                active ? 0.45 * (typeof l.confidence === "number" ? l.confidence : 0.55) : 0.08
              }
              strokeDasharray={l.support === "measured" ? undefined : "3 2"}
              strokeWidth={active ? 1.4 : 0.8}
            />
          );
        })}

        {visible.map((n) => {
          const p = pos.get(n.id)!;
          const r = nodeRadius(n.level);
          const hit = hitRadius(n.level);
          const color = LEVEL_META[n.level].color;
          const dim = focusId != null && !related.has(n.id);
          const selected = n.id === selectedId;
          const lines = wrapLabel(n.label, n.level === 0 ? 11 : 13);
          const target = targets.get(n.id);
          const clickable = Boolean(target || onSelect);
          const tip =
            target?.kind === "ticker"
              ? target.ticker
              : target?.kind === "filter"
                ? `Filter: ${target.q}`
                : undefined;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x}, ${p.y})`}
              opacity={dim ? 0.28 : 1}
              filter={n.level <= 1 ? "url(#nodeGlow)" : undefined}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => {
                if (!clickable) return;
                e.stopPropagation();
                activate(n);
              }}
              className={clickable ? "cursor-pointer" : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={
                tip ? `${n.label} · ${tip}` : n.label
              }
              onKeyDown={(e) => {
                if (clickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  activate(n);
                }
              }}
            >
              {/* Invisible expanded hit target for phone UX */}
              <circle r={hit} fill="transparent" />
              <circle r={r} fill="var(--color-card)" stroke={color} strokeWidth={selected || n.level === 0 ? 2.4 : 1.6} />
              {selected && (
                <circle r={r + 4} fill="none" stroke="var(--color-primary)" strokeOpacity="0.7" strokeWidth="1.4" />
              )}
              {n.level === 0 && (
                <circle r={r - 7} fill="none" stroke={color} strokeOpacity="0.45" strokeWidth="1" />
              )}
              {n.level === 0 ? (
                <text
                  textAnchor="middle"
                  fill="var(--color-foreground)"
                  fontSize="9"
                  fontWeight="600"
                  fontFamily="IBM Plex Sans, sans-serif"
                  style={{ pointerEvents: "none" }}
                >
                  {lines.map((ln, i) => (
                    <tspan key={ln} x="0" y={i === 0 ? (lines.length > 1 ? -4 : 3) : 8}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              ) : (
                <text
                  textAnchor="middle"
                  y={r + 11}
                  fill="var(--color-foreground)"
                  fontSize="9.5"
                  fontFamily="IBM Plex Sans, sans-serif"
                  style={{ pointerEvents: "none" }}
                >
                  {lines.map((ln, i) => (
                    <tspan key={ln} x="0" dy={i === 0 ? 0 : 11}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hoveredNode && (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-md bg-card-2/95 px-2.5 py-2 shadow-[var(--shadow-border)]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-caption font-medium text-foreground">
              {hoveredNode.label}
              {hoveredTarget?.kind === "ticker" ? (
                <span className="ml-1.5 font-mono text-micro text-primary">{hoveredTarget.ticker}</span>
              ) : hoveredNode.ticker ? (
                <span className="ml-1.5 font-mono text-micro text-primary">{hoveredNode.ticker}</span>
              ) : hoveredTarget?.kind === "filter" ? (
                <span className="ml-1.5 text-micro text-muted">assets · {hoveredTarget.q}</span>
              ) : null}
            </div>
            <div className="text-micro tabular-nums text-muted">
              impact {hoveredNode.impact} · {LEVEL_META[hoveredNode.level].label}
            </div>
          </div>
          <p className="mt-0.5 text-tiny text-muted">{hoveredNode.blurb}</p>
        </div>
      )}
    </div>
  );
}
