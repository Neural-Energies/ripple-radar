import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalibrationChart, LearningChart } from "@/components/charts";
import { Badge, Button, Panel } from "@/components/ui";
import { MODEL_STATS } from "@/data/catalog";
import { getLiveCalibration, runForecastResolution } from "@/lib/live/desk";
import { useLiveEvents } from "@/lib/live/provider";
import { cn } from "@/lib/utils";

type Calibration = Awaited<ReturnType<typeof getLiveCalibration>>;

function LiveCalibrationPanel() {
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

function LearningPage() {
  const s = MODEL_STATS;
  const series = useMemo(
    () => s.series.map((d) => ({ date: d.date, accuracy: d.accuracy, brier: Math.round((1 - d.brier) * 100) })),
    [s.series],
  );
  const [replay, setReplay] = useState(2);
  const live = useLiveEvents()[0];
  const freezeDates = live?.timeline?.length
    ? live.timeline
    : s.scoredForecasts.map((f) => ({
        date: f.date,
        title: f.event,
        detail: `Predicted ${(f.predicted * 100).toFixed(0)}% · outcome ${f.outcome ? "occurred" : "did not"}`,
      }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Calibration</h1>
          <p className="mt-0.5 text-caption text-muted">
            Frozen class-level fixture — not this desk&apos;s live Brier or skill.
          </p>
        </div>
        <Link to="/docs" hash="learning" className="text-micro text-primary hover:underline">
          Docs
        </Link>
      </div>

      <LiveCalibrationPanel />

      <div
        role="status"
        className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2.5 text-caption text-foreground"
      >
        <span className="font-medium text-warn">Fixture only.</span>{" "}
        <code className="font-mono text-tiny text-muted">MODEL_STATS</code> is a frozen class-level
        calibration sample shipped with the app. Charts and the scored ledger below are{" "}
        <span className="text-foreground">not</span> live accuracy, Brier, or lead-time for the
        current tape or selected book. Do not treat them as desk performance.
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Accuracy vs inverted Brier"
          action={<Badge tone="warn">frozen fixture</Badge>}
        >
          <LearningChart data={series} />
        </Panel>
        <Panel
          title="Calibration (predicted vs observed)"
          action={<Badge tone="warn">frozen fixture</Badge>}
        >
          <CalibrationChart data={s.calibration} />
        </Panel>
      </div>

      <Panel
        title="Scored forecast ledger (frozen)"
        action={<Badge tone="warn">not live skill</Badge>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-caption">
            <thead className="text-left text-micro uppercase tracking-wider text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">Date T</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Predicted</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Brier</th>
              </tr>
            </thead>
            <tbody>
              {s.scoredForecasts.map((f) => (
                <tr key={f.id} className="border-b border-border/70">
                  <td className="px-3 py-2 font-mono text-tiny">{f.date}</td>
                  <td className="px-3 py-2">{f.event}</td>
                  <td className="px-3 py-2 font-mono">{(f.predicted * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">
                    <Badge tone={f.outcome ? "up" : "neutral"}>{f.outcome ? "occurred" : "did not"}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono">{f.brier.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Historical replay · information freeze (UX sketch)">
        <p className="mb-2 text-tiny text-subtle">
          Slider walks a timeline for illustration. It does not recompute the book as-of that date.
          When the lead book has no timeline, the frozen scored-forecast list is shown instead.
        </p>
        {freezeDates.length === 0 ? (
          <p className="text-caption text-muted">No timeline on the lead book yet.</p>
        ) : (
          <>
            <label className="text-tiny text-muted">
              Clock position
              <input
                type="range"
                min={0}
                max={Math.max(0, freezeDates.length - 1)}
                value={Math.min(replay, freezeDates.length - 1)}
                onChange={(e) => setReplay(Number(e.target.value))}
                className="mt-2 w-full accent-primary"
              />
            </label>
            <div className="mt-2 font-mono text-tiny text-primary">
              {freezeDates[Math.min(replay, freezeDates.length - 1)]?.date}
            </div>
            <ol className="mt-2 flex flex-col gap-2">
              {freezeDates.map((t, i) => (
                <li
                  key={t.date + t.title}
                  className={cn(
                    "rounded-md px-3 py-2 text-caption",
                    i <= replay ? "bg-card-2 text-foreground" : "text-subtle",
                  )}
                >
                  <span className="font-mono text-tiny text-primary">{t.date}</span> · {t.title}
                  {i <= replay && <p className="mt-0.5 text-tiny text-muted">{t.detail}</p>}
                </li>
              ))}
            </ol>
          </>
        )}
      </Panel>
    </div>
  );
}
