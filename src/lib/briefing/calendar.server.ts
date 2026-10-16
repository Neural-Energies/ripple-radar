import { mergeCalendar, parseFaireconomy, type CalendarView } from "./calendar";

const WEEK = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const TTL_MS = 15 * 60_000;
const UA = "Mozilla/5.0 (compatible; RippleRadar/0.3; +https://neuralenergies.com)";

const globalRef = globalThis as typeof globalThis & { __briefingCalendar__?: { at: number; value: CalendarView } };

export async function loadBriefingCalendar(opts: { fetchImpl?: typeof fetch; nowMs?: number } = {}): Promise<CalendarView> {
  const now = opts.nowMs ?? Date.now();
  const hit = globalRef.__briefingCalendar__;
  if (!opts.fetchImpl && hit && now - hit.at < TTL_MS) return hit.value;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const [live, fred] = await Promise.all([loadFaireconomy(fetchImpl, now), loadFred(now)]);
  const value = mergeCalendar(live, fred);
  if (!opts.fetchImpl) globalRef.__briefingCalendar__ = { at: now, value };
  return value;
}

async function loadFaireconomy(fetchImpl: typeof fetch, nowMs: number): Promise<{ ok: boolean; rows: ReturnType<typeof parseFaireconomy>; error: string }> {
  try {
    const res = await fetchImpl(WEEK, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, rows: [], error: `HTTP ${res.status}` };
    const json: unknown = await res.json();
    return { ok: true, rows: parseFaireconomy(json, nowMs), error: "" };
  } catch (err) {
    return { ok: false, rows: [], error: err instanceof Error ? err.message : "request failed" };
  }
}

async function loadFred(nowMs: number): Promise<{ ok: boolean; rows: ReturnType<typeof parseFaireconomy>; detail: string }> {
  try {
    const { loadReleaseCalendar } = await import("@/lib/live/release-calendar.server");
    const { fredToday } = await import("./calendar");
    const cal = await loadReleaseCalendar({ nowMs });
    if (cal.status === "unavailable") return { ok: false, rows: [], detail: cal.detail };
    return { ok: true, rows: fredToday(cal.items, nowMs), detail: cal.detail };
  } catch (err) {
    return { ok: false, rows: [], detail: err instanceof Error ? err.message : "FRED calendar failed." };
  }
}
