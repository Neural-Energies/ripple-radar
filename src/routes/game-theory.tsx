import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Panel } from "@/components/ui";
import { isNash, readMatrix } from "@/lib/engine/game";
import { useLiveEvent, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/game-theory")({ component: GameTheoryPage });

function GameTheoryPage() {
  const id = useApp((s) => s.selectedEventId);
  const setId = useApp((s) => s.setSelectedEventId);
  const events = useLiveEvents();
  const event = useLiveEvent(id);
  const gt = event.gameTheory;
  const read = readMatrix(gt);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setId(e.id)}
            className={cn(
              "max-w-56 truncate rounded-md px-3 py-1.5 text-caption",
              e.id === event.id ? "bg-primary/15 text-foreground" : "bg-card text-muted",
            )}
            title={e.title}
          >
            {e.title}
          </button>
        ))}
      </div>

      <Panel title="How to read the matrix">
        <p className="mb-2 text-caption text-muted">
          Game theory here is not decoration. It answers: given this event, who can change the
          outcome, what they want, and which joint move is likely. That cell rewrites the causal
          graph — for example an official supply response can kill crude upside while leaving a
          freight bottleneck intact.
        </p>
        <ol className="grid gap-2 sm:grid-cols-2">
          {read.primer.map((p, i) => (
            <li key={p} className="rounded-md bg-card-2 px-2.5 py-2 text-caption text-foreground">
              <span className="mr-2 font-mono text-micro text-primary">{String(i + 1).padStart(2, "0")}</span>
              {p}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Players, incentives, BATNAs">
        <p className="mb-3 text-caption text-muted">
          Discovered from who can materially change this event. Not a preloaded country list.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {gt.players.map((p) => (
            <article key={p.name} className="rounded-md bg-card-2 p-3">
              <h3 className="text-body font-medium">{p.name}</h3>
              <dl className="mt-2 flex flex-col gap-1.5 text-caption">
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

      <Panel title={`Payoff matrix · ${gt.actor} vs ${gt.counterpart}`}>
        {gt.columns.length === 0 ? (
          <p className="text-caption text-muted">Matrix constructs once players are discovered.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-caption">
              <thead>
                <tr className="text-left text-tiny text-subtle">
                  <th className="py-2 pr-2 font-medium">
                    {gt.actor} ↓ / {gt.counterpart} →
                  </th>
                  {gt.columns.map((c) => (
                    <th key={c} className="px-2 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gt.rows.map((row) => (
                  <tr key={row.name} className="border-t border-border align-top">
                    <td className="py-2 pr-2 font-medium">{row.name}</td>
                    {row.cells.map((cell, i) => {
                      const col = gt.columns[i] ?? "";
                      const nash = isNash(read, row.name, col);
                      const likely = read.likely?.row === row.name && read.likely?.col === col;
                      return (
                        <td
                          key={col}
                          className={cn("px-2 py-2", nash && "bg-primary/10", likely && "ring-1 ring-primary/40")}
                        >
                          <div className="text-muted">{cell.label}</div>
                          <Badge tone={nash ? "primary" : "neutral"} className="mt-1">
                            ({cell.a}, {cell.b})
                          </Badge>
                          {likely && (
                            <div className="mt-1 text-micro uppercase tracking-wider text-primary">Likely play</div>
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
        {read.likely && (
          <p className="mt-3 rounded-md bg-card-2 px-3 py-2 text-caption text-muted">
            <span className="font-medium text-foreground">Likely cell. </span>
            {gt.actor} plays <span className="text-foreground">{read.likely.row}</span>, {gt.counterpart} plays{" "}
            <span className="text-foreground">{read.likely.col}</span> — {read.likely.label}. Payoff ({read.likely.a},{" "}
            {read.likely.b}).
          </p>
        )}
        <p className="mt-2 rounded-md bg-card-2 px-3 py-2 text-caption text-muted">{gt.insight}</p>
        <p className="mt-2 text-tiny text-subtle">
          What this does to the book: re-rank second-order names that survive the likely play; fade first-order
          that only pays in a tail cell.{" "}
          <Link to="/" className="text-primary hover:underline">
            Back to the ripple
          </Link>
        </p>
      </Panel>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="text-muted">{v}</dd>
    </div>
  );
}
