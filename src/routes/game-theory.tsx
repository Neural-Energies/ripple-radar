import { createFileRoute, Link } from "@tanstack/react-router";
import { ScenarioDistributionBar } from "@/components/charts";
import { ResearchHeader } from "@/components/research-header";
import { Badge, Panel } from "@/components/ui";
import { isNash, readMatrix } from "@/lib/engine/game";
import { validateEventSearch } from "@/lib/hooks/use-event-param-sync";
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
  const read = readMatrix(gt);
  const scenarios = event.scenarios ?? [];

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <ResearchHeader subtitle="Game Theory" />
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Panel title="Players, incentives, BATNAs">
            <div className="grid gap-1.5 md:grid-cols-2">
              {gt.players.map((p) => (
                <article key={p.name} className="rounded-sm bg-card-2 px-2.5 py-1.5">
                  <h3 className="text-caption font-medium">{p.name}</h3>
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
                          return (
                            <td
                              key={col}
                              className={cn("px-2 py-1.5", likely && "ring-1 ring-inset ring-primary")}
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
          <Panel title="What this does to the book">
            {read.likely ? (
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
                <div className="mb-1 text-micro uppercase tracking-wider text-subtle">Scenario mix</div>
                <ScenarioDistributionBar scenarios={scenarios} showSum />
              </div>
            ) : null}
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
