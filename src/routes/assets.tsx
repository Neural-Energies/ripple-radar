import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ExposureScatter } from "@/components/charts";
import { Sparkline } from "@/components/sparkline";
import { Badge, Input, Panel } from "@/components/ui";
import { cn, formatPct, formatPrice } from "@/lib/utils";
import { useAlertHits, useLive, useLiveAssets } from "@/lib/live/provider";
import { useApp } from "@/lib/store";

type AssetsSearch = { q?: string; event?: string };

export const Route = createFileRoute("/assets")({
  validateSearch: (raw: Record<string, unknown>): AssetsSearch => ({
    q: typeof raw.q === "string" ? raw.q : undefined,
    event: typeof raw.event === "string" ? raw.event : undefined,
  }),
  component: AssetsPage,
});

type SortKey = "score" | "change" | "ticker" | "distance";

const CROWD_Z: Record<string, number> = {
  low: 40,
  emerging: 55,
  medium: 80,
  high: 110,
  saturated: 140,
};

function AssetsPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { q: qParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const go = useNavigate();
  const [localQ, setLocalQ] = useState(qParam ?? "");
  useEffect(() => {
    setLocalQ(qParam ?? "");
  }, [qParam]);
  const [sort, setSort] = useState<SortKey>("score");
  const [side, setSide] = useState<"all" | "up" | "down">("all");
  const [highlight, setHighlight] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const assets = useLiveAssets();
  const quotes = useLive((s) => s.desk?.quotes);
  const watchlists = useApp((s) => s.watchlists);
  const alerts = useApp((s) => s.alerts);
  const hits = useAlertHits();

  const q = qParam ?? localQ;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = assets.filter(
      (a) =>
        !needle ||
        a.ticker.toLowerCase().includes(needle) ||
        a.name.toLowerCase().includes(needle) ||
        a.bottleneck.toLowerCase().includes(needle) ||
        (a.causalPath?.toLowerCase().includes(needle) ?? false) ||
        (a.thesis?.toLowerCase().includes(needle) ?? false),
    );
    if (side === "up") list = list.filter((a) => a.change >= 0);
    if (side === "down") list = list.filter((a) => a.change < 0);
    list = [...list].sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "change") return b.change - a.change;
      if (sort === "distance") return (a.distance ?? 99) - (b.distance ?? 99);
      return b.score - a.score;
    });
    return list;
  }, [assets, q, sort, side]);

  const scatterPoints = useMemo(
    () =>
      rows.map((a) => ({
        ticker: a.ticker,
        score: a.score,
        distance: a.distance ?? 0,
        change: a.change,
        causalPath: a.causalPath ?? a.bottleneck,
        crowding: a.crowding,
        z: CROWD_Z[a.crowding ?? ""] ?? 50,
      })),
    [rows],
  );

  // "/assets/$ticker" is a child route of "/assets" in the route tree, so its
  // content only ever mounts through this outlet — without this check the
  // list below renders unconditionally and the ticker detail page is
  // unreachable (URL changes, nothing else does).
  if (pathname !== "/assets") return <Outlet />;

  function onQueryChange(next: string) {
    setLocalQ(next);
    void navigate({
      // Annotated rather than inferred. Adding the macro.* child routes widened
      // the union of navigable search schemas, and `prev` stopped resolving to
      // this route's own — a typecheck break that appears when a SIBLING route
      // is added, not when this file changes.
      search: (prev: AssetsSearch) => ({ ...prev, q: next.trim() || undefined }),
      replace: true,
    });
  }

  function onScatterSelect(ticker: string) {
    setHighlight(ticker);
    const el = rowRefs.current[ticker];
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  const firing = hits
    .map((h) => {
      const rule = alerts.find((a) => a.id === h.id);
      return rule ? { ...h, title: rule.title, kind: rule.kind } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  return (
    <div className="grid gap-1.5 xl:grid-cols-[1fr_16rem]">
      <div className="flex flex-col gap-1.5">
        <Panel
          title="Exposure scatter"
          action={
            <span className="text-micro text-muted">
              X = ripple distance · Y = score · color = session % · size ≈ crowding
            </span>
          }
          padded={false}
        >
          <ExposureScatter
            points={scatterPoints}
            highlight={highlight}
            onSelect={onScatterSelect}
          />
          {highlight ? (
            <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5 text-caption">
              <span className="text-muted">
                Highlighted{" "}
                <span className="font-mono text-primary">{highlight}</span>
              </span>
              <button
                type="button"
                className="text-micro text-primary hover:underline"
                onClick={() =>
                  void go({ to: "/assets/$ticker", params: { ticker: highlight } })
                }
              >
                Open asset →
              </button>
            </div>
          ) : (
            <p className="border-t border-border px-2.5 py-1.5 text-tiny text-subtle">
              Hover for ticker / path. Click a point to highlight the table row.
            </p>
          )}
        </Panel>

        <Panel
          title="Asset Explorer"
          action={
            <span className="text-micro text-muted">
              {rows.length} expressions · ranked for the selected shock
            </span>
          }
          padded={false}
        >
          <div className="flex flex-col gap-1.5 border-b border-border px-2.5 py-2 sm:flex-row sm:items-center">
            <Input
              value={q}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Ticker, name, or path"
              aria-label="Filter assets"
              className="sm:max-w-xs"
            />
            <div className="flex flex-wrap gap-1">
              {(["score", "change", "distance", "ticker"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={cn(
                    "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                    sort === k ? "bg-primary/15 text-primary" : "text-muted",
                  )}
                >
                  {k === "score" ? "score" : k === "change" ? "session" : k === "distance" ? "hops" : "ticker"}
                </button>
              ))}
              {(["all", "up", "down"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSide(k)}
                  className={cn(
                    "rounded-sm px-2 py-1 text-micro uppercase tracking-wider",
                    side === k ? "bg-primary/15 text-primary" : "text-muted",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-caption">
              <thead className="text-left text-micro uppercase tracking-wider text-subtle">
                <tr className="border-b border-border">
                  <th className="px-2 py-1 font-medium">Ticker</th>
                  <th className="px-2 py-1 font-medium">Name</th>
                  <th className="px-2 py-1 font-medium" title="Hops from the shock">Hops</th>
                  <th className="px-2 py-1 font-medium" title="Rank on this book. Not a price target.">Score</th>
                  <th className="px-2 py-1 font-medium">Crowd</th>
                  <th className="px-2 py-1 font-medium">Tape</th>
                  <th className="px-2 py-1 font-medium">Last</th>
                  <th className="px-2 py-1 font-medium">Session</th>
                  <th className="px-2 py-1 font-medium">Spark</th>
                  <th className="px-2 py-1 font-medium">Causal path</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.ticker}
                    ref={(el) => {
                      rowRefs.current[a.ticker] = el;
                    }}
                    className={cn(
                      "border-b border-border/70 hover:bg-card-2",
                      highlight === a.ticker && "bg-primary/10",
                    )}
                    onClick={() => setHighlight(a.ticker)}
                  >
                    <td className="px-2 py-1">
                      <Link
                        to="/assets/$ticker"
                        params={{ ticker: a.ticker }}
                        className="font-mono text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.ticker}
                      </Link>
                    </td>
                    <td className="px-2 py-1">{a.name}</td>
                    <td className="px-2 py-1 font-mono tabular-nums text-muted">
                      {a.distance ?? "—"}
                    </td>
                    <td className="px-2 py-1 font-mono tabular-nums">{a.score}</td>
                    <td className="px-2 py-1">
                      <Badge
                        tone={
                          a.crowding === "low" || a.crowding === "emerging"
                            ? "up"
                            : a.crowding === "saturated"
                              ? "core"
                              : "neutral"
                        }
                      >
                        {a.crowding ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-2 py-1 text-micro uppercase tracking-wider text-muted">
                      {a.confirmation ?? "—"}
                    </td>
                    <td className="px-2 py-1 font-mono tabular-nums">{formatPrice(a.last)}</td>
                    <td
                      className={cn(
                        "px-2 py-1 font-mono tabular-nums",
                        a.change >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {formatPct(a.change)}
                    </td>
                    <td className="px-2 py-1">
                      <Sparkline data={quotes?.[a.ticker]?.spark ?? []} />
                    </td>
                    <td className="px-2 py-1 text-tiny text-muted">
                      {a.causalPath ?? a.bottleneck}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <aside className="flex flex-col gap-1.5">
        <Panel
          title="Watchlists"
          action={
            <Link to="/watchlists" className="text-micro text-primary hover:underline">
              Open
            </Link>
          }
        >
          {watchlists.length === 0 ? (
            <p className="text-caption text-muted">No lists yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {watchlists.map((w) => (
                <li key={w.id} className="rounded-sm bg-card-2 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-caption font-medium">{w.name}</span>
                    <span className="font-mono text-tiny text-subtle">{w.tickers.length}</span>
                  </div>
                  {w.tickers.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {w.tickers.slice(0, 6).map((t) => (
                        <Link
                          key={t}
                          to="/assets/$ticker"
                          params={{ ticker: t }}
                          className="font-mono text-tiny text-primary hover:underline"
                        >
                          {t}
                        </Link>
                      ))}
                      {w.tickers.length > 6 ? (
                        <span className="text-tiny text-subtle">+{w.tickers.length - 6}</span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-tiny text-subtle">Empty</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Alert hits"
          action={
            <Link to="/alerts" className="text-micro text-primary hover:underline">
              Rules
            </Link>
          }
        >
          {firing.length === 0 ? (
            <p className="text-caption text-muted">No rules firing on the live tape.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {firing.map((h) => (
                <li key={h.id} className="rounded-sm bg-card-2 px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="core">firing</Badge>
                    <Badge tone="primary">{h.kind}</Badge>
                  </div>
                  <div className="mt-1 text-caption font-medium">{h.title}</div>
                  <p className="mt-0.5 font-mono text-tiny text-up">{h.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </aside>
    </div>
  );
}
