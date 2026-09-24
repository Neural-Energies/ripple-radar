import { Panel } from "@/components/ui";
import {
  CASCADE_RUN,
  allCascades,
  cascadesForEntities,
  type CascadeRate,
} from "@/lib/ace/cascade-rates";

/**
 * Measured conflict self-excitation — the one place ACE's ripple thesis is
 * actually supported by data.
 *
 * Every attempt to measure propagation on PRICE series found nothing lagged
 * surviving out of sample. On conflict events it is unambiguous: escalation
 * clusters, and the branching ratio says how much.
 *
 * The branching ratio is rendered to ONE decimal and described in words,
 * because the intensity's exact shape is unverified at daily resolution and a
 * three-digit figure would claim precision the residuals do not support.
 */
function Row({ c, lead }: { c: CascadeRate; lead: boolean }) {
  const extra = c.cascadeMultiplier ? Math.round((c.cascadeMultiplier - 1) * 100) : null;
  return (
    <li
      className="grid grid-cols-[minmax(0,7rem)_auto_1fr] items-baseline gap-2 text-caption"
      title={
        `${c.spikeDays} spike days, ${c.firstEvent} to ${c.lastEvent}. ` +
        `Likelihood-ratio p ${c.lrPValue.toExponential(1)} against a Poisson process; ` +
        `out-of-sample log-likelihood gain ${c.oosGainOverPoisson.toFixed(1)}.`
      }
    >
      <span className={lead ? "truncate text-foreground" : "truncate text-muted"}>{c.name}</span>
      <span className="font-mono tabular-nums text-muted">
        ~{c.branchingRatio.toFixed(1)}
      </span>
      <span className="truncate text-micro text-subtle">
        {extra !== null ? `~${extra} more per 100` : ""}
        {c.excitationHalfLifeDays
          ? ` · half-life ${c.excitationHalfLifeDays.toFixed(1)}d`
          : ""}
      </span>
    </li>
  );
}

export function CascadePanel({ entities }: { entities: string[] }) {
  const matched = cascadesForEntities(entities);
  const shown = matched.length ? matched : allCascades().slice(0, 5);
  const isMatched = matched.length > 0;

  return (
    <Panel
      title="Conflict cascade"
      action={
        <span className="font-mono text-micro text-subtle" title={CASCADE_RUN.specification.note}>
          {isMatched ? "this event's actors" : "measured elsewhere"} ·{" "}
          {CASCADE_RUN.nPassing}/{CASCADE_RUN.nFitted} countries
        </span>
      }
    >
      <p className="text-micro text-subtle">
        {isMatched
          ? "Measured self-excitation where this event's actors operate: after one material escalation, how many more follow."
          : "No measured cascade for this event's actors. Showing what has been measured elsewhere, as context — not as a claim about this event."}
      </p>

      <ul className="mt-1.5 flex flex-col gap-0.5">
        {shown.map((c, i) => (
          <Row key={c.code} c={c} lead={isMatched && i === 0} />
        ))}
      </ul>

      <p className="mt-1.5 text-micro text-subtle">
        Hawkes self-excitation on GDELT material-conflict events, fitted before a chronological
        holdout and scored on it. That escalation <em>clusters</em> is established — every country
        here beats a Poisson process out of sample. How fast the excitation decays is{" "}
        <em>not</em>: these events sit on a daily grid, which a continuous test rejects on its own,
        so the ratio is an order-of-magnitude statement rather than an estimate. Prices show no
        such propagation; the event stream does.
      </p>
    </Panel>
  );
}
