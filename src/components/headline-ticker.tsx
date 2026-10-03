import { Link } from "@tanstack/react-router";
import { EMPTY_HEADLINES } from "@/lib/live/empty";
import { useLive } from "@/lib/live/provider";
import { safeHttpUrl } from "@/lib/safe-url";

/** Scrolling live headlines. Quotes stay on the book; this strip is the news tape. */
export function HeadlineTicker() {
  const headlines = useLive((s) => s.desk?.tape ?? s.desk?.headlines ?? EMPTY_HEADLINES);
  const status = useLive((s) => s.status);
  const items = headlines.slice(0, 16);
  if (items.length === 0) {
    return (
      <div className="border-b border-border bg-card px-2 py-1 font-mono text-micro text-subtle">
        {status === "live" || status === "degraded" ? (
          <Link to="/sources" className="hover:text-primary hover:underline">
            No headlines on the last pull. Open data sources.
          </Link>
        ) : (
          "Connecting the world tape…"
        )}
      </div>
    );
  }
  const doubled = [...items, ...items];
  return (
    <div className="overflow-hidden border-b border-border bg-card">
      <div className="flex w-max animate-tape gap-6 px-2 py-1">
        {doubled.map((h, i) => {
          const href = safeHttpUrl(h.url);
          const body = (
            <>
              <span className="text-subtle">{h.source}</span>
              <span className="text-foreground">{h.title}</span>
            </>
          );
          return href ? (
            <a
              key={h.id + i}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex max-w-[28rem] items-baseline gap-1.5 truncate font-mono text-micro hover:text-primary"
            >
              {body}
            </a>
          ) : (
            <Link
              key={h.id + i}
              to="/events"
              className="flex max-w-[28rem] items-baseline gap-1.5 truncate font-mono text-micro hover:text-primary"
            >
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
