import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SCENARIO_COLORS, ScenarioDistributionBar } from "@/components/charts";
import { FrozenBadge, TickerLink } from "@/components/desk-nav";
import { ExpectedEvidencePanel, HorizonPanel } from "@/components/engine-panels";
import { ResearchHeader } from "@/components/research-header";
import { Button, Delta, Input, Panel } from "@/components/ui";
import type { ForecastBand } from "@/data/types";
import { validateEventSearch } from "@/lib/hooks/use-event-param-sync";
import { useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/scenarios")({
  validateSearch: validateEventSearch,
  component: ScenariosPage,
});

function ProbabilityBands({
  scenarios,
  bands,
}: {
  scenarios: { id: string; name: string; probability: number }[];
  bands?: ForecastBand[];
}) {
  const byId = new Map((bands ?? []).map((b) => [b.scenarioId, b]));
  const rows = scenarios.map((s) => ({ scenario: s, band: byId.get(s.id) }));
  const covered = rows.filter((r) => r.band);

  return (
    <Panel
      title="Probability bands"
      action={
        <span className="font-mono text-micro text-subtle">
          {covered.length > 0 ? "P10 · P50 · P90" : (
            <span className="inline-flex items-center gap-1.5">
              <FrozenBadge title="Bands appear only after a frozen prior + evidence update. Empty is honest." />
              no posterior
            </span>
          )}
        </span>
      }
    >
      {covered.length === 0 ? (
        <p className="py-3 text-center text-caption text-muted">
          No band yet. One shows up only after a prior is frozen and evidence moves it.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map(({ scenario, band }, i) => (
            <li key={scenario.id} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2">
              <a
                href={`#scenario-${scenario.id}`}
                title={`Jump to ${scenario.name}`}
                className="flex items-center gap-1.5 truncate text-caption text-muted hover:text-foreground"
              >
                <i
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}
                />
                <span className="truncate">{scenario.name}</span>
              </a>
              {band ? (
                <span className="relative block h-3 rounded-sm bg-card-2/60" title={`P10 ${band.p10}% · P50 ${band.p50}% · P90 ${band.p90}%`}>
                  <span
                    className="absolute inset-y-0 rounded-sm opacity-40"
                    style={{
                      left: `${band.p10}%`,
                      width: `${Math.max(band.p90 - band.p10, 0.6)}%`,
                      background: SCENARIO_COLORS[i % SCENARIO_COLORS.length],
                    }}
                  />
                  <span
                    className="absolute inset-y-0 w-px"
                    style={{
                      left: `${band.p50}%`,
                      background: SCENARIO_COLORS[i % SCENARIO_COLORS.length],
                    }}
                  />
                </span>
              ) : (
                <span className="text-micro text-subtle">desk entry — no posterior</span>
              )}
              <span className="font-mono text-micro tabular-nums text-subtle">
                {band ? `${band.p10}–${band.p90} · ±${(band.width / 2).toFixed(1)}` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-micro text-subtle" title="Marginal Beta of a Dirichlet posterior. Not checked against what later happened.">
        A wider band means less evidence behind the number. It is not a claim the desk has been right.
      </p>
    </Panel>
  );
}

function ScenariosPage() {
  // A scenario arrived in the URL from wherever the reader clicked it; focus
  // that row so the drill-through lands on the thing they pointed at.
  const focused = Route.useSearch().scenario;
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
        title="Paths"
        action={
          <span className="font-mono text-micro text-muted">
            Σ {sum}%{sum === 100 ? " · family mass" : " · not exhaustive"}
          </span>
        }
      >
        <ScenarioDistributionBar scenarios={all} legend={false} showSum />
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {all.map((s, i) => (
            <li key={s.id} className="text-caption">
              <a
                href={`#scenario-${s.id}`}
                className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-card-2"
                title={`Jump to ${s.name}`}
              >
                <i
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}
                />
                <span className="truncate text-muted">{s.name}</span>
                <span className="font-mono tabular-nums">{s.probability}%</span>
              </a>
            </li>
          ))}
        </ul>
      </Panel>
      <ProbabilityBands scenarios={all} bands={event.bands} />

      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,1fr)_16.5rem]">
        <Panel title="The book" padded={false}>
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
                    id={`scenario-${s.id}`}
                    className={cn(
                      "scroll-mt-20 rounded-md bg-card-2 px-2.5 py-2 transition-shadow",
                      focused === s.id && "ring-1 ring-primary",
                    )}
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-caption font-medium leading-snug">{s.name}</div>
                        <div className="text-micro text-subtle line-clamp-2">{s.detail}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-lg font-semibold tabular-nums leading-none">{s.probability}%</div>
                        {delta !== 0 ? <Delta n={delta} digits={0} /> : null}
                      </div>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-card-3">
                      <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, s.probability))}%`, background: color }} />
                    </div>
                    <div className="mt-1.5 grid gap-0.5 text-micro text-muted">
                      <div><span className="text-subtle">Exposure · </span>{s.keyOutcomes}</div>
                      <div><span className="text-subtle">Window · </span>{s.range}</div>
                    </div>
                    {delta !== 0 ? (
                      <p className="mt-1 text-micro text-foreground">
                        Was {s.prevProbability}%. {s.audit.evidence}
                      </p>
                    ) : s.audit.evidence ? (
                      <p className="mt-1 text-micro text-subtle line-clamp-2">{s.audit.evidence}</p>
                    ) : null}
                    {s.audit.rescoredAssets?.length ? (
                      <p className="mt-1 flex flex-wrap gap-x-1.5 text-micro">
                        {s.audit.rescoredAssets.slice(0, 6).map((t) => (
                          <TickerLink key={t} ticker={t} className="text-micro" />
                        ))}
                      </p>
                    ) : null}
                    {"custom" in s && (s as { custom?: boolean }).custom ? (
                      <div className="mt-1">
                        <FrozenBadge title="Desk-entered scenario. Not a calibrated model output." />
                      </div>
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
              Window
              <Input className="mt-1" value={range} onChange={(e) => setRange(e.target.value)} placeholder="1–10 days" />
            </label>
            <label className="text-tiny text-muted">
              Exposure
              <Input className="mt-1" value={outcomes} onChange={(e) => setOutcomes(e.target.value)} placeholder="gasoline, refining, freight" />
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
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
        <HorizonPanel event={event} />
        <ExpectedEvidencePanel event={event} />
      </div>
    </div>
  );
}
