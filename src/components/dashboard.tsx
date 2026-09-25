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
import { EventGeo, NextChecks, StoryList, usePageIntel } from "@/components/event-intel-panels";
import { MacroStrip, VolStrip } from "@/components/macro-strip";
import { SessionCheck } from "@/components/session-check";
import { RippleChain } from "@/components/ripple-chain";
import { Badge, Button, Delta, Input, Panel, buttonVariants } from "@/components/ui";
import { clockLabel } from "@/components/world-tape-helpers";
import { developingNow, feedHealth, storyRole } from "@/lib/engine/event-intel";
import { pageIntel } from "@/lib/engine/page-intel";
import { aceScenariosFor } from "@/lib/ace/published";
import type {
  Crowding,
  RadarEvent,
  TradeCategory,
  TriageDisposition,
} from "@/data/types";
import { goToEvent, goToScenario } from "@/lib/hooks/use-event-param-sync";
import { getReplay } from "@/lib/live/desk";
import { EMPTY_HEADLINES } from "@/lib/live/empty";
import { runAnalyze, runRescore, useLive, useLiveEvents, useQuote } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn, formatPct } from "@/lib/utils";

const TRADE_FILTERS: Array<"All" | TradeCategory> = ["All", "etf", "stock", "futures", "forex", "commodities", "crypto"];

export function Dashboard({ event }: { event: RadarEvent }) {
  const navigate = useNavigate();
  const headlines = useLive((s) => s.desk?.headlines ?? EMPTY_HEADLINES);
  const intel = usePageIntel(event, headlines);
  const [focusId, setFocusId] = useState<string | null>(null);
  const custom = useApp((s) => s.customScenarios).filter((s) => s.eventId === event.id);
  const scenarios = [...event.scenarios, ...custom];
  const ace = aceScenariosFor(event.headlineTicker);

  useEffect(() => {
    setFocusId(null);
  }, [event.id]);

  return (
    <div className="flex flex-col gap-1.5">
      <AnalyzeBar />
      <MacroStrip />
      <SessionCheck />
      <VolStrip />
      <DevelopingNowStrip activeId={event.id} />
      <EventHero event={event} name={intel.name} />

      {/* Map stage + analysis column — map dominates */}
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-12 xl:items-stretch">
        <div className="flex flex-col gap-1.5 xl:col-span-9">
          <RippleChain event={event} />
          {intel.places.length > 0 || intel.basin ? (
            <EventGeo intel={intel} focusId={focusId} onFocus={setFocusId} />
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 xl:col-span-3">
          <ProbabilityReadout event={event} scenarios={scenarios} />
          <Panel
            title="Paths"
            action={
              <Link to="/scenarios" className="text-micro text-primary hover:underline">
                Book
              </Link>
            }
          >
            <ScenarioDistributionBar
              scenarios={scenarios}
              showSum
              onSelect={(sid) => goToScenario(navigate, event.id, sid)}
            />
          </Panel>
          <ForecastDelta eventId={event.id} />
          <YourNames event={event} />
          {ace ? (
            <Panel
              title={`ACE · ${ace.channel}`}
              action={<span className="font-mono text-micro text-subtle">move odds</span>}
            >
              <ScenarioDistributionBar
                scenarios={ace.rows}
                independent
                caption={ace.caption}
              />
            </Panel>
          ) : null}
          <Panel title="Already moving">
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
          <NextChecks intel={intel} />
        </div>
      </div>

      {/* Footer: exposures + evidence + transmission */}
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <TradesPanel event={event} compact />
        </div>
        <div className="lg:col-span-5">
          <EvidencePanel event={event} />
        </div>
      </div>
    </div>
  );
}

function DevelopingNowStrip({ activeId }: { activeId: string }) {
  const raw = useLiveEvents();
  const desk = useLive((s) => s.desk);
  const status = useLive((s) => s.status);
  const events = useMemo(() => developingNow(raw).slice(0, 8), [raw]);
  const headlines = useLive((s) => s.desk?.headlines ?? EMPTY_HEADLINES);
  const cards = useMemo(() => events.map((e) => ({ event: e, intel: pageIntel(e, headlines) })), [events, headlines]);
  const [openId, setOpenId] = useState<string | null>(null);
  const health = feedHealth(desk?.asOf ?? 0, status);
  const setEvent = useApp((s) => s.setSelectedEventId);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <section className="rounded-md border border-border bg-card px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-micro font-medium uppercase tracking-wider text-muted">Developing now</h2>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-mono text-micro",
              health.label === "LIVE" ? "text-up" : health.label === "DELAYED" ? "text-warn" : "text-down",
            )}
            title={health.detail}
          >
            {health.label}
          </span>
          <span className="font-mono text-micro tabular-nums text-subtle">
            {events.length} with a recent story
          </span>
          <Link to="/events" className="text-micro text-primary hover:underline">
            World Tape →
          </Link>
        </div>
      </div>
      {cards.length === 0 ? (
        <p className="px-1 py-1.5 text-caption text-muted">
          Nothing inside its freshness window. Old high-importance books stay off this strip.
        </p>
      ) : (
        <>
          <ul className="flex gap-1.5 overflow-x-auto pb-0.5">
            {cards.map(({ event: e, intel }) => {
              const active = e.id === activeId;
              const open = e.id === openId;
              const hasImp = typeof e.importance === "number";
              const imp = hasImp ? e.importance! : 0;
              const riskTone: "core" | "warn" | "primary" | "neutral" =
                hasImp && imp >= 70 ? "core" : hasImp && imp >= 45 ? "warn" : hasImp && imp >= 25 ? "primary" : "neutral";
              const family = e.eventSubtype ?? e.eventType ?? e.theme;
              const times = intel.stories.map((s) => s.at).filter((n) => n > 0);
              const first = times.length ? Math.min(...times) : 0;
              const last = times.length ? Math.max(...times) : 0;
              return (
                <li key={e.id} className="min-w-[12.5rem] max-w-[16rem] shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEvent(e.id);
                      goToEvent(navigate, pathname, e.id);
                      setOpenId(open ? null : e.id);
                    }}
                    className={cn(
                      "flex h-full w-full flex-col rounded-sm border px-2 py-1.5 text-left transition-colors",
                      active || open
                        ? "border-primary/50 bg-primary/15"
                        : "border-transparent bg-card-2 hover:border-border hover:bg-card-3",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-micro uppercase tracking-wider text-subtle">
                        {family || e.lifecycle || "book"}
                      </span>
                      {hasImp ? (
                        <Badge tone={riskTone} className="shrink-0 px-1 py-px">
                          {imp}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-caption font-medium leading-snug">{intel.name}</div>
                    <div className="mt-1 font-mono text-micro text-muted">
                      <div>
                        {e.lifecycle ?? "—"} · {intel.stories.length} stories
                        {intel.reprints > 0 ? ` · ${intel.reprints} reprints` : ""}
                      </div>
                      <div>First {first ? clockLabel(first) : "—"}</div>
                      <div>Last {last ? clockLabel(last) : "—"}</div>
                    </div>
                    <div className="mt-1 text-micro text-subtle">{open ? "Hide stories" : "Show stories"}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          {cards
            .filter(({ event: e }) => e.id === openId)
            .map(({ intel }) => (
              <StoryList key={openId} intel={intel} />
            ))}
        </>
      )}
    </section>
  );
}

/** Thin book chrome — crowding ≠ confirmation; reserved fields only when present. */
function EventHero({ event, name }: { event: RadarEvent; name: string }) {
  const rescoring = useLive((s) => s.rescoring);
  const mode = event.mode ?? (event.id.startsWith("live-") ? "live" : event.id.startsWith("desk-") ? "desk" : "standing");
  const family = event.eventSubtype ?? event.eventType ?? event.theme;
  const sourceN = event.sourceCount ?? event.sources.reduce((n, s) => n + s.count, 0);
  const freshness = event.timestamp || event.firstDetected;
  const empty = !event.id || event.title === "Listening to the world tape";

  return (
    <section className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Badge tone="up">{event.lifecycle ?? (mode === "desk" ? "desk" : "live")}</Badge>
        {family ? <Badge tone="primary">{family}</Badge> : null}
        {event.region && event.region !== "—" ? <Badge tone="neutral">{event.region}</Badge> : null}
        <BookStateChips event={event} />
        {freshness ? <span className="font-mono text-micro text-subtle">{freshness}</span> : null}
        {sourceN > 0 ? <span className="font-mono text-micro text-subtle">{sourceN} src</span> : null}
        <div className="ml-auto">
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
      <h1 className="mt-1 line-clamp-3 text-base font-semibold tracking-tight text-foreground sm:text-lg">
        {empty ? "No active book" : name}
      </h1>
      {!empty && event.summary && !event.summary.startsWith("Don't trade the headline") ? (
        <p className="mt-0.5 line-clamp-2 text-caption text-muted">{event.summary}</p>
      ) : null}
    </section>
  );
}

function YourNames({ event }: { event: RadarEvent }) {
  const lists = useApp((s) => s.watchlists);
  const held = [...new Set(lists.flatMap((l) => l.tickers))];
  const onBook = new Map(event.trades.map((t) => [t.ticker, t]));
  return (
    <Panel title="Your names" action={<span className="text-micro text-subtle">this chain</span>}>
      {held.length === 0 ? (
        <p className="text-caption text-muted">Add tickers on Watchlists. This book will say which of them sit on the chain.</p>
      ) : (
        <ul className="flex flex-col">
          {held.map((ticker) => {
            const t = onBook.get(ticker);
            const hop = t?.distance;
            const where = hop == null ? "Not on this chain" : hop <= 1 ? "Direct" : hop === 2 ? "Second-order" : "Further";
            return (
              <li key={ticker} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1 last:border-b-0">
                <span className="font-mono text-caption text-primary">{ticker}</span>
                <span className="min-w-0 text-right text-micro text-muted">
                  {where}
                  {t?.reason ? ` · ${t.reason}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ForecastDelta({ eventId }: { eventId: string }) {
  const [frames, setFrames] = useState<Awaited<ReturnType<typeof getReplay>> | null>(null);
  useEffect(() => {
    let dead = false;
    setFrames(null);
    void getReplay({ data: eventId })
      .then((rows) => {
        if (!dead) setFrames(rows);
      })
      .catch(() => {
        if (!dead) setFrames([]);
      });
    return () => {
      dead = true;
    };
  }, [eventId]);

  const series = frames ?? [];
  const ids = series.at(-1)?.scenarios.map((s) => s.id) ?? [];
  return (
    <Panel
      title="Forecast delta"
      action={
        <span className="font-mono text-micro text-subtle">
          {frames === null ? "…" : `${series.length} freeze${series.length === 1 ? "" : "s"}`}
        </span>
      }
    >
      {frames === null ? (
        <p className="text-caption text-muted">Reading the frozen book…</p>
      ) : series.length < 2 ? (
        <p className="text-caption text-muted">
          {series.length === 0
            ? "Nothing frozen on this book yet. A revision appears only after the path odds actually move."
            : "One freeze. The path odds have not revised."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ids.map((id) => {
            const points = series
              .map((f) => f.scenarios.find((s) => s.id === id))
              .filter((s): s is { id: string; name: string; probability: number } => Boolean(s));
            if (points.length < 2) return null;
            const first = points[0]!;
            const last = points[points.length - 1]!;
            const delta = last.probability - first.probability;
            if (delta === 0) return null;
            return (
              <li key={id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-caption leading-snug">{last.name}</span>
                  <span className="shrink-0 font-mono text-caption tabular-nums text-primary">
                    {first.probability}% → {last.probability}%
                  </span>
                </div>
                <p className="font-mono text-micro text-subtle">
                  {points.map((p) => `${p.probability}`).join(" → ")} · frozen record
                </p>
              </li>
            );
          })}
          {ids.every((id) => {
            const points = series.map((f) => f.scenarios.find((s) => s.id === id)?.probability);
            return points.filter((n) => n != null).every((n) => n === points.find((x) => x != null));
          }) ? (
            <li className="text-caption text-muted">Freezes are on the ledger. No path has revised.</li>
          ) : null}
        </ul>
      )}
    </Panel>
  );
}

function ProbabilityReadout({ event, scenarios }: { event: RadarEvent; scenarios: { id: string; name: string; probability: number; prevProbability: number }[] }) {
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
  const lead = [...scenarios].sort((a, b) => b.probability - a.probability)[0];
  const moved = lead && lead.probability !== lead.prevProbability ? lead.probability - lead.prevProbability : 0;
  return (
    <Panel title="Lead path">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-sm bg-card-2 px-2 py-1.5">
          <div className="text-micro uppercase tracking-wider text-subtle">Most likely path</div>
          {lead ? (
            <>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold tabular-nums leading-none text-primary">
                  {lead.probability}
                  <span className="text-sm font-medium">%</span>
                </span>
                {moved ? <Delta n={moved} digits={0} /> : null}
              </div>
              <p className="mt-1 line-clamp-3 text-micro leading-snug text-foreground">{lead.name}</p>
            </>
          ) : (
            <p className="mt-1 text-caption text-muted">No paths on this book yet.</p>
          )}
        </div>
        <div className="rounded-sm bg-card-2 px-2 py-1.5">
          <div className="text-micro uppercase tracking-wider text-subtle">Importance</div>
          <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
            {hasImp ? event.importance : "—"}
          </div>
          <div className="mt-0.5 text-micro text-subtle">how big, not how likely</div>
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
          className="flex flex-row items-center gap-1"
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
            placeholder="Paste a shock"
            className="min-h-7 h-7 min-w-0 flex-1 text-caption"
          />
          <Button type="submit" size="sm" disabled={analyzing || !draft.trim()} className="h-7 shrink-0 px-3">
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

function TradesPanel({ event, compact }: { event: RadarEvent; compact?: boolean }) {
  const [filter, setFilter] = useState<"All" | TradeCategory>("All");
  const rows = event.trades.filter((t) => filter === "All" || t.category === filter);
  const add = useApp((s) => s.addToWatchlist);
  const list = useApp((s) => s.watchlists[0]);
  const watched = new Set(list?.tickers ?? []);
  const quotes = useLive((s) => s.desk?.quotes);

  return (
    <Panel
      title="Exposed markets"
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
        <p className="text-caption text-muted">Nothing exposed on this book yet.</p>
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
  const originals = event.evidence.filter((e) => !e.duplicateOf);
  const reprints = event.evidence.length - originals.length;
  const shown = originals.slice(0, 6);
  return (
    <Panel
      title="Key evidence"
      icon={<Newspaper className="size-3" />}
      action={
        <span className="font-mono text-micro text-muted">
          {originals.length} stories{reprints > 0 ? ` · ${reprints} reprints` : ""}
        </span>
      }
    >
      {shown.length === 0 ? (
        <p className="text-caption text-muted">No tape items on this book yet.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((e) => {
            const role = storyRole(e);
            return (
              <li key={e.id} className="border-t border-border/60 py-1 first:border-t-0">
                <div className="flex items-center gap-1.5">
                  <Badge tone={role === "de-escalation" ? "warn" : role === "escalation" ? "up" : "primary"}>
                    {role}
                  </Badge>
                  <span className="truncate font-mono text-micro text-subtle">{e.source}</span>
                  <span className="ml-auto shrink-0 font-mono text-micro tabular-nums text-subtle">
                    {clockLabel(e.eventTimeMs)}
                  </span>
                </div>
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 block line-clamp-2 text-caption text-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    {e.headline}
                  </a>
                ) : (
                  <p className="mt-0.5 line-clamp-2 text-caption text-foreground">{e.headline}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {reprints > 0 ? (
        <p className="mt-1 text-micro text-subtle">
          {reprints} reprint{reprints === 1 ? "" : "s"} of the same wording are not extra confirmations.
        </p>
      ) : null}
    </Panel>
  );
}
