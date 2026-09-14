import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  FlaskConical,
  Newspaper,
  Swords,
} from "lucide-react";
import { Donut, HeatChart, ImpactBars, LearningChart, ProbabilityChart } from "@/components/charts";
import {
  ActorsPanel,
  ExpectedEvidencePanel,
  HorizonPanel,
  ImportanceMeter,
  KnowledgePanel,
  PipelineStrip,
  RelatedEventsPanel,
} from "@/components/engine-panels";
import { RippleMap } from "@/components/ripple-map";
import { Badge, Button, Delta, Input, Panel, buttonVariants } from "@/components/ui";
import { DEFAULT_PORTFOLIO, MODEL_STATS } from "@/data/catalog";
import type { Crowding, RadarEvent, TradeCategory } from "@/data/types";
import { isNash, readMatrix } from "@/lib/engine/game";
import { runAnalyze, runRescore, useLive, useLiveEvents, useQuote } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn, formatPct } from "@/lib/utils";

const TABS = ["Ripple Map", "Research", "Key Takeaways", "Timeline", "Related Assets", "Sentiment", "Sources (Live)"] as const;
type Tab = (typeof TABS)[number];
const TRADE_FILTERS: Array<"All" | TradeCategory> = ["All", "etf", "stock", "futures", "forex", "commodities", "crypto"];

export function Dashboard({ event }: { event: RadarEvent }) {
  const [tab, setTab] = useState<Tab>("Ripple Map");
  const custom = useApp((s) => s.customScenarios).filter((s) => s.eventId === event.id);
  const scenarios = [...event.scenarios, ...custom];

  return (
    <div className="flex flex-col gap-3">
      <AnalyzeBar />
      <PipelineStrip lifecycle={event.lifecycle} />
      <DeskLoop event={event} />
      <CommandCenter activeId={event.id} />
      <EventHero event={event} tab={tab} onTab={setTab} />

      {tab === "Ripple Map" && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          <Panel title="Ripple Map" className="xl:col-span-6" bodyClassName="p-2 sm:p-3">
            <RippleMap event={event} />
          </Panel>
          <Panel title="Event Impact Summary" className="xl:col-span-3">
            <ImpactBars items={event.impacts} />
          </Panel>
          <div className="flex flex-col gap-3 xl:col-span-3">
            <Panel
              title="Event Probability"
              action={
                <div className="flex shrink-0 items-baseline gap-1.5">
                  <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                    {event.probability}%
                  </span>
                  <Delta n={event.probabilityDelta} digits={0} />
                </div>
              }
            >
              <ProbabilityChart data={event.probabilityHistory} />
            </Panel>
            <Panel title="Market Reaction">
              <ul className="flex flex-col gap-1.5">
                {event.marketReaction.map((m) => (
                  <ReactionRow key={m.ticker} label={m.label} ticker={m.ticker} fallback={m.change} />
                ))}
              </ul>
            </Panel>
            <Panel
              title="Narrative Heat"
              action={
                <div className="hidden items-center gap-2 text-micro text-muted sm:flex">
                  <span className="flex items-center gap-1">
                    <i className="size-1.5 rounded-full bg-primary" /> News
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="size-1.5 rounded-full bg-r2" /> Social
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="size-1.5 rounded-full bg-r3" /> Search
                  </span>
                </div>
              }
            >
              <HeatChart data={event.narrativeHeat} />
            </Panel>
          </div>
        </div>
      )}

      {tab === "Ripple Map" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <TransmissionPanel event={event} />
          <ReflexivityPanel event={event} />
        </div>
      )}

      {tab === "Ripple Map" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <HorizonPanel event={event} />
          <RelatedEventsPanel event={event} />
          <ActorsPanel event={event} />
        </div>
      )}

      {tab === "Research" && (
        <div className="grid min-w-0 gap-3 lg:grid-cols-3">
          <KnowledgePanel event={event} />
          <ExpectedEvidencePanel event={event} />
          <Panel title="Information value">
            <ImportanceMeter event={event} />
            <ul className="mt-3 flex flex-col gap-2">
              {(event.questions ?? []).map((q) => (
                <li key={q.q} className="rounded-md bg-card-2 px-3 py-2">
                  <Badge tone={q.value === "critical" ? "core" : q.value === "high" ? "warn" : "neutral"}>
                    {q.value}
                  </Badge>
                  <div className="mt-1 text-caption font-medium">{q.q}</div>
                  <p className="mt-0.5 text-tiny text-muted">{q.unknown}</p>
                </li>
              ))}
            </ul>
            {(event.invalidation ?? []).length > 0 && (
              <div className="mt-3">
                <p className="text-micro uppercase tracking-wider text-subtle">Invalidation</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {event.invalidation!.map((x) => (
                    <li key={x} className="text-caption text-muted">
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "Key Takeaways" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Key Takeaways">
            <ol className="flex flex-col gap-2">
              {event.takeaways.map((t, i) => (
                <li key={t} className="flex gap-3 text-body text-foreground">
                  <span className="mt-0.5 font-mono text-tiny text-primary">{String(i + 1).padStart(2, "0")}</span>
                  {t}
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Research agenda">
            {(event.questions ?? []).length === 0 ? (
              <p className="text-caption text-muted">No open questions on this book.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {event.questions!.map((q) => (
                  <li key={q.q} className="rounded-md bg-card-2 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={q.value === "critical" ? "core" : q.value === "high" ? "warn" : "neutral"}>
                        {q.value}
                      </Badge>
                      <span className="text-caption font-medium">{q.q}</span>
                    </div>
                    <p className="mt-1 text-tiny text-muted">{q.unknown}</p>
                  </li>
                ))}
              </ul>
            )}
            {(event.invalidation ?? []).length > 0 && (
              <div className="mt-3">
                <p className="text-micro uppercase tracking-wider text-subtle">Invalidation</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {event.invalidation!.map((x) => (
                    <li key={x} className="text-caption text-muted">
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "Timeline" && (
        <Panel title="Event Timeline">
          <ol className="relative ml-3 border-l border-border">
            {event.timeline.map((t) => (
              <li key={t.date + t.title} className="relative mb-4 pl-5 last:mb-0">
                <span className="absolute -left-1.5 top-1 size-3 rounded-full bg-primary" />
                <div className="font-mono text-tiny text-primary">{t.date}</div>
                <div className="text-body font-medium">{t.title}</div>
                <p className="text-caption text-muted">{t.detail}</p>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {tab === "Related Assets" && <TradesPanel event={event} />}

      {tab === "Sentiment" && (
        <Panel title="Narrative Sentiment">
          <ul className="grid gap-3 sm:grid-cols-2">
            {event.sentiment.map((s) => (
              <li key={s.source} className="rounded-md bg-card-2 p-3">
                <div className="flex items-center justify-between text-caption">
                  <span className="text-muted">{s.source}</span>
                  <Badge tone={s.score > 70 ? "core" : s.score > 50 ? "warn" : "primary"}>{s.label}</Badge>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-3">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${s.score}%` }} />
                </div>
                <div className="mt-1 text-right font-mono text-tiny tabular-nums text-muted">{s.score}/100</div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === "Sources (Live)" && (
        <Panel title="Sources — public tape">
          <p className="mb-3 text-caption text-muted">
            Headlines from public world/business RSS. Quotes via Yahoo last/spark. Indicative, not a broker feed.
          </p>
          <ul className="divide-y divide-border">
            {event.sources.map((s) => (
              <li key={s.name} className="flex items-center justify-between py-2 text-caption">
                <span>{s.name}</span>
                <span className="font-mono text-tiny text-muted">
                  {s.count} items · last {s.latest}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ScenarioPanel event={event} scenarios={scenarios} />
        <GameTheoryPanel event={event} />
        <TradesPanel event={event} compact />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ModelPanel />
        <EvidencePanel event={event} />
        <PortfolioPanel />
      </div>
    </div>
  );
}

function AnalyzeBar() {
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const analyzing = useLive((s) => s.analyzing);
  useEffect(() => setReady(true), []);
  return (
    <Panel title="Analyze this event" action={<span className="text-micro text-muted">Paste anything. The engine builds the book.</span>}>
      {!ready ? (
        <div className="h-11 rounded-md bg-card-2" aria-hidden />
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft.trim();
            if (!t) return;
            void runAnalyze(t).then(() => setDraft(""));
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A pipeline is hit. FOMC hikes 50bp. MoF yen intervention. A regional bank fails."
            className="min-h-11 flex-1"
          />
          <Button type="submit" disabled={analyzing || !draft.trim()} className="min-h-11 sm:w-40">
            {analyzing ? "Constructing…" : "Analyze"}
          </Button>
        </form>
      )}
    </Panel>
  );
}

function crowdingTone(c?: Crowding): "up" | "warn" | "core" | "neutral" | "primary" {
  if (c === "low" || c === "emerging") return "up";
  if (c === "medium") return "primary";
  if (c === "high") return "warn";
  if (c === "saturated") return "core";
  return "neutral";
}

function DeskLoop({ event }: { event: RadarEvent }) {
  const head = event.trades.find((t) => t.headline) ?? event.trades[0];
  const under =
    event.trades.find((t) => (t.crowding === "low" || t.crowding === "emerging") && t.ticker !== head?.ticker) ??
    event.trades.find((t) => t.ticker !== head?.ticker);
  const steps = [
    { k: "1 · Event", v: event.title || "Listening to the world tape" },
    {
      k: "2 · Don't trade this",
      v: head
        ? `${head.ticker} is the crowded first print${head.crowding ? ` (${head.crowding} crowd)` : ""}.`
        : "First-order still constructing.",
    },
    {
      k: "3 · Trade what it causes",
      v: under
        ? `${under.ticker} · d${under.distance ?? "?"} · ${under.causalPath ?? under.reason}`
        : "Second-order names appear once the causal graph has hops.",
    },
    {
      k: "4 · Whose move",
      v:
        event.gameTheory.actor && event.gameTheory.actor !== "—"
          ? `${event.gameTheory.actor} vs ${event.gameTheory.counterpart}. ${event.gameTheory.insight}`
          : "Players are discovered from the event — not a preloaded list.",
    },
    {
      k: "5 · Next evidence",
      v: event.expectedEvidence?.[0]
        ? `If ${event.expectedEvidence[0].ifTrue}: ${event.expectedEvidence[0].observe}`
        : "Expected evidence is generated per scenario.",
    },
    {
      k: "6 · Kill the book",
      v: event.invalidation?.[0] ?? "Invalidation is specific to this causal edge.",
    },
  ];
  return (
    <Panel title="Desk loop" action={<span className="text-micro text-muted">Don't trade the headline. Trade what it causes next.</span>}>
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((s) => (
          <li key={s.k} className="min-w-0 rounded-md bg-card-2 px-2.5 py-2">
            <div className="text-micro uppercase tracking-wider text-subtle">{s.k}</div>
            <p className="mt-1 line-clamp-3 text-caption text-foreground">{s.v}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function CommandCenter({ activeId }: { activeId: string }) {
  const events = useLiveEvents().slice(0, 5);
  const setEvent = useApp((s) => s.setSelectedEventId);
  return (
    <Panel title="Developing now" action={<span className="text-micro text-muted">Discovered from the tape — ranked by importance</span>}>
      {events.length === 0 ? (
        <p className="text-caption text-muted">Clustering live headlines into events…</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {events.map((e) => {
            const under = e.trades.find((t) => t.crowding === "low" || t.crowding === "emerging") ?? e.trades[0];
            const active = e.id === activeId;
            return (
              <li key={e.id + "-" + e.title.slice(0, 12)}>
                <button
                  type="button"
                  onClick={() => setEvent(e.id)}
                  className={cn(
                    "flex h-full w-full flex-col rounded-md px-2.5 py-2 text-left",
                    active ? "bg-primary/15" : "bg-card-2 hover:bg-card-3",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-micro uppercase tracking-wider text-subtle">{e.lifecycle ?? e.region}</span>
                    <span className="font-mono text-tiny tabular-nums text-primary">imp {e.importance ?? e.probability}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-caption font-medium">{e.title}</div>
                  {under && (
                    <div className="mt-1 truncate font-mono text-micro text-muted">
                      {e.probability}% · {under.ticker}
                      {under.crowding ? ` · ${under.crowding}` : ""}
                    </div>
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

function ReactionRow({ label, ticker, fallback }: { label: string; ticker: string; fallback: number }) {
  const q = useQuote(ticker);
  const change = q?.changePct ?? fallback;
  return (
    <li className="flex items-center justify-between gap-2 text-caption">
      <Link to="/assets/$ticker" params={{ ticker }} className="truncate text-muted hover:text-primary">
        {label}
      </Link>
      <span className={cn("font-mono tabular-nums", change >= 0 ? "text-up" : "text-down")}>
        {formatPct(change)}
      </span>
    </li>
  );
}

function EventHero({
  event,
  tab,
  onTab,
}: {
  event: RadarEvent;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const rescoring = useLive((s) => s.rescoring);
  const mode = event.mode ?? (event.id.startsWith("live-") ? "live" : event.id.startsWith("desk-") ? "desk" : "standing");
  return (
    <Panel padded={false} className="overflow-hidden">
      <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="core">{event.badge}</Badge>
            <Badge tone="up">{event.lifecycle ?? (mode === "desk" ? "desk" : "live")}</Badge>
            <Badge tone="primary">{event.eventSubtype ?? event.eventType ?? event.forecastHorizon ?? "hours → quarters"}</Badge>
            <Badge tone="warn">imp {event.importance ?? "—"}</Badge>
            <span className="font-mono text-tiny text-muted">{event.timestamp}</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">{event.title}</h1>
          <p className="mt-1 max-w-3xl text-caption text-muted">{event.summary}</p>
          {(() => {
            const under = event.trades.find((t) => t.crowding === "low" || t.crowding === "emerging");
            const head = event.trades.find((t) => t.headline) ?? event.trades[0];
            if (!under && !head) return null;
            return (
              <p className="mt-2 text-tiny text-subtle">
                {head ? (
                  <>
                    Headline print <span className="font-mono text-foreground">{head.ticker}</span>
                    {head.crowding ? ` · ${head.crowding} crowd` : ""}.{" "}
                  </>
                ) : null}
                {under && under.ticker !== head?.ticker ? (
                  <>
                    Under-recognized: <span className="font-mono text-primary">{under.ticker}</span>
                    {under.distance != null ? ` · d${under.distance}` : ""} · {under.crowding} crowd
                    {under.causalPath ? ` · ${under.causalPath}` : ""}
                  </>
                ) : null}
              </p>
            );
          })()}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <Link to="/events" className="inline-flex items-center gap-1 text-caption text-primary hover:underline">
            View Full Story <ArrowUpRight className="size-3.5" />
          </Link>
          <button
            type="button"
            disabled={rescoring === event.id}
            onClick={() => void runRescore(event.id)}
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
          >
            {rescoring === event.id ? "Rescoring…" : "Rescore with Grok"}
          </button>
        </div>
      </div>
      <div className="flex gap-0 overflow-x-auto border-t border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            className={cn(
              "min-h-10 shrink-0 border-b-2 px-3 py-2 text-caption transition-colors duration-150",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function TransmissionPanel({ event }: { event: RadarEvent }) {
  const rows = event.links.filter((l) => l.dest !== "core").slice(0, 8);
  return (
    <Panel title="Transmission" action={<span className="text-micro text-muted">Mechanism · lag · invalidation</span>}>
      {rows.length === 0 ? (
        <p className="text-caption text-muted">Causal edges appear once the engine has hops from this event.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((l) => {
            const src = event.nodes.find((n) => n.id === l.source);
            const dst = event.nodes.find((n) => n.id === l.dest);
            return (
              <li key={`${l.source}-${l.dest}`} className="rounded-md bg-card-2 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-caption">
                  <span className="font-medium">
                    {src?.label ?? l.source} → {dst?.label ?? l.dest}
                    {dst?.ticker ? ` · ${dst.ticker}` : ""}
                  </span>
                  <span className="font-mono text-micro text-primary">d{l.distance}</span>
                </div>
                <p className="mt-1 text-tiny text-muted">{l.evidence}</p>
                <p className="mt-0.5 text-micro text-subtle">
                  Lag {l.expectedLag} · Kill: {l.invalidation}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ReflexivityPanel({ event }: { event: RadarEvent }) {
  const back = event.links.filter((l) => l.dest === "core" && l.source !== "core");
  return (
    <Panel title="Reflexivity" action={<span className="text-micro text-muted">Price can change the event</span>}>
      {back.length === 0 ? (
        <p className="text-caption text-muted">
          No feedback edge yet. When a macro node exists, the engine asks whether policy or price can unwind the shock.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {back.map((l) => {
            const src = event.nodes.find((n) => n.id === l.source);
            return (
              <li key={l.source} className="rounded-md bg-card-2 px-2.5 py-2">
                <div className="text-caption font-medium">{src?.label} → event</div>
                <p className="mt-1 text-tiny text-muted">{l.evidence}</p>
                <p className="mt-0.5 text-micro text-subtle">Invalidation: {l.invalidation}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ScenarioPanel({
  event,
  scenarios,
}: {
  event: RadarEvent;
  scenarios: RadarEvent["scenarios"];
}) {
  const [open, setOpen] = useState<string | null>(scenarios[0]?.id ?? null);
  return (
    <Panel
      title="Scenario Analysis"
      icon={<FlaskConical className="size-3.5" />}
      action={
        <Link to="/scenarios" className="text-micro text-primary hover:underline">
          {event.region} · Lab
        </Link>
      }
    >
      <div className="mb-2 hidden grid-cols-[1fr_52px_72px_1fr] gap-2 text-micro uppercase tracking-wider text-subtle sm:grid">
        <span>Scenario</span>
        <span>Prob</span>
        <span>Range</span>
        <span>Key outcomes</span>
      </div>
      <ul className="flex flex-col gap-1">
        {scenarios.map((s) => {
          const tone = s.probability >= 30 ? "warn" : s.probability >= 20 ? "primary" : "neutral";
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setOpen(open === s.id ? null : s.id)}
                className="grid w-full grid-cols-1 gap-1 rounded-md px-1.5 py-1.5 text-left hover:bg-card-2 sm:grid-cols-[1fr_52px_72px_1fr] sm:items-center"
              >
                <div>
                  <div className="text-caption font-medium">{s.name}</div>
                  <div className="text-micro text-subtle">{s.detail}</div>
                </div>
                <Badge tone={tone}>{s.probability}%</Badge>
                <span className="font-mono text-tiny text-muted">{s.range}</span>
                <span className="truncate text-tiny text-muted">{s.keyOutcomes}</span>
              </button>
              {open === s.id && (
                <div className="mb-1 rounded-md bg-card-2 px-2.5 py-2 text-tiny text-muted">
                  <div className="mb-1 text-micro uppercase tracking-wider text-subtle">Probability audit</div>
                  <p>
                    {s.audit.previous}% → {s.audit.updated}% · {s.audit.direction} weight {s.audit.weight} · {s.audit.evidence}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function GameTheoryPanel({ event }: { event: RadarEvent }) {
  const gt = event.gameTheory;
  const read = readMatrix(gt);
  return (
    <Panel
      title="Game Theory Lens"
      icon={<Swords className="size-3.5" />}
      action={<span className="text-micro text-muted">({gt.actor} payoff, {gt.counterpart} payoff)</span>}
    >
      <p className="mb-2 text-tiny text-muted">
        Rows = {gt.actor || "actor"}'s moves. Columns = {gt.counterpart || "counterpart"}'s. Highlight = mutual best
        response — that cell rewrites the ripple.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-tiny">
          <thead>
            <tr className="text-subtle">
              <th className="py-1 pr-2 text-left font-medium" />
              {gt.columns.map((c) => (
                <th key={c} className="px-1 py-1 text-left font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gt.rows.map((row) => (
              <tr key={row.name} className="border-t border-border/70 align-top">
                <td className="py-1.5 pr-2 font-medium text-foreground">{row.name}</td>
                {row.cells.map((cell, i) => {
                  const col = gt.columns[i] ?? "";
                  const nash = isNash(read, row.name, col);
                  return (
                    <td key={col} className={cn("px-1 py-1.5 text-muted", nash && "bg-primary/10")}>
                      <div>{cell.label}</div>
                      <div className="font-mono text-micro text-primary">
                        ({cell.a}, {cell.b})
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {read.likely && (
        <p className="mt-2 text-tiny text-foreground">
          Likely play: {gt.actor} {read.likely.row} / {gt.counterpart} {read.likely.col}.
        </p>
      )}
      <div className="mt-2 rounded-md bg-card-2 px-2.5 py-2 text-tiny text-muted">
        <span className="font-medium text-primary">Key insight. </span>
        {gt.insight}
      </div>
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
      title="Top Ripple Trades (Model Ranked)"
      action={
        <Link to="/assets" className="text-micro text-primary hover:underline">
          View more
        </Link>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {TRADE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-sm px-2 py-0.5 text-micro uppercase tracking-wider",
              filter === f ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground",
            )}
          >
            {f === "etf" ? "ETFs" : f === "stock" ? "Stocks" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <ul className="flex flex-col">
        {rows.map((t) => {
          const chg = quotes?.[t.ticker]?.changePct;
          return (
            <li
              key={t.ticker}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-border/70 py-1.5 first:border-t-0"
            >
              <Link
                to="/assets/$ticker"
                params={{ ticker: t.ticker }}
                className="w-12 font-mono text-caption text-primary hover:underline"
              >
                {t.ticker}
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-mono text-caption tabular-nums",
                      t.score >= 80 ? "text-up" : t.score >= 65 ? "text-warn" : "text-muted",
                    )}
                  >
                    {t.score}
                  </span>
                  <span className="truncate text-tiny text-muted">{t.reason}</span>
                  {(t.crowding || t.confirmation) && (
                    <span className="hidden gap-1 sm:inline-flex">
                      {t.crowding && <Badge tone={crowdingTone(t.crowding)}>{t.crowding}</Badge>}
                      {t.confirmation && t.confirmation !== "none" && (
                        <Badge tone={t.confirmation === "invalidating" || t.confirmation === "diverging" ? "core" : "primary"}>
                          {t.confirmation}
                        </Badge>
                      )}
                    </span>
                  )}
                </div>
                {!compact && (
                  <div className="text-micro uppercase tracking-wider text-subtle">
                    {t.side} · {t.horizon}
                    {t.distance != null && ` · d${t.distance}`}
                    {chg != null && (
                      <span className={cn("ml-2 normal-case", chg >= 0 ? "text-up" : "text-down")}>
                        {formatPct(chg)}
                      </span>
                    )}
                    {t.causalPath && <div className="normal-case tracking-normal text-subtle">{t.causalPath}</div>}
                    {t.invalidation && (
                      <div className="normal-case tracking-normal text-muted">Invalidation: {t.invalidation}</div>
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
    </Panel>
  );
}

function ModelPanel() {
  const s = MODEL_STATS;
  const series = useMemo(
    () => s.series.map((d) => ({ ...d, brierInv: Math.round((1 - d.brier) * 100) })),
    [s.series],
  );
  return (
    <Panel title="Model Learning & Performance">
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Accuracy (90d)" value={`${s.accuracy}%`} delta={s.accuracyDelta} />
        <Stat label="Brier (lower better)" value={s.brier.toFixed(2)} delta={s.brierDelta} suffix="" invert />
        <Stat label="Lead time" value={`${s.leadDays}d`} delta={s.leadDelta} suffix="d" />
        <Stat label="New insights" value={String(s.insights)} delta={s.insightsDelta} suffix="" />
      </div>
      <LearningChart data={series.map((d) => ({ date: d.date, accuracy: d.accuracy, brier: d.brierInv }))} />
      <ul className="mt-2 flex flex-col gap-1">
        {s.improvements.slice(0, 4).map((i) => (
          <li key={i} className="flex gap-2 text-tiny text-muted">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-r2" />
            {i}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Stat({
  label,
  value,
  delta,
  suffix = "%",
  invert,
}: {
  label: string;
  value: string;
  delta: number;
  suffix?: string;
  invert?: boolean;
}) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wider text-subtle">{label}</div>
      <div className="font-mono text-sm tabular-nums text-foreground">{value}</div>
      <Delta n={delta} suffix={suffix} digits={invert ? 2 : 0} />
    </div>
  );
}

function EvidencePanel({ event }: { event: RadarEvent }) {
  return (
    <Panel title="Evidence Feed" icon={<Newspaper className="size-3.5" />} action={<span className="text-micro text-muted">Class · reliability</span>}>
      {event.evidence.length === 0 ? (
        <p className="text-caption text-muted">No tape items on this book yet.</p>
      ) : (
        <ul className="flex flex-col">
          {event.evidence.slice(0, 8).map((e) => (
            <li key={e.id} className="border-t border-border/70 py-1.5 first:border-t-0">
              <div className="flex items-center gap-2">
                <Badge tone={e.evidenceClass === "fundamental" ? "up" : e.evidenceClass === "market" ? "warn" : "primary"}>
                  {e.evidenceClass.slice(0, 4)}
                </Badge>
                <span className="font-mono text-micro text-subtle">{e.source}</span>
                {e.reliability && <span className="font-mono text-micro text-muted">{e.reliability}</span>}
                {e.delayed && <span className="text-micro text-subtle">delayed</span>}
              </div>
              <p className="mt-0.5 line-clamp-2 text-caption text-foreground">{e.headline}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PortfolioPanel() {
  return (
    <Panel
      title="Balanced ripple"
      action={
        <Link to="/portfolio" className="text-micro text-primary hover:underline">
          Lab
        </Link>
      }
    >
      <Donut data={DEFAULT_PORTFOLIO} />
      <ul className="mt-2 flex flex-col gap-1">
        {DEFAULT_PORTFOLIO.map((s) => (
          <li key={s.label} className="flex items-center justify-between text-caption">
            <span className="flex items-center gap-2 text-muted">
              <i className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-mono tabular-nums">{s.weight}%</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
