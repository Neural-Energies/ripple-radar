import { Panel } from "@/components/ui";
import {
  CURRENT_QUAD,
  POSITIONING_VALIDATED,
  QUADS,
  QUAD_HISTORY,
  QUAD_RUN,
  likelyNextQuads,
  stalenessDays,
  type Quad,
  type QuadReading,
} from "@/lib/ace/macro-quads";

/**
 * The growth/inflation quad — an ENVIRONMENT LABEL, not a trade.
 *
 * The classification passed its test: 320 month-ends built from ALFRED
 * first-release vintages, each using only what had been published by its own
 * date. The positioning claim failed its test: zero of six channels beat
 * simply being long the same asset out of sample. This panel renders the first
 * and states the second, and `POSITIONING_VALIDATED` — written by the
 * generator, not by hand — is what keeps the second from becoming a feature.
 *
 * Two things are deliberately prominent that a quad dashboard usually hides:
 *
 *   1. THE DATA LAG. The label reads two months behind the tape because that
 *      is when the data publishes. A regime panel that implies it knows the
 *      current month is claiming a nowcast nobody has.
 *
 *   2. LEVEL VS DIRECTION. The framework turns on the second derivative, so
 *      it can read "Goldilocks" while growth is still negative in level. That
 *      is not a bug and it is not a bullish call; it is what the word means
 *      here, and the panel says so whenever the two disagree.
 */

/** Reading order of the 2x2: growth accelerating on top, inflation right. */
const QUAD_GRID: Quad[] = [1, 2, 4, 3];

/**
 * One colour per quad, reused by the grid and the timeline so a reader learns
 * the mapping once. Deliberately not a red/green good/bad scale: no quad is
 * good or bad here, and the positioning test is exactly what failed.
 */
const QUAD_TINT: Record<Quad, string> = {
  1: "bg-up/60",
  2: "bg-primary/60",
  3: "bg-warn/60",
  4: "bg-core/60",
};

const signed = (n: number | null, digits = 2) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

const monthLabel = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

function QuadGrid({ active }: { active: Quad }) {
  return (
    <div className="grid w-[9.5rem] shrink-0 grid-cols-2 gap-px rounded-sm bg-border p-px">
      {QUAD_GRID.map((quad) => {
        const on = quad === active;
        return (
          <div
            key={quad}
            className={
              on
                ? "flex flex-col items-center justify-center bg-primary/15 px-1 py-1.5 text-center"
                : "flex flex-col items-center justify-center bg-card px-1 py-1.5 text-center"
            }
            title={QUADS[quad]?.description}
          >
            {/* The colour legend for the timeline below — the mapping is
                learned here once and read there sixty times. */}
            <span className={`mb-0.5 h-0.5 w-4 rounded-full ${QUAD_TINT[quad]}`} />
            <span
              className={
                on ? "font-mono text-caption text-primary" : "font-mono text-caption text-subtle"
              }
            >
              Q{quad}
            </span>
            <span className={on ? "text-micro text-foreground" : "text-micro text-subtle"}>
              {QUADS[quad]?.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The regime as it actually moved, one cell per month-end.
 *
 * This is the history the module already carries, rendered rather than
 * summarised — a count in a sentence would not have earned the bytes. Every
 * cell is a point-in-time classification: the cell for March 2020 shows what
 * was knowable in March 2020, not what the revisions later said.
 */
function QuadStrip({ readings }: { readings: readonly QuadReading[] }) {
  if (readings.length < 2) return null;
  const first = readings[0]!;
  const last = readings[readings.length - 1]!;
  return (
    <div className="mt-1.5">
      <div className="flex h-3 w-full gap-px overflow-hidden rounded-sm">
        {readings.map((r) => (
          <span
            key={r.asOf}
            className={`min-w-0 flex-1 ${QUAD_TINT[r.quad]}`}
            title={`${monthLabel(r.asOf)} — Q${r.quad} ${r.name} (read through ${monthLabel(
              r.growthThrough,
            )})`}
          />
        ))}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between text-micro text-subtle">
        <span>{monthLabel(first.asOf)}</span>
        <span>{readings.length} month-ends, each classified on its own vintage</span>
        <span>{monthLabel(last.asOf)}</span>
      </div>
    </div>
  );
}

function Axis({
  label,
  yoy,
  roc,
  through,
}: {
  label: string;
  yoy: number | null;
  roc: number | null;
  through: string | null;
}) {
  const accel = roc != null && roc >= 0;
  return (
    <div className="flex items-baseline justify-between gap-2 text-caption">
      <span className="text-muted">{label}</span>
      <span className="flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-subtle" title={`Year-on-year level, through ${monthLabel(through)}`}>
          {signed(yoy)}%
        </span>
        <span
          className={accel ? "text-up" : "text-down"}
          title={`Rate of change: the year-on-year rate versus itself ${QUAD_RUN.rocLookbackMonths} months ago`}
        >
          {accel ? "▲" : "▼"} {signed(roc)}
        </span>
      </span>
    </div>
  );
}

export function MacroQuadPanel() {
  const r = CURRENT_QUAD;
  const next = likelyNextQuads(r.quad).slice(0, 2);
  const lag = stalenessDays(r, Date.now());
  // The module is generated; if it has not been regenerated in a while, the
  // "current" reading is older than the data now available. Say so rather than
  // presenting a stale label as live.
  const readingAgeDays = Math.floor((Date.now() - Date.parse(r.asOf + "T00:00:00Z")) / 86_400_000);
  const stale = readingAgeDays > 40;
  // The whole point of a rate-of-change framework, and the thing most likely
  // to be misread: direction and level can disagree.
  const growthDisagrees =
    r.growthYoy != null && r.growthRoc != null && r.growthYoy < 0 && r.growthRoc >= 0;
  const inflationDisagrees =
    r.inflationYoy != null && r.inflationRoc != null && r.inflationYoy > 0 && r.inflationRoc < 0;

  return (
    <Panel
      title="Macro regime"
      action={
        <span
          className="font-mono text-micro text-subtle"
          title={`${QUAD_RUN.nClassified} month-ends classified, ${QUAD_RUN.first} to ${QUAD_RUN.last}`}
        >
          point-in-time · {QUAD_RUN.nClassified} months
        </span>
      }
    >
      <div className="flex items-start gap-2.5">
        <QuadGrid active={r.quad} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-body text-foreground">Q{r.quad}</span>
            <span className="truncate text-caption text-foreground">{r.name}</span>
          </div>
          <Axis label="Growth" yoy={r.growthYoy} roc={r.growthRoc} through={r.growthThrough} />
          <Axis
            label="Inflation"
            yoy={r.inflationYoy}
            roc={r.inflationRoc}
            through={r.inflationThrough}
          />
          <p className="text-micro text-subtle">
            Reads through {monthLabel(r.growthThrough)}
            {lag != null ? ` — ${lag} days behind` : ""}. That lag is the publication calendar, not
            a modelling choice: industrial production and CPI land ~
            {Math.round(QUAD_RUN.medianDataLagDays ?? 0)} days after the month they describe.
          </p>
        </div>
      </div>

      <QuadStrip readings={QUAD_HISTORY} />

      {(growthDisagrees || inflationDisagrees) && (
        <p className="mt-1.5 text-micro text-warn">
          Direction and level disagree.{" "}
          {growthDisagrees
            ? `Growth is still ${signed(r.growthYoy)}% year-on-year but less negative than a quarter ago. `
            : ""}
          {inflationDisagrees
            ? `Inflation is still ${signed(r.inflationYoy)}% year-on-year but decelerating. `
            : ""}
          The quad reads the second derivative, so "{r.name}" describes the change, not the level.
        </p>
      )}

      {stale && (
        <p className="mt-1.5 text-micro text-warn">
          This reading was generated {readingAgeDays} days ago. Newer vintages have published since
          — rerun <span className="font-mono">ace/macro/export_quads.py</span> before treating it as
          current.
        </p>
      )}

      {next.length > 0 && (
        <p className="mt-1.5 text-micro text-subtle">
          When the regime has changed out of Q{r.quad}, it went to{" "}
          {next.map((n, i) => (
            <span key={n.quad}>
              {i > 0 ? " then " : ""}
              <span className="text-muted">
                Q{n.quad} {QUADS[n.quad]?.name}
              </span>{" "}
              {Math.round(n.p * 100)}%
            </span>
          ))}
          . Descriptive — how it has moved across {QUAD_RUN.nClassified} classified months, not a
          forecast of where it goes next.
        </p>
      )}

      {!POSITIONING_VALIDATED && (
        <p className="mt-1.5 text-micro text-subtle">
          <span className="text-muted">This labels the environment. It does not position.</span>{" "}
          Tested against always being long the same asset over a sealed holdout:{" "}
          {QUAD_RUN.validation.channelsBeatingLongOnly.length}/
          {QUAD_RUN.validation.channelsTested.length} channels beat that baseline, and{" "}
          {QUAD_RUN.validation.signsHeld}/{QUAD_RUN.validation.usableCells} quad cells kept their
          sign out of sample — a coin flip. So no asset ranking is shown here. The classification is
          real; the trade it is usually sold with is not.
        </p>
      )}
    </Panel>
  );
}
