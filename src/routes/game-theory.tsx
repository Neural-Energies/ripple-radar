import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ScenarioDistributionBar } from "@/components/charts";
import { FilterLink, NodeNavLink } from "@/components/desk-nav";
import { ResearchHeader } from "@/components/research-header";
import { Badge, Delta, Panel } from "@/components/ui";
import { ImportanceMeter } from "@/components/engine-panels";
import { intervene } from "@/lib/ace/intervene";
import { isNash, readMatrix } from "@/lib/engine/game";
import { goToScenario, validateEventSearch } from "@/lib/hooks/use-event-param-sync";
import { useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/game-theory")({
  validateSearch: validateEventSearch,
  component: GameTheoryPage,
});

function cellBg(a: number): string {
  const t = Math.min(1, Math.abs(a) / 5);
  if (a > 0) return `rgb(61 214 140 / ${0.1 + t * 0.32})`;
  if (a < 0) return `rgb(240 113 120 / ${0.1 + t * 0.32})`;
  return "transparent";
}

function GameTheoryPage() {
  const id = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(id);
  const gt = event.gameTheory;
  const navigate = useNavigate();
  const read = readMatrix(gt);
  const scenarios = event.scenarios ?? [];

  const [picked, setPicked] = useState<{ row: string; col: string } | null>(null);
  const conditional = picked
    ? intervene({
        gameTheory: gt,
        scenarios,
        nodes: event.nodes,
        links: event.links,
        play: picked,
      })
    : null;

  function togglePick(row: string, col: string) {
    setPicked((p) => (p?.row === row && p?.col === col ? null : { row, col }));
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <ResearchHeader subtitle="Game Theory" />
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Panel title="Players, incentives, BATNAs">
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
                    <Row k="BATNA" v={p.batna} />
                  </dl>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title={`Payoff matrix · ${gt.actor} vs ${gt.counterpart}`} padded={false}>
            {gt.columns.length === 0 ? (
              <p className="px-2 py-4 text-caption text-muted">Matrix constructs once players are discovered.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-caption">
                  <thead>
                    <tr className="text-left text-micro text-subtle">
                      <th className="px-2 py-1 font-medium">
                        {gt.actor} ↓ / {gt.counterpart} →
                      </th>
                      {gt.columns.map((c) => (
                        <th key={c} className="px-2 py-1 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gt.rows.map((row) => (
                      <tr key={row.name} className="border-t border-border align-top">
                        <td className="px-2 py-1.5 font-medium">{row.name}</td>
                        {row.cells.map((cell, i) => {
                          const col = gt.columns[i] ?? "";
                          const nash = isNash(read, row.name, col);
                          const likely = read.likely?.row === row.name && read.likely?.col === col;
                          const isPicked = picked?.row === row.name && picked?.col === col;
                          return (
                            <td
                              key={col}
                              role="button"
                              tabIndex={0}
                              aria-pressed={isPicked}
                              title={`Condition the book on ${row.name} vs ${col}`}
                              onClick={() => togglePick(row.name, col)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  togglePick(row.name, col);
                                }
                              }}
                              className={cn(
                                "cursor-pointer px-2 py-1.5 transition-colors hover:brightness-125",
                                likely && "ring-1 ring-inset ring-primary",
                                isPicked && "ring-2 ring-inset ring-foreground",
                              )}
                              style={{ background: cellBg(cell.a) }}
                            >
                              <div className={cn("text-micro leading-snug", nash && "text-foreground")}>{cell.label}</div>
                              <div className="mt-0.5 font-mono text-caption tabular-nums">
                                ({cell.a}, {cell.b})
                              </div>
                              {likely && (
                                <div className="mt-0.5 text-micro uppercase tracking-wider text-primary">Likely play</div>
                              )}
                              {nash && !likely && (
                                <Badge tone="primary" className="mt-0.5">
                                  Nash
                                </Badge>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-1.5">
          <Panel
            title="What this does to the book"
            action={
              conditional ? (
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="font-mono text-micro text-primary hover:underline"
                >
                  clear cell
                </button>
              ) : (
                <span className="font-mono text-micro text-subtle">pick a cell</span>
              )
            }
          >
            {conditional ? (
              <div className="rounded-sm bg-card-2 px-2 py-1.5">
                <div className="text-micro uppercase tracking-wider text-subtle">
                  Conditional on {conditional.play.row} vs {conditional.play.col}
                </div>
                <p className="mt-0.5 text-caption leading-snug text-muted">{conditional.note}</p>
              </div>
            ) : read.likely ? (
              <div className="rounded-sm bg-card-2 px-2 py-1.5">
                <div className="text-micro uppercase tracking-wider text-subtle">Likely cell</div>
                <p className="mt-0.5 text-caption leading-snug">
                  {gt.actor} plays <span className="text-foreground">{read.likely.row}</span>
                  {", "}
                  {gt.counterpart} plays <span className="text-foreground">{read.likely.col}</span>
                  {" — "}
                  {read.likely.label}. Payoff ({read.likely.a}, {read.likely.b}).
                </p>
              </div>
            ) : (
              <p className="text-caption text-muted">No likely cell until the matrix fills.</p>
            )}
            <p className="mt-1.5 text-caption leading-snug text-muted">{gt.insight}</p>
            {scenarios.length > 0 ? (
              <div className="mt-2">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-micro uppercase tracking-wider text-subtle">
                    {conditional ? "Scenario mix · conditional" : "Scenario mix"}
                  </span>
                  {conditional && (
                    <span className="font-mono text-micro text-subtle">
                      severity {conditional.severity > 0 ? "+" : ""}
                      {conditional.severity}
                    </span>
                  )}
                </div>
                <ScenarioDistributionBar
                  scenarios={scenarios}
                  showSum
                  onSelect={(sid) => goToScenario(navigate, event.id, sid)}
                />
                {conditional && (
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {conditional.scenarios.map((s) => (
                      <li key={s.id} className="flex items-baseline justify-between gap-2 text-caption">
                        <span className="truncate text-muted">{s.name}</span>
                        <span className="shrink-0 font-mono tabular-nums">
                          {s.base}% <span className="text-subtle">→</span> {s.conditional}%
                          <span className="ml-1">
                            <Delta n={s.delta} digits={0} />
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            {conditional && conditional.nodes.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-micro uppercase tracking-wider text-subtle">
                  Transmission rescored
                </div>
                <ul className="flex flex-col gap-0.5">
                  {conditional.nodes.slice(0, 5).map((n) => (
                    <li key={n.id} className="flex items-baseline justify-between gap-2 text-caption">
                      {(() => {
                        const full = event.nodes.find((x) => x.id === n.id);
                        if (full) {
                          return <NodeNavLink node={full} event={event} className="truncate" />;
                        }
                        if (n.ticker) {
                          return (
                            <Link
                              to="/assets/$ticker"
                              params={{ ticker: n.ticker }}
                              className="truncate text-primary hover:underline"
                            >
                              {n.label}
                            </Link>
                          );
                        }
                        return <span className="truncate text-muted">{n.label}</span>;
                      })()}
                      <span className="shrink-0 font-mono tabular-nums text-subtle">
                        {n.base} → {n.conditional}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-micro text-subtle">
                  Conditional view over this book — the desk keeps the probabilities the evidence
                  supports. Nothing here is written back.
                </p>
              </div>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-micro uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="min-w-0 text-muted">{v}</dd>
    </>
  );
}
