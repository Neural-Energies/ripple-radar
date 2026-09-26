import { useState, type ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

/** Visual replica of the macro overview comp. The figures are the comp, not a live model. */

const tip = { background: "#101c32", border: "1px solid #1c2d4a", borderRadius: 6, fontSize: 11, color: "#e8eef8" };

function Spark({ data, className }: { data: number[]; className?: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 120;
  const h = 36;
  const d = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-7 w-full", className)} aria-hidden>
      <path d={d} fill="none" stroke="#5eb0e8" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function WorldMap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 180" className={cn("h-12 w-full", className)} aria-hidden>
      <path fill="#2f6fbf" d="M48 38l18-8 22 2 16 14 8 18-10 16-22 10-18-6-16-18-8-16zM78 108l16-4 14 16 6 22-12 16-18-4-14-20-4-16z" />
      <path fill="#d4656a" d="M168 36l22-6 16 8 6 16-14 10-22-2-12-12z" />
      <path fill="#9aa8bc" d="M166 72l20-4 18 10 10 22-8 24-22 8-18-16-10-24z" />
      <path fill="#d4656a" d="M196 28l48-8 62 6 28 18-8 16-36 10-48-4-40-16z" />
      <path fill="#d4656a" d="M286 118l28-6 18 10 4 16-16 10-24-2-14-14z" />
    </svg>
  );
}

function Card({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-sm border border-[#1a2740] bg-card px-2 py-1">
      <div className="text-[9px] font-medium uppercase tracking-wider text-subtle">{kicker}</div>
      {children}
    </section>
  );
}

function Stat({ value, move, good, hint }: { value: string; move?: string; good?: boolean; hint?: string }) {
  return (
    <div className="mt-1">
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-lg font-semibold tabular-nums leading-none">{value}</span>
        {move ? <span className={cn("shrink-0 text-micro font-medium", good ? "text-up" : "text-down")}>{move}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 text-micro leading-tight text-subtle">{hint}</div> : null}
    </div>
  );
}

function Move({ text, good }: { text: string; good?: boolean }) {
  return <span className={cn("text-micro font-medium", good ? "text-up" : "text-down")}>{text}</span>;
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <>
      <span className="text-subtle">{k}</span>
      <span className={cn("text-right", tone === "up" && "text-up", tone === "down" && "text-down")}>{v}</span>
    </>
  );
}

const growthSpark = [2.4, 2.1, 1.6, 1.9, 2.2, 1.8, 1.5, 1.7, 1.4, 1.8, 1.6, 1.5];
const inflationSpark = [3.4, 3.2, 3.0, 3.3, 2.9, 3.1, 2.8, 2.6, 2.9, 2.7, 2.5, 2.7];
const cycleSpark = [14, 13, 12, 11, 12, 10, 9, 10, 8, 9, 8, 7];
const policySpark = [1.2, 1.6, 2.2, 2.8, 3.4, 3.8, 4.1, 4.3, 4.4, 4.3, 4.25, 4.25];
const ratesSpark = [3.6, 3.8, 4.0, 4.3, 4.6, 4.4, 4.2, 4.5, 4.7, 4.5, 4.55, 4.61];
const conditionsSpark = [-0.4, -0.2, 0.1, 0.3, 0.1, -0.1, 0.2, 0.4, 0.2, 0.0, 0.15, 0.24];

const releases = [
  { id: "ism", time: "10:00", name: "ISM Services (Sep)", spark: [51, 52, 50, 53, 54, 52, 51, 53, 55, 54.9], actual: "54.9", actualGood: true, consensus: "52.0", prior: "51.5", impacts: [["GDP nowcast", "−0.18 pp", false], ["Recession prob", "+3 pp", false], ["2Y", "−6 bp", true]] as const, models: ["Growth", "Cycle", "Rates"] },
  { id: "claims", time: "08:30", name: "Initial Claims (Sep 28)", spark: [230, 225, 220, 228, 218, 222, 216, 224, 220, 225], actual: "225K", actualGood: true, consensus: "220K", prior: "218K", impacts: [["Growth breadth", "↑", true], ["Recession prob", "−1 pp", true]] as const, models: ["Growth", "Cycle"] },
  { id: "payrolls", time: "08:30", name: "Nonfarm Payrolls (Sep)", spark: [180, 150, 120, 160, 140, 170, 110, 130, 150, 142], actual: "142K", actualGood: false, consensus: "160K", prior: "89K", impacts: [["GDP nowcast", "−0.14 pp", false], ["Wage pressure", "+0.05σ", true]] as const, models: ["Growth", "Inflation", "Policy"] },
  { id: "unrate", time: "08:30", name: "Unemployment Rate (Sep)", spark: [4.0, 4.1, 4.2, 4.3, 4.2, 4.1, 4.2, 4.3, 4.2, 4.2], actual: "4.2%", actualGood: true, consensus: "4.2%", prior: "4.3%", impacts: [["Policy stance unchanged", "", true], ["Taylor gap", "+2 bp", false]] as const, models: ["Policy", "Cycle"] },
  { id: "pmi", time: "09:45", name: "S&P Global Services PMI (Sep)", spark: [52, 53, 54, 53, 55, 54, 53, 55, 54, 55.2], actual: "55.2", actualGood: true, consensus: "53.5", prior: "53.7", impacts: [["Growth momentum", "↑", true], ["Global cycle", "↑", true]] as const, models: ["Growth", "Global"] },
];

const growthPath = [
  { m: "Jan", now: 0.6, lo: -0.4, band: 1.6 },
  { m: "Feb", now: 1.4, lo: 0.2, band: 1.8 },
  { m: "Mar", now: 2.1, lo: 0.8, band: 2.0 },
  { m: "Apr", now: 2.8, lo: 1.4, band: 2.2 },
  { m: "May", now: 3.4, lo: 2.0, band: 2.2 },
  { m: "Jun", now: 3.1, lo: 1.8, band: 2.0 },
  { m: "Jul", now: 2.4, lo: 1.2, band: 1.8 },
  { m: "Aug", now: 2.0, lo: 0.9, band: 1.7 },
  { m: "Sep", now: 1.8, lo: 0.8, band: 1.6 },
  { m: "Oct", now: 1.6, lo: 1.1, band: 1.0 },
];
const inflationPath = [
  { t: "2021", headline: 1.8, core: 1.6, pce: 1.7 },
  { t: "", headline: 5.2, core: 4.0, pce: 4.4 },
  { t: "2022", headline: 8.4, core: 6.4, pce: 6.6 },
  { t: "", headline: 7.2, core: 6.0, pce: 5.8 },
  { t: "2023", headline: 4.8, core: 5.2, pce: 4.6 },
  { t: "", headline: 3.4, core: 4.2, pce: 3.6 },
  { t: "2024", headline: 3.1, core: 3.4, pce: 2.9 },
  { t: "", headline: 2.5, core: 2.7, pce: 2.6 },
];
const ratesPath = [
  { t: "2021", expected: 0.7, premium: 0.5 },
  { t: "", expected: 1.0, premium: 0.7 },
  { t: "2022", expected: 1.6, premium: 1.0 },
  { t: "", expected: 2.3, premium: 1.3 },
  { t: "2023", expected: 2.8, premium: 1.6 },
  { t: "", expected: 3.0, premium: 1.7 },
  { t: "2024", expected: 2.9, premium: 1.7 },
  { t: "", expected: 2.8, premium: 1.8 },
];
const economies = [
  { flag: "🇺🇸", name: "United States", growth: "1.6%", momentum: "↓", good: false, inflation: "2.5%", phase: "Expansion", phaseGood: true },
  { flag: "🇪🇺", name: "Eurozone", growth: "0.8%", momentum: "↑", good: true, inflation: "2.2%", phase: "Slowdown", phaseGood: false },
  { flag: "🇨🇳", name: "China", growth: "4.8%", momentum: "↑", good: true, inflation: "0.5%", phase: "Expansion", phaseGood: true },
  { flag: "🇯🇵", name: "Japan", growth: "0.7%", momentum: "→", good: true, inflation: "2.8%", phase: "Slowdown", phaseGood: false },
  { flag: "🇬🇧", name: "United Kingdom", growth: "0.9%", momentum: "↓", good: false, inflation: "2.4%", phase: "Slowdown", phaseGood: false },
  { flag: "🌐", name: "Global (G20)", growth: "3.1%", momentum: "↑", good: true, inflation: "2.9%", phase: "Expansion", phaseGood: true },
];

function Contrib({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const pos = value >= 0;
  const hot = invert ? pos : !pos;
  const scale = Math.abs(value) < 0.2 ? 0.16 : 1.4;
  const pct = Math.max(6, Math.min(100, (Math.abs(value) / scale) * 100));
  return (
    <div className="grid grid-cols-[minmax(0,7.2rem)_minmax(0,1fr)_4.2rem] items-center gap-1 py-px text-[11px]">
      <span className="truncate text-muted">{label}</span>
      <span className="h-1.5 rounded-[1px] bg-[#122033]">
        <span className={cn("block h-full rounded-[1px]", hot ? "bg-down" : "bg-up")} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn("whitespace-nowrap text-right font-mono text-[10px] tabular-nums", hot ? "text-down" : "text-up")}>
        {pos ? "+" : ""}
        {value.toFixed(2)} pp
      </span>
    </div>
  );
}

export function MacroMirror() {
  const [id, setId] = useState("ism");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 items-start gap-2 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0">
          <header className="mb-1.5 flex items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold leading-none tracking-tight">Macro Overview</h1>
              <p className="mt-0.5 text-[11px] text-muted">Real-time economic state, model consensus, and market implications.</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-subtle">
              <span>Last update: Oct 3, 2024 10:02 ET</span>
              <span className="text-up">● All systems operational</span>
            </div>
          </header>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 xl:grid-cols-7">
            <Card kicker="Growth">
              <div className="text-micro text-subtle">GDP Nowcast</div>
              <Stat value="1.6%" move="↓ 0.3 pp" hint="SAAR vs prior" />
              <Spark data={growthSpark} />
              <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight"><Row k="Momentum" v="↓" tone="down" /><Row k="Breadth" v="3/5" /><Row k="Model view" v="Mixed" /></div>
            </Card>
            <Card kicker="Inflation">
              <div className="text-micro text-subtle">Core Trend</div>
              <Stat value="2.7%" move="↓ 0.2 pp" hint="YoY vs prior" />
              <Spark data={inflationSpark} />
              <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight"><Row k="Momentum" v="↓" tone="down" /><Row k="Persistence" v="Easing" tone="up" /><Row k="Breadth" v="4/6" /></div>
            </Card>
            <Card kicker="Cycle">
              <div className="text-micro text-subtle">Recession Probability</div>
              <Stat value="7%" move="↓ 3 pp" good hint="vs 1m ago" />
              <Spark data={cycleSpark} />
              <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight"><Row k="Expansion" v="68%" /><Row k="Slowdown" v="25%" /><Row k="Contraction" v="7%" /></div>
            </Card>
            <Card kicker="Policy">
              <div className="text-micro text-subtle">Fed Funds (Target)</div>
              <Stat value="4.25%" />
              <div className="mt-1 text-micro text-subtle">Modified Taylor</div>
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className="font-mono text-base font-semibold">3.82%</span>
                <span className="shrink-0 rounded-sm bg-down/15 px-1 text-[9px] text-down">43 bp tighter</span>
              </div>
              <Spark data={policySpark} />
            </Card>
            <Card kicker="Rates">
              <div className="text-micro text-subtle">10Y Treasury</div>
              <Stat value="4.61%" move="↑ 13 bp" hint="today" />
              <Spark data={ratesSpark} />
              <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight"><Row k="Term Premium" v="69%" /><Row k="Exp. Short Rates" v="31%" /><Row k="Real Yield" v="2.12%" /></div>
            </Card>
            <Card kicker="Financial Conditions">
              <div className="mt-1 text-caption font-semibold leading-tight">Moderately Tight</div>
              <Move text="↑ tighter vs 1m ago" />
              <Spark data={conditionsSpark} />
              <div className="mt-auto grid grid-cols-2 text-[10px] leading-tight"><Row k="NFCI" v="0.24" /><Row k="STLFSI" v="−0.31" /><Row k="Credit Spreads" v="↓" tone="down" /></div>
            </Card>
            <Card kicker="Global">
              <div className="text-micro text-subtle">Global Growth Impulse</div>
              <div className="text-lg font-semibold text-up">Improving</div>
              <div className="mt-1 text-micro text-subtle">US exceptionalism</div>
              <div className="text-caption">Weakening</div>
              <WorldMap />
            </Card>
          </div>

          <section className="mt-2 rounded-md bg-card shadow-[var(--shadow-border)]">
            <header className="flex items-center justify-between border-b border-border px-2.5 py-2">
              <div>
                <h2 className="text-caption font-semibold">What Changed Today</h2>
                <p className="text-micro text-subtle">Latest macro releases and their impact across models.</p>
              </div>
              <span className="text-micro text-primary">View all releases →</span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-caption">
                <thead>
                  <tr className="text-micro uppercase tracking-wider text-subtle">
                    {["Time", "Release", "Actual", "Consensus", "Prior", "Key impacts", "Models affected"].map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {releases.map((row) => (
                    <tr key={row.id} onClick={() => setId(row.id)} className={cn("cursor-pointer border-t border-border/70 hover:bg-card-2", id === row.id && "bg-card-2")}>
                      <td className="px-2 py-1 font-mono text-micro text-subtle">{row.time}</td>
                      <td className="px-2 py-1">
                        <span className="flex items-center gap-2"><Spark data={row.spark} className="h-4 w-14" />{row.name}</span>
                      </td>
                      <td className={cn("px-2 py-1 font-mono", row.actualGood ? "text-up" : "text-down")}>{row.actual}</td>
                      <td className="px-2 py-1 font-mono text-muted">{row.consensus}</td>
                      <td className="px-2 py-1 font-mono text-subtle">{row.prior}</td>
                      <td className="px-2 py-1 text-micro">
                        {row.impacts.map(([label, value, good]) => (
                          <span key={label} className="mr-2">{label}{value ? <span className={good ? "text-up" : "text-down"}> {value}</span> : null}</span>
                        ))}
                      </td>
                      <td className="px-2 py-1">
                        <span className="flex flex-wrap items-center gap-1">
                          {row.models.map((model) => <span key={model} className="rounded-sm bg-card-3 px-1.5 py-0.5 text-micro text-muted">{model}</span>)}
                          <span className="text-subtle">›</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <ReleaseDrawer id={id} />
      </div>
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-4">
        <GrowthDetail />
        <InflationDetail />
        <RatesDetail />
        <GlobalDetail />
      </div>
    </div>
  );
}

function Changed({ label, from, to, delta, good }: { label: string; from: string; to?: string; delta: string; good?: boolean }) {
  return (
    <div className="rounded-sm bg-card-2 p-1.5">
      <div className="text-micro text-subtle">{label}</div>
      <div className="text-caption">{from}{to ? <span className="text-muted"> → {to}</span> : null}</div>
      <div className={cn("text-micro", good ? "text-up" : "text-down")}>{delta}</div>
    </div>
  );
}

export function ReleaseDrawer({ id }: { id: string }) {
  const release = releases.find((row) => row.id === id) ?? releases[0]!;
  return (
    <aside className="flex min-w-0 flex-col gap-1.5">
      <div className="text-micro text-subtle">Macro → What Changed → {release.name.split(" (")[0]}</div>
      <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-body font-semibold">{release.name.replace("(Sep)", "(September)")}</h2>
            <p className="text-micro text-subtle">{release.time} ET · Oct 3, 2024</p>
          </div>
          <div className="flex gap-1 text-micro text-muted">
            <span className="rounded-sm bg-card-3 px-1.5 py-0.5">Previous Release</span>
            <span className="rounded-sm bg-card-3 px-1.5 py-0.5">Next Release</span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-4 overflow-hidden rounded-sm border border-border bg-card-2/40 [&>div]:border-r [&>div]:border-border [&>div]:px-2 [&>div]:py-2 [&>div:last-child]:border-r-0">
          <div><div className="text-micro text-subtle">Actual</div><div className={cn("font-mono text-xl font-semibold", release.actualGood ? "text-up" : "text-down")}>{release.actual}</div></div>
          <div><div className="text-micro text-subtle">Consensus</div><div className="font-mono text-xl">{release.consensus}</div></div>
          <div><div className="text-micro text-subtle">Prior</div><div className="font-mono text-xl text-muted">{release.prior}</div></div>
          <div className="text-micro text-up">↑ Stronger than expected<div>+2.9 vs consensus</div></div>
        </div>
      </section>
      <div className="flex h-7 items-end gap-5 border-b border-border px-2 text-micro">
        <span className="border-b border-primary pb-1.5 text-primary">Impact</span>
        <span className="pb-1.5 text-muted">Details</span>
        <span className="pb-1.5 text-muted">History</span>
        <span className="pb-1.5 text-muted">Related Assets</span>
      </div>
      <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
        <h3 className="text-caption font-medium">What Changed</h3>
        <p className="text-micro text-subtle">How this release moved our models and estimates.</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Changed label="GDP Nowcast" from="1.8%" to="1.6%" delta="↓ 0.18 pp" />
          <Changed label="Recession Probability" from="10%" to="13%" delta="↑ 3 pp" />
          <Changed label="Inflation Persistence" from="Unchanged" delta="2.7%" good />
          <Changed label="2Y Expected Path" from="↓ 6 bp" delta="more dovish" good />
          <Changed label="10Y Expected Path" from="↓ 4 bp" delta="more dovish" good />
          <Changed label="Dollar Sensitivity" from="Bearish" delta="historical response" />
        </div>
      </section>
      <section className="rounded-md bg-card p-2.5 shadow-[var(--shadow-border)]">
        <h3 className="text-caption font-medium">Model Drivers</h3>
        <p className="mb-1 text-micro text-subtle">Which components moved and by how much.</p>
        <Contrib label="Business Activity" value={0.12} />
        <Contrib label="New Orders" value={0.08} />
        <Contrib label="Employment" value={-0.06} />
        <Contrib label="Prices Paid" value={-0.04} />
        <Contrib label="Supplier Deliveries" value={0.02} />
      </section>
    </aside>
  );
}

function Subhead({ crumb, title }: { crumb: string; title: string }) {
  return (
    <header className="mb-1">
      <div className="text-micro text-subtle">{crumb}</div>
      <h2 className="text-body font-semibold">{title}</h2>
    </header>
  );
}

function Tabs({ items, active }: { items: string[]; active: string }) {
  return (
    <div className="mb-2 flex gap-3 text-micro">
      {items.map((item) => (
        <span key={item} className={item === active ? "border-b border-primary text-primary" : "text-subtle"}>{item}</span>
      ))}
    </div>
  );
}

export function GrowthDetail() {
  return (
    <section className="min-h-0 rounded-sm border border-[#1a2740] bg-card p-2">
      <Subhead crumb="Macro → Growth" title="Growth Detail" />
      <Tabs items={["Overview", "Nowcast", "Breadth", "Drivers", "Model Detail"]} active="Overview" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-micro text-subtle">GDP Nowcast</div>
          <div className="font-mono text-xl font-semibold">1.6%</div>
          <Move text="↓ 0.3 pp vs prior" />
          <div className="text-micro text-subtle">SAAR</div>
        </div>
        <div className="space-y-0.5 text-micro text-muted">
          <div className="flex justify-between"><span>Model range</span><span className="font-mono text-foreground">1.1% – 2.1%</span></div>
          <div className="flex justify-between"><span>Previous nowcast</span><span className="font-mono text-foreground">1.9%</span></div>
          <div className="flex justify-between"><span>Last update</span><span className="font-mono text-foreground">Oct 3, 10:02 ET</span></div>
          <div className="flex justify-between"><span>Inputs current</span><span className="font-mono text-foreground">17 / 19</span></div>
        </div>
      </div>
      <div className="mt-2 text-micro text-subtle">GDP Nowcast (SAAR)</div>
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={growthPath} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1a2740" vertical={false} />
            <XAxis dataKey="m" tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={[-1, 5]} ticks={[0, 2, 4]} tick={{ fill: "#5a6d88", fontSize: 9 }} axisLine={false} tickLine={false} width={22} />
            <Tooltip contentStyle={tip} />
            <Area dataKey="lo" stackId="band" stroke="none" fill="transparent" />
            <Area dataKey="band" stackId="band" stroke="none" fill="#5eb0e8" fillOpacity={0.28} />
            <Line dataKey="now" stroke="#5eb0e8" strokeWidth={1.6} dot={false} name="Nowcast" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-micro font-medium">Top Drivers (since last update)</div>
      <Contrib label="Payrolls" value={-0.14} />
      <Contrib label="ISM" value={-0.09} />
      <Contrib label="Retail Sales" value={0.04} />
      <Contrib label="Industrial Production" value={-0.03} />
      <Contrib label="Housing Starts" value={0.02} />
    </section>
  );
}

export function InflationDetail() {
  return (
    <section className="min-h-0 rounded-sm border border-[#1a2740] bg-card p-2">
      <Subhead crumb="Macro → Inflation" title="Inflation Detail" />
      <Tabs items={["Overview", "Components", "Nowcast", "Persistence", "Expectations"]} active="Overview" />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-sm bg-card-2 p-2">
          <div className="text-micro text-subtle">Core Inflation (PCE)</div>
          <div className="font-mono text-xl font-semibold">2.7%</div>
          <Move text="↓ 0.2 pp YoY" good />
        </div>
        <div className="rounded-sm bg-card-2 p-2">
          <div className="text-micro text-subtle">Headline Inflation (CPI)</div>
          <div className="font-mono text-xl font-semibold">2.5%</div>
          <Move text="↓ 0.3 pp YoY" good />
        </div>
      </div>
      <div className="mt-1.5 flex gap-1 text-[10px]">
        {["Level", "Direction", "Persistence", "Breadth"].map((item, i) => (
          <span key={item} className={cn("rounded-sm px-1.5 py-0.5", i === 0 ? "bg-card-3 text-foreground" : "text-subtle")}>{item}</span>
        ))}
      </div>
      <div className="mt-1 flex gap-3 text-[10px]"><span className="text-down">● Headline CPI</span><span className="text-primary">● Core CPI</span><span className="text-[#c4b5fd]">● PCE Core</span></div>
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={inflationPath} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1a2740" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip contentStyle={tip} />
            <Line dataKey="headline" stroke="#f07178" strokeWidth={1.6} dot={false} />
            <Line dataKey="core" stroke="#3ec8e8" strokeWidth={1.6} dot={false} />
            <Line dataKey="pce" stroke="#c4b5fd" strokeWidth={1.6} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-micro font-medium">Component Contributions (YoY)</div>
      <Contrib label="Shelter" value={1.3} invert />
      <Contrib label="Services ex. shelter" value={0.8} invert />
      <Contrib label="Core goods" value={-0.4} invert />
      <Contrib label="Food" value={0.3} invert />
      <Contrib label="Energy" value={-0.6} invert />
    </section>
  );
}

export function RatesDetail() {
  return (
    <section className="min-h-0 rounded-sm border border-[#1a2740] bg-card p-2">
      <Subhead crumb="Macro → Rates" title="Rates Decomposition" />
      <Tabs items={["Overview", "Decomposition", "Curve", "Term Premium", "Drivers"]} active="Decomposition" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-micro text-subtle">10Y UST Yield</div>
          <div className="font-mono text-xl font-semibold">4.61%</div>
          <Move text="↑ 13 bp today" />
        </div>
        <div className="space-y-0.5 text-micro text-muted">
          <div className="flex justify-between"><span>Expected Short Rates</span><span className="font-mono text-primary">+4 bp (31%)</span></div>
          <div className="flex justify-between"><span>Term Premium</span><span className="font-mono text-[#f0a05a]">+9 bp (69%)</span></div>
          <div className="flex justify-between"><span>Real Yield</span><span className="font-mono text-foreground">2.12%</span></div>
          <div className="flex justify-between"><span>Breakeven Inflation</span><span className="font-mono text-foreground">2.49%</span></div>
        </div>
      </div>
      <div className="mt-1 h-20">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={ratesPath} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1a2740" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip contentStyle={tip} />
            <Area dataKey="expected" stackId="y" stroke="#3ec8e8" fill="#3ec8e8" fillOpacity={0.85} />
            <Area dataKey="premium" stackId="y" stroke="#f0a05a" fill="#f0a05a" fillOpacity={0.9} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-micro font-medium">Today's Move</div>
      <div className="mt-1 flex h-3 overflow-hidden rounded-sm"><div className="bg-primary" style={{ width: "31%" }} /><div className="bg-[#f0a05a]" style={{ width: "69%" }} /></div>
      <div className="mt-1 flex justify-between text-micro"><span className="text-down">+13 bp</span><span className="text-primary">+4 bp (31%)</span><span className="text-[#f0a05a]">+9 bp (69%)</span></div>
    </section>
  );
}

export function GlobalDetail() {
  return (
    <section className="min-h-0 rounded-sm border border-[#1a2740] bg-card p-2">
      <Subhead crumb="Macro → Global" title="Global Macro Cycle" />
      <Tabs items={["Overview", "Economies", "Growth", "Inflation", "Trade", "Breadth"]} active="Overview" />
      <div className="grid grid-cols-[1fr_7rem] items-start gap-2">
        <div>
          <div className="text-micro text-subtle">Global Growth Breadth</div>
          <div className="font-mono text-xl font-semibold">13 / 20</div>
          <div className="text-micro text-subtle">economies accelerating</div>
          <div className="text-micro text-up">↑ +2 vs last month</div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-sm"><div className="bg-up" style={{ width: "65%" }} /><div className="bg-down" style={{ width: "35%" }} /></div>
          <div className="mt-1 text-micro text-subtle"><span className="text-up">Accelerating 13</span> · <span className="text-down">Decelerating 7</span></div>
        </div>
        <WorldMap className="h-20" />
      </div>
      <table className="mt-2 w-full text-left text-caption">
        <thead>
          <tr className="text-micro uppercase tracking-wider text-subtle">
            {["Economy", "Growth", "Momentum", "Inflation", "Cycle phase"].map((h) => <th key={h} className="py-1 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {economies.map((row) => (
            <tr key={row.name} className="border-t border-border/60">
              <td className="py-1">{row.flag} {row.name}</td>
              <td className="py-1 font-mono">{row.growth}</td>
              <td className={cn("py-1", row.good ? "text-up" : "text-down")}>{row.momentum}</td>
              <td className="py-1 font-mono">{row.inflation}</td>
              <td className={cn("py-1", row.phaseGood ? "text-up" : "text-warn")}>{row.phase}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
