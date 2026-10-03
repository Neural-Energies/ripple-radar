import { Link } from "@tanstack/react-router";
import { TickerLink } from "@/components/desk-nav";
import { reviewDate } from "@/components/thesis";
import { Badge, Button, Delta, Empty, Panel } from "@/components/ui";
import type { MacroState, MacroStateUnavailable } from "@/lib/ace/macro-state";
import type { Brief, BookBrief, Exposure } from "@/lib/brief";
import { safeHttpUrl } from "@/lib/safe-url";
import { cn, formatPct } from "@/lib/utils";

const arrow = (d: "up" | "down" | "mixed" | null) => (d === "up" ? "▲" : d === "down" ? "▼" : d === "mixed" ? "◆" : "");

function clock(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Why this book matters to you, in one line per name. */
export function exposureLine(e: Exposure): string {
  if (e.conflict) return `Your thesis expects ${e.ticker} ${arrow(e.yourDirection)}; this book implies ${arrow(e.bookDirection)}.`;
  if (e.yourDirection) return `Supports your thesis on ${e.ticker} ${arrow(e.yourDirection)} — ${e.reason}.`;
  return `${e.ticker} on your watchlist: book implies ${arrow(e.bookDirection)} — ${e.reason}.`;
}

function MoveCell({ pct, basis }: { pct: number | null; basis: Exposure["changeBasis"] }) {
  if (pct == null) return <span className="text-subtle">unpriced</span>;
  return (
    <span className={cn(pct > 0 && "text-up", pct < 0 && "text-down")} title={basis === "since_seen" ? "Since you last marked the brief read" : "Session change"}>
      {formatPct(pct)}
      <span className="text-subtle">{basis === "since_seen" ? " since" : " sess"}</span>
    </span>
  );
}

function BookCard({ b }: { b: BookBrief }) {
  return (
    <article className="rounded-md bg-card-2 p-2.5" aria-label={b.title}>
      <header className="flex flex-wrap items-center gap-1.5">
        {b.isNewBook ? <Badge tone="primary">new since read</Badge> : null}
        {b.exposures.some((e) => e.conflict) ? <Badge tone="warn">against your thesis</Badge> : null}
        {b.newEvidence ? <Badge tone="neutral">{b.newEvidence} new evidence</Badge> : null}
        <Link to="/" search={{ event: b.eventId }} className="min-w-0 truncate text-body font-medium hover:text-primary">
          {b.title}
        </Link>
        <span className="ml-auto font-mono text-caption tabular-nums">
          {b.probability}%{" "}
          {b.delta ? <Delta n={b.delta} digits={0} suffix=" pts" /> : null}
          <span className="text-micro text-subtle"> {b.deltaBasis === "since_seen" ? "since read" : "last update"}</span>
        </span>
      </header>

      <ul className="mt-1.5 flex flex-col gap-0.5 text-caption">
        {b.exposures.map((e) => (
          <li key={e.ticker} className="grid grid-cols-[4rem_1fr_auto] items-baseline gap-2">
            <TickerLink ticker={e.ticker} />
            <span className={cn("min-w-0", e.conflict ? "text-warn" : "text-muted")}>{exposureLine(e)}</span>
            <span className="font-mono text-micro tabular-nums">
              <MoveCell pct={e.changePct} basis={e.changeBasis} />
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 grid gap-2 text-caption md:grid-cols-3">
        <div>
          <div className="text-micro uppercase tracking-wider text-subtle">Lead path · {b.horizon}</div>
          {b.lead ? (
            <p>
              {b.lead.name} <span className="font-mono tabular-nums">{b.lead.probability}%</span>{" "}
              {b.lead.delta ? <Delta n={b.lead.delta} digits={0} suffix=" pts" /> : null}
            </p>
          ) : (
            <p className="text-subtle">No scenarios on this book.</p>
          )}
          {b.alternatives.length ? (
            <p className="text-micro text-muted">
              Alternatives: {b.alternatives.map((a) => `${a.name} ${a.probability}%`).join(" · ")}
            </p>
          ) : null}
        </div>
        <div>
          <div className="text-micro uppercase tracking-wider text-subtle">Evidence</div>
          <ul className="flex flex-col gap-0.5">
            {b.evidence.length ? (
              b.evidence.map((e) => (
                <li key={e.headline} className="leading-snug">
                  {e.isNew ? <span className="text-primary">new · </span> : null}
                  {e.headline} <span className="text-micro text-subtle">· {e.source}</span>
                </li>
              ))
            ) : (
              <li className="text-subtle">No evidence on this book yet.</li>
            )}
          </ul>
        </div>
        <div>
          <div className="text-micro uppercase tracking-wider text-subtle">Wrong if</div>
          <ul className="flex flex-col gap-0.5 text-muted">
            {b.invalidation.length ? b.invalidation.map((t) => <li key={t}>· {t}</li>) : <li className="text-subtle">No invalidation stated.</li>}
          </ul>
        </div>
      </div>

      <footer className="mt-2 flex flex-wrap gap-x-2 text-micro uppercase tracking-wider">
        <Link to="/maps" search={{ event: b.eventId }} className="text-primary hover:underline">
          Map
        </Link>
        <Link to="/scenarios" search={{ event: b.eventId }} className="text-primary hover:underline">
          Scenarios
        </Link>
        <Link to="/assets" search={{ event: b.eventId }} className="text-primary hover:underline">
          Assets
        </Link>
      </footer>
    </article>
  );
}

function MacroReleases({ macro }: { macro: MacroState | MacroStateUnavailable | null }) {
  if (!macro) return <p className="text-caption text-muted">Loading the factor engine…</p>;
  if (!macro.available) return <p className="text-caption text-muted">Factor engine unavailable: {macro.reason}.</p>;
  const w = macro.whatChanged;
  // One row per release: the block it moved most.
  const top = new Map<string, (typeof w.releases)[number]>();
  for (const r of w.releases) {
    const prev = top.get(r.seriesId);
    if (!prev || Math.abs(r.impact ?? 0) > Math.abs(prev.impact ?? 0)) top.set(r.seriesId, r);
  }
  const rows = [...top.values()].sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0)).slice(0, 5);
  return (
    <>
      <p className="text-micro text-subtle">
        Releases {w.previousAsOf} → {w.updatedAsOf}: surprise vs the model's own expectation (σ), and the block estimate it moved.
      </p>
      <ul className="mt-1 flex flex-col">
        {rows.map((r) => (
          <li key={r.seriesId} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-2 border-b border-border/50 py-0.5 text-caption last:border-b-0">
            <span className="min-w-0 truncate" title={r.seriesId}>
              {r.label} <span className="text-micro text-subtle">· {r.observationDate}</span>
            </span>
            <span className="font-mono text-micro tabular-nums text-muted">
              {r.surprise != null ? `${r.surprise > 0 ? "+" : ""}${r.surprise.toFixed(2)}σ` : "—"}
            </span>
            <span className="font-mono text-micro tabular-nums">
              {r.block} {r.impact != null ? `${r.impact > 0 ? "+" : ""}${r.impact.toFixed(3)}` : "—"}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/macro" className="mt-1 inline-block text-micro uppercase tracking-wider text-primary hover:underline">
        Macro workstation
      </Link>
    </>
  );
}

/** A calendar date (YYYY-MM-DD, New York) as "Thu 02 Oct". */
function calendarDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

/** Scheduled releases, thesis reviews and awaited evidence over the next week. */
export function ComingUp({ upcoming }: { upcoming: Brief["upcoming"] }) {
  const { releases, reviews, awaiting, calendar } = upcoming;
  return (
    <div className="flex flex-col gap-2 text-caption">
      <section>
        <h3 className="text-micro uppercase tracking-wider text-subtle">Macro releases</h3>
        {releases.length ? (
          <ul className="mt-0.5 flex flex-col">
            {releases.map((r) => (
              <li key={`${r.releaseId}-${r.date}`} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-0.5 last:border-b-0">
                {safeHttpUrl(r.url) ? (
                  <a href={safeHttpUrl(r.url)!} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-primary" title={`Moves: ${r.moves.join(", ")}`}>
                    {r.name}
                  </a>
                ) : (
                  <span className="min-w-0 truncate">{r.name}</span>
                )}
                <span className="shrink-0 font-mono text-micro text-muted">{r.date === upcoming.today ? "today" : calendarDay(r.date)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-0.5 text-muted">
            {calendar.status === "loading" ? "Loading…" : calendar.status === "unavailable" ? calendar.detail : `None scheduled in the next ${upcoming.days} days.`}
          </p>
        )}
        {calendar.status === "partial" ? <p className="mt-0.5 text-micro text-warn">{calendar.detail}</p> : null}
      </section>
      {reviews.length ? (
        <section>
          <h3 className="text-micro uppercase tracking-wider text-subtle">Thesis reviews</h3>
          <ul className="mt-0.5 flex flex-col">
            {reviews.map(({ thesis, reviewAt }) => (
              <li key={thesis.id} className="flex items-baseline justify-between gap-2 py-0.5">
                <Link to="/theses" className="min-w-0 truncate hover:text-primary">
                  {thesis.statement}
                </Link>
                <span className="shrink-0 font-mono text-micro text-muted">{reviewDate(reviewAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {awaiting.length ? (
        <section>
          <h3 className="text-micro uppercase tracking-wider text-subtle">Awaited on your books</h3>
          <ul className="mt-0.5 flex flex-col gap-1">
            {awaiting.map((a, i) => (
              <li key={`${a.eventId}-${i}`}>
                <span className="text-foreground">{a.observe}</span>
                {a.lag ? <span className="font-mono text-micro text-muted"> · within {a.lag}</span> : null}
                <div className="truncate text-micro text-subtle">
                  <Link to="/scenarios" search={{ event: a.eventId }} className="hover:text-primary">
                    {a.title}
                  </Link>
                  {a.scenario ? ` · confirms ${a.scenario}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function BriefView({
  brief,
  macro,
  onMarkRead,
}: {
  brief: Brief;
  macro: MacroState | MacroStateUnavailable | null;
  onMarkRead: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-3">
        <Panel
          className="h-auto"
          title={brief.since ? `What changed since ${clock(brief.since)}` : "What changed this session"}
          action={
            <Button type="button" size="sm" variant="secondary" onClick={onMarkRead} title="Compare the next brief against the books and prices as they are now">
              Mark read
            </Button>
          }
        >
          {brief.exposureCount === 0 ? (
            <Empty>
              The brief is built around your names.{" "}
              <Link to="/watchlists" className="text-primary hover:underline">
                Add tickers to a watchlist
              </Link>{" "}
              or save a thesis from a book.
            </Empty>
          ) : brief.books.length === 0 ? (
            <Empty>No book on the desk touches your {brief.exposureCount} names right now.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {brief.books.map((b) => (
                <BookCard key={b.eventId} b={b} />
              ))}
            </div>
          )}
        </Panel>
        {brief.elsewhere.length ? (
          <Panel className="h-auto" title="Elsewhere on the tape">
            <ul className="flex flex-col">
              {brief.elsewhere.map((b) => (
                <li key={b.eventId} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1 text-caption last:border-b-0">
                  <Link to="/" search={{ event: b.eventId }} className="min-w-0 truncate hover:text-primary">
                    {b.isNewBook ? <span className="text-primary">new · </span> : null}
                    {b.title}
                  </Link>
                  <span className="font-mono tabular-nums">
                    {b.probability}% {b.delta ? <Delta n={b.delta} digits={0} suffix=" pts" /> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <Panel className="h-auto" title="Theses needing attention" action={<Link to="/theses" className="text-micro text-primary hover:underline">All</Link>}>
          {brief.theses.length === 0 ? (
            <p className="text-caption text-muted">Nothing due and nothing broken.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {brief.theses.map(({ thesis, monitor }) => (
                <li key={thesis.id} className="rounded-sm bg-card-2 px-2 py-1.5 text-caption">
                  <div className="flex items-center gap-1.5">
                    {monitor.due ? <Badge tone="warn">due</Badge> : <Badge tone="neutral">review {reviewDate(thesis.reviewAt)}</Badge>}
                    <span className="min-w-0 truncate font-medium">{thesis.statement}</span>
                  </div>
                  <ul className="mt-0.5 text-micro text-warn">
                    {monitor.flags.slice(0, 2).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="h-auto" title={`Coming up · next ${brief.upcoming.days} days`}>
          <ComingUp upcoming={brief.upcoming} />
        </Panel>
        <Panel className="h-auto" title="Your names moving without a book">
          {brief.unexplained.length === 0 ? (
            <p className="text-caption text-muted">No unexplained moves in your names.</p>
          ) : (
            <ul className="flex flex-col">
              {brief.unexplained.map((u) => (
                <li key={u.ticker} className="flex items-baseline justify-between gap-2 py-0.5 font-mono text-caption tabular-nums">
                  <TickerLink ticker={u.ticker} />
                  <MoveCell pct={u.changePct} basis={u.changeBasis} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="h-auto" title="Macro · what changed">
          <MacroReleases macro={macro} />
        </Panel>
      </div>
    </div>
  );
}
