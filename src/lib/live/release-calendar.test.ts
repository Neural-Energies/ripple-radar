/**
 * The release calendar lists FRED's scheduled dates as FRED gives them, drops
 * past dates, and says which releases it could not load.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, CALENDAR_RELEASES, calendarItems, nyDate, parseReleaseDates } from "./release-calendar.ts";
import { loadReleaseCalendar } from "./release-calendar.server.ts";

test("dates are parsed, de-duplicated, sorted and cut at today", () => {
  const json = { release_dates: [{ date: "2026-10-14" }, { date: "2026-09-29" }, { date: "2026-10-02" }, { date: "2026-10-02" }, { date: "bad" }, {}] };
  assert.deepEqual(parseReleaseDates(json, "2026-09-30"), ["2026-10-02", "2026-10-14"]);
  assert.deepEqual(parseReleaseDates({ error_message: "Bad Request" }, "2026-09-30"), []);
  assert.deepEqual(parseReleaseDates(null, "2026-09-30"), []);
});

test("items fall inside the window, earliest first, same-day ties in the calendar's order", () => {
  const dates = new Map([
    [10, ["2026-10-14", "2026-11-10"]],
    [50, ["2026-10-02"]],
    [180, ["2026-10-01", "2026-10-08", "2026-10-15"]],
    [46, ["2026-10-14"]],
  ]);
  const items = calendarItems(dates, "2026-09-30", "2026-10-14");
  assert.deepEqual(
    items.map((i) => `${i.date} ${i.releaseId}`),
    ["2026-10-01 180", "2026-10-02 50", "2026-10-08 180", "2026-10-14 10", "2026-10-14 46"],
  );
  assert.deepEqual(items[1]!.moves, ["Payrolls", "Unemployment rate"]);
  assert.match(items[1]!.url, /rid=50$/);
});

test("the calendar day is New York's", () => {
  assert.equal(nyDate(Date.parse("2026-10-01T02:00:00Z")), "2026-09-30");
  assert.equal(nyDate(Date.parse("2026-10-01T05:00:00Z")), "2026-10-01");
  assert.equal(addDays("2026-09-30", 21), "2026-10-21");
});

function fakeFetch(byRelease: Record<number, string[] | "fail">) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const id = Number(new URL(url).searchParams.get("release_id"));
    const d = byRelease[id];
    if (d === "fail" || d === undefined) return new Response("no", { status: 500 });
    return new Response(JSON.stringify({ release_dates: d.map((date) => ({ release_id: id, date })) }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

test("one call per release, as of New York's today; partial failures are named", async () => {
  const all = Object.fromEntries(CALENDAR_RELEASES.map((r) => [r.id, ["2026-10-20"]])) as Record<number, string[] | "fail">;
  all[50] = ["2026-10-02"];
  all[10] = "fail";
  const { impl, calls } = fakeFetch(all);
  const cal = await loadReleaseCalendar({ fetchImpl: impl, apiKey: "k", nowMs: Date.parse("2026-09-30T15:00:00Z") });
  assert.equal(calls.length, CALENDAR_RELEASES.length);
  assert.equal(new URL(calls[0]!).searchParams.get("realtime_start"), "2026-09-30");
  assert.equal(new URL(calls[0]!).searchParams.get("include_release_dates_with_no_data"), "true");
  assert.equal(cal.status, "partial");
  assert.match(cal.detail, /Consumer Price Index/);
  assert.equal(cal.items[0]!.releaseId, 50);
  assert.ok(!cal.items.some((i) => i.releaseId === 10));
});

test("no key or no reachable release is unavailable, never an empty 'ok'", async () => {
  assert.equal((await loadReleaseCalendar({ fetchImpl: fakeFetch({}).impl, apiKey: "" })).status, "unavailable");
  const cal = await loadReleaseCalendar({ fetchImpl: fakeFetch({}).impl, apiKey: "k" });
  assert.equal(cal.status, "unavailable");
  assert.deepEqual(cal.items, []);
});
