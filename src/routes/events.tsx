import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TickerLink } from "@/components/desk-nav";
import { BookStateChips } from "@/components/research-header";
import { Badge, Button, Delta, Input, Panel } from "@/components/ui";
import type { EvidenceClass, Reliability } from "@/data/types";
import { regionFromText, tagsFromText, themeFromTags } from "@/lib/engine/ontology";
import { classifyText, reliabilityOf } from "@/lib/live/evidence";
import { EMPTY_HEADLINES } from "@/lib/live/empty";
import {
  runAnalyze,
  useLive,
  useLiveClusters,
  useLiveEvent,
  useLiveEvents,
} from "@/lib/live/provider";
import type { LiveCluster, LiveHeadline } from "@/lib/live/types";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/events")({ component: EventsPage });

const HIGH_IMP = 70;

function classTone(c: EvidenceClass): "up" | "warn" | "primary" | "core" {
  if (c === "fundamental") return "up";
  if (c === "market") return "warn";
  if (c === "expectation") return "core";
  return "primary";
}

function relTone(r: Reliability): "up" | "primary" | "neutral" | "warn" {
  if (r === "A") return "up";
  if (r === "B") return "primary";
  if (r === "C") return "neutral";
  return "warn";
}

function toneBadge(tone: LiveCluster["tone"] | LiveHeadline["tone"]): "up" | "down" | "neutral" {
  if (tone === "up") return "up";
  if (tone === "down") return "down";
  return "neutral";
}

function ageLabel(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function clockLabel(ms: number): string {
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

function EventsPage() {
  const navigate = useNavigate();
  const setEvent = useApp((s) => s.setSelectedEventId);
  const addBook = useApp((s) => s.addDeskBook);
  const headlines = useLive((s) => s.desk?.headlines ?? EMPTY_HEADLINES);
  const clusters = useLiveClusters();
  const events = useLiveEvents();
  const analyzing = useLive((s) => s.analyzing);

  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [highlightClusterId, setHighlightClusterId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [modeBOpen, setModeBOpen] = useState(false);

  const inferredTags = tagsFromText(draft);
  const inferredTheme = themeFromTags(inferredTags);
  const inferredRegion = regionFromText(draft, inferredTags);

  const activeClusterId = selectedClusterId ?? highlightClusterId;

  const selectedCluster = useMemo(
    () => clusters.find((c) => c.id === activeClusterId) ?? null,
    [clusters, activeClusterId],
  );

  const previewEventId = selectedCluster?.eventId ?? selectedCluster?.id ?? "";
  const preview = useLiveEvent(previewEventId);
  const hasComposedBook =
    Boolean(selectedCluster?.eventId) && events.some((e) => e.id === selectedCluster?.eventId);

  const highImp = events.filter((e) => (e.importance ?? 0) >= HIGH_IMP).length;

  function selectCluster(id: string) {
    setSelectedClusterId(id);
    setHighlightClusterId(id);
  }

  function onHeadlineClick(h: LiveHeadline) {
    const clusterId = h.eventIds[0];
    // No cluster stamp (didn't clear the significance/relevance bar): clear
    // the selection rather than leaving a stale, unrelated preview showing.
    setHighlightClusterId(clusterId ?? null);
    setSelectedClusterId(clusterId ?? null);
  }

  function openOnDesk(eventId: string) {
    setEvent(eventId);
    void navigate({ to: "/", search: { event: eventId } });
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <section className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-micro uppercase tracking-wider text-subtle">Desk · World Tape</div>
          <h1 className="text-base font-semibold tracking-tight">Headline Cluster Observatory</h1>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Kpi label="Headlines" value={headlines.length} />
          <Kpi label="Clusters" value={clusters.length} />
          <Kpi label="High importance" value={highImp} hint={`imp ≥ ${HIGH_IMP}`} />
        </div>
      </section>

      {modeBOpen ? (
        <Panel
          title="Mode B · Analyze / Instant book"
          action={
            <button
              type="button"
              className="text-micro uppercase tracking-wider text-muted hover:text-primary"
              onClick={() => setModeBOpen(false)}
            >
              Hide
            </button>
          }
          className="shrink-0 opacity-90"
        >
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const title = draft.trim();
              if (!title) return;
              void runAnalyze(title).then((ev) => {
                if (ev) {
                  setDraft("");
                  openOnDesk(ev.id);
                }
              });
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste a shock · pipeline hit · FOMC surprise · mine strike"
              className="min-h-9 flex-1"
            />
            <Button type="submit" disabled={analyzing || !draft.trim()} size="sm" className="min-h-9">
              {analyzing ? "Constructing…" : "Analyze with Grok"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-9"
              disabled={!draft.trim()}
              title="Thin shell — no engine payload until you analyze"
              onClick={() => {
                const title = draft.trim();
                if (!title) return;
                const id = "desk-" + Date.now().toString(36);
                addBook({
                  id,
                  title,
                  region: inferredRegion,
                  note: title,
                  created: new Date().toLocaleString("en-GB", { timeZone: "America/New_York" }),
                });
                setDraft("");
                openOnDesk(id);
              }}
            >
              Instant book
            </Button>
          </form>
          {draft.trim() && (
            <p className="mt-2 text-tiny text-muted">
              Inferred: {inferredTheme} · {inferredRegion}
              {inferredTags.length ? ` · ${inferredTags.slice(0, 4).join(", ")}` : ""}
            </p>
          )}
        </Panel>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-micro uppercase tracking-wider text-subtle hover:text-primary"
            onClick={() => setModeBOpen(true)}
          >
            Mode B · Analyze / Instant book
          </button>
        </div>
      )}

      <div className="grid min-h-[calc(100vh-11rem)] grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)_minmax(0,0.95fr)]">
        <Panel
          title="Live stream"
          action={
            <span className="font-mono text-micro text-muted tabular-nums">{headlines.length} items</span>
          }
          padded={false}
          className="min-h-[16rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {headlines.map((h) => {
              const cls = classifyText(h.title);
              const rel = reliabilityOf(h.source);
              const linked = h.eventIds[0];
              const active = linked != null && linked === activeClusterId;
              return (
                <li
                  key={h.id}
                  className={cn(
                    "grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-1.5 border-b border-border/70 px-2 py-1 last:border-b-0",
                    active && "bg-primary/10",
                  )}
                >
                  <span className="pt-0.5 font-mono text-micro tabular-nums text-subtle">
                    {clockLabel(h.published)}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => onHeadlineClick(h)}
                    title={
                      linked
                        ? "Highlight cluster"
                        : "No cluster stamp — use Mode B to analyze this headline"
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate font-mono text-micro text-primary">{h.source}</span>
                      <Badge tone={toneBadge(h.tone)}>{h.tone}</Badge>
                    </div>
                    <div
                      className={cn(
                        "mt-px text-caption leading-snug hover:text-primary",
                        active && "text-primary",
                      )}
                    >
                      {h.title}
                    </div>
                  </button>
                  <div className="flex flex-col items-end gap-px pt-0.5">
                    <span className="font-mono text-micro uppercase tracking-wider text-subtle">
                      {cls.evidenceClass.slice(0, 4)} {rel}
                    </span>
                    <button
                      type="button"
                      className="text-micro text-muted hover:text-primary"
                      onClick={() => {
                        setDraft(h.title);
                        setModeBOpen(true);
                      }}
                      title="Analyze this headline"
                    >
                      Analyze
                    </button>
                  </div>
                </li>
              );
            })}
            {headlines.length === 0 && (
              <li className="px-3 py-8 text-center text-caption text-muted">
                Pulling market-relevant headlines…
              </li>
            )}
          </ul>
        </Panel>

        <Panel
          title="Cluster explorer"
          action={
            <span className="font-mono text-micro text-muted tabular-nums">{clusters.length} clusters</span>
          }
          padded={false}
          className="min-h-[16rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {clusters.map((c) => {
              const active = c.id === activeClusterId;
              return (
                <li key={c.id} className="mb-1 last:mb-0">
                  <button
                    type="button"
                    onClick={() => selectCluster(c.id)}
                    className={cn(
                      "w-full rounded-sm border px-2 py-1.5 text-left transition-colors",
                      active
                        ? "border-primary/50 bg-primary/10"
                        : c.tone === "up"
                          ? "border-up/25 bg-up/5 hover:border-up/40"
                          : c.tone === "down"
                            ? "border-down/25 bg-down/5 hover:border-down/40"
                            : "border-border/80 bg-card-2/40 hover:border-border hover:bg-card-2",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-caption font-medium leading-snug">{c.title}</div>
                      <span className="shrink-0 font-mono text-micro tabular-nums text-primary">
                        sig {c.significance}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone="primary">{c.headlineCount} hdln</Badge>
                      <Badge tone="neutral">{c.sources} src</Badge>
                      <Badge tone={toneBadge(c.tone)}>{c.tone}</Badge>
                      {c.disposition ? (
                        <Badge
                          tone={
                            c.disposition === "onRadar"
                              ? "core"
                              : c.disposition === "watch"
                                ? "warn"
                                : "neutral"
                          }
                          title="Triage disposition — not a probability"
                        >
                          {c.disposition}
                        </Badge>
                      ) : null}
                      <span className="font-mono text-micro text-subtle">{ageLabel(c.newest)} ago</span>
                    </div>
                    {(c.entities.length > 0 || c.tags.length > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.entities.slice(0, 4).map((e) => (
                          <span key={e} className="rounded-sm bg-card-3 px-1 py-px text-micro text-muted">
                            {e}
                          </span>
                        ))}
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className="rounded-sm bg-card-3/60 px-1 py-px font-mono text-micro text-subtle">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
            {clusters.length === 0 && (
              <li className="px-2 py-8 text-center text-caption text-muted">
                No market-relevant clusters on the tape yet.
              </li>
            )}
          </ul>
          {clusters.length > 1 && (
            <ClusterLandscape clusters={clusters} activeId={activeClusterId} onSelect={selectCluster} />
          )}
        </Panel>

        <Panel
          title="Event preview"
          action={
            selectedCluster ? (
              <span className="font-mono text-micro text-muted">{selectedCluster.id.slice(0, 10)}</span>
            ) : null
          }
          className="min-h-[16rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
        >
          {!selectedCluster && (
            <p className="text-caption text-muted">
              Select a cluster or click a headline to preview the composed book.
            </p>
          )}
          {selectedCluster && !hasComposedBook && (
            <div>
              <h2 className="text-base font-semibold tracking-tight">{selectedCluster.title}</h2>
              <p className="mt-1.5 text-caption text-muted">
                Cluster has {selectedCluster.headlineCount} headlines across {selectedCluster.sources}{" "}
                sources · significance {selectedCluster.significance}. No composed book on the desk yet —
                use Mode B to analyze, or wait for the next tape cycle.
              </p>
            </div>
          )}
          {selectedCluster && hasComposedBook && preview?.id && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <Badge
                  tone={
                    preview.badge === "MAJOR EVENT"
                      ? "core"
                      : preview.badge === "WATCH"
                        ? "primary"
                        : preview.badge === "DEVELOPING"
                          ? "warn"
                          : "neutral"
                  }
                >
                  {preview.badge}
                </Badge>
                {preview.lifecycle && <Badge tone="neutral">{preview.lifecycle}</Badge>}
                <BookStateChips
                  event={{
                    crowdingState: preview.crowdingState,
                    confirmationState: preview.confirmationState,
                    disposition: preview.disposition ?? selectedCluster?.disposition,
                    modelsDisagree: preview.modelsDisagree,
                    provenance: preview.provenance,
                  }}
                />
              </div>
              <h2 className="text-base font-semibold leading-snug tracking-tight">{preview.title}</h2>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-sm bg-card-2 px-2 py-1.5">
                  <div className="text-micro uppercase tracking-wider text-subtle">Probability</div>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span className="font-mono text-lg font-semibold tabular-nums leading-none text-primary">
                      {preview.probability}
                      <span className="text-caption font-medium">%</span>
                    </span>
                    {typeof preview.probabilityDelta === "number" && preview.probabilityDelta !== 0 && (
                      <Delta n={preview.probabilityDelta} digits={0} />
                    )}
                  </div>
                </div>
                <div className="rounded-sm bg-card-2 px-2 py-1.5">
                  <div className="text-micro uppercase tracking-wider text-subtle">Importance</div>
                  <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums leading-none">
                    {preview.importance ?? "—"}
                  </div>
                </div>
              </div>
              <p className="text-caption text-muted line-clamp-3">{preview.summary || preview.story}</p>

              {(preview.trades?.length ?? 0) > 0 && (
                <div>
                  <p className="text-micro uppercase tracking-wider text-subtle">Top expressions</p>
                  <ul className="mt-0.5 flex flex-col">
                    {preview.trades!.slice(0, 3).map((t) => (
                      <li
                        key={t.ticker}
                        className="flex items-center justify-between gap-2 border-b border-border/50 py-0.5 last:border-b-0 text-caption"
                      >
                        <TickerLink ticker={t.ticker} />
                        <span className="min-w-0 truncate text-muted">{t.reason ?? t.side}</span>
                        <span className="shrink-0 font-mono text-micro tabular-nums text-subtle">
                          {t.score != null ? `sc ${t.score}` : t.side}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(preview.evidence?.length ?? 0) > 0 && (
                <div>
                  <p className="text-micro uppercase tracking-wider text-subtle">Evidence</p>
                  <ul className="mt-0.5 flex flex-col gap-1">
                    {preview.evidence.slice(0, 3).map((ev) => (
                      <li key={ev.id} className="text-caption leading-snug">
                        <span className="font-mono text-micro text-subtle">{ev.time} · </span>
                        {ev.url ? (
                          <a href={ev.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                            {ev.headline}
                          </a>
                        ) : (
                          <span>{ev.headline}</span>
                        )}
                        <div className="mt-px flex flex-wrap gap-1">
                          <Badge tone={classTone(ev.evidenceClass)}>{ev.evidenceClass}</Badge>
                          {ev.reliability && <Badge tone={relTone(ev.reliability)}>tier {ev.reliability}</Badge>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button type="button" className="mt-auto w-full" size="sm" onClick={() => openOnDesk(preview.id)}>
                Open on desk →
              </Button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
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
function ClusterLandscape({
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
