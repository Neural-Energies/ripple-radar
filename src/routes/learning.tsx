import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalibrationChart, LearningChart } from "@/components/charts";
import { Badge, Panel } from "@/components/ui";
import { MODEL_STATS, PIPELINE } from "@/data/catalog";
import { DAILY_LOOP } from "@/lib/engine/pipeline";
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
  const freezeDates = live?.timeline?.length ? live.timeline : s.scoredForecasts.map((f) => ({ date: f.date, title: f.event, detail: `Predicted ${(f.predicted * 100).toFixed(0)}% · outcome ${f.outcome ? "occurred" : "did not"}` }));

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Core pipeline">
        <ol className="flex flex-wrap gap-1.5">
          {PIPELINE.map((step, i) => (
            <li key={step} className="flex items-center gap-1.5">
              <span className="rounded-md bg-card-2 px-2 py-1 text-tiny text-foreground">{step}</span>
              {i < PIPELINE.length - 1 && <span className="text-subtle">→</span>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-caption text-muted">
          The engine knows how to reason about events. It does not know which events will happen. The world supplies those.
        </p>
      </Panel>

      <Panel title="Daily loop" action={<span className="text-micro text-muted">Surface only material changes</span>}>
        <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {DAILY_LOOP.map((step, i) => (
            <li key={step} className="flex gap-2 rounded-md bg-card-2 px-2 py-1.5 text-tiny">
              <span className="font-mono text-micro text-primary">{String(i + 1).padStart(2, "0")}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Accuracy vs inverted Brier">
          <LearningChart data={series} />
          <p className="mt-2 text-tiny text-muted">
            Forecast → observe → score → diagnose → recalibrate → update priors. Historical predictions
            are never rewritten after outcomes are known.
          </p>
        </Panel>
        <Panel title="Calibration (predicted vs observed)">
          <CalibrationChart data={s.calibration} />
        </Panel>
      </div>

      <Panel title="Scored forecast ledger (frozen)">
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

      <Panel title="Historical replay · information freeze">
        <p className="mb-3 text-caption text-muted">
          Freeze information at time T, generate scenarios and ranked exposures using only data available by T, then
          advance the clock. Past named episodes in the ledger are calibration cases, not the product.
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
            <div className="mt-2 font-mono text-tiny text-primary">{freezeDates[Math.min(replay, freezeDates.length - 1)]?.date}</div>
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
