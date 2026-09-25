import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ScenarioDistributionBar } from "@/components/charts";
import { FilterLink } from "@/components/desk-nav";
import { ResearchHeader } from "@/components/research-header";
import { Panel } from "@/components/ui";
import { ImportanceMeter } from "@/components/engine-panels";
import { goToScenario, validateEventSearch } from "@/lib/hooks/use-event-param-sync";
import { getEmpiricalBook } from "@/lib/live/desk";
import { formatPct, formatVolume, type EmpiricalBook } from "@/lib/live/empirical";
import { useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/game-theory")({
  validateSearch: validateEventSearch,
  component: GameTheoryPage,
});

function GameTheoryPage() {
  const id = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(id);
  const gt = event.gameTheory;
  const navigate = useNavigate();
  const scenarios = event.scenarios ?? [];
  const actors = gt.players.map((p) => p.name).slice(0, 3);

  const [book, setBook] = useState<EmpiricalBook | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    void getEmpiricalBook({ data: { title: event.title, actors } })
      .then((next) => {
        if (!dead) setBook(next);
      })
      .catch(() => {
        if (!dead) {
          setBook({
            asOf: new Date().toISOString(),
            bullets: ["Market prices could not be loaded."],
            contracts: [],
            history: { available: false, reason: "History was not loaded." },
            error: "unavailable",
          });
        }
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [event.id, event.title, actors.join("|")]);

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <ResearchHeader subtitle="Game Theory" />
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Panel title={`Priced chances · ${gt.actor} and ${gt.counterpart}`}>
            <p className="text-micro text-subtle">
              Live yes-prices from Polymarket. Not a score, and not a pair of moves.
            </p>
            {loading && !book ? (
              <p className="mt-2 text-caption text-muted">Pulling live contract prices…</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {(book?.bullets ?? []).map((line) => (
                  <li key={line} className="text-caption leading-snug text-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {book && book.contracts.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {book.contracts.map((c) => (
                  <li key={c.question}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-baseline justify-between gap-2 rounded-sm px-1 py-1 hover:bg-card-2"
                    >
                      <span className="min-w-0 text-caption text-foreground">{c.question}</span>
                      <span className="shrink-0 font-mono text-caption tabular-nums text-primary">
                        {formatPct(c.yes)}
                        <span className="ml-2 text-subtle">· {formatVolume(c.volumeUsd)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="What they have actually done">
            <HistoryBlock book={book} loading={loading} />
          </Panel>

          <Panel title="Players on the book">
            <div className="grid gap-1.5 md:grid-cols-2">
              {gt.players.map((p) => (
                <article key={p.name} className="rounded-sm bg-card-2 px-2.5 py-1.5">
                  <h3 className="text-caption font-medium">
                    <FilterLink q={p.name}>{p.name}</FilterLink>
                  </h3>
                  <dl className="mt-1 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-caption">
                    <Row k="Objective" v={p.objective} />
                    <Row k="Incentives" v={p.incentives} />
                    <Row k="Constraints" v={p.constraints} />
                    <Row k="Moves" v={p.moves.join(" · ")} />
                    <Row k="Walk-away" v={p.batna} hint="Best alternative if this path fails" />
                  </dl>
                </article>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-1.5">
          <Panel title="Desk book">
            <p className="text-micro text-subtle">
              Desk estimate of the paths forward. Not an order.
            </p>
            <p className="mt-1.5 text-caption leading-snug text-muted">{gt.insight}</p>
            {scenarios.length > 0 ? (
              <div className="mt-2">
                <ScenarioDistributionBar
                  scenarios={scenarios}
                  showSum
                  onSelect={(sid) => goToScenario(navigate, event.id, sid)}
                />
              </div>
            ) : (
              <p className="mt-2 text-caption text-muted">No scenarios on this book.</p>
            )}
          </Panel>
          <Panel title="Book standing">
            <ImportanceMeter event={event} />
          </Panel>
          <p className="px-0.5 text-tiny text-subtle">
            <Link to="/" className="text-primary hover:underline">
              Live Desk
            </Link>
            {" · "}
            <Link to="/docs" className="text-primary hover:underline">
              Docs
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function HistoryBlock({ book, loading }: { book: EmpiricalBook | null; loading: boolean }) {
  if (loading && !book) return <p className="text-caption text-muted">Checking the coded record…</p>;
  const history = book?.history;
  if (!history?.available || !history.sides) {
    return <p className="text-caption text-muted">{history?.reason ?? "No coded history for this book."}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-micro text-subtle">
        {history.window?.[0]} – {history.window?.[1]} · {history.rows?.toLocaleString()} events.{" "}
        {history.diplomaticUnattributed?.toLocaleString()} diplomatic events have no initiator, so they
        are not in the shares below. This is what was recorded, not the chance of the next move.
      </p>
      <ul className="flex flex-col gap-1.5">
        {history.sides.map((side) => (
          <li key={side.label}>
            <div className="flex items-baseline justify-between gap-2 text-caption">
              <span className="min-w-0 text-foreground">
                {side.label} · {side.event.toLowerCase()} {side.k} of {side.n}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-primary">{formatPct(side.share)}</span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-card-3">
              <div className="h-full rounded-full bg-primary" style={{ width: `${side.share * 100}%` }} />
            </div>
            <p className="mt-0.5 text-micro text-subtle" title="95% Wilson interval on the recorded share. Not a forecast.">
              Wilson 95% {formatPct(side.wilson95[0])}–{formatPct(side.wilson95[1])}
            </p>
          </li>
        ))}
      </ul>
      {history.url && (
        <a href={history.url} target="_blank" rel="noreferrer" className="text-micro text-primary hover:underline">
          {history.citation}
        </a>
      )}
    </div>
  );
}

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <>
      <dt className="text-micro uppercase tracking-wider text-subtle" title={hint}>{k}</dt>
      <dd className="min-w-0 text-muted">{v}</dd>
    </>
  );
}
