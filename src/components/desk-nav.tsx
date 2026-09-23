import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui";
import { nodeNavTarget } from "@/lib/engine/instruments";
import { cn } from "@/lib/utils";

/** Liquid ticker → single-asset book. Never invents a symbol. */
export function TickerLink({
  ticker,
  className,
  children,
}: {
  ticker: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  return (
    <Link
      to="/assets/$ticker"
      params={{ ticker: t }}
      className={cn(
        "font-mono text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      {children ?? t}
    </Link>
  );
}

/** Free-text actor / industry / commodity → assets filter. */
export function FilterLink({
  q,
  className,
  children,
}: {
  q: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const query = q.trim();
  if (!query) return null;
  return (
    <Link
      to="/assets"
      search={{ q: query }}
      className={cn(
        "text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      {children ?? query}
    </Link>
  );
}

/** Causal node → ticker book or assets filter. Never invents a symbol. */
export function NodeNavLink({
  node,
  event,
  className,
  children,
}: {
  node: { id: string; label: string; ticker?: string; level: number };
  event: {
    headlineTicker?: string;
    trades: Array<{ ticker: string; headline?: boolean }>;
    marketReaction: Array<{ ticker: string }>;
  };
  className?: string;
  children?: React.ReactNode;
}) {
  const nav = nodeNavTarget(node, event);
  const label = children ?? node.label;
  if (nav?.kind === "ticker") {
    return (
      <Link
        to="/assets/$ticker"
        params={{ ticker: nav.ticker }}
        className={cn(
          "text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          className,
        )}
      >
        {label}
      </Link>
    );
  }
  if (nav?.kind === "filter") {
    return (
      <Link
        to="/assets"
        search={{ q: nav.q }}
        className={cn(
          "text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          className,
        )}
      >
        {label}
      </Link>
    );
  }
  return <span className={className}>{label}</span>;
}

/** Honest marker for surfaces that are not live engine output. */
export function FrozenBadge({ title }: { title?: string }) {
  return (
    <Badge
      tone="warn"
      title={title ?? "Frozen placeholder — not live desk output. Do not treat as calibrated."}
    >
      Frozen
    </Badge>
  );
}
