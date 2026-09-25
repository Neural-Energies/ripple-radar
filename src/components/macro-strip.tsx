import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/ui";
import { getMacroRegime } from "@/lib/live/desk";
import { quadTrack } from "@/lib/live/macro-monitors";
import { QUAD_NAME, regimeFlips, type Quad } from "@/lib/live/macro-regime";

type Read = Awaited<ReturnType<typeof getMacroRegime>>;

const PATTERN: Record<Quad, string> = {
  1: "Equities and credit usually lead. Long duration usually does not.",
  2: "Commodities and cyclicals usually lead. Long duration usually does not.",
  3: "Real assets usually hold up. Credit usually does not.",
  4: "Duration and defensives usually lead. Cyclicals usually do not.",
};

function monthLabel(date: string) {
  const [y, m] = date.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const n = Number(m);
  if (!y || n < 1 || n > 12) return date;
  return `${names[n - 1]} ${y}`;
}

function pts(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

export function useMacroRegime() {
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () => {
      void getMacroRegime()
        .then((row) => {
          if (!dead) setRead(row);
        })
        .catch(() => {
          if (!dead) setRead({ status: "unavailable", detail: "FRED did not answer." });
        });
    };
    load();
    const id = window.setInterval(load, 30 * 60 * 1000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);
  return read;
}

function pp(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function FlipPanel({ read }: { read: Read }) {
  if (read.quad == null) return null;
  const flips = regimeFlips(read.legs ?? []);
  return (
    <Panel title="What flips it">
      {flips.length === 0 ? (
        <p className="text-caption text-muted">No single side of the basket can change the quad.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {flips.map((flip) => (
            <li key={flip.side} className="text-caption">
              <span className="font-medium text-foreground">
                Quad {flip.to} · {QUAD_NAME[flip.to]}.
              </span>{" "}
              {flip.legs.map((leg) => `${leg.label} (${leg.distance.toFixed(1)} pts)`).join(", ")}{" "}
              {flip.legs.length === 1 ? "crosses zero. One leg does it." : "all have to cross zero. One leg does not."}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function scanLine(read: Read) {
  const parts = [
    read.sahm ? (read.sahm.tripped ? "Sahm tripped." : "Sahm clear.") : null,
    read.cfnai ? (read.cfnai.tripped ? "CFNAI contraction." : "CFNAI clear.") : null,
    read.stress ? (read.stress.aboveAverage ? "Stress above average." : "Stress below average.") : null,
    read.policyRule
      ? Math.abs(read.policyRule.stance) < 0.05
        ? "Funds on the rule."
        : `Funds ${Math.abs(read.policyRule.stance).toFixed(1)} pp ${read.policyRule.stance < 0 ? "under" : "over"} the rule.`
      : null,
  ].filter((part): part is string => part != null);
  return parts.join(" ");
}

function QuadTrack({ path }: { path: NonNullable<Read["path"]> }) {
  const track = quadTrack(path);
  if (!track) return null;
  const changes = track.changes.slice(-4);
  return (
    <Panel title="Quad track">
      <p className="text-caption text-foreground">
        Quad {track.quad} since {monthLabel(track.since)} ({track.months === 1 ? "1 month" : `${track.months} months`}).
      </p>
      <ol className="mt-2 flex flex-wrap gap-1">
        {path.slice(-24).map((row) => (
          <li key={row.date} className="rounded-sm bg-card-2 px-1.5 py-1 text-micro">
            <span className="text-subtle">{monthLabel(row.date)} </span>
            <span className="font-mono text-foreground">Q{row.quad}</span>
          </li>
        ))}
      </ol>
      {changes.length ? (
        <ul className="mt-1">
          {changes.map((change) => (
            <li key={change.date} className="text-micro text-muted">
              {monthLabel(change.date)} Q{change.from} → Q{change.to}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-micro text-muted">No quad change in this window.</p>
      )}
    </Panel>
  );
}

function RecessionPanel({ read }: { read: Read }) {
  if (!read.sahm && !read.cfnai && !read.recessionProbability) return null;
  const trip = read.sahm?.lastTrip;
  return (
    <Panel title="Recession">
      {read.sahm ? (
        <p className="text-caption">
          <span className="font-medium text-foreground">Sahm {pp(read.sahm.value)}</span>
          <span className="text-subtle"> · {monthLabel(read.sahm.date)}</span>
          {". "}
          {read.sahm.tripped
            ? `${Math.abs(read.sahm.gap).toFixed(2)} pp over 0.50. Tripped.`
            : `${read.sahm.gap.toFixed(2)} pp under 0.50. Not tripped.`}
          {trip
            ? ` Last trip ${monthLabel(trip.start)}–${monthLabel(trip.end)}, peak ${trip.peak.toFixed(2)}. NBER flag ${trip.nber ? "was 1." : "stayed 0."}`
            : ""}
        </p>
      ) : null}
      {read.cfnai ? (
        <p className="mt-1 text-caption">
          <span className="font-medium text-foreground">CFNAI-MA3 {pp(read.cfnai.value)}</span>
          <span className="text-subtle"> · {monthLabel(read.cfnai.date)}</span>
          {". "}
          {read.cfnai.tripped
            ? "At or below −0.70. Contraction signal."
            : `${read.cfnai.gap.toFixed(2)} above −0.70. Not a contraction signal.`}
        </p>
      ) : null}
      {read.recessionProbability ? (
        <p className="mt-1 text-caption">
          <span className="font-medium text-foreground">
            Recession probability {read.recessionProbability.value.toFixed(2)}%
          </span>
          <span className="text-subtle"> · {monthLabel(read.recessionProbability.date)}</span>
          {". Chauvet–Piger. No tripwire on this series."}
        </p>
      ) : null}
      <p className="mt-1 text-micro text-muted">These date the economy. They do not date a trade.</p>
    </Panel>
  );
}

function VolPanel({ vol }: { vol: Read["vol"] }) {
  if (!vol) return null;
  return (
    <Panel title="Vol" action={<span className="font-mono text-micro text-subtle">{monthLabel(vol.date)}</span>}>
      <p className="text-caption">
        <span className="font-medium text-foreground">
          VIX {vol.vix.toFixed(2)} versus 3-month {vol.vix3m.toFixed(2)}.
        </span>{" "}
        {vol.term === "contango" ? "Contango" : "Backwardation"}, {(vol.slope * 100).toFixed(1)}%.{" "}
        {vol.percentile.toFixed(0)}% of daily prints since {vol.since.slice(0, 4)} were lower.
      </p>
      <p className="mt-1 text-caption">
        Realized {vol.rv21.toFixed(1)}% over 21 days versus {vol.rv252.toFixed(1)}% over a year.{" "}
        {vol.realized === "expanding" ? "Expanding." : "Compressing."} VIX is {Math.abs(vol.premium).toFixed(1)} points{" "}
        {vol.premium >= 0 ? "above" : "below"} that 21-day realized
        {vol.spxDate !== vol.date ? ` (S&P through ${monthLabel(vol.spxDate)})` : ""}.
      </p>
      <p className="mt-1 text-micro text-muted">
        Spot against the 3-month index, not the futures curve. Close-to-close realized vol. Not a Markov-switching probability.
      </p>
    </Panel>
  );
}

export function VolStrip() {
  const read = useMacroRegime();
  return <VolPanel vol={read?.vol} />;
}

function ModelsPanel({ read }: { read: Read }) {
  const rule = read.policyRule;
  const conflict = read.conflict;
  if (!rule && !conflict) return null;
  const rates =
    conflict == null
      ? ""
      : conflict.wageDelta > 0 && conflict.priceDelta > 0
        ? " Both rates are accelerating."
        : conflict.wageDelta < 0 && conflict.priceDelta < 0
          ? " Both rates are slowing."
          : " The two rates are split.";
  return (
    <Panel title="Models">
      {rule ? (
        <p className="text-caption">
          <span className="font-medium text-foreground">3-equation rule</span>
          <span className="text-subtle"> · {monthLabel(rule.date)}</span>
          {`. Funds ${rule.funds.toFixed(2)} versus ${rule.rule.toFixed(2)}. `}
          {Math.abs(rule.stance) < 0.05
            ? "On the rule."
            : `${Math.abs(rule.stance).toFixed(2)} pp ${rule.stance < 0 ? "easier" : "tighter"} than the rule.`}
          {` r* ${rule.rStar.toFixed(2)} (Holston–Laubach–Williams, ${monthLabel(rule.rStarDate)}). Unemployment ${rule.unemployment.toFixed(1)} versus CBO natural rate ${rule.nairu.toFixed(2)}. Core PCE ${rule.inflation.toFixed(1)}%.`}
        </p>
      ) : null}
      {conflict ? (
        <p className="mt-1 text-caption">
          <span className="font-medium text-foreground">Conflict</span>
          <span className="text-subtle"> · {monthLabel(conflict.date)}</span>
          {`. Wages ${conflict.wageYoy.toFixed(1)}% versus CPI ${conflict.priceYoy.toFixed(1)}%. `}
          {conflict.real >= 0 ? "Wages are outrunning prices." : "Prices are outrunning wages."}
          {rates}
        </p>
      ) : null}
      <p className="mt-1 text-micro text-muted">
        Taylor 1993. The output gap is twice the unemployment gap. The other models on macrosimulation.org are textbook
        simulators with fixed parameters. They are not scored on this book.
      </p>
    </Panel>
  );
}

function StressPanel({ read }: { read: Read }) {
  if (!read.stress && !read.curve) return null;
  return (
    <Panel title="Pullback">
      {read.stress ? (
        <p className="text-caption">
          <span className="font-medium text-foreground">Financial stress {pp(read.stress.value)}</span>
          <span className="text-subtle"> · {monthLabel(read.stress.date)}</span>
          {". "}
          {read.stress.aboveAverage ? "Above average." : "Below average."} Zero is average on the St. Louis Fed index.
        </p>
      ) : null}
      {read.curve ? (
        <p className="mt-1 text-caption">
          <span className="font-medium text-foreground">10y–3m {pp(read.curve.value)}</span>
          <span className="text-subtle"> · {monthLabel(read.curve.date)}</span>
          {". "}
          {read.curve.inverted
            ? "Inverted."
            : `Not inverted.${read.curve.lastNegative ? ` Last negative print ${monthLabel(read.curve.lastNegative)}.` : ""}`}{" "}
          A slow lead, not a nowcast.
        </p>
      ) : null}
    </Panel>
  );
}

function LegList({ legs }: { legs: NonNullable<Read["legs"]> }) {
  if (!legs.length) return <p className="text-micro text-muted">No legs on this month.</p>;
  return (
    <ul>
      {legs.map((leg) => (
        <li key={leg.id} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1 last:border-b-0">
          <span className="text-caption">{leg.label}</span>
          <span className="font-mono text-micro tabular-nums text-muted">
            {leg.level.toFixed(leg.level >= 100 ? 0 : 2)} · {leg.yoy.toFixed(1)}% {pts(leg.delta)} · {leg.direction}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MacroStrip() {
  const read = useMacroRegime();
  if (!read) {
    return (
      <Panel title="Macro">
        <p className="text-caption text-muted">Reading FRED…</p>
      </Panel>
    );
  }
  if (read.status !== "ok" || read.quad == null || !read.growth || !read.inflation) {
    return (
      <Panel title="Macro">
        <p className="text-caption text-muted">{read.detail}</p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Macro"
      action={
        <Link to="/macro" className="text-micro text-primary hover:underline">
          Regime
        </Link>
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-lg font-semibold tabular-nums text-primary">Quad {read.quad}</div>
          <div className="text-caption">{read.name}</div>
        </div>
        <p className="max-w-xl text-micro text-muted">
          Growth {read.growth.up}/{read.growth.n} accelerating. Inflation {read.inflation.up}/{read.inflation.n}{" "}
          accelerating. {monthLabel(read.date ?? "")}. {scanLine(read)}
        </p>
      </div>
    </Panel>
  );
}

export function MacroPageBody({ read }: { read: Read | null }) {
  if (!read) return <p className="text-caption text-muted">Reading FRED…</p>;
  if (read.status !== "ok" || read.quad == null || !read.growth || !read.inflation) {
    return <p className="text-caption text-muted">{read.detail}</p>;
  }
  const current = read.quad;
  return (
    <div className="flex flex-col gap-1.5">
      <Panel title={`Quad ${current} · ${QUAD_NAME[current]}`} action={<span className="font-mono text-micro text-subtle">{monthLabel(read.date ?? "")}</span>}>
        <p className="text-caption text-foreground">
          Growth is {read.growth.direction} ({read.growth.up} of {read.growth.n} legs). Inflation is{" "}
          {read.inflation.direction} ({read.inflation.up} of {read.inflation.n} legs).
        </p>
        <p className="mt-1 text-micro text-muted">{PATTERN[current]} Usual pattern. Not an order.</p>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {([1, 2, 4, 3] as Quad[]).map((q) => (
            <div
              key={q}
              className={
                q === current
                  ? "rounded-sm border border-primary bg-primary/10 px-2 py-1.5"
                  : "rounded-sm border border-border bg-card-2 px-2 py-1.5"
              }
            >
              <div className="font-mono text-micro text-subtle">Quad {q}</div>
              <div className="text-caption">{QUAD_NAME[q]}</div>
            </div>
          ))}
        </div>
      </Panel>
      <FlipPanel read={read} />
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <Panel title={`Growth · ${read.growth.up}/${read.growth.n}`}>
          <LegList legs={read.legs?.filter((leg) => leg.side === "growth") ?? []} />
        </Panel>
        <Panel title={`Inflation · ${read.inflation.up}/${read.inflation.n}`}>
          <LegList legs={read.legs?.filter((leg) => leg.side === "inflation") ?? []} />
        </Panel>
      </div>
      {read.path && read.path.length > 1 ? <QuadTrack path={read.path} /> : null}
      <RecessionPanel read={read} />
      <ModelsPanel read={read} />
      <VolPanel vol={read.vol} />
      <StressPanel read={read} />
      {read.prints?.length ? (
        <Panel title="Policy" padded={false}>
          <ul>
            {read.prints.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-2 border-b border-border/60 px-2 py-1 last:border-b-0">
                <span className="text-caption">{p.label}</span>
                <span className="font-mono text-caption tabular-nums">
                  {p.value.toFixed(p.id === "VIXCLS" || p.id === "UNRATE" || p.id === "DGS10" || p.id === "T10Y2Y" ? 2 : 1)}
                  {p.unit ? ` ${p.unit}` : ""}
                  <span className="ml-2 text-micro text-subtle">{monthLabel(p.date)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <p className="text-micro text-subtle">{read.detail}</p>
    </div>
  );
}
