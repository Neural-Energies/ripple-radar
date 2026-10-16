import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge, Empty, Panel, Skeleton } from "@/components/ui";
import { getOvernight } from "@/lib/briefing/api";
import type { Matter } from "@/lib/briefing/assemble";
import type { OvernightMove, SessionMove } from "@/lib/briefing/overnight";
import { safeHttpUrl } from "@/lib/safe-url";
import { cn, formatPct, formatPrice } from "@/lib/utils";

const TOPIC_LABEL: Record<string, string> = {
  macro: "Macro",
  rates: "Rates / Fed",
  energy: "Energy",
  equities: "Equities / Tech",
  geopolitics: "Geopolitics",
  crypto: "Crypto",
};

function etTime(ms: number | null): string {
  if (ms == null) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date(ms)) + " ET";
}

function tone(n: number | null): string {
  if (n == null || n === 0) return "text-muted";
  return n > 0 ? "text-up" : "text-down";
}

function price(n: number | null): string {
  return n == null ? "—" : formatPrice(n);
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 py-1" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className={i % 2 ? "w-2/3" : "w-full"} />
      ))}
    </div>
  );
}

function SessionTable({ title, rows }: { title: string; rows: SessionMove[] }) {
  return (
    <div>
      <h3 className="text-micro font-semibold uppercase tracking-wider text-subtle">{title}</h3>
      <table className="mt-1 w-full text-caption">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/50">
              <td className="py-1">{r.name}</td>
              <td className="py-1 text-right font-mono tabular-nums">{price(r.last)}</td>
              <td className={cn("py-1 text-right font-mono tabular-nums", tone(r.changePct))}>{r.changePct == null ? "—" : formatPct(r.changePct)}</td>
              <td className="py-1 text-right text-micro text-subtle">{etTime(r.asOf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovesTable({ rows }: { rows: OvernightMove[] }) {
  return (
    <table className="w-full text-caption">
      <thead>
        <tr className="text-micro uppercase tracking-wider text-subtle">
          <th className="py-1 text-left font-medium">Market</th>
          <th className="py-1 text-right font-medium">4pm close</th>
          <th className="py-1 text-right font-medium">Last</th>
          <th className="py-1 text-right font-medium">Chg</th>
          <th className="py-1 text-right font-medium">O/N high</th>
          <th className="py-1 text-right font-medium">O/N low</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border/50">
            <td className="py-1 font-mono" title={r.name}>{r.id}</td>
            <td className="py-1 text-right font-mono tabular-nums text-muted">{price(r.refClose)}</td>
            <td className="py-1 text-right font-mono tabular-nums">{price(r.last)}</td>
            <td className={cn("py-1 text-right font-mono tabular-nums", tone(r.changePct))}>{r.changePct == null ? "—" : formatPct(r.changePct)}</td>
            <td className="py-1 text-right font-mono tabular-nums text-muted">{price(r.high)}</td>
            <td className="py-1 text-right font-mono tabular-nums text-muted">{price(r.low)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Prior 4pm ET cash close to now. Existing panels, lists and type only. */
export function OvernightSection({ matters }: { matters: Matter[] }) {
  const query = useQuery({ queryKey: ["overnight"], queryFn: () => getOvernight(), staleTime: 60_000, refetchInterval: 120_000 });
  const data = query.data;
  const byTitle = new Map(matters.map((m) => [m.title.trim().toLowerCase(), m]));

  if (!data) {
    return (
      <Panel className="h-auto" title="Overnight">
        {query.isError ? <p className="text-caption text-down">Overnight request failed.</p> : <LoadingRows />}
      </Panel>
    );
  }

  const windowLabel = `Since ${etTime(data.windowStart)} cash close · as of ${etTime(data.asOf)}`;
  return (
    <div className="flex flex-col gap-4">
      <Panel className="h-auto" title="Overnight" action={<span className="text-micro text-subtle">{windowLabel}</span>}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col gap-3">
            <SessionTable title="Asia" rows={data.asia} />
            <SessionTable title="Europe" rows={data.europe} />
          </div>
          <div>
            <h3 className="text-micro font-semibold uppercase tracking-wider text-subtle">Futures and dollar since the 4pm close</h3>
            <div className="mt-1">
              <MovesTable rows={data.moves} />
            </div>
          </div>
        </div>
        <p className="mt-2 text-micro text-subtle">
          {data.source}.{data.failed.length ? ` No data from: ${data.failed.join(", ")}.` : ""} Session change is against the prior session close.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel className="h-auto" title="Top overnight drivers" action={<span className="text-micro text-subtle">Stored tape, ranked by sentiment × topic × source</span>}>
          {data.drivers.length === 0 ? (
            <Empty>No scored headline in the window yet.</Empty>
          ) : (
            <ol className="flex flex-col">
              {data.drivers.map((d, i) => {
                const matter = byTitle.get(d.title.trim().toLowerCase());
                const href = safeHttpUrl(d.url);
                return (
                  <li key={d.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-2 border-t border-border/50 py-2.5 first:border-t-0">
                    <span className="text-lg font-semibold tabular-nums leading-tight text-subtle">{i + 1}</span>
                    <div className="min-w-0">
                      {matter ? (
                        <Link to="/" search={{ event: matter.id }} className="text-body font-semibold hover:text-primary">{d.title}</Link>
                      ) : href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="text-body font-semibold hover:text-primary">{d.title}</a>
                      ) : (
                        <span className="text-body font-semibold">{d.title}</span>
                      )}
                      <div className="text-micro text-subtle">{d.source} · {etTime(d.publishedMs)} · {d.topics.map((t) => TOPIC_LABEL[t] ?? t).join(", ")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {matter && matter.chain.length
                          ? matter.chain.map((node, n) => (
                              <span key={`${node.label}-${n}`} className="flex items-center gap-1">
                                {n > 0 ? <span aria-hidden className="text-micro text-subtle">→</span> : null}
                                <span className="inline-flex items-center gap-1 rounded-md bg-card-3 px-1.5 py-0.5 text-tiny font-medium text-foreground">
                                  {node.label}
                                  <span className={node.direction === "up" ? "text-up" : node.direction === "down" ? "text-down" : "text-subtle"}>
                                    {node.direction === "up" ? "↑" : node.direction === "down" ? "↓" : "◆"}
                                  </span>
                                </span>
                              </span>
                            ))
                          : (
                            <span className="text-micro text-subtle">No engine chain for this headline. Topic links: {d.markets.join(", ")}</span>
                          )}
                      </div>
                    </div>
                    <span className={cn("font-mono text-caption tabular-nums", tone(d.sentiment))}>{d.sentiment > 0 ? "+" : ""}{Math.abs(d.sentiment) < 10 ? d.sentiment.toFixed(2) : Math.round(d.sentiment)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel className="h-auto" title="Impacted markets" action={<span className="text-micro text-subtle">Largest moves, linked by topic rule</span>}>
          {data.impacted.length === 0 ? (
            <Empty>No market has a quote since the close.</Empty>
          ) : (
            <ul className="flex flex-col">
              {data.impacted.map((m) => (
                <li key={m.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-2 border-t border-border/50 py-1.5 first:border-t-0">
                  <span className="font-mono text-caption">{m.id}</span>
                  <span className="min-w-0 text-caption">
                    {m.driver ? (
                      <>
                        {m.driver.title} <span className="text-micro text-subtle">· {m.driver.source} · {TOPIC_LABEL[m.driver.topic] ?? m.driver.topic}</span>
                      </>
                    ) : (
                      <span className="text-subtle">No linked headline in the window.</span>
                    )}
                  </span>
                  <span className={cn("font-mono text-caption tabular-nums", tone(m.changePct))}>{formatPct(m.changePct)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="h-auto" title="Watch today" action={<span className="text-micro text-subtle">New York time</span>}>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <h3 className="text-micro font-semibold uppercase tracking-wider text-subtle">Calendar</h3>
            {data.watch.length === 0 ? (
              <p className="mt-1 text-caption text-muted">{data.calendarDetail}</p>
            ) : (
              <table className="mt-1 w-full text-caption">
                <thead>
                  <tr className="text-micro uppercase tracking-wider text-subtle">
                    <th className="py-1 text-left font-medium">Time</th>
                    <th className="py-1 text-left font-medium">Event</th>
                    <th className="py-1 text-right font-medium">Consensus</th>
                    <th className="py-1 text-right font-medium">Prior</th>
                  </tr>
                </thead>
                <tbody>
                  {data.watch.map((e) => (
                    <tr key={`${e.source}-${e.country}-${e.title}-${e.when}`} className="border-t border-border/50">
                      <td className="py-1 font-mono tabular-nums text-muted">{e.when}</td>
                      <td className="py-1">
                        {e.country ? <span className="text-subtle">{e.country} · </span> : null}
                        {e.title} {e.impact.toLowerCase() === "high" ? <Badge tone="primary">High</Badge> : null}
                      </td>
                      <td className="py-1 text-right font-mono tabular-nums">{e.forecast ?? "—"}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-muted">{e.previous ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3 className="text-micro font-semibold uppercase tracking-wider text-subtle">Key levels</h3>
            <table className="mt-1 w-full text-caption">
              <thead>
                <tr className="text-micro uppercase tracking-wider text-subtle">
                  <th className="py-1 text-left font-medium">Market</th>
                  <th className="py-1 text-right font-medium">O/N H / L</th>
                  <th className="py-1 text-right font-medium">Prior H / L</th>
                  <th className="py-1 text-right font-medium">Prior close</th>
                </tr>
              </thead>
              <tbody>
                {data.moves.map((m) => (
                  <tr key={m.id} className="border-t border-border/50">
                    <td className="py-1 font-mono">{m.id}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{price(m.high)} / {price(m.low)}</td>
                    <td className="py-1 text-right font-mono tabular-nums text-muted">{m.prior ? `${price(m.prior.high)} / ${price(m.prior.low)}` : "—"}</td>
                    <td className="py-1 text-right font-mono tabular-nums text-muted">{price(m.prior?.close ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <h3 className="mt-3 text-micro font-semibold uppercase tracking-wider text-subtle">Risk flags</h3>
        {data.flags.length === 0 ? (
          <p className="mt-1 text-caption text-muted">No rule tripped: no prior-day break, no move of 1% or more, no high-impact release.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {data.flags.map((f) => (
              <Badge key={f.text} tone={f.tone}>{f.text}</Badge>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
