import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SCENARIO_COLORS, ScenarioDistributionBar } from "@/components/charts";
import { ResearchHeader } from "@/components/research-header";
import { Button, Delta, Input, Panel } from "@/components/ui";
import { validateEventSearch } from "@/lib/hooks/use-event-param-sync";
import { useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/scenarios")({
  validateSearch: validateEventSearch,
  component: ScenariosPage,
});

function ScenariosPage() {
  const eventId = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(eventId);
  const extras = useApp((s) => s.customScenarios).filter((s) => s.eventId === event.id);
  const add = useApp((s) => s.addScenario);
  const all = [...event.scenarios, ...extras];
  const sum = all.reduce((a, s) => a + s.probability, 0);

  const [name, setName] = useState("");
  const [prob, setProb] = useState(10);
  const [range, setRange] = useState("");
  const [outcomes, setOutcomes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    add({
      id: "c-" + Date.now().toString(36),
      eventId: event.id,
      custom: true,
      name: name.trim(),
      detail: "desk scenario",
      probability: prob,
      prevProbability: prob,
      range: range || "n/a",
      keyOutcomes: outcomes || "—",
      audit: {
        previous: prob,
        updated: prob,
        evidence: "Desk-entered scenario. Not a calibrated model output.",
        direction: "up",
        weight: 0,
        affectedNodes: [],
        rescoredAssets: [],
      },
    });
    setName("");
    setRange("");
    setOutcomes("");
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <ResearchHeader subtitle="Scenarios" />
      <Panel
        title="Scenario mix"
        action={
          <span className="font-mono text-micro text-muted">
            Σ {sum}%{sum === 100 ? " · family mass" : " · not exhaustive"}
          </span>
        }
      >
        <ScenarioDistributionBar scenarios={all} legend={false} showSum />
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {all.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5 text-caption">
              <i
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}
              />
              <span className="truncate text-muted">{s.name}</span>
              <span className="font-mono tabular-nums">{s.probability}%</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="Probability bands"
        action={<span className="font-mono text-micro text-subtle">reserved</span>}
      >
        <div className="grid grid-cols-3 gap-1.5">
          {(["p10", "p50", "p90"] as const).map((band) => (
            <div
              key={band}
              className="rounded-sm border border-dashed border-border/80 bg-card-2/40 px-2 py-2 text-center"
            >
              <div className="font-mono text-micro uppercase tracking-wider text-subtle">{band}</div>
              <div className="mt-1 font-mono text-lg tabular-nums text-subtle/60">—</div>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-micro text-subtle">
          Empty until FinEng ships scenario bands. Not painted as fake fans or path envelopes.
        </p>
      </Panel>
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,1fr)_16.5rem]">
        <Panel title="Scenario book" padded={false}>
          {all.length === 0 ? (
            <p className="px-2 py-6 text-center text-caption text-muted">No scenarios on this book.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 p-1.5 sm:grid-cols-2">
              {all.map((s, i) => {
                const color = SCENARIO_COLORS[i % SCENARIO_COLORS.length];
                const delta = s.probability - s.prevProbability;
                return (
                  <li
                    key={s.id}
                    className="rounded-md bg-card-2 px-2.5 py-2"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-caption font-medium leading-snug">{s.name}</div>
                        <div className="text-micro text-subtle line-clamp-2">{s.detail}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-lg font-semibold tabular-nums leading-none">{s.probability}%</div>
                        {delta !== 0 ? (
                          <Delta n={delta} digits={0} />
                        ) : (
                          <div className="font-mono text-micro text-subtle">prev {s.prevProbability}%</div>
                        )}
                      </div>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-card-3">
                      <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, s.probability))}%`, background: color }} />
                    </div>
                    <div className="mt-1.5 grid gap-0.5 text-micro text-muted">
                      <div>Range: {s.range}</div>
                      <div className="line-clamp-2">{s.keyOutcomes}</div>
                    </div>
                    {s.audit.evidence ? (
                      <p className="mt-1 text-micro text-subtle line-clamp-2">{s.audit.evidence}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="New scenario">
          <form onSubmit={submit} className="flex flex-col gap-1.5">
            <label className="text-tiny text-muted">
              Name
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="text-tiny text-muted">
              Probability {prob}%
              <input
                type="range"
                min={1}
                max={80}
                value={prob}
                onChange={(e) => setProb(Number(e.target.value))}
                className="mt-1.5 w-full accent-primary"
              />
            </label>
            <label className="text-tiny text-muted">
              Range / price path
              <Input className="mt-1" value={range} onChange={(e) => setRange(e.target.value)} />
            </label>
            <label className="text-tiny text-muted">
              Key outcomes
              <Input className="mt-1" value={outcomes} onChange={(e) => setOutcomes(e.target.value)} />
            </label>
            <Button type="submit" size="sm" className="mt-0.5">
              Add to book
            </Button>
            <p className="text-micro text-subtle">
              Custom rows are desk notes. They do not enter the scored forecast ledger.
            </p>
          </form>
        </Panel>
      </div>
    </div>
  );
}
