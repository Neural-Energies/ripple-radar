import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { OvernightSection } from "@/components/overnight";
import { Badge, Button, Empty, Panel, Skeleton } from "@/components/ui";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getMorningBriefing } from "@/lib/briefing/api";
import { levelsToWatch, morningSummary, whatMatters, type BotView, type Trend } from "@/lib/briefing/assemble";
import { useLive, useLiveEvents } from "@/lib/live/provider";
import { cn, formatPct, formatPrice } from "@/lib/utils";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "rising", label: "Rising" },
  { id: "falling", label: "Falling" },
] as const;

function signed(n: number | null): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n}`;
}

function toneOf(n: number | null): string {
  if (n == null || n === 0) return "text-muted";
  return n > 0 ? "text-up" : "text-down";
}

function trendLabel(trend: Trend): string {
  if (trend === "rising") return "rising";
  if (trend === "falling") return "falling";
  if (trend === "flat") return "flat";
  return "collecting";
}

function MoodGauge({ value }: { value: number | null }) {
  const v = value == null ? 0 : Math.max(-100, Math.min(100, value));
  const r = 44;
  const len = Math.PI * r;
  const frac = (v + 100) / 200;
  const color = value == null ? "var(--color-subtle)" : v > 5 ? "var(--color-up)" : v < -5 ? "var(--color-warn)" : "var(--color-primary)";
  return (
    <div className="relative h-[68px] w-[120px] shrink-0" role="img" aria-label={`Market mood ${signed(value)} on a scale of minus 100 to plus 100`}>
      <svg viewBox="0 0 120 68" className="h-full w-full">
        <path d="M16 60 A44 44 0 0 1 104 60" fill="none" stroke="var(--color-card-3)" strokeWidth="9" strokeLinecap="round" />
        {value != null ? (
          <path
            d="M16 60 A44 44 0 0 1 104 60"
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${len * frac} ${len}`}
            className="transition-[stroke-dasharray] duration-700 ease-out"
          />
        ) : null}
      </svg>
      <span className="absolute inset-x-0 bottom-0 text-center text-2xl font-semibold tabular-nums leading-none tracking-tight" style={{ color: value == null ? "var(--color-muted)" : color }}>
        {signed(value)}
      </span>
    </div>
  );
}

function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 py-1" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i % 2 ? "w-2/3" : "w-full"} />
      ))}
    </div>
  );
}

function BotCard({ bot }: { bot: BotView }) {
  return (
    <article className="rounded-lg bg-card-2 p-3 shadow-[var(--shadow-border)] transition-shadow duration-200 hover:shadow-[var(--shadow-border-hover)]">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold tracking-tight">{bot.name}</h3>
        <span className="text-micro uppercase tracking-wider text-subtle">
          {bot.confidence === "none" ? "Collecting" : `Confidence ${bot.confidence}`}
        </span>
      </header>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums leading-none tracking-tight", toneOf(bot.today.score))}>
          {signed(bot.today.score)}
        </span>
        <span className="text-micro text-muted">{trendLabel(bot.trend)}</span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-micro">
        <div>
          <dt className="uppercase tracking-wider text-subtle">Today</dt>
          <dd className={cn("font-mono tabular-nums", toneOf(bot.today.score))}>{signed(bot.today.score)}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-subtle">3-day</dt>
          <dd className={cn("font-mono tabular-nums", toneOf(bot.d3.score))}>{signed(bot.d3.score)}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-subtle">5-day</dt>
          <dd className={cn("font-mono tabular-nums", toneOf(bot.d5.score))}>{signed(bot.d5.score)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-micro text-subtle">
        {bot.today.n} scored · {bot.today.sources} {bot.today.sources === 1 ? "source" : "sources"}
      </p>
      {bot.drivers.length ? (
        <details className="group mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-tiny font-medium text-primary [&::-webkit-details-marker]:hidden">
            <span className="transition-transform duration-200 group-open:rotate-90">›</span>
            {bot.drivers.length} top {bot.drivers.length === 1 ? "driver" : "drivers"}
          </summary>
          <ul className="mt-1 flex flex-col">
            {bot.drivers.map((d) => (
              <li key={d.title} className="border-t border-border/50 py-1.5 text-caption leading-snug">
                {d.title} <span className="text-micro text-subtle">· {d.source}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mt-1.5 text-micro text-subtle">No scored headlines in the last 24 hours.</p>
      )}
    </article>
  );
}

export function MorningBriefing() {
  const events = useLiveEvents();
  const quotes = useLive((s) => s.desk?.quotes);
  const deskAsOf = useLive((s) => s.desk?.asOf ?? 0);
  const user = useCurrentUser();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const query = useQuery({
    queryKey: ["morning-briefing", deskAsOf],
    queryFn: () => getMorningBriefing(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const data = query.data;
  const scored = useMemo(
    () =>
      (data?.bots ?? []).flatMap((bot) =>
        bot.drivers.map((d) => ({ title: d.title, magnitude: Math.abs(d.contribution) })),
      ),
    [data],
  );
  const matters = useMemo(() => whatMatters(events, scored), [events, scored]);
  const levels = useMemo(() => levelsToWatch(matters, events, quotes), [matters, events, quotes]);
  const summary = data
    ? morningSummary({ mood: data.mood, bots: data.bots, matters, stored: data.stored })
    : query.isError
      ? "The briefing request failed."
      : "Collecting headlines. Scores appear once the tape has been stored.";
  const bots = (data?.bots ?? []).filter((bot) => filter === "all" || bot.trend === filter);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(data?.asOf ?? Date.now()));
  const name = user?.displayName?.trim().split(/\s+/)[0];
  const scorer = !data
    ? "Scoring from the stored tape"
    : data.method === "mixed"
      ? "Lexicon plus model scores where the key is set"
      : data.xaiConfigured
        ? "Lexicon scores. Model pass has not written a score yet."
        : "Loughran–McDonald-style lexicon. No XAI_API_KEY, so the model pass is off.";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-stretch">
      <div className="flex flex-col justify-center px-1 py-2">
        <p className="text-micro font-semibold uppercase tracking-[0.08em] text-subtle">Morning briefing · {day}</p>
        <h1 className="mt-1 text-[2.25rem] font-bold leading-tight tracking-[-0.02em] text-foreground">{name ? `Good morning, ${name}.` : "Good morning."}</h1>
        <p className="mt-1.5 max-w-3xl text-base leading-relaxed text-muted">{summary}</p>
      </div>

      <Panel
        className="h-auto"
        title="Market mood"
      >
        {!data ? (
          query.isError ? <p className="text-caption text-down">Briefing request failed.</p> : <LoadingRows />
        ) : (
          <div className="grid gap-4 p-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <div className="flex flex-col items-center">
              <MoodGauge value={data.mood.today} />
              <div className="mt-1 text-micro uppercase tracking-[0.08em] text-subtle">Today</div>
            </div>
            <div>
              <h2 className="text-base font-semibold capitalize tracking-tight">{data.mood.label}</h2>
              <p className="mt-1 text-caption text-muted">
                Composite of the bots that have a score. {data.stored} headlines stored in the last five days, {data.scored} of them scored onto a bot.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="neutral">Today {signed(data.mood.today)}</Badge>
                <Badge tone="neutral">3-day {signed(data.mood.d3)}</Badge>
                <Badge tone="neutral">5-day {signed(data.mood.d5)}</Badge>
                <Badge tone={data.mood.trend === "rising" ? "up" : data.mood.trend === "falling" ? "down" : "neutral"}>
                  Trend {trendLabel(data.mood.trend)}
                </Badge>
                <Badge tone={data.mood.confidence === "high" ? "primary" : data.mood.confidence === "low" ? "warn" : "neutral"}>
                  Confidence {data.mood.confidence}
                </Badge>
              </div>
              <p className="mt-2 text-micro text-subtle">{scorer}</p>
            </div>
          </div>
        )}
      </Panel>

      </div>

      <Panel className="h-auto" title="What matters today" action={<span className="text-micro text-subtle">Event, then what the book says it causes next</span>}>
        {matters.length === 0 ? (
          <Empty>No book on the desk yet. The chain appears when the tape builds one.</Empty>
        ) : (
          <ol className="flex flex-col">
            {matters.map((row, i) => (
              <li key={row.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-2 border-t border-border/50 py-2.5 first:border-t-0">
                <span className="text-lg font-semibold tabular-nums leading-tight text-subtle">{i + 1}</span>
                <div className="min-w-0">
                  <Link to="/" search={{ event: row.id }} className="text-body font-semibold hover:text-primary">
                    {row.title}
                  </Link>
                  <div className="text-micro text-subtle">
                    {row.source || "Desk"}
                    {row.time ? ` · ${row.time}` : ""}
                  </div>
                  {row.chain.length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {row.chain.map((node, n) => (
                        <span key={`${node.label}-${n}`} className="flex items-center gap-1">
                          {n > 0 ? <span aria-hidden className="text-micro text-subtle">→</span> : null}
                          <span className="inline-flex items-center gap-1 rounded-md bg-card-3 px-1.5 py-0.5 text-tiny font-medium text-foreground">
                            {node.label}
                            <span className={node.direction === "up" ? "text-up" : node.direction === "down" ? "text-down" : "text-subtle"}>
                              {node.direction === "up" ? "↑" : node.direction === "down" ? "↓" : "◆"}
                            </span>
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-micro text-subtle">This book has no causal chain yet.</p>
                  )}
                </div>
                <Badge tone={row.impactLabel === "High" ? "primary" : "neutral"}>{row.impactLabel}</Badge>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <OvernightSection matters={matters} />

      <Panel
        className="h-auto"
        title="Sentiment bots"
        action={
          <div className="flex gap-1">
            {FILTERS.map((item) => (
              <Button key={item.id} type="button" size="sm" variant={filter === item.id ? "default" : "secondary"} onClick={() => setFilter(item.id)}>
                {item.label}
              </Button>
            ))}
          </div>
        }
      >
        {!data ? (
          query.isError ? <p className="text-caption text-down">Briefing request failed.</p> : <LoadingRows rows={4} />
        ) : bots.length === 0 ? (
          <Empty>No bot is {filter} on the stored tape.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {bots.map((bot) => (
              <BotCard key={bot.id} bot={bot} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel className="h-auto" title="Levels to watch" action={<span className="text-micro text-subtle">Live quotes on today's books</span>}>
          {levels.length === 0 ? (
            <Empty>No quoted instrument on today's books.</Empty>
          ) : (
            <table className="w-full text-caption">
              <thead>
                <tr className="text-micro uppercase tracking-wider text-subtle">
                  <th className="py-1 text-left font-medium">Asset</th>
                  <th className="py-1 text-right font-medium">Last</th>
                  <th className="py-1 text-right font-medium">Chg</th>
                  <th className="py-1 text-right font-medium">Prev close</th>
                  <th className="py-1 text-left font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((row) => (
                  <tr key={row.ticker} className="border-t border-border/50">
                    <td className="py-1 font-mono">{row.ticker}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{formatPrice(row.last)}</td>
                    <td className={cn("py-1 text-right font-mono tabular-nums", row.changePct == null ? "text-subtle" : toneOf(row.changePct))}>
                      {row.changePct == null ? "—" : formatPct(row.changePct)}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums text-muted">{row.prevClose == null ? "—" : formatPrice(row.prevClose)}</td>
                    <td className="max-w-[14rem] truncate py-1 text-muted" title={row.why}>
                      {row.why}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel className="h-auto" title="Today's calendar" action={<span className="text-micro text-subtle">New York date</span>}>
          {!data ? (
            query.isError ? <p className="text-caption text-down">Calendar request failed.</p> : <LoadingRows />
          ) : data.calendar.items.length === 0 ? (
            <Empty>{data.calendar.detail}</Empty>
          ) : (
            <>
              <ul className="flex flex-col">
                {data.calendar.items.map((item) => (
                  <li key={`${item.source}-${item.country}-${item.title}-${item.when}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-2 border-t border-border/50 py-1.5 first:border-t-0">
                    <span className="font-mono text-micro tabular-nums text-muted">{item.when}</span>
                    <span className="min-w-0 text-caption">
                      {item.country ? <span className="text-subtle">{item.country} · </span> : null}
                      {item.title}
                      {item.forecast ? <span className="text-micro text-subtle"> · forecast {item.forecast}</span> : null}
                    </span>
                    <Badge tone={item.impact.toLowerCase() === "high" ? "primary" : "neutral"}>{item.impact}</Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-micro text-subtle">{data.calendar.detail}</p>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
