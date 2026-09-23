import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { HeatPoint, Scenario, SeriesPoint } from "@/data/types";
import { cn } from "@/lib/utils";

const tooltipStyle = {
  background: "#101c32",
  border: "1px solid #1c2d4a",
  borderRadius: 8,
  fontSize: 11,
  color: "#e8eef8",
};

export function ProbabilityChart({ data }: { data: SeriesPoint[] }) {
  return (
    <div className="h-28 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="probFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3ec8e8" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#3ec8e8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1c2d4a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: "#5a6d88", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [`${String(v)}%`, "Probability"]}
          />
          <Area type="monotone" dataKey="value" stroke="#3ec8e8" strokeWidth={2} fill="url(#probFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HeatChart({ data }: { data: HeatPoint[] }) {
  return (
    <div className="h-28 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#1c2d4a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="news" name="News" stroke="#3ec8e8" strokeWidth={1.6} dot={false} />
          <Line type="monotone" dataKey="social" name="Social" stroke="#4ade80" strokeWidth={1.6} dot={false} />
          <Line type="monotone" dataKey="search" name="Search" stroke="#e0b35c" strokeWidth={1.6} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LearningChart({
  data,
}: {
  data: { date: string; accuracy: number; brier: number }[];
}) {
  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#1c2d4a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="a" domain={[40, 80]} tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line yAxisId="a" type="monotone" dataKey="accuracy" name="Accuracy" stroke="#4ade80" strokeWidth={1.8} dot={{ r: 2.5 }} />
          <Line yAxisId="a" type="monotone" dataKey="brier" name="Brier ×100" stroke="#3ec8e8" strokeWidth={1.8} dot={{ r: 2.5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CalibrationChart({
  data,
}: {
  data: { bucket: string; predicted: number; observed: number }[];
}) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#1c2d4a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#5a6d88", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="predicted" name="Predicted" fill="#3ec8e8" radius={[3, 3, 0, 0]} />
          <Bar dataKey="observed" name="Observed" fill="#4ade80" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({
  data,
}: {
  data: { label: string; weight: number; color: string }[];
}) {
  return (
    <div className="h-36 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="weight"
            nameKey="label"
            innerRadius={38}
            outerRadius={58}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${String(v)}%`, "Weight"]} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}


export const SCENARIO_COLORS = ["#3ec8e8", "#4ade80", "#e0b35c", "#f07178", "#a78bfa", "#94a3b8"];

/** Current scenario mass only — not a path-over-time / fan chart. */
export function ScenarioDistributionBar({
  scenarios,
  legend = true,
  showSum = false,
  onSelect,
}: {
  scenarios: Pick<Scenario, "id" | "name" | "probability">[];
  legend?: boolean;
  /** Show raw Σ of displayed mass. Never labels Σ=100 as calibrated. */
  showSum?: boolean;
  /** When given, legend rows drill into the scenario. Omitted for historical
   *  frames, where there is no current row to open. */
  onSelect?: (scenarioId: string) => void;
}) {
  if (!scenarios.length) {
    return <p className="text-caption text-muted">No scenarios on this book.</p>;
  }
  const rawSum = scenarios.reduce((n, s) => n + Math.max(0, s.probability), 0);
  const total = rawSum || 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-4 w-full overflow-hidden rounded-sm bg-card-3">
        {scenarios.map((s, i) => {
          const w = (Math.max(0, s.probability) / total) * 100;
          if (w <= 0) return null;
          return (
            <div
              key={s.id}
              title={`${s.name}: ${s.probability}%`}
              className="flex h-full items-center justify-center overflow-hidden"
              style={{ width: `${w}%`, background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}
            >
              {w >= 12 ? (
                <span className="px-0.5 font-mono text-[9px] font-semibold tabular-nums leading-none text-primary-foreground/90">
                  {s.probability}%
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {showSum ? (
        <div className="font-mono text-micro tabular-nums text-subtle">
          Σ {rawSum}%{rawSum === 100 ? " · family mass" : " · not exhaustive"}
        </div>
      ) : null}
      {legend ? (
        <ul className="flex flex-col gap-1">
          {scenarios.map((s, i) => {
            const body = (
              <>
                <span className="flex min-w-0 items-center gap-1.5">
                  <i
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}
                  />
                  <span className="truncate text-muted">{s.name}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-foreground">
                  {s.probability}%
                </span>
              </>
            );
            return (
              <li key={s.id} className="text-caption">
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    title={`Open ${s.name} in the scenario book`}
                    className="flex w-full items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-card-2"
                  >
                    {body}
                  </button>
                ) : (
                  <span className="flex items-center justify-between gap-2 px-1 py-0.5">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function ImpactBars({
  items,
}: {
  items: { label: string; value: number; direction: "up" | "down" }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 truncate text-tiny text-muted">{i.label}</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-card-3">
              <div
                className={cn(
                  "h-full rounded-full",
                  i.direction === "down" ? "bg-r4" : i.value > 70 ? "bg-r3" : "bg-r2",
                )}
                style={{ width: `${(i.value / max) * 100}%` }}
              />
            </div>
          </div>
          <span className="w-8 text-right font-mono text-tiny tabular-nums text-foreground">
            {i.value}%
          </span>
        </li>
      ))}
    </ul>
  );
}


/** Exposure scatter: X = ripple distance, Y = research rank (ordering, not
 *  conviction or expected return). Real AssetRecord fields only. */
export function ExposureScatter({
  points,
  highlight,
  onSelect,
}: {
  points: {
    ticker: string;
    score: number;
    distance: number;
    change: number;
    causalPath?: string;
    crowding?: string;
    z: number;
  }[];
  highlight?: string | null;
  onSelect?: (ticker: string) => void;
}) {
  if (!points.length) {
    return (
      <p className="px-3 py-6 text-center text-caption text-muted">
        No ranked expressions for this shock.
      </p>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 12 }}>
          <CartesianGrid stroke="#1c2d4a" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="distance"
            name="Distance"
            domain={[-0.2, 4.2]}
            ticks={[0, 1, 2, 3, 4]}
            tick={{ fill: "#5a6d88", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            label={{
              value: "Ripple distance",
              position: "insideBottom",
              offset: -4,
              fill: "#5a6d88",
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            dataKey="score"
            name="Research rank"
            tick={{ fill: "#5a6d88", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
            label={{
              value: "Research rank",
              angle: -90,
              position: "insideLeft",
              fill: "#5a6d88",
              fontSize: 10,
            }}
          />
          <ZAxis type="number" dataKey="z" range={[40, 160]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]?.payload as {
                ticker: string;
                score: number;
                distance: number;
                change: number;
                causalPath?: string;
              };
              return (
                <div className="rounded-md border border-border bg-card px-2.5 py-2 text-caption shadow-lg">
                  <div className="font-mono text-primary">{p.ticker}</div>
                  <div className="text-muted">
                    d{p.distance} · rank {p.score} · {p.change >= 0 ? "+" : ""}
                    {p.change.toFixed(1)}%
                  </div>
                  {p.causalPath ? (
                    <div className="mt-1 max-w-[14rem] text-tiny text-subtle">{p.causalPath}</div>
                  ) : null}
                </div>
              );
            }}
          />
          <Scatter
            data={points}
            fill="#3ec8e8"
            onClick={(d) => {
              const row = d as { ticker?: string };
              if (row?.ticker && onSelect) onSelect(row.ticker);
            }}
            cursor="pointer"
          >
            {points.map((p) => (
              <Cell
                key={p.ticker}
                fill={p.change >= 0 ? "#4ade80" : "#f07178"}
                stroke={highlight === p.ticker ? "#e8eef8" : "transparent"}
                strokeWidth={highlight === p.ticker ? 2 : 0}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
