import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { FrozenBadge } from "@/components/desk-nav";
import { useMacroRegime } from "@/components/macro-strip";
import { Badge, Panel } from "@/components/ui";
import { SHOCKS, UNWIRED } from "@/data/macro-fixtures";
import { QUAD_NAME, regimeFlips } from "@/lib/live/macro-regime";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/macro", label: "Overview", exact: true },
  { to: "/macro/growth", label: "Growth", exact: false },
  { to: "/macro/inflation", label: "Inflation", exact: false },
  { to: "/macro/rates", label: "Rates", exact: false },
  { to: "/macro/global", label: "Global", exact: false },
  { to: "/macro/cycle", label: "Cycle", exact: false },
  { to: "/macro/policy", label: "Policy", exact: false },
  { to: "/macro/conditions", label: "Conditions", exact: false },
  { to: "/macro/shocks", label: "Shocks", exact: false },
] as const;

export function MacroChrome({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
      <header>
        <div className="text-micro uppercase tracking-wider text-subtle">Macro</div>
        <h1 className="text-base font-semibold tracking-tight">Workstation</h1>
      </header>
      <nav className="flex gap-1 overflow-x-auto" aria-label="Macro book">
        {TABS.map((tab) => {
          const on = tab.exact ? path === "/macro" : path === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "shrink-0 rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                on ? "bg-card-3 text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

type Read = NonNullable<ReturnType<typeof useMacroRegime>>;

function month(date?: string) {
  if (!date) return "";
  const [year, m] = date.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${year}`;
}

export function WhatChanged({ read }: { read: Read | null }) {
  if (!read || read.status !== "ok" || read.quad == null) {
    return (
      <Panel title="What changed">
        <p className="text-caption text-muted">{read?.detail ?? "Reading FRED…"}</p>
      </Panel>
    );
  }
  const flip = regimeFlips(read.legs ?? [])[0];
  return (
    <Panel title="What changed" action={<span className="font-mono text-micro text-subtle">{month(read.date)}</span>}>
      <ul className="flex flex-col gap-1 text-caption">
        <li>
          Quad {read.quad} · {QUAD_NAME[read.quad]}. Growth {read.growth?.direction}, inflation {read.inflation?.direction}.
        </li>
        {flip ? (
          <li>
            Nearest flip: {flip.legs.map((leg) => `${leg.label} (${leg.distance.toFixed(1)} pts)`).join(", ")} → Quad {flip.to} ·{" "}
            {QUAD_NAME[flip.to]}.
          </li>
        ) : null}
        {read.policyRule ? (
          <li>
            Funds {read.policyRule.funds.toFixed(2)} versus the rule {read.policyRule.rule.toFixed(2)}.{" "}
            {Math.abs(read.policyRule.stance).toFixed(2)} pp {read.policyRule.stance < 0 ? "easier" : "tighter"}.
          </li>
        ) : null}
        {read.vol ? (
          <li>
            VIX {read.vol.vix.toFixed(2)}. {read.vol.term === "contango" ? "Contango" : "Backwardation"}{" "}
            {(read.vol.slope * 100).toFixed(1)}%. Realized vol is {read.vol.realized}.
          </li>
        ) : null}
        {read.sahm ? (
          <li>{read.sahm.tripped ? "Sahm is through the line." : `Sahm is ${read.sahm.gap.toFixed(2)} pp under the line.`}</li>
        ) : null}
      </ul>
    </Panel>
  );
}

export function ReleaseDrawer({ read }: { read: Read | null }) {
  const [open, setOpen] = useState(false);
  const prints = read?.prints ?? [];
  return (
    <Panel
      title="Last prints"
      action={
        <button type="button" className="text-micro text-primary hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Open"}
        </button>
      }
    >
      <p className="text-caption text-muted">The upcoming-release calendar is not wired. This drawer is the last print already on the book.</p>
      {open ? (
        <ul className="mt-1">
          {prints.map((print) => (
            <li key={print.id} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1 text-caption last:border-b-0">
              <span>{print.label}</span>
              <span className="font-mono text-micro text-subtle">
                {print.value.toFixed(2)}
                {print.unit ? ` ${print.unit}` : ""} · {month(print.date)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function Tabs({ tabs }: { tabs: { id: string; label: string; body: ReactNode }[] }) {
  const [id, setId] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === id) ?? tabs[0];
  return (
    <div>
      <div className="mb-1.5 flex gap-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === current?.id}
            onClick={() => setId(tab.id)}
            className={cn(
              "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
              tab.id === current?.id ? "bg-card-3 text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current?.body}
    </div>
  );
}

function Hole({ id }: { id: (typeof UNWIRED)[number]["id"] }) {
  const row = UNWIRED.find((item) => item.id === id);
  if (!row) return null;
  return (
    <Panel title={row.title} action={<FrozenBadge title="Fixture. Not a live model." />}>
      <p className="text-caption text-muted">{row.detail}</p>
    </Panel>
  );
}

function Legs({ read, side }: { read: Read | null; side: "growth" | "inflation" }) {
  const legs = (read?.legs ?? []).filter((leg) => leg.side === side);
  if (!legs.length) return <p className="text-caption text-muted">No legs on this side yet.</p>;
  return (
    <ul>
      {legs.map((leg) => (
        <li key={leg.id} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1 text-caption last:border-b-0">
          <span>{leg.label}</span>
          <span className="font-mono text-micro">
            {leg.yoy.toFixed(1)}% <span className="text-subtle">{leg.direction}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function GrowthPage() {
  const read = useMacroRegime();
  const side = read?.growth;
  return (
    <Tabs
      tabs={[
        {
          id: "drivers",
          label: "Drivers",
          body: (
            <Panel title="Growth basket" action={<Badge tone="primary">Live</Badge>}>
              <Legs read={read} side="growth" />
            </Panel>
          ),
        },
        {
          id: "breadth",
          label: "Breadth",
          body: (
            <Panel title="Breadth" action={<Badge tone="primary">Live</Badge>}>
              <p className="text-caption">
                {side ? `${side.up} of ${side.n} accelerating. ${side.direction}.` : "No growth vote yet."} Same basket as the validated regime.
              </p>
            </Panel>
          ),
        },
        { id: "nowcast", label: "Nowcast", body: <Hole id="nowcast" /> },
        { id: "range", label: "Range", body: <Hole id="range" /> },
      ]}
    />
  );
}

export function InflationPage() {
  const read = useMacroRegime();
  const side = read?.inflation;
  return (
    <Tabs
      tabs={[
        {
          id: "level",
          label: "Level",
          body: (
            <Panel title="Inflation level" action={<Badge tone="primary">Live</Badge>}>
              <p className="text-caption">{side ? `Basket ${side.yoy.toFixed(1)}% year over year.` : "No inflation vote yet."}</p>
            </Panel>
          ),
        },
        {
          id: "direction",
          label: "Direction",
          body: (
            <Panel title="Direction" action={<Badge tone="primary">Live</Badge>}>
              <p className="text-caption">{side ? `${side.direction}. 3-month change in the rate ${side.delta.toFixed(2)} pts.` : "No inflation vote yet."}</p>
            </Panel>
          ),
        },
        {
          id: "breadth",
          label: "Breadth",
          body: (
            <Panel title="Components" action={<Badge tone="primary">Live</Badge>}>
              <Legs read={read} side="inflation" />
            </Panel>
          ),
        },
        { id: "persistence", label: "Persistence", body: <Hole id="persist" /> },
      ]}
    />
  );
}

export function RatesPage() {
  const read = useMacroRegime();
  const curve = read?.prints?.find((print) => print.id === "T10Y2Y");
  return (
    <Tabs
      tabs={[
        {
          id: "curve",
          label: "Curve",
          body: (
            <Panel title="Curve" action={<Badge tone="primary">Live</Badge>}>
              <p className="text-caption">
                {curve ? `10-year minus 2-year is ${curve.value.toFixed(2)} pp, ${month(curve.date)}.` : "No curve print yet."}{" "}
                {read?.curve ? `10-year minus 3-month bill is ${read.curve.value.toFixed(2)} pp${read.curve.inverted ? ", inverted" : ""}.` : ""}
              </p>
            </Panel>
          ),
        },
        { id: "premium", label: "Term premium", body: <Hole id="premium" /> },
      ]}
    />
  );
}

export function GlobalPage() {
  return <Hole id="global" />;
}

export function CyclePage() {
  const read = useMacroRegime();
  return (
    <Tabs
      tabs={[
        {
          id: "phase",
          label: "Phase",
          body: (
            <Panel title="Phase" action={<Badge tone="primary">Live</Badge>}>
              <p className="text-caption">
                {read?.quad != null ? `Quad ${read.quad} · ${QUAD_NAME[read.quad]}. This is the basket, not a separate cycle model.` : "No quad yet."}
              </p>
            </Panel>
          ),
        },
        {
          id: "monitors",
          label: "Monitors",
          body: (
            <Panel title="Independent monitors" action={<Badge tone="primary">Live</Badge>}>
              <ul className="flex flex-col gap-1 text-caption">
                <li>{read?.sahm ? (read.sahm.tripped ? "Sahm tripped." : `Sahm ${read.sahm.value.toFixed(2)}, ${read.sahm.gap.toFixed(2)} pp under.`) : "Sahm not in."}</li>
                <li>{read?.cfnai ? (read.cfnai.tripped ? "CFNAI tripped." : `CFNAI ${read.cfnai.value.toFixed(2)}, ${Math.abs(read.cfnai.gap).toFixed(2)} above the line.`) : "CFNAI not in."}</li>
                <li>{read?.recessionProbability ? `Chauvet–Piger ${read.recessionProbability.value.toFixed(2)}%.` : "Recession probability not in."}</li>
              </ul>
            </Panel>
          ),
        },
      ]}
    />
  );
}

export function PolicyPage() {
  const read = useMacroRegime();
  const rule = read?.policyRule;
  return (
    <Panel title="Funds versus the rule" action={<Badge tone="primary">Live</Badge>}>
      {rule ? (
        <p className="text-caption">
          Funds {rule.funds.toFixed(2)} versus {rule.rule.toFixed(2)}. {Math.abs(rule.stance).toFixed(2)} pp{" "}
          {rule.stance < 0 ? "easier" : "tighter"} than Taylor 1993. r* {rule.rStar.toFixed(2)}. Unemployment {rule.unemployment.toFixed(1)} versus{" "}
          {rule.nairu.toFixed(2)}. A comparison, not a call.
        </p>
      ) : (
        <p className="text-caption text-muted">The rule is not in yet.</p>
      )}
    </Panel>
  );
}

export function ConditionsPage() {
  const read = useMacroRegime();
  return (
    <Tabs
      tabs={[
        {
          id: "stress",
          label: "Stress",
          body: (
            <Panel title="St. Louis Fed stress" action={<Badge tone="primary">Live</Badge>}>
              <p className="text-caption">
                {read?.stress
                  ? `${read.stress.value.toFixed(2)} in ${month(read.stress.date)}. ${read.stress.aboveAverage ? "Above" : "Below"} average. Zero is average.`
                  : "Stress is not in yet."}
              </p>
            </Panel>
          ),
        },
        { id: "nfci", label: "NFCI", body: <Hole id="nfci" /> },
      ]}
    />
  );
}

export function ShocksPage() {
  const [id, setId] = useState<string>(SHOCKS[0].id);
  const shock = SHOCKS.find((row) => row.id === id) ?? SHOCKS[0];
  return (
    <Panel title="Shock" action={<FrozenBadge title="Selector only. ACE is not wired." />}>
      <label className="flex items-center gap-2 text-caption">
        <span className="text-muted">Shock</span>
        <select
          className="h-7 rounded-sm border border-border bg-card-2 px-2 text-caption"
          value={id}
          onChange={(event) => setId(event.target.value)}
        >
          {SHOCKS.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-caption text-muted">{shock.label} is not scored here. ACE still lives on the game-theory book.</p>
      <Link to="/game-theory" className="mt-1 inline-block text-micro text-primary hover:underline">
        Game theory
      </Link>
    </Panel>
  );
}
