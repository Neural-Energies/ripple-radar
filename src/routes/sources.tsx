import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Panel } from "@/components/ui";
import { useLive } from "@/lib/live/provider";
import type { FeedSourceStatus } from "@/lib/live/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sources")({ component: SourcesPage });

const STATE_LABEL: Record<FeedSourceStatus["state"], string> = {
  ok: "Up",
  down: "Down",
  stale: "Last good",
  missing: "No key",
  empty: "Empty",
};

function tone(state: FeedSourceStatus["state"]): "up" | "warn" | "down" | "neutral" | "primary" {
  if (state === "ok") return "up";
  if (state === "down") return "down";
  if (state === "stale" || state === "missing") return "warn";
  return "neutral";
}

function SourcesPage() {
  const desk = useLive((s) => s.desk);
  const status = useLive((s) => s.status);
  const error = useLive((s) => s.error);
  const feeds = desk?.feeds ?? [];
  const waiting = !desk && (status === "idle" || status === "connecting");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <header>
        <div className="text-micro uppercase tracking-wider text-subtle">Desk</div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Data sources</h1>
        <p className="mt-1 text-caption text-muted">
          Each feed, as of the last pull. A down feed keeps the previous tape instead of going blank.
        </p>
      </header>

      <Panel title="This pull" padded>
        {waiting ? (
          <p className="text-caption text-muted">Pulling the tape. This page fills in when the first answer arrives.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-caption text-foreground">{error || desk?.statusDetail || "No status yet."}</p>
            {desk ? (
              <p className="font-mono text-micro text-subtle">
                Pulled {new Date(desk.asOf).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                {" · "}
                {desk.quoteCount} prices · {desk.headlines.length} headlines
              </p>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Feeds" padded={false}>
        {feeds.length === 0 ? (
          <p className="px-3 py-8 text-center text-caption text-muted">
            {waiting ? "Waiting for the first pull." : "This pull did not list individual feeds. The status line above is the whole story."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {feeds.map((f) => (
              <li key={`${f.kind}-${f.name}`} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-caption text-foreground">{f.name}</div>
                  <p className={cn("text-micro text-muted", f.state === "down" && "text-down")}>{f.detail}</p>
                </div>
                <Badge tone={tone(f.state)}>{STATE_LABEL[f.state]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-micro text-subtle">
        Quotes are delayed public prints. Macro needs a FRED key on the machine that runs the desk.{" "}
        <Link to="/docs" className="text-primary hover:underline">
          How the desk is built
        </Link>
      </p>
    </div>
  );
}
