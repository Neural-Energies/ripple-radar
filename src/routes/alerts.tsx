import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { DeskHint } from "@/components/desk-sync";
import { Badge, Button, Input, Panel } from "@/components/ui";
import type { AlertRule } from "@/data/types";
import { goToEvent } from "@/lib/hooks/use-event-param-sync";
import { alertIsHit, useAlertHits, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/alerts")({ component: AlertsPage });

const KINDS: AlertRule["kind"][] = [
  "probability",
  "price",
  "narrative",
  "scenario",
  "crowding",
  "confirmation",
  "invalidation",
];

function AlertsPage() {
  const alerts = useApp((s) => s.alerts);
  const toggle = useApp((s) => s.toggleAlert);
  const add = useApp((s) => s.addAlert);
  const dismiss = useApp((s) => s.dismissAlert);
  const hits = useAlertHits();
  const events = useLiveEvents();
  const setEvent = useApp((s) => s.setSelectedEventId);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [kind, setKind] = useState<AlertRule["kind"]>("probability");
  const [ticker, setTicker] = useState("");
  const [threshold, setThreshold] = useState("8");
  const [eventId, setEventId] = useState("");

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
      <Panel
        title="Alert rules"
        action={<Badge tone="core">{hits.length} firing</Badge>}
      >
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => {
            const firing = alertIsHit(a.id, hits);
            const hit = hits.find((h) => h.id === a.id);
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-card-2 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption font-medium">{a.title}</span>
                    <Badge tone={a.active ? "up" : "neutral"}>{a.active ? "on" : "off"}</Badge>
                    <Badge tone="primary">{a.kind}</Badge>
                    {firing && <Badge tone="core">firing</Badge>}
                  </div>
                  <p className="mt-1 text-tiny text-muted">{a.detail}</p>
                  {hit && <p className="mt-1 font-mono text-tiny text-up">{hit.reason}</p>}
                  {(a.ticker || (a.eventId && events.some((e) => e.id === a.eventId))) && (
                    <p className="mt-1 flex gap-2 text-tiny">
                      {a.ticker && (
                        <Link
                          to="/assets/$ticker"
                          params={{ ticker: a.ticker }}
                          className="font-mono text-primary hover:underline"
                        >
                          {a.ticker} →
                        </Link>
                      )}
                      {a.eventId && events.some((e) => e.id === a.eventId) && (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => {
                            setEvent(a.eventId!);
                            goToEvent(navigate, pathname, a.eventId!);
                          }}
                        >
                          Open book →
                        </button>
                      )}
                    </p>
                  )}
                  <p className="mt-1 text-micro text-subtle">Created {a.created}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggle(a.id)}>
                    {a.active ? "Pause" : "Resume"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => dismiss(a.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="New rule">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            add({
              title: title.trim(),
              detail: detail.trim() || "Desk rule",
              kind,
              active: true,
              ticker: ticker.trim().toUpperCase() || undefined,
              threshold: Number(threshold) || undefined,
              eventId: eventId || undefined,
            });
            setTitle("");
            setDetail("");
          }}
        >
          <label className="text-tiny text-muted">
            Title
            <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="text-tiny text-muted">
            Detail
            <Input className="mt-1" value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
          {kind === "price" || kind === "crowding" || kind === "confirmation" || kind === "invalidation" ? (
            <label className="text-tiny text-muted">
              Ticker
              <Input className="mt-1" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="BWET" />
            </label>
          ) : null}
          {(kind === "probability" || kind === "narrative") && (
            <label className="text-tiny text-muted">
              Book id
              <Input className="mt-1" value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="live event id (optional)" />
            </label>
          )}
          <label className="text-tiny text-muted">
            Threshold
            <Input
              className="mt-1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                  kind === k ? "bg-primary/15 text-primary" : "text-muted",
                )}
              >
                {k}
              </button>
            ))}
          </div>
          <Button type="submit">Create alert</Button>
          <p className="text-micro text-subtle">
            Rules evaluate against the live tape every 15 seconds. Price uses session %; crowding and confirmation use the discovery engine; probability uses the live book.
          </p>
          <DeskHint />
        </form>
      </Panel>
    </div>
  );
}
