import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui";
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
      className={cn("font-mono text-primary hover:underline", className)}
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
      className={cn("text-primary hover:underline", className)}
    >
      {children ?? query}
    </Link>
  );
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
