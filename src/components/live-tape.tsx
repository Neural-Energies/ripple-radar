import { useEffect, useState } from "react";
import { etParts } from "@/lib/live/clock";
import type { LiveQuote } from "@/lib/live/types";
import { useLive } from "@/lib/live/provider";
import { cn, formatPct, formatPrice } from "@/lib/utils";

const TAPE = [
  "BWET",
  "CL",
  "HO",
  "RB",
  "BZ",
  "GC",
  "TSM",
  "NVDA",
  "ASML",
  "ITA",
  "BTC",
  "TLT",
  "UUP",
  "JPY",
  "KRE",
  "SPX",
  "VIX",
  "JETS",
];

export function LiveTape() {
  const desk = useLive((s) => s.desk);
  const status = useLive((s) => s.status);
  const quotes = TAPE.map((t) => desk?.quotes[t]).filter((q): q is LiveQuote => Boolean(q));
  const items = quotes;
  const doubled = [...items, ...items];

  return (
    <div className="border-b border-border bg-card">
      <div className="overflow-hidden">
        {items.length === 0 ? (
          <div className="px-3 py-1.5 font-mono text-micro text-subtle">
            {status === "connecting" ? "Connecting public tape…" : "Awaiting quotes"}
          </div>
        ) : (
          <div className="flex w-max animate-tape gap-5 px-3 py-1.5">
            {doubled.map((q, i) => (
              <div key={q.ticker + i} className="flex items-baseline gap-1.5 font-mono text-micro">
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
  const headline = desk?.headlines[0];

  return (
    <div className="border-b border-border bg-card/40 px-3 py-1.5 lg:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-subtle">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <i
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-up" : status === "connecting" ? "bg-warn" : "bg-down",
            )}
          />
          <span className={live ? "text-up" : "text-warn"}>{live ? "LIVE" : status === "connecting" ? "CONNECTING" : "DEGRADED"}</span>
        </span>
        <span className="font-mono text-foreground">{clock || "ET"}</span>
        <Session on={sess?.ny} label="NY" />
        <Session on={sess?.london} label="LDN" />
        <Session on={sess?.tokyo} label="TYO" />
        <Session on={sess?.futures} label="FUT" />
        <span className="font-medium text-primary">{region}</span>
        <span className="hidden sm:inline">{desk?.statusDetail ?? "Public Yahoo + RSS tape"}</span>
        <span className="hidden md:inline">
          {desk
            ? `${desk.quoteLive}/${desk.quoteCount} live · ${desk.headlines.length} headlines`
            : "—"}
        </span>
        {error && <span className="text-down">{error}</span>}
      </div>
      {headline && (
        <div className="mt-1 truncate font-mono text-micro text-muted">
          <span className="text-primary">{headline.source}</span>
          <span className="text-subtle"> · </span>
          {headline.url ? (
            <a href={headline.url} target="_blank" rel="noreferrer" className="hover:text-foreground">
              {headline.title}
            </a>
          ) : (
            headline.title
          )}
        </div>
      )}
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
