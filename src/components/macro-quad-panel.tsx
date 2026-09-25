import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/ui";
import { QUAD_TINT, monthLabel, pct, signed } from "@/lib/ace/macro-format";
import {
  CURRENT_QUAD,
  DURATIONS,
  OCCUPANCY,
  POSITIONING_VALIDATED,
  QUADS,
  RECENT_STRIP,
  RETURNS_TEST,
  SELECTION,
  VOL_TEST,
  confidenceOf,
  stalenessDays,
  type Quad,
} from "@/lib/ace/macro-quads";

/**
 * The growth/inflation quad — an ENVIRONMENT LABEL, not a trade.
 *
 * The classification passed its test. Two forecasting claims built on it did
 * not: positioning lost to simply being long, and the quad added nothing to a
 * volatility forecast that already knew last month's volatility. So this panel
 * renders a label and its uncertainty, and ranks nothing.
 *
 * Four things are deliberately prominent that a quad dashboard usually hides.
 *
 *   1. THE DATA LAG. The label reads a month or two behind the tape because
 *      that is when the data publishes.
 *
 *   2. LEVEL VS DIRECTION. The framework turns on the second derivative, so it
 *      can read "Goldilocks" while growth is still negative in level.
 *
 *   3. HOW FIRM THE CALL IS. A reading whose rates of change sit a hair from
 *      zero is a coin flip that will flip — and we know how often, because the
 *      real-time labels were checked against the revised data afterwards.
 *
 *   4. WHERE THE YEAR WAS ACTUALLY SPENT. The point reading changes roughly
 *      every two months under every specification tested, so occupancy over a
 *      window is the more honest summary of the regime.
 */

/** Reading order of the 2x2: growth accelerating on top, inflation right. */
const QUAD_GRID: Quad[] = [1, 2, 4, 3];

const GRADE_TONE: Record<"firm" | "mixed" | "fragile", string> = {
  firm: "text-up",
  mixed: "text-warn",
  fragile: "text-core",
};

export function QuadGrid({ active, compact }: { active: Quad; compact?: boolean }) {
  return (
    <div
      className={`grid shrink-0 grid-cols-2 gap-px rounded-sm bg-border p-px ${
        compact ? "w-[9.5rem]" : "w-full max-w-[16rem]"
      }`}
    >
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
            {/* The colour legend for the timeline — learned here once and read
                there three dozen times. */}
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
 * Every cell is a point-in-time classification: the cell for March 2020 shows
 * what was knowable in March 2020, not what the revisions later said.
 */
export function QuadStrip({
  readings,
  labels = true,
}: {
  readings: readonly { asOf: string; quad: Quad }[];
  labels?: boolean;
}) {
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
            title={`${monthLabel(r.asOf)} — Q${r.quad} ${QUADS[r.quad]?.name}`}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-0.5 flex items-baseline justify-between text-micro text-subtle">
          <span>{monthLabel(first.asOf)}</span>
          <span>{readings.length} month-ends, each on its own vintage</span>
          <span>{monthLabel(last.asOf)}</span>
        </div>
      )}
    </div>
  );
}

export function Axis({
  label,
  yoy,
  roc,
  through,
  lookback,
}: {
  label: string;
  yoy: number | null;
  roc: number | null;
  through: string | null;
  lookback: number;
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
          title={`Rate of change: the year-on-year rate versus itself ${lookback} months ago. This is what decides the quad.`}
        >
          {accel ? "▲" : "▼"} {signed(roc)}
        </span>
      </span>
    </div>
  );
}

export function MacroQuadPanel() {
  const r = CURRENT_QUAD;
  const conf = confidenceOf(r);
  const lag = stalenessDays(r, Date.now());
  const occ = OCCUPANCY[12];
  // The module is generated; if it has not been regenerated in a while the
  // "current" reading is older than the data now available. Say so rather than
  // presenting a stale label as live.
  const readingAgeDays = Math.floor((Date.now() - Date.parse(r.asOf + "T00:00:00Z")) / 86_400_000);
  const stale = readingAgeDays > 40;
  // The whole point of a rate-of-change framework, and the thing most likely to
  // be misread: direction and level can disagree.
  const disagrees =
    (r.growthYoy != null && r.growthRoc != null && r.growthYoy < 0 && r.growthRoc >= 0) ||
    (r.inflationYoy != null && r.inflationRoc != null && r.inflationYoy > 0 && r.inflationRoc < 0);

  // A SUMMARY, laid out as a full-width band rather than a tile in the
  // event-analysis column. It lived there first, and that column is stretched
  // to the map's height with `overflow-hidden` on every panel, so the last
  // paragraph was silently clipped — the paragraph saying the quad does not
  // position, which is the one line that must never be the one that gets cut.
  // A band also matches what this is: macro backdrop, the same whichever event
  // is on the desk, unlike everything else in that column.
  return (
    <Panel
      title="Macro regime"
      action={
        <Link to="/macro" className="font-mono text-micro text-primary hover:underline">
          {SELECTION.chosen} · detail
        </Link>
      }
    >
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex items-start gap-2.5">
          <QuadGrid active={r.quad} compact />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-body text-foreground">Q{r.quad}</span>
              <span className="truncate text-caption text-foreground">{r.name}</span>
            </div>
            <Axis
              label="Growth"
              yoy={r.growthYoy}
              roc={r.growthRoc}
              through={r.growthThrough}
              lookback={SELECTION.lookback}
            />
            <Axis
              label="Inflation"
              yoy={r.inflationYoy}
              roc={r.inflationRoc}
              through={r.inflationThrough}
              lookback={SELECTION.lookback}
            />
            <p className="text-micro text-subtle">
              Through {monthLabel(r.growthThrough)}
              {lag != null ? `, ${lag}d behind` : ""} — the publication calendar, not a modelling
              choice.
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          {/* Two measured quantities, one line. Both spelled out on /macro. */}
          <p className="text-micro text-subtle">
            <span className={GRADE_TONE[conf.grade]}>
              {conf.grade === "firm" ? "Firm" : conf.grade === "mixed" ? "Mixed" : "Fragile"} call
            </span>
            {conf.marginBin ? (
              <>
                {" "}
                — margin {r.margin?.toFixed(2)} is {conf.marginBin}
                {conf.marginUsable && conf.marginSurvival != null
                  ? `, and readings this close survived revision ${pct(conf.marginSurvival)} of the time`
                  : ", and too few past readings sat this close to quote a rate"}
              </>
            ) : null}
            . {conf.specAgreeing}/{conf.specTotal} ways of measuring it agree.
          </p>
          <QuadStrip readings={RECENT_STRIP} labels={false} />
          {disagrees && (
            <p className="text-micro text-warn">
              Level and direction disagree — growth is {signed(r.growthYoy)}% year-on-year but
              rising. &ldquo;{r.name}&rdquo; names the change, not the level.
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          {occ && occ.dominant != null && (
            <p className="text-micro text-subtle">
              Last {occ.months} months:{" "}
              <span className="text-muted">
                {occ.tied
                  ? [occ.dominant, ...occ.tiedWith].map((q) => `Q${q}`).join("/") + " tied"
                  : `Q${occ.dominant} ${QUADS[occ.dominant]?.name}`}
              </span>{" "}
              {pct(occ.dominantShare)}, {occ.switches} {occ.switches === 1 ? "switch" : "switches"}.
              The label turns over about every {DURATIONS.pooled.medianMonths} months, so the window
              is the steadier read.
            </p>
          )}

          {stale && (
            <p className="text-micro text-warn">
              Generated {readingAgeDays} days ago; newer vintages have published since. Rerun{" "}
              <span className="font-mono">npm run quads:generate</span>.
            </p>
          )}

          {!POSITIONING_VALIDATED && (
            <p className="text-micro text-subtle">
              <span className="text-muted">
                Labels the environment; does not position or size risk.
              </span>{" "}
              {RETURNS_TEST.channelsBeatingBaseline.length}/{RETURNS_TEST.channelsTested.length}{" "}
              channels beat always-long, {VOL_TEST.channelsBeatingBaseline.length}/
              {VOL_TEST.channelsTested.length} beat a vol forecast that knows last month&rsquo;s
              vol.{" "}
              <Link to="/macro" className="text-primary hover:underline">
                Both tests
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
