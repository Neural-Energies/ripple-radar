import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge, Button, Input, Panel } from "@/components/ui";
import type { EventBadge, EvidenceClass, Lifecycle, Reliability } from "@/data/types";
import { regionFromText, tagsFromText, themeFromTags } from "@/lib/engine/ontology";
import { classifyText, reliabilityOf } from "@/lib/live/evidence";
import { EMPTY_HEADLINES } from "@/lib/live/empty";
import { runAnalyze, useLive, useLiveEvent, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/events")({ component: EventsPage });

const FILTERS: Array<"All" | EventBadge> = ["All", "MAJOR EVENT", "WATCH", "DEVELOPING"];
const LIVES: Array<"All" | Lifecycle> = ["All", "candidate", "emerging", "active", "escalating", "de-escalating", "resolving"];
const MODES = ["discovery", "monitoring"] as const;

function classTone(c: EvidenceClass): "up" | "warn" | "primary" | "core" {
  if (c === "fundamental") return "up";
  if (c === "market") return "warn";
  if (c === "expectation") return "core";
  return "primary";
}

function relTone(r: Reliability): "up" | "primary" | "neutral" | "warn" {
  if (r === "A") return "up";
  if (r === "B") return "primary";
  if (r === "C") return "neutral";
  return "warn";
}

function EventsPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [life, setLife] = useState<(typeof LIVES)[number]>("All");
  const [mode, setMode] = useState<(typeof MODES)[number]>("discovery");
  const selected = useApp((s) => s.selectedEventId);
  const setEvent = useApp((s) => s.setSelectedEventId);
  const addBook = useApp((s) => s.addDeskBook);
  const removeBook = useApp((s) => s.removeDeskBook);
  const navigate = useNavigate();
  const events = useLiveEvents();
  const headlines = useLive((s) => s.desk?.headlines ?? EMPTY_HEADLINES);
  const analyzing = useLive((s) => s.analyzing);
  const [draft, setDraft] = useState("");
  const inferredTags = tagsFromText(draft);
  const inferredTheme = themeFromTags(inferredTags);
  const inferredRegion = regionFromText(draft, inferredTags);

  const rows = useMemo(
    () =>
      events
        .filter((e) => (mode === "discovery" ? e.mode !== "desk" : e.mode === "desk"))
        .filter((e) => (filter === "All" ? true : e.badge === filter))
        .filter((e) => (life === "All" ? true : e.lifecycle === life))
        .filter(
          (e) =>
            !q ||
            e.title.toLowerCase().includes(q.toLowerCase()) ||
            e.theme.toLowerCase().includes(q.toLowerCase()) ||
            e.region.toLowerCase().includes(q.toLowerCase()),
        )
        .sort((a, b) => (b.importance ?? b.probability) - (a.importance ?? a.probability)),
    [events, q, filter, life, mode],
  );

  const open = useLiveEvent(selected);

  return (
    <div className="flex flex-col gap-3">
      <Panel title="World tape" action={<span className="text-micro text-muted">Class · reliability · not a count of copies</span>} padded={false}>
        <ul className="max-h-36 overflow-y-auto">
          {headlines.slice(0, 12).map((h) => {
            const cls = classifyText(h.title);
            const rel = reliabilityOf(h.source);
            return (
              <li key={h.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border/70 px-3 py-1.5 last:border-b-0">
                <span className="w-20 shrink-0 truncate font-mono text-micro text-primary">{h.source}</span>
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-caption hover:text-primary"
                  onClick={() => {
                    setDraft(h.title);
                  }}
                  title="Open a book from this headline"
                >
                  {h.title}
                </button>
                <span className="w-16 shrink-0 text-right font-mono text-micro uppercase tracking-wider text-subtle">
                  {cls.evidenceClass.slice(0, 4)} {rel}
                </span>
              </li>
            );
          })}
          {headlines.length === 0 && (
            <li className="px-3 py-4 text-center text-caption text-muted">Pulling public headlines…</li>
          )}
        </ul>
      </Panel>
      <Panel title="Analyze this event">
        <p className="mb-2 text-caption text-muted">
          Paste what happened. The engine constructs scenarios, players, the causal graph, and asset exposures — not a template from a named war.
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const title = draft.trim();
            if (!title) return;
            void runAnalyze(title).then((ev) => {
              if (ev) {
                setDraft("");
                void navigate({ to: "/" });
              }
            });
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Pipeline attack · FOMC surprise hike · yen intervention · mine strike"
            className="min-h-11 flex-1"
          />
          <Button type="submit" disabled={analyzing || !draft.trim()} className="min-h-11">
            {analyzing ? "Constructing…" : "Analyze with Grok"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={!draft.trim()}
            onClick={() => {
              const title = draft.trim();
              if (!title) return;
              addBook({
                id: "desk-" + Date.now().toString(36),
                title,
                region: inferredRegion,
                note: title,
                created: new Date().toLocaleString("en-GB", { timeZone: "America/New_York" }),
              });
              setDraft("");
              void navigate({ to: "/" });
            }}
          >
            Instant book
          </Button>
        </form>
        {draft.trim() && (
          <p className="mt-2 text-tiny text-muted">
            Inferred: {inferredTheme} · {inferredRegion}
            {inferredTags.length ? ` · ${inferredTags.slice(0, 4).join(", ")}` : ""}
          </p>
        )}
      </Panel>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Panel title="Event Feed" action={<span className="text-micro text-muted">{rows.length} tracks · {mode}</span>}>
          <div className="mb-2 flex gap-1">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-micro uppercase tracking-wider",
                  mode === m ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by region, theme, title"
            className="mb-2"
          />
          <div className="mb-2 flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-micro uppercase tracking-wider",
                  filter === f ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground",
                )}
              >
                {f === "All" ? "All" : f}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {LIVES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setLife(f)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-micro uppercase tracking-wider",
                  life === f ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-1">
            {rows.map((e) => (
              <li key={e.id} className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => setEvent(e.id)}
                  className={cn(
                    "min-w-0 flex-1 rounded-md px-2 py-2 text-left hover:bg-card-2",
                    selected === e.id && "bg-card-2",
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        e.badge === "MAJOR EVENT"
                          ? "core"
                          : e.badge === "CASE STUDY"
                            ? "warn"
                            : e.badge === "WATCH"
                              ? "primary"
                              : "neutral"
                      }
                    >
                      {e.badge}
                    </Badge>
                    <span className="font-mono text-micro text-subtle">
                      {e.mode ?? "standing"} · {e.timestamp}
                    </span>
                  </div>
                  <div className="text-caption font-medium">{e.title}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-tiny text-muted">
                    <span className="min-w-0 truncate">
                      {e.lifecycle ?? e.region} · {e.eventSubtype ?? e.theme}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-primary">
                      imp {e.importance ?? "—"} · {e.probability}%
                    </span>
                  </div>
                </button>
                {e.mode === "desk" && (
                  <button
                    type="button"
                    className="mt-2 px-1 text-micro text-muted hover:text-down"
                    onClick={() => removeBook(e.id)}
                  >
                    Close
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        {open && (
          <Panel title="Story + evidence trail">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="core">{open.badge}</Badge>
              <span className="font-mono text-tiny text-muted">{open.timestamp}</span>
              <span className="text-tiny text-subtle">{open.theme}</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{open.title}</h1>
            <p className="mt-2 text-body text-muted">{open.story}</p>
            {(open.relatedEvents ?? []).length > 0 && (
              <div className="mt-3 rounded-md bg-card-2 px-3 py-2">
                <p className="text-micro uppercase tracking-wider text-subtle">Related books</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {open.relatedEvents!.map((r) => (
                    <li key={r.targetId} className="text-caption text-muted">
                      <span className="font-mono text-tiny text-primary">{r.kind.replace(/_/g, " ")}</span> · {r.targetTitle}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              className="mt-3 text-caption text-primary hover:underline"
              onClick={() => {
                setEvent(open.id);
                void navigate({ to: "/" });
              }}
            >
              Open on dashboard →
            </button>
            <h2 className="mt-6 text-tiny font-medium uppercase tracking-wider text-muted">
              Evidence classes
            </h2>
            <ul className="mt-2 flex flex-col">
              {open.evidence.map((ev) => (
                <li
                  key={ev.id}
                  className="grid grid-cols-[52px_1fr] gap-2 border-t border-border py-2 first:border-t-0"
                >
                  <span className="font-mono text-tiny text-subtle">{ev.time}</span>
                  <div>
                    {ev.url ? (
                      <a href={ev.url} target="_blank" rel="noreferrer" className="text-caption hover:text-primary">
                        {ev.headline}
                      </a>
                    ) : (
                      <div className="text-caption">{ev.headline}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-micro text-subtle">
                      <span>{ev.source}</span>
                      <Badge tone={classTone(ev.evidenceClass)}>{ev.evidenceClass}</Badge>
                      {ev.reliability && <Badge tone={relTone(ev.reliability)}>tier {ev.reliability}</Badge>}
                      {ev.duplicateOf && <Badge tone="warn">duplicate</Badge>}
                      <span>{ev.delayed ? "catalog" : "live"}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
