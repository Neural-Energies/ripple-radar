import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DeskHint } from "@/components/desk-sync";
import { ThesisCardView } from "@/components/thesis";
import { Empty, Panel } from "@/components/ui";
import type { RadarEvent, Thesis } from "@/data/types";
import { useLive, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { monitorThesis, reviewRecord, reviewTally } from "@/lib/thesis";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/theses")({ component: ThesesPage });

type Filter = "open" | "due" | "reviewed";

/** Re-render on a clock so "due" and hours-left move without a new tape poll. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function ThesesPage() {
  const theses = useApp((s) => s.theses);
  const reviewThesis = useApp((s) => s.reviewThesis);
  const removeThesis = useApp((s) => s.removeThesis);
  const events = useLiveEvents();
  const quotes = useLive((s) => s.desk?.quotes);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>("open");

  // Exact lookup: a thesis whose book left the desk gets null, never events[0].
  const byId = useMemo(() => new Map<string, RadarEvent>(events.map((e) => [e.id, e])), [events]);
  const rows = useMemo(
    () =>
      theses.map((t) => ({ thesis: t, event: byId.get(t.eventId) ?? null, monitor: monitorThesis(t, byId.get(t.eventId) ?? null, quotes, now) })),
    [theses, byId, quotes, now],
  );
  const counts = {
    open: rows.filter((r) => r.thesis.status === "open").length,
    due: rows.filter((r) => r.thesis.status === "open" && r.monitor.due).length,
    reviewed: rows.filter((r) => r.thesis.status === "reviewed").length,
  };
  const shown = rows
    .filter((r) =>
      filter === "reviewed" ? r.thesis.status === "reviewed" : filter === "due" ? r.thesis.status === "open" && r.monitor.due : r.thesis.status === "open",
    )
    .sort((a, b) =>
      filter === "reviewed"
        ? Date.parse(b.thesis.review!.at) - Date.parse(a.thesis.review!.at)
        : a.monitor.hoursLeft - b.monitor.hoursLeft,
    );
  const tally = reviewTally(theses);

  function review(t: Thesis, event: RadarEvent | null, outcome: NonNullable<Thesis["review"]>["outcome"], note: string) {
    reviewThesis(t.id, reviewRecord(t, event, quotes, new Date(), outcome, note));
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[16rem_1fr]">
      <Panel title="Theses">
        <ul className="flex flex-col gap-1">
          {(["open", "due", "reviewed"] as const).map((f) => (
            <li key={f}>
              <button
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-caption capitalize",
                  filter === f ? "bg-card-2 text-foreground" : "text-muted hover:bg-card-2",
                )}
              >
                {f === "due" ? "Due for review" : f}
                <span className="font-mono text-tiny text-subtle">{counts[f]}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-md bg-card-2 p-2 text-caption">
          <div className="text-micro uppercase tracking-wider text-subtle">Review log</div>
          {tally.reviewed ? (
            <p className="mt-1 font-mono tabular-nums">
              {tally.right} right · {tally.wrong} wrong · {tally.mixed} mixed · {tally.unclear} unclear
            </p>
          ) : (
            <p className="mt-1 text-muted">No reviews yet.</p>
          )}
        </div>
        <p className="mt-3 text-tiny text-muted">
          Save a thesis from any research view of a book — Map, Scenarios, Game Theory or Assets. It is monitored against the live book
          until its horizon, then reviewed here.
        </p>
        <div className="mt-3">
          <DeskHint />
        </div>
      </Panel>
      <Panel title={filter === "reviewed" ? "Reviewed" : filter === "due" ? "Due for review" : "Open"}>
        {shown.length === 0 ? (
          <Empty>
            {theses.length === 0 ? (
              <>
                No theses yet.{" "}
                <Link to="/events" className="text-primary hover:underline">
                  Find a book on the World Tape
                </Link>{" "}
                and save one from its research view.
              </>
            ) : (
              "Nothing in this list."
            )}
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map(({ thesis, event, monitor }) => (
              <ThesisCardView
                key={thesis.id}
                thesis={thesis}
                monitor={monitor}
                onReview={(outcome, note) => review(thesis, event, outcome, note)}
                onRemove={() => removeThesis(thesis.id)}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
