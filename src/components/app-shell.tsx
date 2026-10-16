import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
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
  Landmark,
  Menu,
  Newspaper,
  Radio,
  NotebookPen,
  PanelLeft,
  Radar,
  Search,
  Settings,
  Swords,
  Sun,
  Moon,
  Sunrise,
  Keyboard,
  X,
} from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { Logo, LogoMark } from "@/components/logo";
import { applyTheme, useTheme } from "@/lib/theme";
import { AuthSlot } from "@/components/auth-slot";
import { Badge, Button, Kbd } from "@/components/ui";
import {
  useAlertHits,
  useLive,
  useLiveEvent,
  useLiveEvents,
} from "@/lib/live/provider";
import { goToEvent, useEventParamSync } from "@/lib/hooks/use-event-param-sync";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { DesktopUpdateNotice } from "@/components/desktop-update";
import { HeadlineTicker } from "@/components/headline-ticker";
import { MacroTopNav } from "@/components/macro/top-nav";
import type { RadarEvent } from "@/data/types";

type NavItem = { to: string; label: string; icon: typeof Activity };

const NAV_GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: "today",
    label: "Today",
    items: [
      { to: "/brief", label: "Morning Briefing", icon: Sunrise },
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
      { to: "/macro", label: "Macro", icon: Landmark },
    ],
  },
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { to: "/theses", label: "Theses", icon: NotebookPen },
      { to: "/watchlists", label: "Watchlists", icon: Bookmark },
      { to: "/alerts", label: "Alerts", icon: Bell },
      { to: "/portfolio", label: "Portfolio", icon: Briefcase },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { to: "/sources", label: "Data sources", icon: Radio },
      { to: "/learning", label: "Learning", icon: GraduationCap },
      { to: "/docs", label: "Docs", icon: BookOpen },
      { to: "/settings", label: "Settings", icon: Settings },
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
  const [shortcuts, setShortcuts] = useState(false);
  const navigateTo = useNavigate();
  const setCommand = useApp((s) => s.setCommandOpen);
  const hits = useAlertHits();
  const event = useLiveEvent(useApp((s) => s.selectedEventId));

  const pendingG = useRef(false);
  useEffect(() => {
    // Opening any page other than the desk counts as having landed; the desk route handles "/".
    try {
      if (window.location.pathname !== "/") sessionStorage.setItem("ripple-landed", "1");
    } catch {
      // ignore
    }
  }, []);
  useEventParamSync();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand(true);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (useApp.getState().commandOpen) return;
      if (pendingG.current) {
        pendingG.current = false;
        const to = GO_KEYS[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
          void navigateTo({ to });
        }
        return;
      }
      if (e.key === "g") {
        pendingG.current = true;
        window.setTimeout(() => (pendingG.current = false), 1200);
      } else if (e.key === "?") {
        setShortcuts((v) => !v);
      } else if (e.key === "[") {
        setRailCollapsed((v) => !v);
      } else if (e.key === "D" && e.shiftKey) {
        const dark = document.documentElement.getAttribute("data-theme") === "dark";
        applyTheme(dark ? "light" : "dark");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommand, navigateTo]);

  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  const macroWorkstation = pathname === "/macro" || pathname.startsWith("/macro/");
  if (macroWorkstation) {
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <MacroTopNav onSearch={() => setCommand(true)} alertCount={hits.length} />
        <HeadlineTicker />
        <DesktopUpdateNotice />
        <main id="main" className="min-w-0 flex-1 overflow-x-hidden">
          <div className="px-2 py-1.5">{children}</div>
        </main>
        <CommandPalette />
      </div>
    );
  }

  const current = NAV_GROUPS.flatMap((g) => g.items).find((n) => pathActive(pathname, n.to));

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border/60 bg-card/55 backdrop-blur-2xl backdrop-saturate-150 transition-[width] duration-300 ease-[var(--ease-spring)] lg:flex",
          railCollapsed ? "w-[4.25rem]" : "w-60",
        )}
        aria-label="Primary"
      >
        <div className={cn("flex h-14 items-center gap-2 px-4", railCollapsed && "justify-center px-0")}>
          <Link to="/brief" className="flex min-w-0 items-center gap-2.5" aria-label="Ripple Radar, Morning Briefing">
            <LogoMark className="size-7" />
            {!railCollapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[0.9375rem] font-semibold tracking-tight">Ripple Radar</span>
                <span className="block truncate text-tiny text-subtle">Trade what it causes next</span>
              </span>
            )}
          </Link>
        </div>
        <div className={cn("px-3 pb-2", railCollapsed && "px-2")}>
          <button
            type="button"
            onClick={() => setCommand(true)}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-lg bg-card-2/80 px-2.5 text-caption text-subtle shadow-[var(--shadow-border)] hover:text-muted",
              railCollapsed && "justify-center px-0",
            )}
            aria-label="Search and commands"
          >
            <Search className="size-4 shrink-0" />
            {!railCollapsed && (
              <>
                <span className="truncate">Search or jump to…</span>
                <span className="ml-auto">
                  <Kbd>⌘K</Kbd>
                </span>
              </>
            )}
          </button>
        </div>
        <SideNav pathname={pathname} collapsed={railCollapsed} alertCount={hits.length} />
        <div className={cn("flex items-center gap-1 border-t border-border/60 p-2", railCollapsed && "flex-col")}>
          <button
            type="button"
            onClick={() => setRailCollapsed((v) => !v)}
            className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-card-2 hover:text-foreground"
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={railCollapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
          >
            {railCollapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => setShortcuts(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-tiny text-subtle hover:bg-card-2 hover:text-foreground"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts  ?"
          >
            <Keyboard className="size-4" />
            {!railCollapsed && <span>Shortcuts</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-2xl backdrop-saturate-150">
          <div className="flex h-14 items-center gap-2 px-3 lg:px-5">
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-card-2 hover:text-foreground lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="hidden min-w-0 shrink-0 flex-col sm:flex">
              <span className="text-tiny font-medium text-subtle">{current ? groupOf(current.to) : "Ripple Radar"}</span>
              <span className="truncate text-base font-semibold leading-tight tracking-tight">{current?.label ?? "Ripple Radar"}</span>
            </div>
            <div className="mx-2 hidden h-7 w-px bg-border/70 md:block" />
            <LivePill />
            <ActiveEventControl event={event} />
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCommand(true)}
                className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-card-2 hover:text-foreground lg:hidden"
                aria-label="Search"
              >
                <Search className="size-4" />
              </button>
              <ThemeToggle />
              <Link
                to="/alerts"
                className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-card-2 hover:text-foreground"
                aria-label={hits.length > 0 ? `Alerts · ${hits.length} firing` : "Alerts"}
              >
                <Bell className="size-4" />
                {hits.length > 0 && (
                  <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-core px-1 text-[9px] font-semibold leading-4 text-white">
                    {hits.length > 9 ? "9+" : hits.length}
                  </span>
                )}
              </Link>
              <AuthSlot />
            </div>
          </div>
          <HeadlineTicker />
        </header>
        <DesktopUpdateNotice />

        <main id="main" className="min-w-0 flex-1 overflow-x-hidden pb-20 lg:pb-0">
          <div key={pathname} className="mx-auto w-full max-w-[1600px] px-3 py-4 lg:px-6 lg:py-5">
            {children}
          </div>
        </main>
      </div>

      <MobileTabBar pathname={pathname} onMore={() => setMobileNav(true)} />

      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-overlay backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card/95 shadow-[var(--shadow-border-hover)] backdrop-blur-2xl">
            <div className="flex items-center justify-between px-4 py-3">
              <Logo />
              <Button variant="ghost" size="icon" onClick={() => setMobileNav(false)} aria-label="Close">
                <X className="size-4" />
              </Button>
            </div>
            <SideNav pathname={pathname} collapsed={false} alertCount={hits.length} />
          </div>
        </div>
      )}

      {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
      <CommandPalette />
    </div>
  );
}

function groupOf(to: string) {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.to === to))?.label ?? "";
}

function ThemeToggle() {
  const { resolved, set } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={() => set(dark ? "light" : "dark")}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-card-2 hover:text-foreground"
      aria-label={dark ? "Switch to light appearance" : "Switch to dark appearance"}
      title={dark ? "Light appearance  ⇧D" : "Dark appearance  ⇧D"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

const TAB_ITEMS: NavItem[] = [
  { to: "/brief", label: "Briefing", icon: Sunrise },
  { to: "/", label: "Desk", icon: Activity },
  { to: "/events", label: "Tape", icon: Newspaper },
  { to: "/alerts", label: "Alerts", icon: Bell },
];

function MobileTabBar({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border/60 bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 lg:hidden"
    >
      {TAB_ITEMS.map((t) => {
        const Icon = t.icon;
        const active = pathActive(pathname, t.to);
        return (
          <Link
            key={t.to}
            to={t.to}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium",
              active ? "text-primary" : "text-subtle",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-5" />
            {t.label}
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium text-subtle">
        <Menu className="size-5" />
        More
      </button>
    </nav>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Search and commands" },
  { keys: ["G", "B"], label: "Morning Briefing" },
  { keys: ["G", "D"], label: "Live Desk" },
  { keys: ["G", "T"], label: "World Tape" },
  { keys: ["G", "M"], label: "Ripple Map" },
  { keys: ["G", "S"], label: "Scenarios" },
  { keys: ["G", "A"], label: "Alerts" },
  { keys: ["G", "P"], label: "Portfolio" },
  { keys: ["G", ","], label: "Settings" },
  { keys: ["["], label: "Collapse or expand sidebar" },
  { keys: ["⇧", "D"], label: "Toggle light / dark" },
  { keys: ["?"], label: "Show shortcuts" },
];

const GO_KEYS: Record<string, string> = {
  b: "/brief",
  d: "/",
  t: "/events",
  m: "/maps",
  s: "/scenarios",
  a: "/alerts",
  p: "/portfolio",
  ",": "/settings",
};

function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-overlay backdrop-blur-sm" aria-label="Close shortcuts" onClick={onClose} />
      <div role="dialog" aria-label="Keyboard shortcuts" className="relative w-full max-w-md rounded-2xl bg-card/95 p-5 shadow-[var(--shadow-border-hover)] backdrop-blur-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Keyboard shortcuts</h2>
        <ul className="mt-3 flex flex-col">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between border-t border-border/50 py-2 text-body first:border-t-0">
              <span className="text-muted">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LivePill() {
  const desk = useLive((s) => s.desk);
  const status = useLive((s) => s.status);
  const error = useLive((s) => s.error);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const ageSec = desk ? Math.max(0, Math.round((now - desk.asOf) / 1000)) : null;
  const fresh = ageSec != null && ageSec < 40 && status !== "degraded";
  const sess = desk?.sessions;

  return (
    <div className="hidden min-w-0 items-center gap-2 text-micro text-subtle md:flex">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <i
          className={cn(
            "size-1.5 rounded-full",
            fresh ? "bg-up" : status === "connecting" || ageSec == null ? "bg-warn" : "bg-down",
          )}
        />
        <span className={fresh ? "text-up" : "text-warn"}>
          {fresh ? "LIVE" : ageSec == null || status === "connecting" ? "CONN" : "STALE"}
        </span>
      </span>
      <span className="font-mono text-foreground" title={desk ? `Tape pulled ${new Date(desk.asOf).toISOString()}` : "No tape yet"}>
        {ageSec == null ? "ET" : `tape ${ageSec}s`}
      </span>
      <span className="hidden gap-1.5 lg:inline-flex">
        <Session on={sess?.ny} label="NY" />
        <Session on={sess?.london} label="LDN" />
        <Session on={sess?.tokyo} label="TYO" />
        <Session on={sess?.futures} label="FUT" />
      </span>
      {error ? (
        <Link to="/sources" className="max-w-56 truncate text-down" title={error}>
          {error}
        </Link>
      ) : desk?.statusDetail ? (
        <Link to="/sources" className="hidden max-w-72 truncate 2xl:inline" title={desk.statusDetail}>
          {desk.statusDetail}
        </Link>
      ) : null}
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
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
    <div ref={ref} className="relative min-w-[12rem] max-w-md flex-1">
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
                    goToEvent(navigate, pathname, e.id);
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

function SideNav({ pathname, collapsed, alertCount = 0 }: { pathname: string; collapsed: boolean; alertCount?: number }) {
  return (
    <nav className={cn("flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-2", collapsed && "items-center px-2")}>
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className={cn("flex flex-col gap-0.5", collapsed && "w-full items-center")}>
          {!collapsed && (
            <div className="px-2 pb-1 text-tiny font-semibold text-subtle">{group.label}</div>
          )}
          {group.items.map((n) => {
            const Icon = n.icon;
            const active = pathActive(pathname, n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                title={n.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-2.5 rounded-lg text-body font-medium",
                  collapsed ? "w-10 justify-center px-0" : "px-2.5",
                  active
                    ? "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-primary)_22%,transparent)]"
                    : "text-muted hover:bg-card-2/80 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-subtle")} />
                {!collapsed && <span className="truncate">{n.label}</span>}
                {n.to === "/alerts" && alertCount > 0 ? (
                  <span className={cn("rounded-full bg-core px-1.5 text-[0.625rem] font-semibold leading-4 text-white", collapsed ? "absolute right-0.5 top-0.5" : "ml-auto")}>
                    {alertCount > 9 ? "9+" : alertCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
