import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/ui";
import { getAnalogs } from "@/lib/analogs/analogs";

const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

/**
 * What has followed market states like today's.
 *
 * Deliberately NOT framed as analogs of the event. The state is momentum and
 * volatility across five channels; it knows nothing about actors, event type or
 * severity. Calling these "similar events" would claim a retrieval the data
 * cannot support, so the panel says market state and means it.
 *
 * The distribution is the output. The nearest analog is shown because a reader
 * wants to see one, but never as the answer — on the current state the nearest
 * fell ~5% while the median rose ~2%, which is exactly why a single analog is
 * not a forecast.
 */
export function AnalogPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["analogs"],
    queryFn: () => getAnalogs(),
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Panel title="Historical analogs">
        <p className="py-3 text-center text-caption text-muted">Retrieving…</p>
      </Panel>
    );
  }
  if (!data?.available || !data.distribution) {
    return (
      <Panel title="Historical analogs">
        <p className="py-3 text-center text-caption text-muted">
          {data?.reason ?? "No analog pool available."} Nothing is shown rather than a
          number the retrieval could not support.
        </p>
      </Panel>
    );
  }

  const d = data.distribution;
  const agreementLabel =
    data.agreement! >= 0.6 ? "analogs mostly agree" : data.agreement! >= 0.3 ? "analogs are split" : "analogs disagree";

  return (
    <Panel
      title="Historical analogs"
      action={
        <span
          className="font-mono text-micro text-subtle"
          title={`${data.method}. Pool built ${new Date(data.poolGeneratedAt).toISOString().slice(0, 10)}.`}
        >
          {d.n} nearest · state as of {data.asOf}
        </span>
      }
    >
      <p className="text-micro text-subtle">
        Nearest {data.windowDays}-day momentum/volatility states across{" "}
        {data.channels.join(", ")}, drawn from {data.poolRows.toLocaleString()} days. Market
        state — not event type, actors or severity.
      </p>

      <div className="mt-1.5 grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5">
        <span className="text-micro text-subtle">
          {data.targetChannel} next {data.forwardDays}d
        </span>
        <span className="font-mono text-caption tabular-nums">
          <span className="text-muted">{pct(d.p10)}</span>
          <span className="mx-1 text-subtle">·</span>
          <span className="text-foreground">{pct(d.median)}</span>
          <span className="mx-1 text-subtle">·</span>
          <span className="text-muted">{pct(d.p90)}</span>
          <span className="ml-1.5 text-micro text-subtle">p10 · median · p90</span>
        </span>
        <span className="text-micro text-subtle">Direction</span>
        <span className="font-mono text-caption tabular-nums text-muted">
          {Math.round(d.sharePositive * 100)}% positive
          <span className="ml-1.5 text-micro text-subtle">{agreementLabel}</span>
        </span>
      </div>

      <ul className="mt-1.5 flex flex-col gap-0.5">
        {data.analogs.slice(0, 5).map((a) => (
          <li
            key={a.date}
            className="grid grid-cols-[auto_auto_1fr] items-baseline gap-2 text-micro"
            title={a.drivers
              .map(
                (dr) =>
                  `${dr.feature} ${dr.analogValue > dr.queryValue ? "higher" : "lower"} then (${dr.analogValue.toFixed(4)} vs ${dr.queryValue.toFixed(4)}) — ${Math.round(dr.share * 100)}% of the gap`,
              )
              .join("\n")}
          >
            <span className="font-mono tabular-nums text-muted">{a.date}</span>
            <span className="font-mono tabular-nums text-subtle">d {a.distance.toFixed(2)}</span>
            <span className="truncate text-subtle">
              <span className={a.forwardReturn >= 0 ? "text-muted" : "text-muted"}>
                {pct(a.forwardReturn)}
              </span>
              <span className="ml-1.5">
                mostly {a.drivers[0]?.feature} ({Math.round((a.drivers[0]?.share ?? 0) * 100)}%)
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-1.5 text-micro text-subtle">
        Retrieval, not causality. Candidates are restricted to dates whose own{" "}
        {data.forwardDays}-day window had already closed, and the distance metric is fitted on
        those candidates only — the present cannot shape the metric that finds its own analogs.
        The spread is the finding; the nearest single analog is not a forecast.
      </p>
    </Panel>
  );
}
