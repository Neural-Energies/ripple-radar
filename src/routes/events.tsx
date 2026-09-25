import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TickerLink } from "@/components/desk-nav";
import { BookStateChips } from "@/components/research-header";
import {
  ClusterLandscape,
  HIGH_IMP,
  Kpi,
  Stamp,
  classTone,
  clockLabel,
  currentShocks,
  relTone,
  toneBadge,
} from "@/components/world-tape-helpers";
import { Badge, Button, Delta, Input, Panel } from "@/components/ui";
import { regionFromText, tagsFromText, themeFromTags } from "@/lib/engine/ontology";
import { classifyText, reliabilityOf } from "@/lib/live/evidence";
import { isTapeShock } from "@/lib/engine/relevance";
import { EMPTY_HEADLINES } from "@/lib/live/empty";
import {
  runAnalyze,
  useLive,
  useLiveClusters,
  useLiveEvent,
  useLiveEvents,
} from "@/lib/live/provider";
import type { LiveHeadline } from "@/lib/live/types";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/events")({ component: EventsPage });

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
  const [lens, setLens] = useState<"headlines" | "clusters" | "high" | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const highRef = useRef<HTMLDivElement>(null);
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
  const highBooks = useMemo(
    () => events.filter((e) => (e.importance ?? 0) >= HIGH_IMP),
    [events],
  );
  const highImp = highBooks.length;
  const tape = useMemo(() => currentShocks(headlines), [headlines]);
  const shockIds = useMemo(() => new Set(tape.flatMap((h) => h.eventIds)), [tape]);
  const shownClusters = useMemo(
    () => clusters.filter((c) => shockIds.has(c.id) || isTapeShock(c.title)),
    [clusters, shockIds],
  );
  const stream = lens === "headlines" ? headlines : tape;
  const clusterRows = lens === "clusters" ? clusters : shownClusters;

  function pickLens(next: "headlines" | "clusters" | "high") {
    setLens((cur) => (cur === next ? null : next));
    const node = next === "headlines" ? streamRef.current : next === "clusters" ? clusterRef.current : highRef.current;
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectCluster(id: string) {
    setSelectedClusterId(id);
    setHighlightClusterId(id);
  }
  function onHeadlineClick(h: LiveHeadline) {
    const clusterId = h.eventIds[0];
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
          <div className="text-micro uppercase tracking-wider text-subtle">Live headlines</div>
          <h1 className="text-base font-semibold tracking-tight">World Tape</h1>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Kpi label="Headlines" value={headlines.length} active={lens === "headlines"} onClick={() => pickLens("headlines")} />
          <Kpi label="Clusters" value={clusters.length} active={lens === "clusters"} onClick={() => pickLens("clusters")} />
          <Kpi label="High importance" value={highImp} hint={`Importance ${HIGH_IMP} or higher`} active={lens === "high"} onClick={() => pickLens("high")} />
        </div>
      </section>

      <Panel title="Analyze a shock" className="shrink-0">
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
            {analyzing ? "Working…" : "Analyze"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-9"
            disabled={!draft.trim()}
            title="Opens a book with no score until you analyze"
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
            Open book
          </Button>
        </form>
        {draft.trim() ? (
          <p className="mt-2 text-tiny text-muted">
            Inferred: {inferredTheme} · {inferredRegion}
            {inferredTags.length ? ` · ${inferredTags.slice(0, 4).join(", ")}` : ""}
          </p>
        ) : null}
      </Panel>

      <div className="grid min-h-[calc(100vh-11rem)] grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)_minmax(0,0.95fr)]">
        <div ref={streamRef}>
        <Panel
          title={lens === "headlines" ? "All headlines" : "Live stream"}
          action={<span className="font-mono text-micro tabular-nums text-muted">{lens === "headlines" ? `${stream.length} headlines` : `${stream.length} shocks`}</span>}
          padded={false}
          className="min-h-[16rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {stream.map((h) => {
              const cls = classifyText(h.title);
              const rel = reliabilityOf(h.source);
              const linked = h.eventIds[0];
              const active = linked != null && linked === activeClusterId;
              return (
                <li
                  key={h.id}
                  className={cn(
                    "grid grid-cols-[3.4rem_minmax(0,1fr)_auto] items-start gap-1.5 border-b border-border/70 px-2 py-1 last:border-b-0",
                    active && "bg-primary/10",
                  )}
                >
                  <Stamp ms={h.published} />
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="flex max-w-full items-center gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      onClick={() => onHeadlineClick(h)}
                      title={linked ? "Highlight cluster" : "No cluster yet"}
                    >
                      <span className="truncate font-mono text-micro text-primary">{h.source}</span>
                      <Badge tone={toneBadge(h.tone)}>{h.tone}</Badge>
                    </button>
                    {h.url ? (
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          "mt-px block text-caption leading-snug hover:text-primary hover:underline",
                          active && "text-primary",
                        )}
                      >
                        {h.title}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="mt-px block text-left text-caption leading-snug hover:text-primary"
                        onClick={() => onHeadlineClick(h)}
                      >
                        {h.title}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-px pt-0.5">
                    <span className="font-mono text-micro uppercase tracking-wider text-subtle">
                      {cls.evidenceClass.slice(0, 4)} {rel}
                    </span>
                    <button
                      type="button"
                      className="text-micro text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      onClick={() => setDraft(h.title)}
                      title="Analyze this headline"
                    >
                      Analyze
                    </button>
                  </div>
                </li>
              );
            })}
            {stream.length === 0 ? (
              <li className="px-3 py-8 text-center text-caption text-muted">
                No market-moving headlines on the tape yet.
              </li>
            ) : null}
          </ul>
        </Panel>
        </div>

        <div ref={clusterRef}>
        <Panel
          title={lens === "clusters" ? "All clusters" : "Cluster explorer"}
          action={<span className="font-mono text-micro tabular-nums text-muted">{clusterRows.length} clusters</span>}
          padded={false}
          className="min-h-[16rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {clusterRows.map((c) => {
              const active = c.id === activeClusterId;
              return (
                <li key={c.id} className="mb-1 last:mb-0">
                  <button
                    type="button"
                    onClick={() => selectCluster(c.id)}
                    className={cn(
                      "w-full rounded-sm border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
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
                      <span className="shrink-0 font-mono text-micro tabular-nums text-primary">sig {c.significance}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone="primary">{c.headlineCount} hdln</Badge>
                      <Badge tone="neutral">{c.sources} src</Badge>
                      <Badge tone={toneBadge(c.tone)}>{c.tone}</Badge>
                      <span className="font-mono text-micro tabular-nums text-subtle" title="First story">
                        First {clockLabel(c.oldest)}
                      </span>
                      <span className="font-mono text-micro tabular-nums text-subtle" title="Latest story">
                        Last {clockLabel(c.newest)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
            {clusterRows.length === 0 ? (
              <li className="px-2 py-8 text-center text-caption text-muted">No market-moving clusters on the tape yet.</li>
            ) : null}
          </ul>
          {clusterRows.length > 1 ? (
            <ClusterLandscape clusters={clusterRows} activeId={activeClusterId} onSelect={selectCluster} />
          ) : null}
        </Panel>
        </div>

        <div ref={highRef}>
        <Panel
          title={lens === "high" ? "High importance" : "Event preview"}
          action={
            lens === "high" ? (
              <span className="font-mono text-micro text-muted">imp ≥ {HIGH_IMP}</span>
            ) : selectedCluster ? (
              <span className="font-mono text-micro text-muted">{selectedCluster.id.slice(0, 10)}</span>
            ) : null
          }
          className="min-h-[16rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
        >
          {lens === "high" ? (
            highBooks.length === 0 ? (
              <p className="text-caption text-muted">Nothing at importance {HIGH_IMP} or higher.</p>
            ) : (
              <ul className="flex flex-col">
                {highBooks.map((e) => (
                  <li key={e.id} className="border-b border-border/70 py-1.5 last:border-b-0">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => openOnDesk(e.id)}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-caption font-medium leading-snug">{e.title}</span>
                        <span className="shrink-0 font-mono text-micro tabular-nums text-primary">{e.importance}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-micro text-subtle">{e.timestamp || "Open on the desk"}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
          <>
          {!selectedCluster ? (
            <p className="text-caption text-muted">Select a cluster or click a headline to preview the composed book.</p>
          ) : null}
          {selectedCluster && !hasComposedBook ? (
            <div>
              <h2 className="text-base font-semibold tracking-tight">{selectedCluster.title}</h2>
              <p className="mt-1.5 text-caption text-muted">
                {selectedCluster.headlineCount} headlines, {selectedCluster.sources} sources. No book on the desk yet. Analyze it above, or wait for the next pass.
              </p>
            </div>
          ) : null}
          {selectedCluster && hasComposedBook && preview?.id ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="neutral">{preview.badge}</Badge>
                {preview.lifecycle ? <Badge tone="neutral">{preview.lifecycle}</Badge> : null}
                <BookStateChips event={preview} />
              </div>
              <h2 className="text-base font-semibold leading-snug tracking-tight">{preview.title}</h2>
              <div className="grid grid-cols-2 gap-1.5">
                <Link
                  to="/scenarios"
                  search={{ event: preview.id }}
                  className="rounded-sm bg-card-2 px-2 py-1.5 hover:bg-card-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <div className="text-micro uppercase tracking-wider text-subtle">Probability</div>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span className="font-mono text-lg font-semibold tabular-nums leading-none text-primary">
                      {preview.probability}
                      <span className="text-caption font-medium">%</span>
                    </span>
                    {typeof preview.probabilityDelta === "number" && preview.probabilityDelta !== 0 ? (
                      <Delta n={preview.probabilityDelta} digits={0} />
                    ) : null}
                  </div>
                </Link>
                <Link
                  to="/game-theory"
                  search={{ event: preview.id }}
                  className="rounded-sm bg-card-2 px-2 py-1.5 hover:bg-card-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <div className="text-micro uppercase tracking-wider text-subtle">Importance</div>
                  <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums leading-none">
                    {preview.importance ?? "—"}
                  </div>
                </Link>
              </div>
              <p className="line-clamp-3 text-caption text-muted">{preview.summary || preview.story}</p>
              {(preview.trades?.length ?? 0) > 0 ? (
                <ul className="flex flex-col">
                  {preview.trades.slice(0, 3).map((t) => (
                    <li key={t.ticker} className="flex items-center justify-between gap-2 border-b border-border/50 py-0.5 text-caption last:border-b-0">
                      <TickerLink ticker={t.ticker} />
                      <span className="min-w-0 truncate text-muted">{t.reason ?? t.side}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {(preview.evidence?.length ?? 0) > 0 ? (
                <ul className="flex flex-col gap-1">
                  {preview.evidence.slice(0, 3).map((ev) => (
                    <li key={ev.id} className="text-caption leading-snug">
                      <div className="mb-px font-mono text-micro tabular-nums text-subtle">{clockLabel(ev.eventTimeMs)}</div>
                      {ev.url ? (
                        <a href={ev.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                          {ev.headline}
                        </a>
                      ) : (
                        ev.headline
                      )}
                      <div className="mt-px flex flex-wrap gap-1">
                        <Badge tone={classTone(ev.evidenceClass)}>{ev.evidenceClass}</Badge>
                        {ev.reliability ? <Badge tone={relTone(ev.reliability)}>tier {ev.reliability}</Badge> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-x-2 gap-y-1 text-micro uppercase tracking-wider">
                <Link to="/maps" search={{ event: preview.id }} className="text-primary hover:underline">
                  Map
                </Link>
                <Link to="/scenarios" search={{ event: preview.id }} className="text-primary hover:underline">
                  Scenarios
                </Link>
                <Link to="/game-theory" search={{ event: preview.id }} className="text-primary hover:underline">
                  Game
                </Link>
                <Link to="/assets" search={{ event: preview.id }} className="text-primary hover:underline">
                  Assets
                </Link>
              </div>
              <Button type="button" className="w-full" size="sm" onClick={() => openOnDesk(preview.id)}>
                Open on desk →
              </Button>
            </div>
          ) : null}
          </>
          )}
        </Panel>
        </div>
      </div>
    </div>
  );
}
