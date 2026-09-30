import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sparkline } from "@/components/sparkline";
import type { Confirmation, Crowding, ScoreParts } from "@/data/types";
import { Badge, Button, Panel } from "@/components/ui";
import { goToEvent } from "@/lib/hooks/use-event-param-sync";
import { useLiveAsset, useLiveAssets, useLiveEvents, useQuote } from "@/lib/live/provider";
import { explainScore } from "@/lib/live/discover";
import { FUTURES } from "@/lib/live/symbols";
import { useApp } from "@/lib/store";
import { cn, formatPct, formatPrice } from "@/lib/utils";

export const Route = createFileRoute("/assets/$ticker")({ component: AssetDetail });

function AssetDetail() {
  const { ticker } = Route.useParams();
  const asset = useLiveAsset(ticker);
  const events = useLiveEvents();
  const assets = useLiveAssets();
  const quote = useQuote(ticker);
  const add = useApp((s) => s.addToWatchlist);
  const lists = useApp((s) => s.watchlists);
  const setEvent = useApp((s) => s.setSelectedEventId);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!asset) {
    return (
      <Panel title="Unknown ticker">
        <p className="text-body text-muted">No record for {ticker}.</p>
        <Link to="/assets" className="mt-2 inline-block text-caption text-primary hover:underline">
          Back to explorer
        </Link>
      </Panel>
    );
  }

  const related = events.filter((e) => e.trades.some((t) => t.ticker === asset.ticker) || e.nodes.some((n) => n.ticker === asset.ticker));
  const peers = assets
    .filter((a) => a.ticker !== asset.ticker && a.distance === asset.distance)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-tiny text-primary">{asset.ticker}</div>
            <h1 className="text-xl font-semibold tracking-tight">{asset.name}</h1>
            <p className="mt-1 max-w-2xl text-caption text-muted">{asset.thesis}</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl tabular-nums">{formatPrice(asset.last)}</div>
            <div className={cn("font-mono text-sm", asset.change >= 0 ? "text-up" : "text-down")}>
              session {formatPct(asset.change)}
            </div>
            <div className="mt-1 text-tiny text-subtle">
              {quote?.state === "live"
                ? "Live last"
                : quote?.state === "last"
                  ? "Last session print"
                  : "Last mark"}
              {quote?.exchange ? ` · ${quote.exchange}` : ""}
            </div>
            {FUTURES[asset.ticker] ? (
              <div className="mt-0.5 max-w-xs text-tiny text-subtle">
                {FUTURES[asset.ticker]!.contract} · {FUTURES[asset.ticker]!.exchange} front month, continuous; rolls{" "}
                {FUTURES[asset.ticker]!.roll}, so a change across a roll spans two contracts. Delayed ~
                {FUTURES[asset.ticker]!.delayMinutes} min · {FUTURES[asset.ticker]!.session}
              </div>
            ) : null}
            <Sparkline data={quote?.spark ?? []} className="ml-auto mt-2" />
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field k="Book score" v={String(asset.score)} />
          <Field k="Crowding" v={asset.crowding ?? "—"} />
          <Field k="Confirmation" v={asset.confirmation ?? "—"} />
          <Field k="Expected lag" v={asset.lag} />
          <Field k="Kind" v={asset.kind} />
          <Field k="Liquidity" v={asset.liquidity ?? "—"} />
          <Field k="Distance" v={asset.distance != null ? `Ripple ${asset.distance}` : "—"} />
          <Field k="Bottleneck" v={asset.bottleneck} />
        </dl>
        {asset.causalPath && (
          <p className="mt-3 text-caption text-muted">
            <span className="text-micro uppercase tracking-wider text-subtle">Causal path. </span>
            {asset.causalPath}
          </p>
        )}
        {asset.invalidation && (
          <p className="mt-1 text-caption text-muted">
            <span className="text-micro uppercase tracking-wider text-subtle">Invalidation. </span>
            {asset.invalidation}
          </p>
        )}
        <WhyThisScore ticker={asset.ticker} events={related} fallback={asset} />
        <div className="mt-3 flex flex-wrap gap-2">
          {lists.map((w) => (
            <Button key={w.id} size="sm" variant="secondary" onClick={() => add(w.id, asset.ticker)}>
              Add to {w.name}
            </Button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Linked events">
          <ul className="flex flex-col gap-2">
            {related.map((e) => {
              const node = e.nodes.find((n) => n.ticker === asset.ticker);
              return (
                <li key={e.id} className="rounded-md bg-card-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="text-left text-caption font-medium text-foreground hover:text-primary hover:underline"
                      onClick={() => {
                        setEvent(e.id);
                        goToEvent(navigate, pathname, e.id);
                      }}
                    >
                      {e.title}
                    </button>
                    <Badge tone="primary">{e.probability}%</Badge>
                  </div>
                  {node && (
                    <p className="mt-1 text-tiny text-muted">
                      Ripple {node.level} · impact {node.impact} · {node.blurb}
                    </p>
                  )}
                  <p className="mt-2 text-tiny text-subtle">
                    Links:{" "}
                    {e.links
                      .filter((l) => {
                        const src = e.nodes.find((n) => n.id === l.source);
                        const dst = e.nodes.find((n) => n.id === l.dest);
                        return src?.ticker === asset.ticker || dst?.ticker === asset.ticker;
                      })
                      .map((l) => `${l.source} → ${l.dest} (${l.expectedLag})`)
                      .join(" · ") || "—"}
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Peer expressions">
          <ul className="flex flex-col">
            {peers.map((p) => (
              <li key={p.ticker} className="flex items-center justify-between border-t border-border/70 py-2 first:border-t-0">
                <Link
                  to="/assets/$ticker"
                  params={{ ticker: p.ticker }}
                  className="font-mono text-caption text-primary hover:underline"
                >
                  {p.ticker}
                </Link>
                <span className="truncate px-2 text-tiny text-muted">{p.bottleneck}</span>
                <span className={cn("font-mono text-tiny tabular-nums", p.change >= 0 ? "text-up" : "text-down")}>
                  {formatPct(p.change)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="text-caption">{v}</dd>
    </div>
  );
}

/**
 * What the score is made of, on the book that ranks this name highest, and
 * which other names on that book point the same way (one driver, one bet).
 */
function WhyThisScore({
  ticker,
  events,
  fallback,
}: {
  ticker: string;
  events: ReturnType<typeof useLiveEvents>;
  fallback: { scoreParts?: ScoreParts; crowding?: Crowding; confirmation?: Confirmation };
}) {
  const ranked = events
    .map((e) => ({ event: e, trade: e.trades.find((t) => t.ticker === ticker) }))
    .filter((r): r is { event: (typeof events)[number]; trade: NonNullable<(typeof r)["trade"]> } => Boolean(r.trade))
    .sort((a, b) => b.trade.score - a.trade.score)[0];
  const parts = ranked?.trade.scoreParts ?? fallback.scoreParts;
  if (!parts) return null;
  const lines = explainScore(parts, ranked?.trade.crowding ?? fallback.crowding, ranked?.trade.confirmation ?? fallback.confirmation);
  const sameSide = ranked ? ranked.event.trades.filter((t) => t.ticker !== ticker && t.side === ranked.trade.side) : [];
  return (
    <div className="mt-3 rounded-sm bg-card-2 p-2">
      <div className="text-micro uppercase tracking-wider text-subtle">
        Why this score{ranked ? ` · ${ranked.event.title}` : ""}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {lines.map((l) => (
          <li key={l.label} className="grid grid-cols-[8.5rem_3.5rem_1fr] items-baseline gap-2 text-caption max-sm:grid-cols-[1fr_auto]">
            <span className="text-foreground">{l.label}</span>
            <span className={cn("text-right font-mono tabular-nums", l.label === "Book rank" ? "" : l.points > 0 ? "text-up" : l.points < 0 ? "text-down" : "text-muted")}>
              {l.label === "Book rank" ? l.points : `${l.points > 0 ? "+" : ""}${l.points}`}
            </span>
            <span className="text-micro text-muted max-sm:col-span-2">{l.basis}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-micro text-subtle">Scores are clamped to 8–99, so the lines can sum past the score.</p>
      {sameSide.length ? (
        <p className="mt-1 text-micro text-muted">
          Same book, same side: {sameSide.slice(0, 8).map((t) => t.ticker).join(", ")}
          {sameSide.length > 8 ? ` and ${sameSide.length - 8} more` : ""}. They share this book&apos;s driver, so holding
          several is one bet, not several.
        </p>
      ) : null}
    </div>
  );
}
