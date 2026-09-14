import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkline } from "@/components/sparkline";
import { Badge, Input, Panel } from "@/components/ui";
import { cn, formatPct, formatPrice } from "@/lib/utils";
import { useLive, useLiveAssets } from "@/lib/live/provider";

export const Route = createFileRoute("/assets")({ component: AssetsPage });

type SortKey = "score" | "change" | "ticker";

function AssetsPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [side, setSide] = useState<"all" | "up" | "down">("all");
  const assets = useLiveAssets();
  const quotes = useLive((s) => s.desk?.quotes);

  const rows = useMemo(() => {
    let list = assets.filter(
      (a) =>
        !q ||
        a.ticker.toLowerCase().includes(q.toLowerCase()) ||
        a.name.toLowerCase().includes(q.toLowerCase()) ||
        a.bottleneck.toLowerCase().includes(q.toLowerCase()),
    );
    if (side === "up") list = list.filter((a) => a.change >= 0);
    if (side === "down") list = list.filter((a) => a.change < 0);
    list = [...list].sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "change") return b.change - a.change;
      return b.score - a.score;
    });
    return list;
  }, [assets, q, sort, side]);

  return (
    <Panel
      title="Asset Explorer"
      action={<span className="text-micro text-muted">{rows.length} expressions · ranked for the selected shock</span>}
      padded={false}
    >
      <div className="flex flex-col gap-2 border-b border-border px-3 py-3 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ticker, name, bottleneck"
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1">
          {(["score", "change", "ticker"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={cn(
                "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                sort === k ? "bg-primary/15 text-primary" : "text-muted",
              )}
            >
              Sort {k}
            </button>
          ))}
          {(["all", "up", "down"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSide(k)}
              className={cn(
                "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                side === k ? "bg-primary/15 text-primary" : "text-muted",
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-caption">
          <thead className="text-left text-micro uppercase tracking-wider text-subtle">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Crowd</th>
              <th className="px-3 py-2 font-medium">Tape</th>
              <th className="px-3 py-2 font-medium">Last</th>
              <th className="px-3 py-2 font-medium">Session</th>
              <th className="px-3 py-2 font-medium">Spark</th>
              <th className="px-3 py-2 font-medium">Causal path</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.ticker} className="border-b border-border/70 hover:bg-card-2">
                <td className="px-3 py-2">
                  <Link
                    to="/assets/$ticker"
                    params={{ ticker: a.ticker }}
                    className="font-mono text-primary hover:underline"
                  >
                    {a.ticker}
                  </Link>
                </td>
                <td className="px-3 py-2">{a.name}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{a.score}</td>
                <td className="px-3 py-2">
                  <Badge tone={a.crowding === "low" || a.crowding === "emerging" ? "up" : a.crowding === "saturated" ? "core" : "neutral"}>
                    {a.crowding ?? "—"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-micro uppercase tracking-wider text-muted">{a.confirmation ?? "—"}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{formatPrice(a.last)}</td>
                <td
                  className={cn(
                    "px-3 py-2 font-mono tabular-nums",
                    a.change >= 0 ? "text-up" : "text-down",
                  )}
                >
                  {formatPct(a.change)}
                </td>
                <td className="px-3 py-2">
                  <Sparkline data={quotes?.[a.ticker]?.spark ?? []} />
                </td>
                <td className="px-3 py-2 text-tiny text-muted">{a.causalPath ?? a.bottleneck}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
