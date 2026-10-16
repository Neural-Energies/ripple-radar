/**
 * Today's economic calendar. Times and impact labels are taken from the
 * source. A release with no clock time is marked date-only rather than given
 * one.
 */
import { nyDate } from "@/lib/live/release-calendar";

export interface CalendarRow {
  title: string;
  country: string;
  /** Epoch ms when the source published a timestamp. Null when it published a date only. */
  atMs: number | null;
  /** Clock in America/New_York, or "Date only". */
  when: string;
  /** Impact label as published by the source. */
  impact: string;
  source: "faireconomy" | "fred";
  forecast: string | null;
  previous: string | null;
}

export interface CalendarView {
  status: "ok" | "partial" | "unavailable";
  detail: string;
  items: CalendarRow[];
}

const CAP = 24;

export function parseFaireconomy(json: unknown, nowMs: number): CalendarRow[] {
  if (!Array.isArray(json)) return [];
  const today = nyDate(nowMs);
  const rows: CalendarRow[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const title = str(row, "title");
    const country = str(row, "country");
    const date = str(row, "date");
    const impact = str(row, "impact") || "Unspecified";
    if (!title || !date) continue;
    const at = Date.parse(date);
    if (!Number.isFinite(at)) continue;
    if (nyDate(at) !== today) continue;
    rows.push({
      title,
      country,
      atMs: at,
      when: clock(at),
      impact,
      source: "faireconomy",
      forecast: empty(str(row, "forecast")),
      previous: empty(str(row, "previous")),
    });
  }
  rows.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  return cap(rows);
}

export function fredToday(
  items: { name: string; date: string; moves: string[] }[],
  nowMs: number,
): CalendarRow[] {
  const today = nyDate(nowMs);
  return items
    .filter((item) => item.date === today && item.name)
    .map((item) => ({
      title: item.name,
      country: "US",
      atMs: null,
      when: "Date only",
      impact: "Scheduled",
      source: "fred" as const,
      forecast: null,
      previous: item.moves.length ? item.moves.join(", ") : null,
    }));
}

export function mergeCalendar(
  live: { ok: boolean; rows: CalendarRow[]; error: string },
  fred: { ok: boolean; rows: CalendarRow[]; detail: string },
): CalendarView {
  const items = cap([...live.rows, ...fred.rows].sort((a, b) => compareWhen(a, b)));
  if (!live.ok && !fred.ok) {
    return { status: "unavailable", detail: live.error || fred.detail || "Calendar sources did not answer.", items: [] };
  }
  if (!live.ok) {
    return {
      status: fred.rows.length ? "partial" : "unavailable",
      detail: `Public calendar did not answer (${live.error}). ${fred.detail}`,
      items,
    };
  }
  if (!fred.ok) {
    return {
      status: "ok",
      detail: items.length
        ? `Public calendar (Faireconomy). ${fred.detail}`
        : `Nothing scheduled today on the public calendar. ${fred.detail}`,
      items,
    };
  }
  return {
    status: items.length ? "ok" : "ok",
    detail: items.length ? "Public calendar plus FRED releases scheduled today." : "Nothing scheduled today.",
    items,
  };
}

function cap(rows: CalendarRow[]): CalendarRow[] {
  return rows.slice(0, CAP);
}

function compareWhen(a: CalendarRow, b: CalendarRow): number {
  if (a.atMs == null && b.atMs == null) return a.title.localeCompare(b.title);
  if (a.atMs == null) return 1;
  if (b.atMs == null) return -1;
  return a.atMs - b.atMs;
}

function clock(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

function str(row: object, key: string): string {
  const v = (row as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : "";
}

function empty(v: string): string | null {
  return v ? v : null;
}
