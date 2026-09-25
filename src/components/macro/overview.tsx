import { Link } from "@tanstack/react-router";
import { MacroQuadPanel } from "@/components/macro-quad-panel";
import { useMacroRegime } from "@/components/macro-strip";
import { Panel } from "@/components/ui";
import { CURRENT_QUAD, QUADS, confidenceOf, occupancyFor, specCalls } from "@/lib/ace/macro-quads";
import { monthLabel, pct } from "@/lib/ace/macro-format";
import { regimeFlips } from "@/lib/live/macro-regime";
import { cn } from "@/lib/utils";

type Read = NonNullable<ReturnType<typeof useMacroRegime>>;

const HOLES = [
  "GDP nowcast",
  "CPI nowcast",
  "Expansion / slowdown / contraction split",
  "Inflation persistence",
  "Term premium",
  "NFCI",
  "Global cycle",
  "SPF and market benchmarks",
  "Release before/after",
] as const;

function month(date?: string) {
  return monthLabel(date);
}

function Card({
  to,
  kicker,
  value,
  unit,
  lines,
}: {
  to: "/macro/growth" | "/macro/inflation" | "/macro/cycle" | "/macro/policy" | "/macro/rates" | "/macro/conditions" | "/macro/global";
  kicker: string;
  value: string;
  unit?: string;
  lines: string[];
}) {
  return (
    <Link
      to={to}
      className="flex min-w-0 flex-col rounded-md bg-card p-2 shadow-[var(--shadow-border)] hover:bg-card-2"
    >
      <div className="text-micro uppercase tracking-wider text-subtle">{kicker}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-lg tabular-nums leading-none text-foreground">{value}</span>
        {unit ? <span className="text-micro text-subtle">{unit}</span> : null}
      </div>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {lines.map((line) => (
          <li key={line} className="text-micro text-muted">
            {line}
          </li>
        ))}
      </ul>
    </Link>
  );
}

export function MacroOverview({ read }: { read: Read | null }) {
  const live = read?.status === "ok" ? read : null;
  const growthFlip = live ? regimeFlips(live.legs ?? []).find((flip) => flip.side === "growth") : undefined;
  const inflationFlip = live ? regimeFlips(live.legs ?? []).find((flip) => flip.side === "inflation") : undefined;
  const decisive = growthFlip?.legs[0];
  const conf = confidenceOf(CURRENT_QUAD);
  const occ = occupancyFor(12);
  const rule = live?.policyRule;
  const vol = live?.vol;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-micro text-subtle">
        Scan the live book. The ALFRED quad underneath is a different model. Empty slots are not connected. Nothing here is an order.
      </p>

      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 xl:grid-cols-7">
        <Card
          to="/macro/growth"
          kicker="Growth breadth"
          value={live?.growth ? `${live.growth.up}/${live.growth.n}` : "—"}
          unit="accelerating"
          lines={[
            live?.growth ? `Basket is ${live.growth.direction}.` : "Reading the basket…",
            decisive ? `Decisive leg: ${decisive.label}, ${decisive.distance.toFixed(1)} pts.` : "No close flip.",
            "GDP nowcast not connected.",
          ]}
        />
        <Card
          to="/macro/inflation"
          kicker="Inflation breadth"
          value={live?.inflation ? `${live.inflation.yoy.toFixed(1)}%` : "—"}
          unit="basket yoy"
          lines={[
            live?.inflation ? `${live.inflation.direction}. ${live.inflation.up}/${live.inflation.n} accelerating.` : "Reading…",
            live?.conflict
              ? `Wages ${live.conflict.wageYoy.toFixed(1)}% vs CPI ${live.conflict.priceYoy.toFixed(1)}%.`
              : "Wage gap not in.",
            "Persistence not connected.",
          ]}
        />
        <Card
          to="/macro/cycle"
          kicker="Recession probability"
          value={live?.recessionProbability ? `${live.recessionProbability.value.toFixed(1)}%` : "—"}
          unit="Chauvet–Piger"
          lines={[
            live?.sahm ? (live.sahm.tripped ? "Sahm tripped." : `Sahm ${live.sahm.gap.toFixed(2)} pp under.`) : "Sahm not in.",
            live?.cfnai ? `CFNAI ${live.cfnai.value.toFixed(2)}.` : "CFNAI not in.",
            "Three-state split not fit.",
          ]}
        />
        <Card
          to="/macro/policy"
          kicker="Policy"
          value={rule ? rule.funds.toFixed(2) : "—"}
          unit="fed funds"
          lines={
            rule
              ? [
                  `Rule ${rule.rule.toFixed(2)}.`,
                  `${Math.abs(rule.stance * 100).toFixed(0)} bp ${rule.stance < 0 ? "under" : "over"} the rule.`,
                  "Comparison, not an optimal rate.",
                ]
              : ["Rule not in."]
          }
        />
        <Card
          to="/macro/rates"
          kicker="Curve"
          value={live?.curve ? `${live.curve.value.toFixed(2)}` : "—"}
          unit="10y–3m"
          lines={[
            live?.curve ? (live.curve.inverted ? "Inverted." : "Not inverted.") : "Curve not in.",
            live?.prints?.find((p) => p.id === "T10Y2Y")
              ? `10y–2y ${live.prints.find((p) => p.id === "T10Y2Y")!.value.toFixed(2)}.`
              : "10y–2y not in.",
            "Term premium not connected.",
          ]}
        />
        <Card
          to="/macro/conditions"
          kicker="Conditions"
          value={live?.stress ? live.stress.value.toFixed(2) : "—"}
          unit="STLFSI"
          lines={[
            live?.stress ? (live.stress.aboveAverage ? "Above average stress." : "Below average stress.") : "Stress not in.",
            vol ? `VIX ${vol.vix.toFixed(1)}, ${vol.term}.` : "Vol not in.",
            "NFCI not connected.",
          ]}
        />
        <Card
          to="/macro/global"
          kicker="Global"
          value="—"
          lines={["No foreign nowcast.", "US exceptionalism not measured.", "Not a map."]}
        />
      </div>

      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel
            title="What changed"
            action={<span className="text-micro text-subtle">Last print on the book. Not a before/after.</span>}
          >
            {!live ? (
              <p className="text-caption text-muted">{read?.detail ?? "Reading FRED…"}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-caption">
                  <thead>
                    <tr className="text-micro uppercase tracking-wider text-subtle">
                      <th className="py-1 pr-2 font-medium">Release</th>
                      <th className="py-1 pr-2 font-medium">Print</th>
                      <th className="py-1 pr-2 font-medium">As of</th>
                      <th className="py-1 font-medium">On this book</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(live.prints ?? []).map((print) => (
                      <tr key={print.id} className="border-t border-border/60">
                        <td className="py-1 pr-2">{print.label}</td>
                        <td className="py-1 pr-2 font-mono tabular-nums">
                          {print.value.toFixed(2)}
                          {print.unit ? ` ${print.unit}` : ""}
                        </td>
                        <td className="py-1 pr-2 font-mono text-micro text-subtle">{month(print.date)}</td>
                        <td className="py-1 text-micro text-muted">No nowcast to revise.</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="Drivers" action={<span className="text-micro text-subtle">3-month change in the yoy rate</span>}>
            <DriverList read={live} side="growth" flip={growthFlip?.legs[0]?.label} />
            <DriverList read={live} side="inflation" flip={inflationFlip?.legs[0]?.label} />
          </Panel>
        </div>
      </div>

      <Panel title="Not connected">
        <ul className="flex flex-wrap gap-1">
          {HOLES.map((hole) => (
            <li key={hole} className="rounded-sm bg-card-3 px-1.5 py-0.5 text-micro text-muted">
              {hole}
            </li>
          ))}
        </ul>
      </Panel>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h2 className="text-micro uppercase tracking-wider text-subtle">Validated ALFRED quad</h2>
          <span className="text-micro text-subtle">
            {conf.specAgreeing}/{conf.specTotal} specs on Q{CURRENT_QUAD.quad}. Not the breadth vote above.
            {occ?.dominant != null ? ` Last 12 months mostly Q${occ.dominant} (${pct(occ.dominantShare)}).` : ""}
          </span>
        </div>
        <MacroQuadPanel />
      </div>
    </div>
  );
}

function DriverList({
  read,
  side,
  flip,
}: {
  read: Read | null;
  side: "growth" | "inflation";
  flip?: string;
}) {
  const legs = (read?.legs ?? []).filter((leg) => leg.side === side).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return (
    <div className={cn(side === "inflation" && "mt-2")}>
      <div className="text-micro uppercase tracking-wider text-subtle">{side}</div>
      <ul>
        {legs.map((leg) => (
          <li key={leg.id} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-0.5 text-caption last:border-b-0">
            <span>
              {leg.label}
              {leg.label === flip ? <span className="ml-1 text-micro text-warn">decisive</span> : null}
            </span>
            <span className="font-mono text-micro tabular-nums text-muted">
              {leg.delta >= 0 ? "+" : ""}
              {leg.delta.toFixed(2)} pts
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModelsPage() {
  const conf = confidenceOf(CURRENT_QUAD);
  const calls = specCalls();
  return (
    <div className="flex flex-col gap-1.5">
      <Panel title="Specification debate" action={<span className="text-micro text-subtle">ALFRED specs. Not averaged.</span>}>
        <p className="text-caption">
          Modal call is Q{CURRENT_QUAD.quad} · {QUADS[CURRENT_QUAD.quad]?.name}. {conf.specAgreeing} of {conf.specTotal}{" "}
          specifications agree. The grade is {conf.grade}: {conf.basis}. That grade is not a probability.
        </p>
        <ul className="mt-1">
          {calls.map((spec) => (
            <li key={spec.name} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1 text-caption last:border-b-0">
              <span>
                {spec.name}{" "}
                <span className="text-micro text-subtle">
                  {spec.growth.join(", ")} / {spec.inflation.join(", ")}
                </span>
              </span>
              <span className="font-mono text-micro">
                {spec.quadNow == null ? "—" : `Q${spec.quadNow} ${QUADS[spec.quadNow]?.name}`}
                {spec.quadNow != null && spec.quadNow !== CURRENT_QUAD.quad ? " · disagrees" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Not on this book">
        <p className="text-caption text-muted">
          A dynamic-factor nowcast, a BVAR, the SPF, and a structural VAR are not connected. Their absence is not a vote.
        </p>
      </Panel>
    </div>
  );
}
