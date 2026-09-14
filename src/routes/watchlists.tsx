import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DeskHint } from "@/components/desk-sync";
import { Button, Input, Panel } from "@/components/ui";
import { instrumentOf } from "@/lib/engine/instruments";
import { useLive, useLiveAssets } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn, formatPct, formatPrice } from "@/lib/utils";

export const Route = createFileRoute("/watchlists")({ component: WatchlistsPage });

function WatchlistsPage() {
  const lists = useApp((s) => s.watchlists);
  const create = useApp((s) => s.createWatchlist);
  const remove = useApp((s) => s.removeFromWatchlist);
  const [name, setName] = useState("");
  const [active, setActive] = useState(lists[0]?.id ?? "");
  const current = lists.find((l) => l.id === active) ?? lists[0];
  const quotes = useLive((s) => s.desk?.quotes);
  const liveAssets = useLiveAssets();

  return (
    <div className="grid gap-3 lg:grid-cols-[16rem_1fr]">
      <Panel title="Lists">
        <ul className="flex flex-col gap-1">
          {lists.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setActive(l.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-caption",
                  current?.id === l.id ? "bg-card-2 text-foreground" : "text-muted hover:bg-card-2",
                )}
              >
                {l.name}
                <span className="font-mono text-tiny text-subtle">{l.tickers.length}</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create(name.trim());
            setName("");
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list" />
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
        <div className="mt-3">
          <DeskHint />
        </div>
      </Panel>
      <Panel title={current ? current.name : "Select a list"} padded={false}>
        {!current || current.tickers.length === 0 ? (
          <p className="px-3 py-8 text-center text-caption text-muted">
            Empty list. Ranked trades on the dashboard pin here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-caption">
              <thead className="text-left text-micro uppercase tracking-wider text-subtle">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Last</th>
                  <th className="px-3 py-2 font-medium">Session</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {current.tickers.map((t) => {
                  const a = liveAssets.find((x) => x.ticker === t) ?? instrumentOf(t, quotes);
                  const q = quotes?.[t];
                  const change = q?.changePct ?? a?.change ?? 0;
                  return (
                    <tr key={t} className="border-b border-border/70">
                      <td className="px-3 py-2">
                        <Link
                          to="/assets/$ticker"
                          params={{ ticker: t }}
                          className="font-mono text-primary hover:underline"
                        >
                          {t}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{a?.name ?? "—"}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {q ? formatPrice(q.last) : a ? formatPrice(a.last) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 font-mono",
                          change >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {formatPct(change)}
                      </td>
                      <td className="px-3 py-2 font-mono">{a?.score ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-tiny text-muted hover:text-down"
                          onClick={() => remove(current.id, t)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
