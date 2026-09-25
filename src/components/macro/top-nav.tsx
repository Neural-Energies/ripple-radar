import { Bell, Search } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AuthSlot } from "@/components/auth-slot";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/macro", label: "Macro" },
  { to: "/assets", label: "Markets" },
  { to: "/events", label: "Events" },
  { to: "/game-theory", label: "ACE" },
  { to: "/scenarios", label: "Scenarios" },
  { to: "/events", label: "World" },
  { to: "/watchlists", label: "Options" },
  { to: "/watchlists", label: "Watchlist" },
] as const;

function active(path: string, to: string) {
  if (to === "/") return path === "/";
  return path === to || path.startsWith(to + "/");
}

export function MacroTopNav({
  onSearch,
  alertCount = 0,
}: {
  onSearch: () => void;
  alertCount?: number;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[#07101c]/98">
      <div className="flex h-9 items-center gap-1 px-3">
        <Link to="/" className="mr-2 shrink-0">
          <Logo compact />
        </Link>

        <nav className="hidden h-full items-stretch lg:flex" aria-label="Primary">
          {NAV.map((item) => {
            const on = item.label === "Macro" ? path.startsWith("/macro") : active(path, item.to);
            return (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  "relative flex h-full items-center px-3 text-[10px] text-muted transition-colors hover:bg-card-2/60 hover:text-foreground",
                  on && "bg-[#10223a] text-[#66c9ff]",
                )}
              >
                {item.label}
                {on ? <span className="absolute inset-x-0 bottom-0 h-px bg-[#52bdf4]" /> : null}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onSearch}
          className="ml-auto hidden h-7 w-[13rem] items-center gap-2 rounded-sm border border-border bg-[#0c1828] px-2 text-left text-[9px] text-subtle hover:border-primary/40 xl:flex"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="truncate">Search assets, events, or data...</span>
        </button>

        <Link
          to="/alerts"
          className="relative inline-flex size-8 items-center justify-center rounded-sm text-muted hover:bg-card-2 hover:text-foreground"
          aria-label={alertCount > 0 ? `Alerts · ${alertCount} firing` : "Alerts"}
        >
          <Bell className="size-3.5" />
          {alertCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 flex min-w-3 items-center justify-center rounded-full bg-core px-0.5 text-[8px] leading-none text-primary-foreground">
              {alertCount > 9 ? "9+" : alertCount}
            </span>
          ) : null}
        </Link>

        <AuthSlot />
      </div>
    </header>
  );
}
