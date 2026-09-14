import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  Bookmark,
  Briefcase,
  FlaskConical,
  GraduationCap,
  LineChart,
  Menu,
  Newspaper,
  Radar,
  Search,
  Swords,
  X,
} from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { Logo } from "@/components/logo";
import { AuthSlot } from "@/components/auth-slot";
import { LiveStatus, LiveTape } from "@/components/live-tape";
import { Button, Kbd } from "@/components/ui";
import { useLiveEvent } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const TOP_NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/events", label: "Events" },
  { to: "/scenarios", label: "Scenarios" },
  { to: "/assets", label: "Assets" },
  { to: "/game-theory", label: "Game Theory" },
  { to: "/learning", label: "Learning" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/alerts", label: "Alerts" },
] as const;

const SIDE_NAV = [
  { to: "/", label: "Live Overview", icon: Activity },
  { to: "/events", label: "Event Feed", icon: Newspaper },
  { to: "/maps", label: "Ripple Maps", icon: Radar },
  { to: "/scenarios", label: "Scenario Lab", icon: FlaskConical },
  { to: "/assets", label: "Asset Explorer", icon: LineChart },
  { to: "/game-theory", label: "Game Theory", icon: Swords },
  { to: "/learning", label: "Model Learning", icon: GraduationCap },
  { to: "/portfolio", label: "Portfolio", icon: Briefcase },
  { to: "/watchlists", label: "Watchlists", icon: Bookmark },
] as const;

function pathActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(to + "/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileNav, setMobileNav] = useState(false);
  const setCommand = useApp((s) => s.setCommandOpen);
  const alerts = useApp((s) => s.alerts).filter((a) => a.active).length;
  const event = useLiveEvent(useApp((s) => s.selectedEventId));

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
        <div className="flex h-12 items-center gap-3 px-3 lg:px-4">
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md text-muted hover:bg-card-2 hover:text-foreground lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu className="size-5" />
          </button>
          <Link to="/" className="shrink-0">
            <Logo compact />
          </Link>
          <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
            {TOP_NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-caption transition-colors duration-150",
                  pathActive(pathname, n.to)
                    ? "bg-card-2 text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setCommand(true)}
            className="ml-auto flex h-8 min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2 text-tiny text-subtle hover:border-primary/40 hover:text-muted sm:w-56 lg:w-72"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="hidden truncate sm:inline">Search events, assets, or themes</span>
            <span className="ml-auto hidden sm:inline">
              <Kbd>⌘K</Kbd>
            </span>
          </button>
          <Link
            to="/alerts"
            className="relative inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-card-2 hover:text-foreground"
            aria-label="Alerts"
          >
            <Bell className="size-4" />
            {alerts > 0 && (
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-core" />
            )}
          </Link>
          <AuthSlot />
        </div>
      </header>
      <LiveTape />

      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-52 shrink-0 flex-col border-r border-border bg-background lg:flex">
          <SideNav pathname={pathname} />
          <Quote />
        </aside>

        <main id="main" className="min-w-0 flex-1 overflow-x-hidden">
          <LiveStatus region={event.region} />
          <div className="px-3 py-3 lg:px-4 lg:py-4">{children}</div>
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
            <SideNav pathname={pathname} />
            <Quote />
          </div>
        </div>
      )}

      <CommandPalette />
    </div>
  );
}

function SideNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 p-2">
      {SIDE_NAV.map((n) => {
        const Icon = n.icon;
        const active = pathActive(pathname, n.to);
        return (
          <Link
            key={n.to + n.label}
            to={n.to}
            className={cn(
              "flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-caption transition-colors duration-150",
              active
                ? "bg-primary/10 text-foreground"
                : "text-muted hover:bg-card-2 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4", active && "text-primary")} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Quote() {
  return (
    <blockquote className="border-t border-border px-4 py-4 text-tiny leading-relaxed text-subtle">
      “Don't trade the headline. Trade what it causes next.”
      <footer className="mt-2 text-micro uppercase tracking-wider text-primary">Ripple Radar</footer>
    </blockquote>
  );
}
