import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge, Button, Input, Panel } from "@/components/ui";
import { useLiveEvent, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/scenarios")({ component: ScenariosPage });

function ScenariosPage() {
  const eventId = useApp((s) => s.selectedEventId);
  const setEvent = useApp((s) => s.setSelectedEventId);
  const events = useLiveEvents();
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
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setEvent(e.id)}
              className={`rounded-md px-3 py-1.5 text-caption ${
                e.id === event.id ? "bg-primary/15 text-foreground" : "bg-card text-muted"
              }`}
            >
              {e.region}
            </button>
          ))}
        </div>
        <Panel
          title="Scenario Lab"
          action={
            <span className="font-mono text-tiny text-muted">
              Σ {sum}% {sum === 100 ? "· calibrated" : "· not exhaustive"}
            </span>
          }
        >
          <p className="mb-3 text-caption text-muted">
            Probabilities are stored with previous value, evidence, direction/weight, affected nodes,
            and rescored assets. LLM-generated numbers alone are never treated as calibrated.
          </p>
          <ul className="flex flex-col gap-2">
            {all.map((s) => (
              <li key={s.id} className="rounded-md bg-card-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-body font-medium">{s.name}</div>
                    <div className="text-tiny text-subtle">{s.detail}</div>
                  </div>
                  <div className="text-right">
                    <Badge tone={s.probability >= 30 ? "warn" : "primary"}>{s.probability}%</Badge>
                    <div className="mt-1 font-mono text-micro text-muted">
                      prev {s.prevProbability}%
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid gap-1 text-caption text-muted sm:grid-cols-2">
                  <div>Range: {s.range}</div>
                  <div>{s.keyOutcomes}</div>
                </div>
                <p className="mt-2 text-tiny text-subtle">{s.audit.evidence}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="New scenario">
        <form onSubmit={submit} className="flex flex-col gap-2">
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
              className="mt-2 w-full accent-primary"
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
          <Button type="submit" className="mt-1">
            Add to {event.region}
          </Button>
          <p className="text-micro text-subtle">
            Custom rows are desk notes. They do not enter the scored forecast ledger.
          </p>
        </form>
      </Panel>
    </div>
  );
}
