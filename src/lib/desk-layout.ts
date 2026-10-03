export const STRIP_IDS = ["brief", "macro", "session", "vol", "developing"] as const;
export const MAIN_IDS = ["chain", "geo", "trades"] as const;
export const SIDE_IDS = ["paths", "forecast", "names", "ace", "moving", "checks", "evidence"] as const;
export const WIDGET_IDS = [...STRIP_IDS, ...MAIN_IDS, ...SIDE_IDS] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];
export type WidgetZone = "strip" | "main" | "side";
export type SideSpan = 3 | 4 | 6;

export const WIDGET_LABEL: Record<WidgetId, string> = {
  brief: "Brief",
  macro: "Macro strip",
  session: "Session check",
  vol: "Volatility",
  developing: "Developing now",
  chain: "Causal chain",
  geo: "Places",
  trades: "Exposed markets",
  paths: "Paths",
  forecast: "Forecast change",
  names: "Your names",
  ace: "ACE odds",
  moving: "Already moving",
  checks: "Next checks",
  evidence: "Key evidence",
};

export const DESK_LAYOUT_KEY = "ripple-desk-layout";

export interface DeskLayout {
  order: Record<WidgetZone, WidgetId[]>;
  hidden: WidgetId[];
  sideSpan: SideSpan;
  /** Exposed-markets category. "All" shows every name. */
  tradeFilter: "All" | "etf" | "stock" | "futures" | "forex" | "commodities" | "crypto";
}

const ZONE_OF: Record<WidgetId, WidgetZone> = {
  brief: "strip",
  macro: "strip",
  session: "strip",
  vol: "strip",
  developing: "strip",
  chain: "main",
  geo: "main",
  trades: "main",
  paths: "side",
  forecast: "side",
  names: "side",
  ace: "side",
  moving: "side",
  checks: "side",
  evidence: "side",
};

const TRADE_FILTERS = ["All", "etf", "stock", "futures", "forex", "commodities", "crypto"] as const;

export function defaultDeskLayout(): DeskLayout {
  return {
    order: {
      strip: [...STRIP_IDS],
      main: [...MAIN_IDS],
      side: [...SIDE_IDS],
    },
    hidden: [],
    sideSpan: 3,
    tradeFilter: "All",
  };
}

function isWidget(id: string): id is WidgetId {
  return (WIDGET_IDS as readonly string[]).includes(id);
}

export function zoneOf(id: WidgetId): WidgetZone {
  return ZONE_OF[id];
}

export function parseDeskLayout(raw: unknown): DeskLayout {
  const base = defaultDeskLayout();
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Partial<DeskLayout>;
  const hidden = Array.isArray(row.hidden) ? row.hidden.filter(isWidget) : [];
  const order = { ...base.order };
  for (const zone of ["strip", "main", "side"] as const) {
    const given = Array.isArray(row.order?.[zone]) ? row.order[zone].filter(isWidget) : [];
    const kept = given.filter((id) => ZONE_OF[id] === zone);
    const missing = base.order[zone].filter((id) => !kept.includes(id));
    order[zone] = [...kept, ...missing];
  }
  const sideSpan: SideSpan = row.sideSpan === 4 || row.sideSpan === 6 || row.sideSpan === 3 ? row.sideSpan : 3;
  const tradeFilter = TRADE_FILTERS.find((f) => f === row.tradeFilter) ?? "All";
  return { order, hidden: [...new Set(hidden)], sideSpan, tradeFilter };
}

export function readDeskLayout(): DeskLayout {
  try {
    const raw = globalThis.localStorage?.getItem(DESK_LAYOUT_KEY);
    if (!raw) return defaultDeskLayout();
    return parseDeskLayout(JSON.parse(raw));
  } catch {
    return defaultDeskLayout();
  }
}

export function writeDeskLayout(layout: DeskLayout): DeskLayout {
  const next = parseDeskLayout(layout);
  try {
    globalThis.localStorage?.setItem(DESK_LAYOUT_KEY, JSON.stringify(next));
  } catch {
    // This session still uses the returned layout.
  }
  return next;
}

export function toggleWidget(layout: DeskLayout, id: WidgetId): DeskLayout {
  const hidden = layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id];
  return { ...layout, hidden };
}

export function moveWidget(layout: DeskLayout, id: WidgetId, dir: -1 | 1): DeskLayout {
  const zone = ZONE_OF[id];
  const list = [...layout.order[zone]];
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return layout;
  const swap = list[j];
  if (!swap) return layout;
  list[i] = swap;
  list[j] = id;
  return { ...layout, order: { ...layout.order, [zone]: list } };
}

export function cycleSideSpan(layout: DeskLayout): DeskLayout {
  const sideSpan: SideSpan = layout.sideSpan === 3 ? 4 : layout.sideSpan === 4 ? 6 : 3;
  return { ...layout, sideSpan };
}
