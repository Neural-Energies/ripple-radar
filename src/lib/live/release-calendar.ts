/**
 * The scheduled US macro releases the desk reads, and when each is next out.
 *
 * Dates come from FRED's release calendar (`fred/release/dates` with
 * `include_release_dates_with_no_data`), which lists a release's scheduled
 * dates before its data exist. Release IDs were read from FRED's own
 * `series/release` for the series named here, not assigned by hand. Releases
 * published every business day (H.15 rates, spot prices, spreads, VIX) are not
 * catalysts and are left out. FOMC meeting dates are not in FRED's calendar
 * and are not shown.
 */

export interface CalendarRelease {
  id: number;
  name: string;
  /** The series on this desk the release moves. */
  moves: string[];
}

export const CALENDAR_RELEASES: CalendarRelease[] = [
  { id: 50, name: "Employment Situation", moves: ["Payrolls", "Unemployment rate"] },
  { id: 10, name: "Consumer Price Index", moves: ["CPI", "Core CPI"] },
  { id: 46, name: "Producer Price Index", moves: ["PPI"] },
  { id: 54, name: "Personal Income and Outlays", moves: ["PCE prices", "Real spending"] },
  { id: 53, name: "Gross Domestic Product", moves: ["Real GDP"] },
  { id: 9, name: "Advance Retail Sales", moves: ["Retail sales"] },
  { id: 13, name: "Industrial Production (G.17)", moves: ["Industrial production"] },
  { id: 27, name: "New Residential Construction", moves: ["Housing starts"] },
  { id: 192, name: "JOLTS", moves: ["Job openings"] },
  { id: 91, name: "Surveys of Consumers (UMich)", moves: ["Consumer sentiment"] },
  { id: 180, name: "Weekly Jobless Claims", moves: ["Initial claims"] },
];

export interface CalendarItem {
  releaseId: number;
  name: string;
  /** ISO date (YYYY-MM-DD), as FRED schedules it. No time of day is published there. */
  date: string;
  moves: string[];
  url: string;
}

export interface ReleaseCalendar {
  status: "ok" | "partial" | "unavailable";
  detail: string;
  fetchedAt: string;
  items: CalendarItem[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The scheduled dates in one `release/dates` response, on or after `from`. */
export function parseReleaseDates(json: unknown, from: string): string[] {
  const rows = (json as { release_dates?: { date?: unknown }[] } | null)?.release_dates;
  if (!Array.isArray(rows)) return [];
  return [...new Set(rows.map((r) => r?.date).filter((d): d is string => typeof d === "string" && ISO.test(d) && d >= from))].sort();
}

/** One row per scheduled date within [from, to], earliest first; ties in list order. */
export function calendarItems(dates: Map<number, string[]>, from: string, to: string): CalendarItem[] {
  const items: CalendarItem[] = [];
  CALENDAR_RELEASES.forEach((r) => {
    for (const date of dates.get(r.id) ?? []) {
      if (date < from || date > to) continue;
      items.push({ releaseId: r.id, name: r.name, date, moves: r.moves, url: `https://fred.stlouisfed.org/releases/calendar?rid=${r.id}` });
    }
  });
  const order = new Map(CALENDAR_RELEASES.map((r, i) => [r.id, i]));
  return items.sort((a, b) => (a.date === b.date ? order.get(a.releaseId)! - order.get(b.releaseId)! : a.date < b.date ? -1 : 1));
}

/** YYYY-MM-DD in New York, where these releases are scheduled. */
export function nyDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
