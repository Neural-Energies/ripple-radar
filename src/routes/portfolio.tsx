import { Link } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { Donut } from "@/components/charts";
import { Button, Panel } from "@/components/ui";
import { DEFAULT_PORTFOLIO } from "@/data/catalog";
import { useLive, useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn, formatPct } from "@/lib/utils";

export const Route = createFileRoute("/portfolio")({ component: PortfolioPage });

function PortfolioPage() {
  const eventId = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(eventId);
  const quotes = useLive((s) => s.desk?.quotes);
  const add = useApp((s) => s.addToWatchlist);
  const list = useApp((s) => s.watchlists[0]);
  const holdings = event.trades;
  const sessionMoves = holdings
    .map((h) => quotes?.[h.ticker]?.changePct)
    .filter((n): n is number => n != null);
  const session =
    sessionMoves.length > 0 ? sessionMoves.reduce((a, b) => a + b, 0) / sessionMoves.length : null;

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
      <Panel title={`Balanced ripple · ${event.theme}`}>
        <Donut data={DEFAULT_PORTFOLIO} />
        <ul className="mt-1 flex flex-col gap-1">
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
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-card-2 p-3">
          <div>
            <div className="text-micro uppercase tracking-wider text-subtle">Session P&L (EW)</div>
            <div
              className={cn(
                "font-mono text-sm",
                session == null ? "text-muted" : session >= 0 ? "text-up" : "text-down",
              )}
            >
              {session == null ? "—" : formatPct(session)}
            </div>
          </div>
          <div>
            <div className="text-micro uppercase tracking-wider text-subtle">Max DD</div>
            <div className="font-mono text-sm text-down">−8%</div>
          </div>
        </div>
        {list && (
          <Button
            className="mt-3 w-full"
            onClick={() => holdings.forEach((h) => add(list.id, h.ticker))}
          >
            Push names to {list.name}
          </Button>
        )}
      </Panel>
      <Panel title="Strategy lab · ranked expressions" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-caption">
            <thead className="text-left text-micro uppercase tracking-wider text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">Ticker</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Horizon</th>
                <th className="px-3 py-2 font-medium">Thesis</th>
              </tr>
            </thead>
            <tbody>
              {event.trades.map((t) => {
                return (
                  <tr key={t.ticker} className="border-b border-border/70">
                    <td className="px-3 py-2">
                      <Link
                        to="/assets/$ticker"
                        params={{ ticker: t.ticker }}
                        className="font-mono text-primary hover:underline"
                      >
                        {t.ticker}
                      </Link>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 uppercase",
                        t.side === "long" ? "text-up" : "text-down",
                      )}
                    >
                      {t.side}
                    </td>
                    <td className="px-3 py-2 font-mono">{t.score}</td>
                    <td className="px-3 py-2 text-muted">{t.horizon}</td>
                    <td className="px-3 py-2 text-muted">{t.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-3 text-tiny text-subtle">
          Illustrative construction from public Yahoo last + RSS tape. Not a recommendation. Not a
          broker. Marks are last/session prints, not a professional consolidated feed.
        </p>
      </Panel>
    </div>
  );
}
