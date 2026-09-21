import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalibrationChart, LearningChart } from "@/components/charts";
import { Badge, Panel } from "@/components/ui";
import { MODEL_STATS } from "@/data/catalog";
import { useLiveEvents } from "@/lib/live/provider";
import { cn } from "@/lib/utils";

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
