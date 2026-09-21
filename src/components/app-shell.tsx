import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  BookOpen,
  Bookmark,
  Briefcase,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FlaskConical,
  GraduationCap,
  LineChart,
  Menu,
  Newspaper,
  PanelLeft,
  Radar,
  Search,
  Swords,
  X,
} from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { Logo } from "@/components/logo";
import { AuthSlot } from "@/components/auth-slot";
import { Badge, Button, Kbd } from "@/components/ui";
import { etParts } from "@/lib/live/clock";
import {
  useAlertHits,
  useLive,
  useLiveEvent,
  useLiveEvents,
} from "@/lib/live/provider";
import { useEventParamSync } from "@/lib/hooks/use-event-param-sync";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { RadarEvent } from "@/data/types";

type NavItem = { to: string; label: string; icon: typeof Activity };

const NAV_GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: "desk",
    label: "Desk",
    items: [
      { to: "/", label: "Live Desk", icon: Activity },
      { to: "/events", label: "World Tape", icon: Newspaper },
    ],
  },
  {
    id: "research",
    label: "Research",
    items: [
      { to: "/maps", label: "Ripple Map", icon: Radar },
      { to: "/scenarios", label: "Scenarios", icon: FlaskConical },
      { to: "/game-theory", label: "Game Theory", icon: Swords },
      { to: "/assets", label: "Assets", icon: LineChart },
    ],
  },
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { to: "/watchlists", label: "Watchlists", icon: Bookmark },
      { to: "/alerts", label: "Alerts", icon: Bell },
      { to: "/portfolio", label: "Portfolio", icon: Briefcase },
    ],
  },
  {
    id: "model",
    label: "Model",
    items: [
      { to: "/learning", label: "Learning", icon: GraduationCap },
      { to: "/docs", label: "Docs", icon: BookOpen },
    ],
  },
];

function pathActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(to + "/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileNav, setMobileNav] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const setCommand = useApp((s) => s.setCommandOpen);
  const hits = useAlertHits();
  const event = useLiveEvent(useApp((s) => s.selectedEventId));

  useEventParamSync();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommand]);

  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex h-10 items-center gap-1.5 px-2 lg:gap-2 lg:px-2.5">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-card-2 hover:text-foreground lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu className="size-5" />
          </button>

          <Link to="/" className="shrink-0">
            <Logo compact />
          </Link>

          <LivePill />

          <ActiveEventControl event={event} />

          <button
            type="button"
            onClick={() => setCommand(true)}
            className="ml-auto flex h-7 min-w-0 items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-tiny text-subtle hover:border-primary/40 hover:text-muted sm:w-40 lg:w-48"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="hidden truncate sm:inline">Search</span>
            <span className="ml-auto hidden sm:inline">
              <Kbd>⌘K</Kbd>
            </span>
          </button>

          <Link
            to="/alerts"
            className="relative inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-card-2 hover:text-foreground"
            aria-label={hits.length > 0 ? `Alerts · ${hits.length} firing` : "Alerts"}
          >
            <Bell className="size-4" />
            {hits.length > 0 && (
              <span className="absolute right-1 top-1 flex min-w-3.5 items-center justify-center rounded-full bg-core px-0.5 text-[9px] font-medium leading-none text-primary-foreground">
                {hits.length > 9 ? "9+" : hits.length}
              </span>
            )}
          </Link>
          <AuthSlot />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "sticky top-10 hidden h-[calc(100dvh-2.5rem)] shrink-0 flex-col border-r border-border bg-background transition-[width] duration-150 lg:flex",
            railCollapsed ? "w-11" : "w-[11.5rem]",
          )}
        >
          <SideNav pathname={pathname} collapsed={railCollapsed} />
          <button
            type="button"
            onClick={() => setRailCollapsed((v) => !v)}
            className="mt-auto flex h-8 items-center justify-center gap-2 border-t border-border text-subtle hover:bg-card-2 hover:text-muted"
            aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={railCollapsed ? "Expand" : "Collapse"}
          >
            {railCollapsed ? (
              <ChevronsRight className="size-3.5" />
            ) : (
              <>
                <ChevronsLeft className="size-3.5" />
                <span className="text-micro uppercase tracking-wider">Collapse</span>
              </>
            )}
          </button>
        </aside>

        <main id="main" className="min-w-0 flex-1 overflow-x-hidden">
          <div className="px-2 py-1.5 lg:px-2.5 lg:py-2">{children}</div>
        </main>
      </div>

      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-overlay"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-[var(--shadow-border)]">
            <div className="flex items-center justify-between border-b border-border px-3 py-3">
              <Logo />
              <Button variant="ghost" size="icon" onClick={() => setMobileNav(false)} aria-label="Close">
                <X className="size-4" />
              </Button>
            </div>
            <SideNav pathname={pathname} collapsed={false} />
          </div>
        </div>
      )}

      <CommandPalette />
    </div>
  );
}

function LivePill() {
  const desk = useLive((s) => s.desk);
  const status = useLive((s) => s.status);
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
    <div className="hidden min-w-0 items-center gap-2 text-micro text-subtle md:flex">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <i
          className={cn(
            "size-1.5 rounded-full",
            live ? "bg-up" : status === "connecting" ? "bg-warn" : "bg-down",
          )}
        />
        <span className={live ? "text-up" : "text-warn"}>
          {live ? "LIVE" : status === "connecting" ? "CONN" : "DEG"}
        </span>
      </span>
      <span className="font-mono text-foreground">{clock || "ET"}</span>
      <span className="hidden gap-1.5 lg:inline-flex">
        <Session on={sess?.ny} label="NY" />
        <Session on={sess?.london} label="LDN" />
        <Session on={sess?.tokyo} label="TYO" />
        <Session on={sess?.futures} label="FUT" />
      </span>
    </div>
  );
}

function Session({ on, label }: { on: boolean | undefined; label: string }) {
  return (
    <span className={on ? "text-up" : "text-subtle"}>
      {label}
    </span>
  );
}

function ActiveEventControl({ event }: { event: RadarEvent }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const setId = useApp((s) => s.setSelectedEventId);
  const events = useLiveEvents();
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => (b.importance ?? b.probability) - (a.importance ?? a.probability),
      ),
    [events],
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const empty = !event.id || event.title === "Listening to the world tape";

  return (
    <div ref={ref} className="relative min-w-0 max-w-md flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-left hover:border-primary/40"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Active event"
      >
        <PanelLeft className="hidden size-3.5 shrink-0 text-primary sm:block" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption font-medium text-foreground">
            {empty ? "No active event" : event.title}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {event.lifecycle && (
            <Badge tone="primary" className="max-w-24 truncate">
              {event.lifecycle}
            </Badge>
          )}
          {event.importance != null && (
            <span className="font-mono text-tiny tabular-nums text-muted" title="Importance">
              {event.importance}
            </span>
          )}
          <span className="font-mono text-tiny tabular-nums text-foreground" title="Probability">
            {event.probability}%
          </span>
        </div>
        <ChevronDown className={cn("size-3.5 shrink-0 text-subtle transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-72 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-[var(--shadow-border-hover)]"
        >
          {sorted.length === 0 && (
            <li className="px-3 py-4 text-center text-caption text-muted">No books on the tape</li>
          )}
          {sorted.map((e) => {
            const active = e.id === event.id;
            return (
              <li key={e.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setId(e.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-card-2",
                    active && "bg-primary/10",
                  )}
                >
                  <span className="line-clamp-2 text-caption text-foreground">{e.title}</span>
                  <span className="flex gap-2 font-mono text-micro text-subtle">
                    {e.lifecycle && <span className="uppercase text-primary">{e.lifecycle}</span>}
                    <span>imp {e.importance ?? "—"}</span>
                    <span>{e.probability}%</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SideNav({ pathname, collapsed }: { pathname: string; collapsed: boolean }) {
  return (
    <nav className={cn("flex flex-1 flex-col gap-2 overflow-y-auto p-1.5", collapsed && "items-center")}>
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className={cn("flex flex-col gap-px", collapsed && "w-full items-center")}>
          {!collapsed && (
            <div className="px-2 pb-0.5 pt-1 text-[0.5625rem] font-medium uppercase tracking-wider text-subtle">
              {group.label}
            </div>
          )}
          {group.items.map((n) => {
            const Icon = n.icon;
            const active = pathActive(pathname, n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                title={n.label}
                className={cn(
                  "relative flex min-h-8 items-center gap-2 rounded-sm text-caption transition-colors duration-150",
                  collapsed ? "size-8 justify-center px-0" : "px-2",
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted hover:bg-card-2 hover:text-foreground",
                )}
              >
                {active && !collapsed ? (
                  <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" aria-hidden />
                ) : null}
                <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} />
                {!collapsed && <span className="truncate">{n.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
