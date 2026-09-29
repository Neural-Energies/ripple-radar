import { useState, type TextareaHTMLAttributes } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { TickerLink } from "@/components/desk-nav";
import { Badge, Button, Delta, Input } from "@/components/ui";
import type { RadarEvent, Thesis } from "@/data/types";
import { useLive } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import {
  buildThesis,
  draftFromEvent,
  draftProblems,
  horizonHours,
  type DraftProblem,
  type ThesisDraft,
  type ThesisMonitor,
} from "@/lib/thesis";
import { cn, formatPct, formatPrice } from "@/lib/utils";

function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[3.5rem] w-full rounded-md border border-border bg-card-2 px-2.5 py-1.5 text-body text-foreground placeholder:text-subtle outline-none transition-shadow duration-150 focus:shadow-[0_0_0_1px_var(--color-primary)]",
        className,
      )}
      {...props}
    />
  );
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

const PROBLEM_TEXT: Record<DraftProblem, string> = {
  book: "Select a book first.",
  statement: "State the claim.",
  instruments: "Add at least one instrument.",
  invalidation: "Say what would prove it wrong.",
};

export function reviewDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Save a thesis on the active book. Prefilled from the book so the trader
 * edits a claim rather than types one from nothing; saved as a frozen copy.
 */
export function ThesisComposer({
  event,
  scenarioId,
  onClose,
}: {
  event: RadarEvent;
  scenarioId?: string | null;
  onClose: () => void;
}) {
  const addThesis = useApp((s) => s.addThesis);
  const quotes = useLive((s) => s.desk?.quotes);
  const navigate = useNavigate();
  // Mounted per book (`key={event.id}`), so the draft starts from that book only.
  const [initial] = useState(() => draftFromEvent(event, scenarioId));
  const [draft, setDraft] = useState<ThesisDraft>(initial);
  const [triggers, setTriggers] = useState(initial.triggers.join("\n"));
  const [invalidation, setInvalidation] = useState(initial.invalidation.join("\n"));
  const [ticker, setTicker] = useState("");

  const full: ThesisDraft = { ...draft, triggers: lines(triggers), invalidation: lines(invalidation) };
  const problems = draftProblems(full, event);
  const hours = horizonHours(full, event);
  const due = new Date(Date.now() + hours * 3_600_000).toISOString();
  const set = (patch: Partial<ThesisDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function changeScenario(id: string) {
    const next = draftFromEvent(event, id || null);
    set({ scenarioId: id || null, statement: draft.statement === draftFromEvent(event, draft.scenarioId).statement ? next.statement : draft.statement });
    setTriggers(next.triggers.join("\n"));
  }

  function save() {
    if (problems.length) return;
    const thesis = buildThesis(event, full, quotes, new Date());
    addThesis(thesis);
    toast("Thesis saved", {
      description: `Review ${reviewDate(thesis.reviewAt)}. Monitoring starts now.`,
      action: { label: "Open", onClick: () => void navigate({ to: "/theses" }) },
    });
    onClose();
  }

  return (
    <form
      className="mt-2 grid gap-2 border-t border-border pt-2 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      aria-label="Save thesis"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-tiny text-muted">
          Claim
          <TextArea className="mt-1" value={draft.statement} onChange={(e) => set({ statement: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-tiny text-muted">
            Scenario
            <select
              className="mt-1 h-8 w-full rounded-md border border-border bg-card-2 px-2 text-body text-foreground"
              value={draft.scenarioId ?? ""}
              onChange={(e) => changeScenario(e.target.value)}
            >
              <option value="">None — the book as a whole</option>
              {event.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.probability}%
                </option>
              ))}
            </select>
          </label>
          <label className="text-tiny text-muted">
            Horizon
            <Input className="mt-1" value={draft.horizon} onChange={(e) => set({ horizon: e.target.value })} placeholder="7d" />
            <span className="mt-0.5 block text-micro text-subtle">Review {reviewDate(due)}</span>
          </label>
        </div>
        <div className="text-tiny text-muted">
          Instruments
          <ul className="mt-1 flex flex-wrap gap-1">
            {draft.instruments.map((i) => (
              <li key={i.ticker} className="flex items-center gap-1 rounded-sm bg-card-2 px-1.5 py-0.5 font-mono text-caption">
                {i.ticker}
                <button
                  type="button"
                  className={cn("rounded-sm px-1 text-micro", i.expected === "up" ? "bg-up/15 text-up" : "bg-down/15 text-down")}
                  title="Expected direction — click to flip"
                  onClick={() =>
                    set({
                      instruments: draft.instruments.map((x) =>
                        x.ticker === i.ticker ? { ...x, expected: x.expected === "up" ? "down" : "up" } : x,
                      ),
                    })
                  }
                >
                  {i.expected === "up" ? "▲ up" : "▼ down"}
                </button>
                <button
                  type="button"
                  className="text-subtle hover:text-foreground"
                  aria-label={`Remove ${i.ticker}`}
                  onClick={() => set({ instruments: draft.instruments.filter((x) => x.ticker !== i.ticker) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex gap-1">
            <Input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Add ticker" aria-label="Add ticker" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const t = ticker.trim();
                if (!t || draft.instruments.some((x) => x.ticker === t)) return;
                set({ instruments: [...draft.instruments, { ticker: t, expected: "up" }] });
                setTicker("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-tiny text-muted">
          Confirms it (one per line)
          <TextArea className="mt-1" value={triggers} onChange={(e) => setTriggers(e.target.value)} />
        </label>
        <label className="text-tiny text-muted">
          Proves it wrong (one per line)
          <TextArea className="mt-1" value={invalidation} onChange={(e) => setInvalidation(e.target.value)} />
        </label>
        <p className="text-micro text-subtle">
          Saves the book at {event.probability}%, the scenario odds, the latest evidence and current prices. The saved copy does not change;
          monitoring compares the live book against it.
        </p>
        <div className="mt-auto flex items-center justify-end gap-2">
          {problems.length ? <span className="text-micro text-warn">{PROBLEM_TEXT[problems[0]!]}</span> : null}
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={problems.length > 0}>
            Save thesis
          </Button>
        </div>
      </div>
    </form>
  );
}

const OUTCOMES: NonNullable<Thesis["review"]>["outcome"][] = ["right", "wrong", "mixed", "unclear"];

function outcomeTone(o: NonNullable<Thesis["review"]>["outcome"]) {
  return o === "right" ? "up" : o === "wrong" ? "down" : o === "mixed" ? "warn" : "neutral";
}

function hoursLabel(h: number) {
  const abs = Math.abs(h);
  const text = abs >= 48 ? `${Math.round(abs / 24)}d` : `${Math.round(abs)}h`;
  return h > 0 ? `${text} left` : `${text} overdue`;
}

/** One thesis: the frozen claim on the left, the live check on the right. */
export function ThesisCardView({
  thesis,
  monitor,
  onReview,
  onRemove,
}: {
  thesis: Thesis;
  monitor: ThesisMonitor;
  onReview?: (outcome: NonNullable<Thesis["review"]>["outcome"], note: string) => void;
  onRemove?: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [outcome, setOutcome] = useState<NonNullable<Thesis["review"]>["outcome"]>("right");
  const [note, setNote] = useState("");
  const review = thesis.review;

  return (
    <article className="rounded-md bg-card-2 p-2.5" aria-label={thesis.statement}>
      <header className="flex flex-wrap items-center gap-1.5">
        {review ? (
          <Badge tone={outcomeTone(review.outcome)}>{review.outcome}</Badge>
        ) : monitor.due ? (
          <Badge tone="warn">review due</Badge>
        ) : (
          <Badge tone="primary">open · {hoursLabel(monitor.hoursLeft)}</Badge>
        )}
        {!monitor.onDesk ? <Badge tone="neutral">book off desk</Badge> : null}
        <span className="min-w-0 truncate text-micro text-subtle" title={thesis.eventTitle}>
          {thesis.eventTitle}
        </span>
        <span className="ml-auto font-mono text-micro tabular-nums text-subtle">
          saved {reviewDate(thesis.createdAt)} · {thesis.horizon}
        </span>
      </header>
      <p className="mt-1 text-body font-medium leading-snug">{thesis.statement}</p>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-1 text-caption">
          <div className="text-micro uppercase tracking-wider text-subtle">Odds · saved → now</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted">Book</span>
            <span className="font-mono tabular-nums">
              {thesis.bookProbability}% → {monitor.bookNow != null ? `${monitor.bookNow}%` : "—"}{" "}
              {monitor.bookDelta ? <Delta n={monitor.bookDelta} digits={0} suffix=" pts" /> : null}
            </span>
          </div>
          {thesis.scenarioName ? (
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-muted">{thesis.scenarioName}</span>
              <span className="font-mono tabular-nums">
                {thesis.scenarioProbability ?? "—"}% → {monitor.scenarioNow != null ? `${monitor.scenarioNow}%` : "—"}{" "}
                {monitor.scenarioDelta ? <Delta n={monitor.scenarioDelta} digits={0} suffix=" pts" /> : null}
              </span>
            </div>
          ) : null}
          {thesis.alternatives.length ? (
            <div className="text-micro text-subtle">
              Alternatives when saved: {thesis.alternatives.map((a) => `${a.name} ${a.probability}%`).join(" · ")}
            </div>
          ) : null}
          <div className="mt-1 text-micro uppercase tracking-wider text-subtle">Instruments · since saved</div>
          <ul className="flex flex-col">
            {monitor.instruments.map((i) => (
              <li key={i.ticker} className="flex items-center justify-between gap-2 font-mono text-caption tabular-nums">
                <span className="flex items-center gap-1">
                  <TickerLink ticker={i.ticker} />
                  <span className={i.expected === "up" ? "text-up" : "text-down"}>{i.expected === "up" ? "▲" : "▼"}</span>
                </span>
                <span className="text-muted">
                  {i.priceAtSave != null ? formatPrice(i.priceAtSave) : "—"} → {i.priceNow != null ? formatPrice(i.priceNow) : "—"}
                </span>
                <span
                  className={cn(
                    "w-16 text-right",
                    i.agrees === true && "text-up",
                    i.agrees === false && "text-down",
                    i.agrees == null && "text-subtle",
                  )}
                >
                  {i.changePct != null ? formatPct(i.changePct) : "unpriced"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-1 text-caption">
          {review ? null : monitor.flags.length ? (
            <ul className="flex flex-col gap-0.5">
              {monitor.flags.map((f) => (
                <li key={f} className="text-warn">
                  {f}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nothing has broken since it was saved.</p>
          )}
          {thesis.triggers.length ? (
            <>
              <div className="mt-1 text-micro uppercase tracking-wider text-subtle">Confirms it</div>
              <ul className="flex flex-col gap-0.5">
                {thesis.triggers.map((t) => {
                  const seen = monitor.triggersSeen.find((s) => s.observe === t);
                  return (
                    <li key={t} className={seen ? "text-up" : "text-muted"}>
                      {seen ? "✓ " : "· "}
                      {t}
                      {seen?.headline ? <span className="text-subtle"> — {seen.headline}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <div className="mt-1 text-micro uppercase tracking-wider text-subtle">Proves it wrong</div>
          <ul className="flex flex-col gap-0.5 text-muted">
            {thesis.invalidation.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
          {thesis.evidence.length ? (
            <details className="mt-1 text-micro text-subtle">
              <summary className="cursor-pointer">Evidence when saved ({thesis.evidence.length})</summary>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {thesis.evidence.map((e) => (
                  <li key={e.headline}>
                    <span className="font-mono">{e.time}</span> {e.headline} <span className="text-subtle">· {e.source}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>

      {review ? (
        <div className="mt-2 rounded-sm bg-card-3 px-2 py-1.5 text-caption">
          <span className="text-micro uppercase tracking-wider text-subtle">Reviewed {reviewDate(review.at)} · </span>
          {review.note || <span className="text-subtle">No note.</span>}
          <span className="ml-1 font-mono text-micro text-subtle">
            book {review.bookProbability != null ? `${review.bookProbability}%` : "off desk"}
            {review.prices
              .filter((p) => p.changePct != null)
              .map((p) => ` · ${p.ticker} ${formatPct(p.changePct!)}`)
              .join("")}
          </span>
        </div>
      ) : null}

      <footer className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro uppercase tracking-wider">
        {monitor.onDesk ? (
          <>
            <Link to="/maps" search={{ event: thesis.eventId }} className="text-primary hover:underline">
              Map
            </Link>
            <Link
              to="/scenarios"
              search={{ event: thesis.eventId, scenario: thesis.scenarioId ?? undefined }}
              className="text-primary hover:underline"
            >
              Scenarios
            </Link>
            <Link to="/assets" search={{ event: thesis.eventId }} className="text-primary hover:underline">
              Assets
            </Link>
          </>
        ) : null}
        <span className="ml-auto flex gap-1">
          {!review && onReview ? (
            <Button type="button" size="sm" variant={monitor.due ? "default" : "secondary"} onClick={() => setReviewing((v) => !v)}>
              Review
            </Button>
          ) : null}
          {onRemove ? (
            <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
              Delete
            </Button>
          ) : null}
        </span>
      </footer>

      {reviewing && onReview && !review ? (
        <form
          className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            onReview(outcome, note);
            setReviewing(false);
          }}
        >
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Outcome">
            {OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={outcome === o}
                onClick={() => setOutcome(o)}
                className={cn(
                  "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                  outcome === o ? "bg-primary/15 text-primary" : "bg-card-3 text-muted hover:text-foreground",
                )}
              >
                {o}
              </button>
            ))}
          </div>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, and what you would do differently" />
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              Record review
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
