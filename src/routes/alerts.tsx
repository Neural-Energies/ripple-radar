import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { DeskHint } from "@/components/desk-sync";
import { Badge, Button, Input, Panel } from "@/components/ui";
import type { AlertKind, AlertMetric, AlertOperator, AlertRule } from "@/data/types";
import { goToEvent } from "@/lib/hooks/use-event-param-sync";
import { setAlertWebhook } from "@/lib/live/alert-inbox";
import { describeRule, METRIC_ORDER, METRICS, validateRule, type Evaluation } from "@/lib/live/alerts";
import { useLive, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/alerts")({ component: AlertsPage });

const KIND_OF: Record<AlertMetric, AlertKind> = {
  book_probability: "probability",
  scenario_probability: "scenario",
  scenario_move: "path",
  book_evidence: "narrative",
  price_last: "price",
  price_change_pct: "price",
  price_abs_change_pct: "price",
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StatusLine({ e }: { e: Evaluation | undefined }) {
  if (!e) return <p className="mt-1 text-tiny text-subtle">Waiting for the tape.</p>;
  if (e.status === "ok") {
    return <p className={cn("mt-1 font-mono text-tiny", e.satisfied ? "text-up" : "text-muted")}>{e.satisfied ? "Met · " : "Watching · "}{e.reason}</p>;
  }
  return <p className={cn("mt-1 text-tiny", e.status === "suspended" ? "text-warn" : "text-subtle")}>{e.reason}</p>;
}

function statusBadge(e: Evaluation | undefined, active: boolean) {
  if (!active) return <Badge tone="neutral">paused</Badge>;
  if (!e) return null;
  if (e.status === "ok") return e.satisfied ? <Badge tone="core">met</Badge> : <Badge tone="up">watching</Badge>;
  if (e.status === "suspended") return <Badge tone="warn">suspended</Badge>;
  if (e.status === "unavailable") return <Badge tone="neutral">no reading</Badge>;
  return <Badge tone="neutral">needs target</Badge>;
}

function AlertsPage() {
  const alerts = useApp((s) => s.alerts);
  const toggle = useApp((s) => s.toggleAlert);
  const add = useApp((s) => s.addAlert);
  const dismiss = useApp((s) => s.dismissAlert);
  const identity = useApp((s) => s.identity);
  const status = useLive((s) => s.alertStatus);
  const inbox = useLive((s) => s.inbox);
  const quotes = useLive((s) => s.desk?.quotes);
  const events = useLiveEvents();
  const setEvent = useApp((s) => s.setSelectedEventId);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [metric, setMetric] = useState<AlertMetric>("book_probability");
  const spec = METRICS[metric];
  const [operator, setOperator] = useState<AlertOperator>("above");
  const [threshold, setThreshold] = useState(String(spec.defaultThreshold));
  const [eventId, setEventId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [ticker, setTicker] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [webhook, setWebhook] = useState<string | null>(null);

  const books = useMemo(() => events.filter((e) => !!e.id), [events]);
  const book = books.find((b) => b.id === eventId);
  const draft: Omit<AlertRule, "id" | "created"> = {
    title: "",
    detail: "",
    kind: KIND_OF[metric],
    active: true,
    metric,
    operator,
    threshold: threshold.trim() === "" ? Number.NaN : Number(threshold),
    ...(spec.target === "ticker" ? { ticker: ticker.trim().toUpperCase() } : { eventId }),
    ...(spec.target === "scenario" ? { scenarioId } : {}),
  };
  const scenario = book?.scenarios.find((s) => s.id === scenarioId);
  draft.targetLabel = spec.target === "ticker" ? undefined : scenario ? `${book!.title} · ${scenario.name}` : book?.title;
  const errors = validateRule(draft);
  const described = describeRule({ ...draft, id: "", created: "" });
  const noQuote = spec.target === "ticker" && draft.ticker && !quotes?.[draft.ticker];

  function chooseMetric(m: AlertMetric) {
    setMetric(m);
    setOperator(METRICS[m].operators[0]!);
    setThreshold(String(METRICS[m].defaultThreshold));
  }

  const signedIn = typeof identity === "string";
  const serverState = new Map((inbox?.states ?? []).map((s) => [s.ruleId, s]));
  const webhookValue = webhook ?? inbox?.webhookUrl ?? "";

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-3">
        <Panel className="h-auto" title="Alert rules" action={<Badge tone="core">{Object.values(status).filter((e) => e.status === "ok" && e.satisfied).length} met</Badge>}>
          {alerts.length === 0 ? (
            <p className="py-6 text-center text-caption text-muted">No rules yet. Add one on the right.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {alerts.map((a) => {
                const e = status[a.id];
                const server = serverState.get(a.id);
                const onDesk = a.eventId && books.some((b) => b.id === a.eventId);
                return (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-card-2 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-caption font-medium">{a.title || describeRule(a)}</span>
                        {statusBadge(e, a.active)}
                      </div>
                      <p className="mt-1 font-mono text-tiny text-muted">{describeRule(a)}</p>
                      {a.detail ? <p className="mt-1 text-tiny text-muted">{a.detail}</p> : null}
                      <StatusLine e={e} />
                      {server ? (
                        <p className="mt-1 text-micro text-subtle">
                          Server check {when(server.evaluatedAt)} · {server.status === "ok" ? (server.satisfied ? "met" : "watching") : server.status}
                        </p>
                      ) : null}
                      {(a.ticker || onDesk) && (
                        <p className="mt-1 flex gap-2 text-tiny">
                          {a.ticker && (
                            <Link to="/assets/$ticker" params={{ ticker: a.ticker }} className="font-mono text-primary hover:underline">
                              {a.ticker} →
                            </Link>
                          )}
                          {onDesk && (
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
                      {a.metric ? (
                        <Button size="sm" variant="secondary" onClick={() => toggle(a.id)}>
                          {a.active ? "Pause" : "Resume"}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => dismiss(a.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="h-auto" title="Delivery">
          {signedIn ? (
            <div className="flex flex-col gap-2 text-caption">
              <p className="text-muted">
                Rules saved to your account are checked on the server every few minutes, with or without this tab open. Each time a rule's
                condition becomes true it is recorded once, shown here and on your next visit, and sent to your webhook if you set one.
                {inbox?.lastPassAt ? ` Last server check ${when(inbox.lastPassAt)}.` : " No server check has run yet."}
              </p>
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await setAlertWebhook({ data: { url: webhookValue.trim() || null } });
                  if (res.ok) {
                    toast(res.url ? "Webhook saved" : "Webhook removed");
                    setWebhook(res.url ?? "");
                  } else toast("Webhook not saved", { description: res.error });
                }}
              >
                <Input
                  value={webhookValue}
                  onChange={(e) => setWebhook(e.target.value)}
                  placeholder="https://hooks.example.com/…  (optional)"
                  aria-label="Webhook URL"
                />
                <Button type="submit" size="sm" variant="secondary">
                  Save
                </Button>
              </form>
              {inbox?.deliveries.length ? (
                <ul className="flex flex-col">
                  {inbox.deliveries.slice(0, 20).map((d) => (
                    <li key={d.id} className="grid grid-cols-[6.5rem_1fr_auto] items-baseline gap-2 border-b border-border/50 py-1 last:border-b-0">
                      <span className="font-mono text-micro tabular-nums text-subtle">{when(d.firedAt)}</span>
                      <span className="min-w-0">
                        <span className="font-medium">{d.title}</span> <span className="text-muted">{d.reason}</span>
                      </span>
                      <span className={cn("text-micro", d.status === "failed" ? "text-down" : d.status === "pending" ? "text-warn" : "text-subtle")}>
                        {d.channel} · {d.status}
                        {d.channel === "webhook" && d.attempts ? ` (${d.attempts})` : ""}
                        {d.lastError ? ` · ${d.lastError}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-subtle">Nothing has fired yet.</p>
              )}
            </div>
          ) : (
            <p className="text-caption text-muted">
              Signed out, rules are checked only while this tab is open.{" "}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>{" "}
              to have them checked on the server, kept in an inbox, and sent to a webhook.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="New rule">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (errors.length) return;
            add({ ...draft, title: title.trim() || described, detail: detail.trim() });
            setTitle("");
            setDetail("");
            toast("Alert created", { description: described });
          }}
        >
          <label className="text-tiny text-muted">
            Measure
            <select
              className="mt-1 h-8 w-full rounded-md border border-border bg-card-2 px-2 text-body text-foreground"
              value={metric}
              onChange={(e) => chooseMetric(e.target.value as AlertMetric)}
            >
              {METRIC_ORDER.map((m) => (
                <option key={m} value={m}>
                  {METRICS[m].label}
                </option>
              ))}
            </select>
          </label>

          {spec.target === "ticker" ? (
            <label className="text-tiny text-muted">
              Ticker
              <Input className="mt-1" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="XLE" />
              {noQuote ? <span className="mt-0.5 block text-micro text-warn">No live quote for {draft.ticker} right now; the rule will read "no reading" until one arrives.</span> : null}
            </label>
          ) : (
            <label className="text-tiny text-muted">
              Book
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-card-2 px-2 text-body text-foreground"
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setScenarioId("");
                }}
              >
                <option value="">Choose a book…</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} · {b.probability}%
                  </option>
                ))}
              </select>
            </label>
          )}

          {spec.target === "scenario" ? (
            <label className="text-tiny text-muted">
              Scenario
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-card-2 px-2 text-body text-foreground"
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value)}
                disabled={!book}
              >
                <option value="">{book ? "Choose a scenario…" : "Choose a book first"}</option>
                {book?.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.probability}%
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <label className="text-tiny text-muted">
              When
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-card-2 px-2 text-body text-foreground"
                value={operator}
                onChange={(e) => setOperator(e.target.value as AlertOperator)}
              >
                {spec.operators.map((o) => (
                  <option key={o} value={o}>
                    {o === "above" ? "at or above" : "at or below"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-tiny text-muted">
              Threshold ({spec.unit === "price" ? "price" : spec.unit})
              <Input className="mt-1" value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" />
            </label>
          </div>
          <p className="text-micro text-subtle">{spec.contract}</p>

          <label className="text-tiny text-muted">
            Name (optional)
            <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={described} />
          </label>
          <label className="text-tiny text-muted">
            Note (optional)
            <Input className="mt-1" value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
          {errors.length ? <p className="text-micro text-warn">{errors[0]}</p> : null}
          <Button type="submit" disabled={errors.length > 0}>
            Create alert
          </Button>
          <p className="text-micro text-subtle">
            A rule watches exactly the book, scenario or ticker chosen here. If that book leaves the desk the rule is suspended, never moved
            to another. It fires once each time its condition becomes true.
          </p>
          <DeskHint />
        </form>
      </Panel>
    </div>
  );
}
