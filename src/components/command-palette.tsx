import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useLiveAssets, useLiveEvents } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const PAGES = [
  { to: "/", label: "Dashboard · Live Overview" },
  { to: "/events", label: "Event Feed" },
  { to: "/maps", label: "Ripple Maps" },
  { to: "/scenarios", label: "Scenario Lab" },
  { to: "/assets", label: "Asset Explorer" },
  { to: "/game-theory", label: "Game Theory" },
  { to: "/learning", label: "Model Learning" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/watchlists", label: "Watchlists" },
  { to: "/alerts", label: "Alerts" },
];

export function CommandPalette() {
  const open = useApp((s) => s.commandOpen);
  const setOpen = useApp((s) => s.setCommandOpen);
  const setEvent = useApp((s) => s.setSelectedEventId);
  const navigate = useNavigate();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const liveEvents = useLiveEvents();
  const liveAssets = useLiveAssets();
  const eventsSrc = liveEvents;
  const assetsSrc = liveAssets;

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const events = eventsSrc
      .filter(
        (e) =>
          !query ||
          e.title.toLowerCase().includes(query) ||
          e.theme.toLowerCase().includes(query) ||
          e.region.toLowerCase().includes(query),
      )
      .map((e) => ({ kind: "event" as const, id: e.id, label: e.title, sub: e.region, to: "/" }));
    const assets = assetsSrc
      .filter(
        (a) =>
          !query ||
          a.ticker.toLowerCase().includes(query) ||
          a.name.toLowerCase().includes(query),
      )
      .map((a) => ({
        kind: "asset" as const,
        id: a.ticker,
        label: `${a.ticker} · ${a.name}`,
        sub: a.thesis,
        to: `/assets/${a.ticker}`,
      }));
    const pages = PAGES.filter((p) => !query || p.label.toLowerCase().includes(query)).map((p) => ({
      kind: "page" as const,
      id: p.to,
      label: p.label,
      sub: "Navigate",
      to: p.to,
    }));
    return [...events, ...assets, ...pages].slice(0, 16);
  }, [q, eventsSrc, assetsSrc]);

  useEffect(() => {
    setIdx(0);
  }, [q, open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(items.length - 1, i + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter" && items[idx]) {
        e.preventDefault();
        go(items[idx]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, idx, setOpen]);

  function go(item: (typeof items)[number]) {
    if (item.kind === "event") {
      setEvent(item.id);
      void navigate({ to: "/" });
    } else if (item.kind === "asset") {
      void navigate({ to: "/assets/$ticker", params: { ticker: item.id } });
    } else {
      router.history.push(item.to);
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label="Dismiss search"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-label="Search"
        className="relative w-full max-w-lg overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border-hover)]"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search events, assets, themes…"
          className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-subtle"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-caption text-muted">No matches.</li>
          )}
          {items.map((item, i) => (
            <li key={item.kind + item.id}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(item)}
                className={cn(
                  "flex w-full flex-col items-start px-4 py-2 text-left",
                  i === idx ? "bg-card-2" : "",
                )}
              >
                <span className="text-caption text-foreground">{item.label}</span>
                <span className="truncate text-tiny text-subtle">{item.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
