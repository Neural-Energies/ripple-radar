import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Newspaper,
  X,
} from "lucide-react";
import { ScenarioDistributionBar } from "@/components/charts";
import { BookStateChips } from "@/components/research-header";
import { RippleMap } from "@/components/ripple-map";
import { Badge, Button, Delta, Input, Panel, buttonVariants } from "@/components/ui";
import type {
  Crowding,
  RadarEvent,
  TradeCategory,
  TriageDisposition,
} from "@/data/types";
import { goToEvent } from "@/lib/hooks/use-event-param-sync";
import { runAnalyze, runRescore, useLive, useLiveEvents, useQuote } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn, formatPct } from "@/lib/utils";

const TRADE_FILTERS: Array<"All" | TradeCategory> = ["All", "etf", "stock", "futures", "forex", "commodities", "crypto"];

export function Dashboard({ event }: { event: RadarEvent }) {
  const custom = useApp((s) => s.customScenarios).filter((s) => s.eventId === event.id);
  const scenarios = [...event.scenarios, ...custom];

  return (
    <div className="flex flex-col gap-1.5">
      <DevelopingNowStrip activeId={event.id} />
      <EventHero event={event} />
      <AnalyzeBar />

      {/* Map stage + analysis column — map dominates */}
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-12 xl:items-stretch">
        <Panel
          title="Ripple Map"
          className="min-h-[24rem] xl:col-span-9 xl:min-h-[32rem]"
          bodyClassName="flex min-h-0 flex-1 flex-col p-1 sm:p-1.5"
          action={
            <Link to="/maps" className="text-micro text-primary hover:underline">
              Full map
            </Link>
          }
        >
          <div className="min-h-[22rem] flex-1 xl:min-h-[30rem]">
            <RippleMap event={event} />
          </div>
        </Panel>

        <div className="flex flex-col gap-1.5 xl:col-span-3">
          <ProbabilityReadout event={event} />
          <Panel
            title="Scenario mix"
            action={
              <Link to="/scenarios" className="text-micro text-primary hover:underline">
                Lab
              </Link>
            }
          >
            <ScenarioDistributionBar scenarios={scenarios} showSum />
          </Panel>
          <Panel title="Market reaction">
            {event.marketReaction.length === 0 ? (
              <p className="text-caption text-muted">No liquid names on this book yet.</p>
            ) : (
              <ul className="flex flex-col">
                {event.marketReaction.slice(0, 8).map((m) => (
                  <ReactionRow key={m.ticker} label={m.label} ticker={m.ticker} fallback={m.change} />
                ))}
              </ul>
            )}
          </Panel>
          <NextEvidencePanel event={event} />
        </div>
      </div>

      {/* Footer: exposures + evidence + transmission */}
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <TradesPanel event={event} compact />
        </div>
        <div className="lg:col-span-4">
          <EvidencePanel event={event} />
        </div>
        <div className="lg:col-span-3">
          <TransmissionPanel event={event} />
        </div>
      </div>
    </div>
  );
}

function DevelopingNowStrip({ activeId }: { activeId: string }) {
  const raw = useLiveEvents();
  const events = useMemo(
    () =>
      [...raw]
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || b.probability - a.probability)
        .slice(0, 8),
    [raw],
  );
  const setEvent = useApp((s) => s.setSelectedEventId);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <section className="rounded-md border border-border bg-card px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-micro font-medium uppercase tracking-wider text-muted">Developing now</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-micro tabular-nums text-subtle">
            {events.length} book{events.length === 1 ? "" : "s"} · by importance
          </span>
          <Link to="/events" className="text-micro text-primary hover:underline">
            World Tape →
          </Link>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="px-1 py-1.5 text-caption text-muted">Clustering live headlines into events…</p>
      ) : (
        <ul className="flex gap-1.5 overflow-x-auto pb-0.5">
          {events.map((e) => {
            const active = e.id === activeId;
            const hasImp = typeof e.importance === "number";
            const imp = hasImp ? e.importance! : 0;
            const riskTone: "core" | "warn" | "primary" | "neutral" =
              hasImp && imp >= 70 ? "core" : hasImp && imp >= 45 ? "warn" : hasImp && imp >= 25 ? "primary" : "neutral";
            const family = e.eventSubtype ?? e.eventType ?? e.theme;
            const links = e.relatedEvents?.length ?? 0;
            return (
              <li key={e.id} className="min-w-[11rem] max-w-[13rem] shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEvent(e.id);
                    goToEvent(navigate, pathname, e.id);
                  }}
                  className={cn(
                    "flex h-full w-full flex-col rounded-sm border px-2 py-1.5 text-left transition-colors",
                    active
                      ? "border-primary/50 bg-primary/15"
                      : "border-transparent bg-card-2 hover:border-border hover:bg-card-3",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-micro uppercase tracking-wider text-subtle">
                      {family || e.lifecycle || e.region || "book"}
                    </span>
                    {hasImp ? (
                      <Badge tone={riskTone} className="shrink-0 px-1 py-px">
                        {imp >= 70 ? "high" : imp >= 45 ? "med" : "low"}
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="shrink-0 px-1 py-px">
                        —
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-caption font-medium leading-snug">{e.title}</div>
                  <div className="mt-1 flex items-center justify-between gap-1 font-mono text-micro text-muted">
                    <span title="Importance 0–99">
                      imp {hasImp ? e.importance : "—"}
                    </span>
                    <span className="tabular-nums text-primary" title="Probability">
                      {e.probability}%
                    </span>
                  </div>
                  {(e.lifecycle || links > 0 || e.disposition) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {e.lifecycle ? (
                        <span className="truncate text-micro uppercase tracking-wider text-subtle">
                          {e.lifecycle}
                        </span>
                      ) : null}
                      {links > 0 ? (
                        <span className="font-mono text-micro text-subtle">{links} rel</span>
                      ) : null}
                      {e.disposition ? (
                        <Badge tone={dispositionTone(e.disposition)} className="px-1 py-px">
                          {e.disposition}
                        </Badge>
                      ) : null}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Thin book chrome — crowding ≠ confirmation; reserved fields only when present. */
function EventHero({ event }: { event: RadarEvent }) {
  const rescoring = useLive((s) => s.rescoring);
  const mode = event.mode ?? (event.id.startsWith("live-") ? "live" : event.id.startsWith("desk-") ? "desk" : "standing");
  const family = event.eventSubtype ?? event.eventType ?? event.theme;
  const sourceN = event.sourceCount ?? event.sources.reduce((n, s) => n + s.count, 0);
  const freshness = event.timestamp || event.firstDetected;
  const empty = !event.id || event.title === "Listening to the world tape";
  const hasImp = typeof event.importance === "number" && !empty;
  const hasProb = !empty;

  return (
    <section className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Badge tone="up">{event.lifecycle ?? (mode === "desk" ? "desk" : "live")}</Badge>
        {family ? <Badge tone="primary">{family}</Badge> : null}
        {event.region && event.region !== "—" ? <Badge tone="neutral">{event.region}</Badge> : null}
        <BookStateChips event={event} />
        {freshness ? <span className="font-mono text-micro text-subtle">{freshness}</span> : null}
        {sourceN > 0 ? <span className="font-mono text-micro text-subtle">{sourceN} src</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-caption tabular-nums text-muted" title="Importance 0–99 · not a 10-scale">
            imp <span className="text-foreground">{hasImp ? event.importance : "—"}</span>
          </span>
          <span className="font-mono text-caption tabular-nums" title="Probability">
            {hasProb ? (
              <>
                <span className="text-primary">{event.probability}%</span>
                {typeof event.probabilityDelta === "number" && event.probabilityDelta !== 0 ? (
                  <>
                    {" "}
                    <Delta n={event.probabilityDelta} digits={0} />
                  </>
                ) : null}
              </>
            ) : (
              <span className="text-subtle">—%</span>
            )}
          </span>
          <button
            type="button"
            disabled={rescoring === event.id || empty}
            onClick={() => void runRescore(event.id)}
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "h-6 px-2 text-micro")}
          >
            {rescoring === event.id ? "…" : "Rescore"}
          </button>
        </div>
      </div>
      <h1 className="mt-1 truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
        {empty ? "No active book" : event.title}
      </h1>
      {!empty && event.summary ? (
        <p className="mt-0.5 line-clamp-1 text-caption text-muted">{event.summary}</p>
      ) : null}
    </section>
  );
}

function ProbabilityReadout({ event }: { event: RadarEvent }) {
  const empty = !event.id || event.title === "Listening to the world tape";
  const hasImp = typeof event.importance === "number" && !empty;
  const imp = hasImp ? event.importance! : 0;
  if (empty) {
    return (
      <Panel title="Event analysis">
        <p className="text-caption text-muted">Select a live book to see probability and importance.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Event analysis">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-sm bg-card-2 px-2 py-1.5">
          <div className="text-micro uppercase tracking-wider text-subtle">Probability</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tabular-nums leading-none text-primary">
              {event.probability}
              <span className="text-sm font-medium">%</span>
            </span>
            <Delta n={event.probabilityDelta} digits={0} />
          </div>
          {event.provenance ? (
            <div className="mt-1 text-micro uppercase tracking-wider text-subtle">
              {event.provenance.replace("_", " ")}
            </div>
          ) : null}
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-card-3">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, event.probability))}%` }}
            />
          </div>
        </div>
        <div className="rounded-sm bg-card-2 px-2 py-1.5">
          <div className="text-micro uppercase tracking-wider text-subtle">Importance</div>
          <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
            {hasImp ? event.importance : "—"}
          </div>
          <div className="mt-0.5 text-micro text-subtle">raw 0–99 · ≠ prob</div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-card-3">
            <div
              className="h-full rounded-full bg-warn"
              style={{ width: `${hasImp ? Math.min(100, Math.max(0, imp)) : 0}%` }}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function NextEvidencePanel({ event }: { event: RadarEvent }) {
  const next = event.expectedEvidence?.[0];
  const kills = event.invalidation ?? [];
  return (
    <Panel title="Next evidence / invalidation">
      {next ? (
        <div className="rounded-sm bg-card-2 px-2 py-1.5">
          <div className="text-micro uppercase tracking-wider text-subtle">If {next.ifTrue}</div>
          <p className="mt-0.5 text-caption text-foreground">
            Then within {next.lag}: {next.observe}
          </p>
          <div className="mt-1">
            <Badge tone={next.appeared ? "up" : "neutral"}>{next.appeared ? "observed" : "awaiting"}</Badge>
          </div>
        </div>
      ) : (
        <p className="text-caption text-muted">No expected evidence on this book yet.</p>
      )}
      {kills.length > 0 && (
        <div className="mt-1.5">
          <p className="text-micro uppercase tracking-wider text-subtle">Kill the book</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {kills.slice(0, 3).map((x) => (
              <li key={x} className="text-caption text-muted">
                {x}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function AnalyzeBar() {
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const analyzing = useLive((s) => s.analyzing);
  useEffect(() => setReady(true), []);
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1">
      {!ready ? (
        <div className="h-7 rounded-sm bg-card-2" aria-hidden />
      ) : (
        <form
          className="flex flex-col gap-1 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft.trim();
            if (!t) return;
            void runAnalyze(t).then(() => setDraft(""));
          }}
        >
          <span className="shrink-0 text-micro font-medium uppercase tracking-wider text-muted">Analyze</span>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste a shock — pipeline hit, FOMC hike, yen intervention…"
            className="min-h-7 h-7 flex-1 text-caption"
          />
          <Button type="submit" size="sm" disabled={analyzing || !draft.trim()} className="h-7 sm:w-20">
            {analyzing ? "…" : "Run"}
          </Button>
        </form>
      )}
    </div>
  );
}

function crowdingTone(c?: Crowding): "up" | "warn" | "core" | "neutral" | "primary" {
  if (c === "low" || c === "emerging") return "up";
  if (c === "medium") return "primary";
  if (c === "high") return "warn";
  if (c === "saturated") return "core";
  return "neutral";
}

function dispositionTone(d: TriageDisposition): "up" | "warn" | "core" | "neutral" | "primary" {
  if (d === "onRadar") return "core";
  if (d === "watch") return "warn";
  if (d === "duplicate") return "primary";
  return "neutral";
}


function ReactionRow({ label, ticker, fallback }: { label: string; ticker: string; fallback: number }) {
  const q = useQuote(ticker);
  const change = q?.changePct ?? fallback;
  const live = q != null;
  return (
    <li className="flex items-center justify-between gap-2 border-t border-border/60 py-1 text-caption first:border-t-0 first:pt-0">
      <Link to="/assets/$ticker" params={{ ticker }} className="truncate text-muted hover:text-primary">
        {label}
        <span className="ml-1 font-mono text-micro text-subtle">{live ? "live" : "last"}</span>
      </Link>
      <span className={cn("shrink-0 font-mono tabular-nums", change >= 0 ? "text-up" : "text-down")}>
        {formatPct(change)}
      </span>
    </li>
  );
}

function TransmissionPanel({ event }: { event: RadarEvent }) {
  const rows = event.links.filter((l) => l.dest !== "core").slice(0, 6);
  const [selected, setSelected] = useState<(typeof rows)[number] | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const src = selected ? event.nodes.find((n) => n.id === selected.source) : undefined;
  const dst = selected ? event.nodes.find((n) => n.id === selected.dest) : undefined;

  return (
    <Panel
      title="Transmission"
      action={
        <Link to="/maps" className="text-micro text-primary hover:underline">
          Map
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="text-caption text-muted">No edges yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((l) => {
            const s = event.nodes.find((n) => n.id === l.source);
            const d = event.nodes.find((n) => n.id === l.dest);
            return (
              <li key={`${l.source}-${l.dest}`}>
                <button
                  type="button"
                  onClick={() => setSelected(l)}
                  className="flex min-h-9 w-full flex-col gap-0.5 rounded-sm bg-card-2 px-1.5 py-1 text-left transition-colors hover:bg-card-3"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-caption font-medium">
                      {s?.label ?? l.source} → {d?.label ?? l.dest}
                      {d?.ticker ? ` · ${d.ticker}` : ""}
                    </span>
                    <span className="shrink-0 font-mono text-micro text-primary">d{l.distance}</span>
                  </div>
                  <p className="line-clamp-1 text-micro text-muted">{l.evidence}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:px-4">
          <button
            type="button"
            className="absolute inset-0 bg-overlay"
            aria-label="Dismiss transmission"
            onClick={() => setSelected(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Transmission detail"
            className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl bg-card shadow-[var(--shadow-border-hover)] sm:rounded-md"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-3 pb-2.5 pt-3">
              <div className="min-w-0">
                <div className="text-micro uppercase tracking-wider text-subtle">Transmission</div>
                <h3 className="mt-0.5 text-base font-semibold leading-snug text-foreground">
                  {src?.label ?? selected.source} → {dst?.label ?? selected.dest}
                </h3>
                {dst?.ticker ? (
                  <Link
                    to="/assets/$ticker"
                    params={{ ticker: dst.ticker }}
                    className="mt-1 inline-flex min-h-9 items-center text-sm font-medium text-primary hover:underline"
                    onClick={() => setSelected(null)}
                  >
                    {dst.ticker}
                    <ArrowUpRight className="ml-0.5 size-3.5" />
                  </Link>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-card-2 hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-3 py-3">
              <dl className="flex flex-col gap-3">
                <div>
                  <dt className="text-micro uppercase tracking-wider text-subtle">Explanation</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-foreground">{selected.evidence}</dd>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-micro uppercase tracking-wider text-subtle">Lag</dt>
                    <dd className="mt-1 text-sm text-foreground">{selected.expectedLag}</dd>
                  </div>
                  <div>
                    <dt className="text-micro uppercase tracking-wider text-subtle">Distance</dt>
                    <dd className="mt-1 font-mono text-sm text-primary">d{selected.distance}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-micro uppercase tracking-wider text-subtle">Kill / invalidation</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-foreground">{selected.invalidation}</dd>
                </div>
                {typeof selected.confidence === "number" ? (
                  <div>
                    <dt className="text-micro uppercase tracking-wider text-subtle">Confidence</dt>
                    <dd className="mt-1 font-mono text-sm text-foreground">
                      {Math.round(selected.confidence * 100)}%
                    </dd>
                  </div>
                ) : null}
                {selected.historicalSupport ? (
                  <div>
                    <dt className="text-micro uppercase tracking-wider text-subtle">Historical support</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted">{selected.historicalSupport}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function TradesPanel({ event, compact }: { event: RadarEvent; compact?: boolean }) {
  const [filter, setFilter] = useState<"All" | TradeCategory>("All");
  const rows = event.trades.filter((t) => filter === "All" || t.category === filter);
  const add = useApp((s) => s.addToWatchlist);
  const list = useApp((s) => s.watchlists[0]);
  const watched = new Set(list?.tickers ?? []);
  const quotes = useLive((s) => s.desk?.quotes);

  return (
    <Panel
      title="Top exposures"
      action={
        <Link to="/assets" className="text-micro text-primary hover:underline">
          Assets
        </Link>
      }
    >
      <div className="mb-1.5 flex flex-wrap gap-0.5">
        {TRADE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-micro uppercase tracking-wider",
              filter === f ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground",
            )}
          >
            {f === "etf" ? "ETFs" : f === "stock" ? "Stocks" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-caption text-muted">No ranked expressions yet.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, compact ? 8 : undefined).map((t) => {
            const chg = quotes?.[t.ticker]?.changePct;
            return (
              <li
                key={t.ticker}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5 border-t border-border/60 py-1 first:border-t-0"
              >
                <Link
                  to="/assets/$ticker"
                  params={{ ticker: t.ticker }}
                  className="w-11 font-mono text-caption text-primary hover:underline"
                >
                  {t.ticker}
                </Link>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "font-mono text-caption tabular-nums",
                        t.score >= 80 ? "text-up" : t.score >= 65 ? "text-warn" : "text-muted",
                      )}
                    >
                      {t.score}
                    </span>
                    <span className="truncate text-micro text-muted">{t.reason}</span>
                    {(t.crowding || (t.confirmation && t.confirmation !== "none")) && (
                      <span className="hidden gap-0.5 lg:inline-flex">
                        {t.crowding ? (
                          <Badge tone={crowdingTone(t.crowding)} title="Crowding">
                            Crowd · {t.crowding}
                          </Badge>
                        ) : null}
                        {t.confirmation && t.confirmation !== "none" ? (
                          <Badge
                            tone={
                              t.confirmation === "invalidating" || t.confirmation === "diverging"
                                ? "core"
                                : "primary"
                            }
                            title="Confirmation"
                          >
                            Conf · {t.confirmation}
                          </Badge>
                        ) : null}
                      </span>
                    )}
                  </div>
                  {compact && (
                    <div className="truncate text-micro text-subtle">
                      {t.side} · {t.horizon}
                      {t.distance != null && ` · d${t.distance}`}
                      {chg != null && (
                        <span className={cn("ml-1.5", chg >= 0 ? "text-up" : "text-down")}>{formatPct(chg)}</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={watched.has(t.ticker) ? "On watchlist" : "Add to watchlist"}
                  onClick={() => list && add(list.id, t.ticker)}
                  className="text-muted hover:text-primary"
                >
                  {watched.has(t.ticker) ? (
                    <BookmarkCheck className="size-3.5 text-primary" />
                  ) : (
                    <Bookmark className="size-3.5" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function EvidencePanel({ event }: { event: RadarEvent }) {
  return (
    <Panel
      title="Key evidence"
      icon={<Newspaper className="size-3" />}
      action={<span className="text-micro text-muted">tape</span>}
    >
      {event.evidence.length === 0 ? (
        <p className="text-caption text-muted">No tape items on this book yet.</p>
      ) : (
        <ul className="flex flex-col">
          {event.evidence.slice(0, 8).map((e) => (
            <li key={e.id} className="border-t border-border/60 py-1 first:border-t-0">
              <div className="flex items-center gap-1.5">
                <Badge
                  tone={
                    e.evidenceClass === "fundamental" ? "up" : e.evidenceClass === "market" ? "warn" : "primary"
                  }
                >
                  {e.evidenceClass.slice(0, 4)}
                </Badge>
                <span className="font-mono text-micro text-subtle">{e.source}</span>
                {e.reliability && <span className="font-mono text-micro text-muted">{e.reliability}</span>}
              </div>
              <p className="mt-0.5 line-clamp-2 text-caption text-foreground">{e.headline}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
