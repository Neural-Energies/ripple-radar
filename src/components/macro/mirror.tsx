import { useState, type ReactNode } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMacroRegime } from "@/components/macro-strip";
import { CURRENT_QUAD, VOL_BY_CHANNEL, VOL_FORECAST_VALIDATED } from "@/lib/ace/macro-quads";
import { useMacroState, type FactorRow, type MacroState, type MacroStateUnavailable, type ReleaseRow } from "@/lib/ace/macro-state";
import type { getMacroRegime } from "@/lib/live/desk";
import { cn } from "@/lib/utils";

/**
 * The macro workstation, on the reference layout, bound to its producers:
 *
 *   read   live FRED book (`getMacroRegime`): baskets, policy rule, curve,
 *          conditions, monitors, 36-month paths
 *   state  factor-engine run (`getMacroState`): Factor State API, the DFM news
 *          decomposition behind "What changed", regime verdicts, provenance
 *
 * Nothing here is a constant. A panel whose producer is absent or failed
 * says so instead of showing a number (PR #6 B01).
 */

export type MacroReadPayload = Awaited<ReturnType<typeof getMacroRegime>>;
type Read = MacroReadPayload | null;
type State = MacroState | MacroStateUnavailable | null;

const tip = { background: "var(--color-card-2)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 11, color: "var(--color-foreground)" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(date?: string | null) {
  if (!date) return "—";
  const [y, m] = date.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function dayLabel(date?: string | null) {
  if (!date) return "—";
  const [, m, d] = date.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

function timeLabel(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

const fixed = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(d));
const signed = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}`;
const sigma = (n: number | null | undefined) => (n == null ? "—" : `${signed(n)}σ`);
const arrow = (n: number | null | undefined) => (n == null ? "" : n > 0 ? "↑" : n < 0 ? "↓" : "→");

/** News-decomposition block -> the PCA domain that describes the same part of the economy. */
const BLOCK_DOMAIN: Record<string, string> = {
  financial: "financial_conditions",
  growth: "output_activity",
  liquidity: "liquidity_money",
};

function factorOf(state: State, domain: string): FactorRow | null {
  if (!state?.available) return null;
  return state.factors.find((f) => f.domain === domain) ?? null;
}

function printOf(read: Read, id: string) {
  return read?.status === "ok" ? read.prints?.find((p) => p.id === id) ?? null : null;
}

function Spark({ data, className }: { data: (number | null)[]; className?: string }) {
  const xs = data.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min || 1;
  const w = 120;
  const h = 36;
  const d = xs
    .map((v, i) => {
      const x = (i / (xs.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-full", className)} aria-hidden>
      <path d={d} fill="none" stroke="#5eb0e8" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Card({ kicker, source, children }: { kicker: string; source?: string; children: ReactNode }) {
  return (
    <section className="flex min-w-[9.5rem] flex-col rounded-md bg-card p-2 shadow-[var(--shadow-border)]">
      <div className="text-micro font-medium uppercase tracking-wider text-subtle">{kicker}</div>
      {children}
      {source ? <div className="mt-1 text-[9px] leading-tight text-subtle">{source}</div> : null}
    </section>
  );
}

function Stat({ value, move, good, hint }: { value: string; move?: string; good?: boolean; hint?: string }) {
  return (
    <div className="mt-1">
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-xl font-semibold tabular-nums leading-none">{value}</span>
        {move ? <span className={cn("shrink-0 text-micro font-medium", good ? "text-up" : "text-down")}>{move}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 text-micro leading-tight text-subtle">{hint}</div> : null}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <>
      <span className="text-subtle">{k}</span>
      <span className={cn("text-right", tone === "up" && "text-up", tone === "down" && "text-down")}>{v}</span>
    </>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-micro leading-tight text-subtle">{children}</p>;
}

function Contrib({ label, value, unit, scale }: { label: string; value: number; unit: string; scale: number }) {
  const pos = value >= 0;
  const pct = Math.max(6, Math.min(100, (Math.abs(value) / (scale || 1)) * 100));
  return (
    <div className="grid grid-cols-[minmax(0,7.2rem)_minmax(0,1fr)_4.6rem] items-center gap-1 py-px text-[11px]">
      <span className="truncate text-muted" title={label}>{label}</span>
      <span className="h-1.5 rounded-[1px] bg-card-3">
        <span className={cn("block h-full rounded-[1px]", pos ? "bg-up" : "bg-down")} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn("whitespace-nowrap text-right font-mono text-[10px] tabular-nums", pos ? "text-up" : "text-down")}>
        {signed(value, unit === "σ" ? 3 : 2)}
        {unit === "σ" ? "" : ` ${unit}`}
      </span>
    </div>
  );
}

function Contribs({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const scale = Math.max(...rows.map((r) => Math.abs(r.value)), 0);
  return (
    <>
      {rows.map((r) => (
        <Contrib key={r.label} label={r.label} value={r.value} unit={unit} scale={scale} />
      ))}
    </>
  );
}

function FactorLine({ f }: { f: FactorRow | null }) {
  if (!f) return <Row k="Factor" v="—" />;
  return (
    <Row
      k={`${f.domain.replace("_", " ")} factor`}
      v={`${fixed(f.percentile, 0)}th pct ${arrow(f.change1m)}`}
      tone={(f.change1m ?? 0) >= 0 ? "up" : "down"}
    />
  );
}

// --------------------------------------------------------------- overview --

export function MacroOverviewView({ read, state }: { read: Read; state: State }) {
  const ok = read?.status === "ok";
  const st = state?.available ? state : null;
  const [selected, setSelected] = useState<string | null>(null);
  const releases = st?.whatChanged.releases ?? [];
  const key = (r: ReleaseRow) => `${r.seriesId}|${r.block}`;
  const current = releases.find((r) => key(r) === selected) ?? releases[0] ?? null;
  const history = ok ? read.history ?? [] : [];
  const last12 = history.slice(-12);

  const funds = printOf(read, "FEDFUNDS");
  const ten = printOf(read, "DGS10");
  const two = printOf(read, "DGS2");
  const curve2 = printOf(read, "T10Y2Y");
  const vix = printOf(read, "VIXCLS");
  const baa = printOf(read, "BAA10Y");
  const output = factorOf(state, "output_activity");
  const inflationF = factorOf(state, "inflation");
  const conditionsF = factorOf(state, "financial_conditions");
  const external = factorOf(state, "trade_external");
  const commodities = factorOf(state, "commodities");
  const fredDown = read != null && !ok ? (read.detail ?? "FRED did not answer.") : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 items-start gap-2 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0">
          <header className="mb-1.5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold leading-none tracking-tight">Macro Overview</h1>
              <p className="mt-0.5 text-[11px] text-muted">
                US economic state from live FRED reads and the point-in-time factor engine, and what the latest releases moved.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-subtle" data-testid="macro-status">
              <span className={cn(read == null ? "text-subtle" : ok ? "text-up" : "text-down")}>
                ● FRED {read == null ? "loading" : ok ? `read ${timeLabel(read.fetchedAt)}` : "unavailable"}
              </span>
              <span className={cn(state == null ? "text-subtle" : st ? "text-up" : "text-down")}>
                ● Factor engine {state == null ? "loading" : st ? `as of ${st.factorModel.asOf}` : "unavailable"}
              </span>
            </div>
          </header>
          {fredDown ? <Missing>FRED: {fredDown}</Missing> : null}
          {state && !state.available ? <Missing>Factor engine: {state.reason}</Missing> : null}

          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 xl:grid-cols-7">
            <Card kicker="Growth" source={ok ? `FRED basket · ${monthLabel(read.date)}` : undefined}>
              <div className="text-micro text-subtle">Basket YoY (median of {ok ? read.growth?.n ?? "—" : "—"} legs)</div>
              {ok && read.growth ? (
                <>
                  <Stat
                    value={`${fixed(read.growth.yoy, 1)}%`}
                    move={`${arrow(read.growth.delta)} ${fixed(Math.abs(read.growth.delta), 2)} pp 3m`}
                    good={read.growth.delta >= 0}
                    hint={read.growth.direction}
                  />
                  <Spark data={last12.map((h) => h.growthYoy)} />
                  <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight">
                    <Row k="Accelerating" v={`${read.growth.up}/${read.growth.n}`} />
                    <FactorLine f={output} />
                  </div>
                </>
              ) : (
                <Missing>{read == null ? "Reading FRED…" : "No basket reading."}</Missing>
              )}
            </Card>

            <Card kicker="Inflation" source={ok ? `FRED basket · ${monthLabel(read.date)}` : undefined}>
              <div className="text-micro text-subtle">Basket YoY (median of {ok ? read.inflation?.n ?? "—" : "—"} legs)</div>
              {ok && read.inflation ? (
                <>
                  <Stat
                    value={`${fixed(read.inflation.yoy, 1)}%`}
                    move={`${arrow(read.inflation.delta)} ${fixed(Math.abs(read.inflation.delta), 2)} pp 3m`}
                    good={read.inflation.delta <= 0}
                    hint={read.inflation.direction}
                  />
                  <Spark data={last12.map((h) => h.inflationYoy)} />
                  <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight">
                    <Row k="Core CPI YoY" v={`${fixed(last12.at(-1)?.core, 1)}%`} />
                    <Row k="Accelerating" v={`${read.inflation.up}/${read.inflation.n}`} />
                    <FactorLine f={inflationF} />
                  </div>
                </>
              ) : (
                <Missing>{read == null ? "Reading FRED…" : "No basket reading."}</Missing>
              )}
            </Card>

            <Card
              kicker="Cycle"
              source={ok && read.recessionProbability ? `Chauvet–Piger (FRED) · ${monthLabel(read.recessionProbability.date)}` : undefined}
            >
              <div className="text-micro text-subtle">Recession probability</div>
              {ok && read.recessionProbability ? (
                <>
                  <Stat value={`${fixed(read.recessionProbability.value, 1)}%`} hint="smoothed, published model" />
                  <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight">
                    <Row
                      k="Sahm"
                      v={read.sahm ? `${fixed(read.sahm.value)} (${read.sahm.tripped ? "tripped" : `${fixed(read.sahm.gap)} under`})` : "—"}
                      tone={read.sahm?.tripped ? "down" : undefined}
                    />
                    <Row k="CFNAI-MA3" v={fixed(read.cfnai?.value)} tone={read.cfnai?.tripped ? "down" : undefined} />
                  </div>
                </>
              ) : (
                <Missing>{read == null ? "Reading FRED…" : "No recession-probability print."}</Missing>
              )}
            </Card>

            <Card kicker="Policy" source={ok && read.policyRule ? `Taylor 1993 · HLW r* ${monthLabel(read.policyRule.rStarDate)}` : undefined}>
              <div className="text-micro text-subtle">Fed funds (effective)</div>
              {funds ? (
                <>
                  <Stat value={`${fixed(funds.value)}%`} hint={monthLabel(funds.date)} />
                  {ok && read.policyRule ? (
                    <>
                      <div className="mt-1 text-micro text-subtle">Rule rate</div>
                      <div className="mt-0.5 flex items-center justify-between gap-1">
                        <span className="font-mono text-base font-semibold">{fixed(read.policyRule.rule)}%</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-sm px-1 text-[9px]",
                            read.policyRule.stance < 0 ? "bg-up/15 text-up" : "bg-down/15 text-down",
                          )}
                        >
                          {Math.abs(read.policyRule.stance * 100).toFixed(0)} bp {read.policyRule.stance < 0 ? "easier" : "tighter"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <Missing>Rule inputs not all published.</Missing>
                  )}
                  <Spark data={last12.map((h) => h.funds)} />
                </>
              ) : (
                <Missing>{read == null ? "Reading FRED…" : "No funds print."}</Missing>
              )}
            </Card>

            <Card kicker="Rates" source={ten ? `FRED · ${dayLabel(ten.date)}` : undefined}>
              <div className="text-micro text-subtle">10Y Treasury</div>
              {ten ? (
                <>
                  <Stat
                    value={`${fixed(ten.value)}%`}
                    move={
                      ten.monthAgo != null
                        ? `${arrow(ten.value - ten.monthAgo)} ${Math.abs((ten.value - ten.monthAgo) * 100).toFixed(0)} bp 1m`
                        : undefined
                    }
                    good={ten.monthAgo != null && ten.value <= ten.monthAgo}
                  />
                  <Spark data={last12.map((h) => h.dgs10)} />
                  <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight">
                    <Row k="2Y" v={two ? `${fixed(two.value)}%` : "—"} />
                    <Row k="10Y–2Y" v={curve2 ? `${fixed(curve2.value)} pp` : "—"} />
                    <Row k="10Y–3M" v={ok && read.curve ? `${fixed(read.curve.value)} pp` : "—"} tone={ok && read.curve?.inverted ? "down" : undefined} />
                  </div>
                </>
              ) : (
                <Missing>{read == null ? "Reading FRED…" : "No 10Y print."}</Missing>
              )}
            </Card>

            <Card kicker="Financial Conditions" source={ok && read.nfci ? `Chicago Fed NFCI · ${dayLabel(read.nfci.date)}` : undefined}>
              {ok && read.nfci ? (
                <>
                  <div className="mt-1 text-caption font-semibold leading-tight">
                    {read.nfci.value > 0 ? "Tighter than average" : "Looser than average"}
                  </div>
                  <Stat
                    value={fixed(read.nfci.value, 3)}
                    move={
                      read.nfci.monthAgo != null
                        ? `${arrow(read.nfci.value - read.nfci.monthAgo)} ${fixed(Math.abs(read.nfci.value - read.nfci.monthAgo), 3)} 1m`
                        : undefined
                    }
                    good={read.nfci.monthAgo != null && read.nfci.value <= read.nfci.monthAgo}
                    hint="NFCI, 0 = average"
                  />
                  <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight">
                    <Row k="STLFSI" v={fixed(read.stress?.value)} />
                    <Row k="Baa spread" v={baa ? `${fixed(baa.value)} pp` : "—"} />
                    <Row k="VIX" v={fixed(vix?.value)} />
                    <FactorLine f={conditionsF} />
                  </div>
                </>
              ) : (
                <Missing>{read == null ? "Reading FRED…" : "No NFCI print."}</Missing>
              )}
            </Card>

            <Card kicker="External" source={external ? `Factor engine · ${monthLabel(external.asOf)}` : undefined}>
              <div className="text-micro text-subtle">Trade & external factor</div>
              {external ? (
                <>
                  <Stat
                    value={`${fixed(external.percentile, 0)}th`}
                    move={`${arrow(external.change1m)} ${fixed(Math.abs(external.change1m ?? 0))} 1m`}
                    good={(external.change1m ?? 0) >= 0}
                    hint="percentile of its own history"
                  />
                  <Spark data={external.path.map((p) => p.level)} />
                  <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight">
                    <FactorLine f={commodities} />
                  </div>
                </>
              ) : (
                <Missing>{state == null ? "Loading the factor engine…" : "No external-sector factor."}</Missing>
              )}
            </Card>
          </div>

          <section className="mt-2 rounded-md bg-card shadow-[var(--shadow-border)]">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2.5 py-2">
              <div>
                <h2 className="text-caption font-semibold">What Changed</h2>
                <p className="text-micro text-subtle">
                  {st
                    ? `Releases between the ${st.whatChanged.previousAsOf} and ${st.whatChanged.updatedAsOf} model runs, ranked by how far they moved a block estimate.`
                    : "Releases and how they moved the factor model."}
                </p>
              </div>
              {st ? <span className="text-micro text-subtle">σ = standardized units of each series</span> : null}
            </header>
            {st && releases.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-left text-caption">
                  <thead>
                    <tr className="text-micro uppercase tracking-wider text-subtle">
                      {["Obs.", "Release", "Observed", "Model expected", "Surprise", "Impact on block", "Block"].map((h) => (
                        <th key={h} className="px-2 py-1 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {releases.map((row) => (
                      <tr
                        key={key(row)}
                        onClick={() => setSelected(key(row))}
                        className={cn(
                          "cursor-pointer border-t border-border/70 hover:bg-card-2",
                          current && key(current) === key(row) && "bg-card-2",
                        )}
                      >
                        <td className="px-2 py-1 font-mono text-micro text-subtle">{monthLabel(row.observationDate)}</td>
                        <td className="px-2 py-1">{row.label}</td>
                        <td className="px-2 py-1 font-mono">{sigma(row.observed)}</td>
                        <td className="px-2 py-1 font-mono text-muted">{sigma(row.expected)}</td>
                        <td className={cn("px-2 py-1 font-mono", (row.surprise ?? 0) >= 0 ? "text-up" : "text-down")}>{sigma(row.surprise)}</td>
                        <td className={cn("px-2 py-1 font-mono", (row.impact ?? 0) >= 0 ? "text-up" : "text-down")}>{signed(row.impact, 4)}</td>
                        <td className="px-2 py-1">
                          <span className="rounded-sm bg-card-3 px-1.5 py-0.5 text-micro text-muted">{row.block}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-2.5 py-3 text-caption text-muted">
                {state == null
                  ? "Loading the news decomposition…"
                  : st
                    ? "No releases landed between the two runs."
                    : `Unavailable: ${(state as MacroStateUnavailable).reason}.`}
              </p>
            )}
          </section>
        </div>
        <ReleaseDrawerView state={state} release={current} />
      </div>
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-4">
        <GrowthDetailView read={read} state={state} />
        <InflationDetailView read={read} state={state} />
        <RatesDetailView read={read} />
        <GlobalDetailView state={state} />
      </div>
    </div>
  );
}

export function MacroMirror() {
  const read = useMacroRegime();
  const state = useMacroState();
  return <MacroOverviewView read={read} state={state} />;
}

// ---------------------------------------------------------- release drawer --

function Changed({ label, from, to, delta, good }: { label: string; from: string; to?: string; delta: string; good?: boolean }) {
  return (
    <div className="rounded-sm bg-card-2 p-1.5">
      <div className="text-micro text-subtle">{label}</div>
      <div className="text-caption">
        {from}
        {to ? <span className="text-muted"> → {to}</span> : null}
      </div>
      <div className={cn("text-micro", good ? "text-up" : "text-down")}>{delta}</div>
    </div>
  );
}

const DRAWER_TABS = ["Impact", "Details", "History", "Related Assets"] as const;

export function ReleaseDrawerView({ state, release }: { state: State; release: ReleaseRow | null }) {
  const [tab, setTab] = useState<(typeof DRAWER_TABS)[number]>("Impact");
  const st = state?.available ? state : null;
  if (!st || !release) {
    return (
      <aside className="flex min-w-0 flex-col gap-1.5">
        <section className="rounded-md bg-card p-2.5 text-caption text-muted shadow-[var(--shadow-border)]">
          {state == null ? "Loading…" : st ? "Select a release." : "The release detail needs the factor-engine run, which is unavailable."}
        </section>
      </aside>
    );
  }
  const block = st.whatChanged.blocks.find((b) => b.block === release.block) ?? null;
  const factor = factorOf(st, BLOCK_DOMAIN[release.block] ?? release.block);
  const meta = st.series[release.seriesId];
  const above = (release.surprise ?? 0) >= 0;
  const quad = String(CURRENT_QUAD.quad ?? "");

  return (
    <aside className="flex min-w-0 flex-col gap-1.5">
      <div className="text-micro text-subtle">Macro → What Changed → {release.label}</div>
      <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
        <div>
          <h2 className="text-body font-semibold">{release.label}</h2>
          <p className="text-micro text-subtle">
            {monthLabel(release.observationDate)} observation · {release.block} block · run {st.whatChanged.updatedAsOf}
          </p>
        </div>
        <div className="mt-2 grid grid-cols-4 overflow-hidden rounded-sm border border-border bg-card-2/40 [&>div]:border-r [&>div]:border-border [&>div]:px-2 [&>div]:py-2 [&>div:last-child]:border-r-0">
          <div>
            <div className="text-micro text-subtle">Observed</div>
            <div className="font-mono text-lg font-semibold">{sigma(release.observed)}</div>
          </div>
          <div>
            <div className="text-micro text-subtle">Model expected</div>
            <div className="font-mono text-lg">{sigma(release.expected)}</div>
          </div>
          <div>
            <div className="text-micro text-subtle">Surprise</div>
            <div className={cn("font-mono text-lg", above ? "text-up" : "text-down")}>{sigma(release.surprise)}</div>
          </div>
          <div className={cn("text-micro", above ? "text-up" : "text-down")}>
            {above ? "↑ Above" : "↓ Below"} the model's forecast
            <div className="text-subtle">weight {signed(release.weight, 4)}</div>
          </div>
        </div>
      </section>
      <div className="flex h-7 items-end gap-5 border-b border-border px-2 text-micro" role="tablist">
        {DRAWER_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("pb-1.5", tab === t ? "border-b border-primary text-primary" : "text-muted hover:text-foreground")}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Impact" ? (
        <>
          <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
            <h3 className="text-caption font-medium">What Changed</h3>
            <p className="text-micro text-subtle">
              How the {release.block} block estimate moved between runs ({block?.proxyLabel ?? "block proxy"}, σ).
            </p>
            {block ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Changed
                  label={`${block.proxyLabel ?? block.block} estimate`}
                  from={signed(block.estimatePrevious, 3)}
                  to={signed(block.estimateUpdated, 3)}
                  delta={`${arrow(block.total)} ${signed(block.total, 4)}`}
                  good={(block.total ?? 0) >= 0}
                />
                <Changed label="From new releases" from={signed(block.news, 4)} delta="news" good={(block.news ?? 0) >= 0} />
                <Changed label="From revisions" from={signed(block.revisions, 4)} delta="revisions" good={(block.revisions ?? 0) >= 0} />
              </div>
            ) : (
              <Missing>No block decomposition for this release.</Missing>
            )}
          </section>
          <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
            <h3 className="text-caption font-medium">Model Drivers</h3>
            <p className="mb-1 text-micro text-subtle">Releases that moved the {release.block} block, by impact.</p>
            {block?.releases.length ? (
              <Contribs rows={block.releases.map((r) => ({ label: r.label, value: r.impact ?? 0 }))} unit="σ" />
            ) : (
              <Missing>None.</Missing>
            )}
          </section>
        </>
      ) : null}

      {tab === "Details" ? (
        <section className="rounded-md bg-card p-2.5 text-micro shadow-[var(--shadow-border)]">
          <div className="grid grid-cols-2 gap-y-0.5">
            <Row k="Series" v={release.seriesId} />
            <Row k="Source" v={meta?.source ?? "—"} />
            <Row k="Units" v={meta?.units ?? "—"} />
            <Row k="Transform" v={meta?.transformation ?? "—"} />
            <Row k="Median release lag" v={meta?.releaseLagDays != null ? `${meta.releaseLagDays} d` : "—"} />
            <Row k="Published through" v={meta?.through ?? "—"} />
          </div>
          <p className="mt-2 text-subtle">
            {st.whatChanged.method}. {st.whatChanged.units} {st.whatChanged.validation}
          </p>
          <p className="mt-1 text-subtle">
            Source run: {st.provenance.news?.file} ({st.provenance.news?.sha256}) · generated {timeLabel(st.generatedAt)}
          </p>
        </section>
      ) : null}

      {tab === "History" ? (
        <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
          {factor ? (
            <>
              <h3 className="text-caption font-medium">{factor.domain.replace("_", " ")} factor</h3>
              <p className="text-micro text-subtle">
                {fixed(factor.percentile, 0)}th percentile of its history · {factor.direction} · as of {monthLabel(factor.asOf)}
              </p>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                <Changed
                  label="Level"
                  from={signed(factor.level, 2)}
                  delta={`${fixed((factor.varianceShare ?? 0) * 100, 0)}% of domain variance`}
                  good
                />
                <Changed label="1m change" from={signed(factor.change1m, 2)} delta={arrow(factor.change1m)} good={(factor.change1m ?? 0) >= 0} />
                <Changed label="3m change" from={signed(factor.change3m, 2)} delta={arrow(factor.change3m)} good={(factor.change3m ?? 0) >= 0} />
              </div>
              <div className="mt-2 text-micro font-medium">Drivers</div>
              <Contribs rows={factor.drivers.map((d) => ({ label: d.label, value: d.contribution ?? 0 }))} unit="σ" />
            </>
          ) : (
            <Missing>No domain factor maps to the {release.block} block.</Missing>
          )}
        </section>
      ) : null}

      {tab === "Related Assets" ? (
        <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
          <h3 className="text-caption font-medium">Volatility by growth/inflation quad</h3>
          <p className="text-micro text-subtle">
            How volatile each market was in Quad {quad} months, relative to its own average (training window, then holdout).
            {VOL_FORECAST_VALIDATED ? "" : " Descriptive: the quad did not improve a volatility forecast out of sample."}
          </p>
          <table className="mt-1 w-full text-left text-caption">
            <thead>
              <tr className="text-micro uppercase tracking-wider text-subtle">
                <th className="py-0.5 font-medium">Market</th>
                <th className="py-0.5 text-right font-medium">Train</th>
                <th className="py-0.5 text-right font-medium">Holdout</th>
                <th className="py-0.5 text-right font-medium">Sign held</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(VOL_BY_CHANNEL).map(([channel, row]) => {
                const cell = row.volRatios[quad];
                return (
                  <tr key={channel} className="border-t border-border/60">
                    <td className="py-0.5">{channel}</td>
                    <td className="py-0.5 text-right font-mono">{cell?.trainVolRatio != null ? `${fixed(cell.trainVolRatio)}×` : "—"}</td>
                    <td className="py-0.5 text-right font-mono">{cell?.holdoutVolRatio != null ? `${fixed(cell.holdoutVolRatio)}×` : "—"}</td>
                    <td className="py-0.5 text-right">{cell?.signHeld == null ? "—" : cell.signHeld ? "yes" : "no"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------- detail panels --

function Subhead({ crumb, title, note }: { crumb: string; title: string; note?: string }) {
  return (
    <header className="mb-1">
      <div className="text-micro text-subtle">{crumb}</div>
      <h2 className="text-body font-semibold">{title}</h2>
      {note ? <p className="text-micro text-subtle">{note}</p> : null}
    </header>
  );
}

function PathChart({
  data,
  lines,
}: {
  data: Record<string, number | string | null>[];
  lines: { key: string; color: string; name: string }[];
}) {
  if (data.length < 2) return <Missing>Not enough history to chart.</Missing>;
  return (
    <div className="h-20">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="t" tick={{ fill: "var(--color-subtle)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "var(--color-subtle)", fontSize: 9 }} axisLine={false} tickLine={false} width={26} />
          <Tooltip contentStyle={tip} />
          {lines.map((l) => (
            <Line key={l.key} dataKey={l.key} stroke={l.color} strokeWidth={1.6} dot={false} name={l.name} connectNulls />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function chartRows(read: Read, months = 24) {
  if (read?.status !== "ok") return [];
  return (read.history ?? []).slice(-months).map((h) => ({ ...h, t: monthLabel(h.date).slice(0, 3) }));
}

function LegTable({ read, side }: { read: Read; side: "growth" | "inflation" }) {
  const legs = read?.status === "ok" ? (read.legs ?? []).filter((l) => l.side === side) : [];
  if (!legs.length) return <Missing>No legs published.</Missing>;
  return (
    <div className="mt-1 grid grid-cols-[1fr_auto_auto] gap-x-2 text-micro">
      {legs.map((leg) => (
        <div key={leg.id} className="contents">
          <span className="truncate text-muted">{leg.label}</span>
          <span className="text-right font-mono">{fixed(leg.yoy, 1)}%</span>
          <span className={cn("text-right font-mono", leg.delta >= 0 ? "text-up" : "text-down")}>{signed(leg.delta, 2)} 3m</span>
        </div>
      ))}
    </div>
  );
}

export function GrowthDetailView({ read, state }: { read: Read; state: State }) {
  const ok = read?.status === "ok";
  const f = factorOf(state, "output_activity");
  const labor = factorOf(state, "labor");
  return (
    <section className="min-h-0 rounded-sm border border-border bg-card p-2">
      <Subhead crumb="Macro → Growth" title="Growth Detail" note="Live five-leg FRED basket; factor drivers from the point-in-time panel." />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-micro text-subtle">Basket YoY</div>
          <div className="font-mono text-xl font-semibold">{ok && read.growth ? `${fixed(read.growth.yoy, 1)}%` : "—"}</div>
          <div className="text-micro text-subtle">{ok && read.growth ? `${read.growth.direction}, ${signed(read.growth.delta)} pp 3m` : ""}</div>
        </div>
        <LegTable read={read} side="growth" />
      </div>
      <PathChart data={chartRows(read)} lines={[{ key: "growthYoy", color: "#5eb0e8", name: "Basket YoY" }]} />
      <div className="mt-1 text-micro font-medium">Output factor drivers {f ? `(${fixed(f.percentile, 0)}th pct)` : ""}</div>
      {f ? (
        <Contribs rows={f.drivers.map((d) => ({ label: d.label, value: d.contribution ?? 0 }))} unit="σ" />
      ) : (
        <Missing>{state == null ? "Loading…" : "Factor engine unavailable."}</Missing>
      )}
      {labor ? (
        <div className="mt-1 text-micro text-subtle">
          Labour factor {fixed(labor.percentile, 0)}th pct, {labor.direction}.
        </div>
      ) : null}
    </section>
  );
}

export function InflationDetailView({ read, state }: { read: Read; state: State }) {
  const rows = chartRows(read);
  const last = rows.at(-1);
  const pce = [...rows].reverse().find((r) => r.pceCore != null);
  const f = factorOf(state, "inflation");
  return (
    <section className="min-h-0 rounded-sm border border-border bg-card p-2">
      <Subhead crumb="Macro → Inflation" title="Inflation Detail" note="Year-over-year, FRED, monthly." />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-sm bg-card-2 p-2">
          <div className="text-micro text-subtle">Headline CPI</div>
          <div className="font-mono text-xl font-semibold">{last?.cpi != null ? `${fixed(last.cpi, 1)}%` : "—"}</div>
          <div className="text-micro text-subtle">{last ? monthLabel(last.date) : ""}</div>
        </div>
        <div className="rounded-sm bg-card-2 p-2">
          <div className="text-micro text-subtle">Core CPI</div>
          <div className="font-mono text-xl font-semibold">{last?.core != null ? `${fixed(last.core, 1)}%` : "—"}</div>
          <div className="text-micro text-subtle">
            Core PCE {pce?.pceCore != null ? `${fixed(pce.pceCore, 1)}% (${monthLabel(pce.date)})` : "—"}
          </div>
        </div>
      </div>
      <div className="mt-1 flex gap-3 text-[10px]">
        <span className="text-down">● Headline CPI</span>
        <span className="text-primary">● Core CPI</span>
        <span className="text-[#c4b5fd]">● Core PCE</span>
      </div>
      <PathChart
        data={rows}
        lines={[
          { key: "cpi", color: "var(--color-down)", name: "Headline CPI" },
          { key: "core", color: "var(--color-r1)", name: "Core CPI" },
          { key: "pceCore", color: "#c4b5fd", name: "Core PCE" },
        ]}
      />
      <div className="mt-1 text-micro font-medium">Basket legs</div>
      <LegTable read={read} side="inflation" />
      {f ? (
        <div className="mt-1 text-micro text-subtle">
          Inflation factor {fixed(f.percentile, 0)}th pct, {f.direction}.
        </div>
      ) : null}
    </section>
  );
}

export function RatesDetailView({ read }: { read: Read }) {
  const ten = printOf(read, "DGS10");
  const two = printOf(read, "DGS2");
  const rule = read?.status === "ok" ? read.policyRule : undefined;
  return (
    <section className="min-h-0 rounded-sm border border-border bg-card p-2">
      <Subhead crumb="Macro → Rates" title="Rates" note="Treasury yields and the policy rule; no term-premium split is fitted." />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-micro text-subtle">10Y UST</div>
          <div className="font-mono text-xl font-semibold">{ten ? `${fixed(ten.value)}%` : "—"}</div>
          <div className="text-micro text-subtle">{ten ? dayLabel(ten.date) : ""}</div>
        </div>
        <div className="space-y-0.5 text-micro text-muted">
          <div className="flex justify-between">
            <span>2Y UST</span>
            <span className="font-mono text-foreground">{two ? `${fixed(two.value)}%` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>10Y–3M</span>
            <span className="font-mono text-foreground">{read?.status === "ok" && read.curve ? `${fixed(read.curve.value)} pp` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Rule rate</span>
            <span className="font-mono text-foreground">{rule ? `${fixed(rule.rule)}%` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>r* (HLW)</span>
            <span className="font-mono text-foreground">{rule ? `${fixed(rule.rStar)}%` : "—"}</span>
          </div>
        </div>
      </div>
      <PathChart
        data={chartRows(read)}
        lines={[
          { key: "dgs10", color: "var(--color-r1)", name: "10Y" },
          { key: "funds", color: "#f0a05a", name: "Fed funds" },
        ]}
      />
      {read?.status === "ok" && read.curve?.lastNegative ? (
        <div className="text-micro text-subtle">10Y–3M last inverted {read.curve.lastNegative}.</div>
      ) : null}
    </section>
  );
}

export function GlobalDetailView({ state }: { state: State }) {
  const external = factorOf(state, "trade_external");
  const commodities = factorOf(state, "commodities");
  return (
    <section className="min-h-0 rounded-sm border border-border bg-card p-2">
      <Subhead
        crumb="Macro → Global"
        title="External & Commodities"
        note="US-panel factors for trade and commodities. No foreign-economy producer is connected."
      />
      {[external, commodities].map((f, i) =>
        f ? (
          <div key={f.id} className={cn(i > 0 && "mt-2")}>
            <div className="flex items-baseline justify-between text-micro">
              <span className="font-medium">{f.domain.replace("_", " ")} factor</span>
              <span className="font-mono">
                {fixed(f.percentile, 0)}th pct · {f.direction}
              </span>
            </div>
            <Contribs rows={f.drivers.slice(0, 4).map((d) => ({ label: d.label, value: d.contribution ?? 0 }))} unit="σ" />
          </div>
        ) : (
          <Missing key={i}>{state == null ? "Loading…" : "Factor unavailable."}</Missing>
        ),
      )}
    </section>
  );
}

export function GrowthDetail() {
  const read = useMacroRegime();
  const state = useMacroState();
  return <GrowthDetailView read={read} state={state} />;
}

export function InflationDetail() {
  const read = useMacroRegime();
  const state = useMacroState();
  return <InflationDetailView read={read} state={state} />;
}

export function RatesDetail() {
  const read = useMacroRegime();
  return <RatesDetailView read={read} />;
}

export function GlobalDetail() {
  const state = useMacroState();
  return <GlobalDetailView state={state} />;
}
