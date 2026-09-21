import { useEffect, useMemo, useState } from "react";
import { etParts } from "@/lib/live/clock";
import type { LiveQuote } from "@/lib/live/types";
import { useLive, useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn, formatPct, formatPrice } from "@/lib/utils";

/**
 * Compact selected-book quote strip (not the global hardcoded universe).
 * Unused by AppShell after utility-bar merge — kept for World Tape / optional chrome.
 */
export function LiveTape() {
  const desk = useLive((s) => s.desk);
  const status = useLive((s) => s.status);
  const eventId = useApp((s) => s.selectedEventId);
  const event = useLiveEvent(eventId);

  const tickers = useMemo(() => {
    const fromBook = [
      ...event.marketReaction.map((m) => m.ticker),
      ...event.trades.map((t) => t.ticker),
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of fromBook) {
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 8) break;
    }
    return out;
  }, [event.marketReaction, event.trades]);

  const quotes = tickers
    .map((t) => desk?.quotes[t])
    .filter((q): q is LiveQuote => Boolean(q));
  const items = quotes;
  const doubled = [...items, ...items];

  return (
    <div className="border-b border-border bg-card">
      <div className="overflow-hidden">
        {items.length === 0 ? (
          <div className="px-2 py-1 font-mono text-micro text-subtle">
            {status === "connecting"
              ? "Connecting public tape…"
              : "No book tickers with quotes yet"}
          </div>
        ) : (
          <div className="flex w-max animate-tape gap-4 px-2 py-1">
            {doubled.map((q, i) => (
              <div key={q.ticker + i} className="flex items-baseline gap-1 font-mono text-micro">
                <span className="text-muted">{q.ticker}</span>
                <span className="tabular-nums text-foreground">{formatPrice(q.last)}</span>
                <span className={cn("tabular-nums", q.changePct >= 0 ? "text-up" : "text-down")}>
                  {formatPct(q.changePct)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** @deprecated Merged into AppShell LivePill — retained for any stray imports. */
export function LiveStatus({ region }: { region: string; title?: string }) {
  const desk = useLive((s) => s.desk);
  const status = useLive((s) => s.status);
  const error = useLive((s) => s.error);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => setClock(etParts().clock);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const live = status === "live";
  const sess = desk?.sessions;

  return (
    <div className="border-b border-border bg-card/40 px-2 py-1 lg:px-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-subtle">
        <span className="inline-flex items-center gap-1 font-medium">
          <i
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-up" : status === "connecting" ? "bg-warn" : "bg-down",
            )}
          />
          <span className={live ? "text-up" : "text-warn"}>
            {live ? "LIVE" : status === "connecting" ? "CONNECTING" : "DEGRADED"}
          </span>
        </span>
        <span className="font-mono text-foreground">{clock || "ET"}</span>
        <Session on={sess?.ny} label="NY" />
        <Session on={sess?.london} label="LDN" />
        <Session on={sess?.tokyo} label="TYO" />
        <Session on={sess?.futures} label="FUT" />
        <span className="font-medium text-primary">{region}</span>
        {error && <span className="text-down">{error}</span>}
      </div>
    </div>
  );
}

function Session({ on, label }: { on: boolean | undefined; label: string }) {
  return (
    <span className={on ? "text-up" : "text-subtle"}>
      {label} {on ? "open" : "closed"}
    </span>
  );
}
