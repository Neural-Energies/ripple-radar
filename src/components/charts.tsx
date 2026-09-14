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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HeatPoint, SeriesPoint } from "@/data/types";
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
