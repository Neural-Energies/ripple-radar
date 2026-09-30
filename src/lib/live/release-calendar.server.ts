/**
 * Fetch the next scheduled dates for each calendar release from FRED. One call
 * per release, cached for six hours; a release that fails is reported, not
 * guessed. Missing key → unavailable.
 */
import { env } from "../env.server.ts";
import { FRED_API_BASE, FRED_USER_AGENT } from "./fred.server.ts";
import { addDays, CALENDAR_RELEASES, calendarItems, nyDate, parseReleaseDates, type ReleaseCalendar } from "./release-calendar.ts";

const TTL_MS = 6 * 60 * 60 * 1000;
/** How far ahead the calendar reaches. */
export const CALENDAR_DAYS = 21;

let cache: { at: number; day: string; calendar: ReleaseCalendar } | null = null;

export async function loadReleaseCalendar(opts: { fetchImpl?: typeof fetch; nowMs?: number; apiKey?: string } = {}): Promise<ReleaseCalendar> {
  const nowMs = opts.nowMs ?? Date.now();
  const today = nyDate(nowMs);
  if (!opts.fetchImpl && cache && cache.day === today && nowMs - cache.at < TTL_MS) return cache.calendar;
  const key = opts.apiKey ?? env("FRED_API_KEY");
  const fetchedAt = new Date(nowMs).toISOString();
  if (!key) return { status: "unavailable", detail: "FRED_API_KEY missing — release calendar skipped.", fetchedAt, items: [] };
  const doFetch = opts.fetchImpl ?? fetch;
  const dates = new Map<number, string[]>();
  const failed: string[] = [];
  await Promise.all(
    CALENDAR_RELEASES.map(async (r) => {
      const params = new URLSearchParams({
        release_id: String(r.id),
        api_key: key,
        file_type: "json",
        realtime_start: today,
        realtime_end: "9999-12-31",
        include_release_dates_with_no_data: "true",
        sort_order: "asc",
        limit: "40",
      });
      try {
        const res = await doFetch(`${FRED_API_BASE}release/dates?${params}`, {
          headers: { "User-Agent": FRED_USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        dates.set(r.id, parseReleaseDates(await res.json(), today));
      } catch {
        failed.push(r.name);
      }
    }),
  );
  const items = calendarItems(dates, today, addDays(today, CALENDAR_DAYS));
  const calendar: ReleaseCalendar =
    failed.length === CALENDAR_RELEASES.length
      ? { status: "unavailable", detail: "FRED release calendar unreachable.", fetchedAt, items: [] }
      : {
          status: failed.length ? "partial" : "ok",
          detail: failed.length ? `Not loaded: ${failed.sort().join(", ")}.` : `FRED release calendar, next ${CALENDAR_DAYS} days.`,
          fetchedAt,
          items,
        };
  if (!opts.fetchImpl && calendar.status !== "unavailable") cache = { at: nowMs, day: today, calendar };
  return calendar;
}
