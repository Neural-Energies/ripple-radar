import { Link } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { FrozenBadge } from "@/components/desk-nav";
import { Badge, Button, Panel } from "@/components/ui";
import { useLive, useLiveEvent } from "@/lib/live/provider";
import { validateEventSearch } from "@/lib/hooks/use-event-param-sync";
import { useApp } from "@/lib/store";
import { cn, formatPct, formatPrice } from "@/lib/utils";

export const Route = createFileRoute("/portfolio")({
  validateSearch: validateEventSearch,
  component: PortfolioPage,
});

function PortfolioPage() {
  const eventId = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(eventId);
  const quotes = useLive((s) => s.desk?.quotes);
  const add = useApp((s) => s.addToWatchlist);
  const list = useApp((s) => s.watchlists[0]);
  const holdings = event.trades;

  const byDistance = [0, 1, 2, 3, 4].map((d) => ({
    distance: d,
    count: holdings.filter((h) => (h.distance ?? 0) === d).length,
  }));
  const withDistance = holdings.filter((h) => h.distance != null).length;

  return (
    <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
      <Panel
        title="Book context"
        action={<FrozenBadge title="Not a capital blotter — no AUM, NAV, or strategy P&L." />}
      >
        <p className="text-caption text-muted">
          Ranked expressions for{" "}
          <span className="text-foreground">{event.title?.trim() || "the selected shock"}</span>
          . This page is not a capital blotter — there is no AUM, NAV, or strategy P&amp;L.
        </p>
        <div className="mt-3 rounded-md bg-card-2 p-3">
          <div className="text-micro uppercase tracking-wider text-subtle">
            Expression count by ripple distance
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {byDistance.map((b) => (
              <li key={b.distance} className="flex items-center justify-between text-caption">
                <span className="text-muted">Distance {b.distance}</span>
                <span className="font-mono tabular-nums">{b.count}</span>
              </li>
            ))}
          </ul>
          {withDistance === 0 && holdings.length > 0 ? (
            <p className="mt-2 text-tiny text-subtle">Distances not stamped on these trades yet.</p>
          ) : null}
        </div>
        {list && holdings.length > 0 ? (
          <Button
            className="mt-3 w-full"
            onClick={() => holdings.forEach((h) => add(list.id, h.ticker))}
          >
            Push names to {list.name}
          </Button>
        ) : null}
      </Panel>

      <Panel title="Strategy lab · ranked expressions" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-caption">
            <thead className="text-left text-micro uppercase tracking-wider text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">Ticker</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 font-medium">Dist</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Last</th>
                <th className="px-3 py-2 font-medium">Session</th>
                <th className="px-3 py-2 font-medium">Horizon</th>
                <th className="px-3 py-2 font-medium">Thesis</th>
              </tr>
            </thead>
            <tbody>
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    No ranked trades on this book yet.
                  </td>
                </tr>
              ) : (
                holdings.map((t) => {
                  const q = quotes?.[t.ticker];
                  const session = q?.changePct;
                  const last = q?.last;
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
                      <td className="px-3 py-2 font-mono text-muted">{t.distance ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">{t.score}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {last != null ? formatPrice(last) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 font-mono tabular-nums",
                          session == null ? "text-muted" : session >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {session == null ? "—" : formatPct(session)}
                      </td>
                      <td className="px-3 py-2 text-muted">{t.horizon}</td>
                      <td className="px-3 py-2 text-muted">
                        <span className="mr-1">{t.reason}</span>
                        {t.crowding ? <Badge tone="neutral">{t.crowding}</Badge> : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-3 text-tiny text-subtle">
          Session columns are live Yahoo marks for the selected book&apos;s tickers — not portfolio
          P&amp;L. Illustrative construction only. Not a recommendation. Not a broker.
        </p>
      </Panel>
    </div>
  );
}
