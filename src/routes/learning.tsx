import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CalibrationChart, LearningChart, ScenarioDistributionBar } from "@/components/charts";
import { Badge, Button, Panel } from "@/components/ui";
import {
  getLiveCalibration,
  getReplay,
  getScoredLedger,
  getSkillOverTime,
  runForecastResolution,
} from "@/lib/live/desk";
import { goToEvent } from "@/lib/hooks/use-event-param-sync";
import { useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

type Scored = Awaited<ReturnType<typeof getScoredLedger>>[number];
type SkillPoint = Awaited<ReturnType<typeof getSkillOverTime>>[number];
type Frame = Awaited<ReturnType<typeof getReplay>>[number];

function day(iso: string) {
  return iso.slice(0, 10);
}
function clock(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Calibration = Awaited<ReturnType<typeof getLiveCalibration>>;

function LiveCalibrationPanel({ onResolved }: { onResolved?: () => void }) {
  const [data, setData] = useState<Calibration | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  useEffect(() => {
    void getLiveCalibration().then(setData);
  }, []);

  async function runPass() {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await runForecastResolution();
      setRunResult(
        res.checked === 0
          ? "Nothing due yet — either no snapshots have passed their 72h horizon, or no XAI_API_KEY is configured."
          : `Checked ${res.checked} due snapshot${res.checked === 1 ? "" : "s"}, resolved ${res.resolved}.`,
      );
      setData(await getLiveCalibration());
      onResolved?.();
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel
      title="Live calibration (model-graded)"
      action={<Badge tone={data && data.n > 0 ? "up" : "neutral"}>{data ? `n=${data.n}` : "…"}</Badge>}
    >
      <p className="text-caption text-muted">
        Real forecasts, frozen the moment this desk actually made them, resolved later by an xAI
        judge reading headlines archived after the fact —{" "}
        <span className="text-foreground">not human-verified, not a guarantee of accuracy.</span>{" "}
        The score below is this desk&apos;s own track record against that judge, computed fresh from
        whatever has actually resolved so far.
      </p>
      {data && data.n > 0 ? (
        <>
          <div className="mt-2 text-caption">
            Brier score <span className="font-mono text-primary">{data.brier}</span>
            <span className="ml-1.5 text-tiny text-subtle">(0 = perfect · 0.25 = coin flip · 1 = always wrong)</span>
          </div>
          {data.buckets.length > 0 && (
            <table className="mt-2 w-full text-caption">
              <thead className="text-left text-micro uppercase tracking-wider text-subtle">
                <tr>
                  <th className="py-1 font-medium">Predicted</th>
                  <th className="py-1 font-medium">Observed</th>
                  <th className="py-1 font-medium">n</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map((b) => (
                  <tr key={b.bucket} className="border-t border-border/50">
                    <td className="py-1 font-mono">{b.bucket}</td>
                    <td className="py-1 font-mono">{b.observed}%</td>
                    <td className="py-1 font-mono text-muted">{b.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="mt-2 text-caption text-subtle">
          {data
            ? "No resolved forecasts yet. Snapshots freeze automatically as the live tape composes books; each one becomes eligible for resolution 72h later, and resolution itself needs an XAI_API_KEY configured."
            : "Loading…"}
        </p>
      )}
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => void runPass()} disabled={running}>
        {running ? "Checking…" : "Run resolution pass"}
      </Button>
      {runResult && <p className="mt-1.5 text-tiny text-subtle">{runResult}</p>}
    </Panel>
  );
}

export const Route = createFileRoute("/learning")({ component: LearningPage });

/**
 * Skill this desk has actually demonstrated, and nothing else.
 *
 * Every number on this page is computed from the append-only freeze ledger:
 * forecasts committed before the outcome was known, graded afterwards. There
 * is no sample data behind any of it. An empty page means the ledger is young
 * — which is the honest answer, and the reason the fixture that used to fill
 * this space has been removed rather than relabelled.
 */
function LearningPage() {
  const [scored, setScored] = useState<Scored[] | null>(null);
  const [skill, setSkill] = useState<SkillPoint[] | null>(null);
  const [calib, setCalib] = useState<Awaited<ReturnType<typeof getLiveCalibration>> | null>(null);

  const load = useCallback(() => {
    void getScoredLedger().then(setScored);
    void getSkillOverTime().then(setSkill);
    void getLiveCalibration().then(setCalib);
  }, []);
  useEffect(load, [load]);

  const series = (skill ?? []).map((d) => ({
    date: d.date,
    accuracy: d.accuracy,
    brier: Math.round((1 - d.brier) * 100),
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Calibration</h1>
          <p className="mt-0.5 text-caption text-muted">
            Computed from this desk&apos;s own frozen forecasts — no sample data.
          </p>
        </div>
        <Link to="/docs" hash="learning" className="text-micro text-primary hover:underline">
          Docs
        </Link>
      </div>

      <LiveCalibrationPanel onResolved={load} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Skill over time"
          action={
            <span className="font-mono text-micro text-muted">
              {series.length > 0 ? `${series.length} scored day${series.length === 1 ? "" : "s"}` : "no scored days yet"}
            </span>
          }
        >
          {series.length === 0 ? (
            <EmptyLedger what="A point appears for each day a frozen forecast gets resolved." />
          ) : (
            <>
              <LearningChart data={series} />
              <p className="mt-1.5 text-micro text-subtle">
                Accuracy is the share of that day&apos;s resolutions where the top-ranked scenario
                is the one that occurred. The second series is inverted Brier, so higher is better
                on both.
              </p>
            </>
          )}
        </Panel>
        <Panel
          title="Calibration (predicted vs observed)"
          action={
            <span className="font-mono text-micro text-muted">
              {calib && calib.n > 0 ? `n=${calib.n}` : "awaiting resolutions"}
            </span>
          }
        >
          {!calib || calib.buckets.length === 0 ? (
            <EmptyLedger what="Buckets fill once forecasts at a given confidence have resolved." />
          ) : (
            <>
              <CalibrationChart data={calib.buckets} />
              <p className="mt-1.5 text-micro text-subtle">
                A well-calibrated desk sits on the diagonal: things it called 70% happen about 70%
                of the time.
              </p>
            </>
          )}
        </Panel>
      </div>

      <ScoredLedgerPanel rows={scored} />
      <ReplayPanel />
    </div>
  );
}

function EmptyLedger({ what }: { what: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-caption text-muted">Nothing scored yet.</p>
      <p className="mt-1 text-micro text-subtle">{what}</p>
    </div>
  );
}

/** Every row is a real commitment, and every row drills into its book. */
function ScoredLedgerPanel({ rows }: { rows: Scored[] | null }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const setEvent = useApp((st) => st.setSelectedEventId);
  const [open, setOpen] = useState<string | null>(null);

  const hits = (rows ?? []).filter((r) => r.hit).length;
  return (
    <Panel
      title="Scored forecast ledger"
      action={
        <span className="font-mono text-micro text-muted">
          {rows === null
            ? "loading…"
            : rows.length === 0
              ? "empty"
              : `${hits}/${rows.length} top-scenario hits`}
        </span>
      }
    >
      {rows === null ? (
        <p className="py-6 text-center text-caption text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyLedger what="A forecast becomes eligible 72h after it is frozen; resolution then grades it against headlines archived after the fact." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-caption">
            <thead className="text-left text-micro uppercase tracking-wider text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium" title="Locked then. Not revised after the outcome.">Frozen</th>
                <th className="px-3 py-2 font-medium">Book</th>
                <th className="px-3 py-2 font-medium">Called</th>
                <th className="px-3 py-2 font-medium">Occurred</th>
                <th className="px-3 py-2 font-medium" title="Lower is better. 0 is perfect, 0.25 is a coin flip.">Brier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <>
                  <tr
                    key={f.snapshotId}
                    role="button"
                    tabIndex={0}
                    title="Show the judge's rationale"
                    onClick={() => setOpen((o) => (o === f.snapshotId ? null : f.snapshotId))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen((o) => (o === f.snapshotId ? null : f.snapshotId));
                      }
                    }}
                    className="cursor-pointer border-b border-border/70 hover:bg-card-2"
                  >
                    <td className="px-3 py-2 font-mono text-tiny">{clock(f.frozenAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-left text-primary hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEvent(f.eventId);
                          goToEvent(navigate, pathname, f.eventId);
                        }}
                      >
                        {f.eventTitle}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-muted">{f.topScenario}</span>{" "}
                      <span className="font-mono tabular-nums">{f.topProbability}%</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={f.hit ? "up" : "neutral"}>{f.hit ? "as called" : "other"}</Badge>{" "}
                      <span className="text-muted">{f.resolvedScenario}</span>
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{f.brier.toFixed(4)}</td>
                  </tr>
                  {open === f.snapshotId && (
                    <tr key={`${f.snapshotId}-why`} className="border-b border-border/70 bg-card-2/50">
                      <td colSpan={5} className="px-3 py-2">
                        <div className="text-micro uppercase tracking-wider text-subtle">
                          Judge rationale · {f.method}
                          {f.confidence ? ` · confidence ${f.confidence}` : ""} · resolved{" "}
                          {clock(f.resolvedAt)}
                        </div>
                        <p className="mt-1 text-caption text-muted">{f.rationale}</p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1.5 text-micro text-subtle">
        Append-only. A resolution points at the snapshot it graded; a frozen forecast is never
        rewritten once the outcome is known. Model-graded, not human-verified.
      </p>
    </Panel>
  );
}

/**
 * Real as-of replay: the forecasts this book actually froze, in order.
 *
 * It does not rebuild the book with today's information — that would peek past
 * T. It walks the append-only record of what the desk believed at each freeze,
 * which is the only replay that is honest by construction.
 */
function ReplayPanel() {
  const events = useLiveEvents();
  const selected = useApp((st) => st.selectedEventId);
  const [eventId, setEventId] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [at, setAt] = useState(0);

  const active = eventId ?? selected ?? events[0]?.id ?? null;

  useEffect(() => {
    if (!active) return;
    setFrames(null);
    void getReplay({ data: active }).then((f) => {
      setFrames(f);
      setAt(Math.max(0, f.length - 1));
    });
  }, [active]);

  const frame = frames && frames.length > 0 ? frames[Math.min(at, frames.length - 1)] : null;

  return (
    <Panel
      title="As-of replay · frozen information set"
      action={
        <span className="font-mono text-micro text-muted">
          {frames === null ? "loading…" : `${frames.length} freeze${frames.length === 1 ? "" : "s"}`}
        </span>
      }
    >
      {events.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {events.slice(0, 8).map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setEventId(e.id)}
              className={cn(
                "max-w-[14rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-micro",
                e.id === active ? "bg-primary/20 text-primary" : "bg-card-2 text-muted hover:text-foreground",
              )}
            >
              {e.title}
            </button>
          ))}
        </div>
      )}
      {frames === null ? (
        <p className="py-6 text-center text-caption text-muted">Loading…</p>
      ) : frames.length === 0 ? (
        <EmptyLedger what="A frame is written each time this book's scenario mix actually moves." />
      ) : (
        <>
          <label className="text-tiny text-muted">
            Clock position · {clock(frame!.asOf)}
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={Math.min(at, frames.length - 1)}
              onChange={(e) => setAt(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{frame!.provenance}</Badge>
            {frame!.resolved && <Badge tone="up">resolved</Badge>}
            <span className="font-mono text-micro text-subtle">
              freeze {Math.min(at, frames.length - 1) + 1} of {frames.length}
            </span>
          </div>
          <div className="mt-2">
            <ScenarioDistributionBar
              scenarios={frame!.scenarios.map((sc) => ({
                id: sc.id,
                name: sc.name,
                probability: sc.probability,
              }))}
              showSum
            />
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {frame!.scenarios.map((sc) => (
              <li key={sc.id} className="flex items-baseline justify-between gap-2 text-caption">
                <span className="truncate text-muted">
                  {sc.name}
                  {frame!.resolvedScenario === sc.id && (
                    <Badge tone="up" className="ml-1.5">
                      occurred
                    </Badge>
                  )}
                </span>
                <span className="shrink-0 font-mono tabular-nums">{sc.probability}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-micro text-subtle">
            What this desk believed at {day(frame!.asOf)}, exactly as it was frozen. Nothing here is
            recomputed with later information.
          </p>
        </>
      )}
    </Panel>
  );
}
