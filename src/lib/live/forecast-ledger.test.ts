/**
 * A forecast is graded at its own horizon, whenever the grading job runs
 * (PR #5 A02).
 *
 * Runs the real resolution pass — the real SQL, against the real migrations,
 * in an in-memory PGLite — with a controlled clock and a judge that records
 * exactly what it was given.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import {
  buildJudgePrompt,
  getCalibrationFrom,
  resolutionDeadlineMs,
  runResolutionPass,
  type JudgeInput,
} from "./forecast-ledger.server.ts";

const MIGRATIONS = join(process.cwd(), "migrations");

async function freshDb(): Promise<Sql> {
  const pg = new PGlite();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + (i ? `$${i}` : "") + part, "");
    return (await pg.query(text, values)).rows;
  }) as Sql;
  sql.query = async (text: string, params?: unknown[]) => (await pg.query(text, params)).rows as never;
  return sql;
}

const T = (iso: string) => new Date(iso).getTime();
const FROZEN = "2026-09-01T00:00:00Z";
const SCENARIOS = [
  { id: "A", name: "Talks hold", probability: 60 },
  { id: "B", name: "Talks collapse", probability: 40 },
];

async function seed(sql: Sql) {
  await sql`
    insert into forecast_snapshots (id, event_id, event_title, as_of, scenarios, provenance, horizon_hours)
    values ('snap-1', 'ev1', 'Ceasefire talks', ${FROZEN}, ${JSON.stringify(SCENARIOS)}, 'heuristic', 24)
  `;
  const headline = (id: string, title: string, at: string, events = '["ev1"]') => sql`
    insert into headline_archive (id, title, source, published, event_ids)
    values (${id}, ${title}, 'wire', ${at}, ${events})
  `;
  await headline("h-before", "Talks scheduled", "2026-08-31T20:00:00Z");
  await headline("h-in", "Talks hold through the first day", "2026-09-01T12:00:00Z");
  await headline("h-other", "Unrelated book", "2026-09-01T13:00:00Z", '["ev2"]');
  await headline("h-edge", "Talks still holding at close", "2026-09-02T00:00:00Z");
  await headline("h-late", "Talks collapse", "2026-09-09T12:00:00Z");
}

/** A judge that picks B if it sees the collapse, A if it sees talks holding. */
function recordingJudge(seen: JudgeInput[]) {
  return async (input: JudgeInput) => {
    seen.push(input);
    const titles = input.evidence.map((e) => e.title).join(" | ");
    const scenarioId = /collapse/i.test(titles) ? "B" : /hold/i.test(titles) ? "A" : null;
    return { scenarioId, confidence: "high" as const, rationale: titles || "nothing" };
  };
}

async function gradeAt(nowIso: string) {
  const sql = await freshDb();
  await seed(sql);
  const seen: JudgeInput[] = [];
  const out = await runResolutionPass(10, { sql, judge: recordingJudge(seen), nowMs: T(nowIso) });
  const rows = await sql<{ resolved_scenario: string | null; deadline: Date | string; evidence: string }>`
    select resolved_scenario, deadline, evidence from forecast_resolutions where snapshot_id = 'snap-1'
  `;
  return { out, seen, rows, sql };
}

test("grading on day 2 and on day 10 gives the same inputs and the same outcome", async () => {
  const early = await gradeAt("2026-09-02T06:00:00Z");
  const late = await gradeAt("2026-09-10T12:00:00Z");
  assert.equal(early.seen.length, 1);
  assert.equal(late.seen.length, 1);
  assert.deepEqual(late.seen[0], early.seen[0]);
  assert.deepEqual(
    early.seen[0]!.evidence.map((e) => e.id),
    ["h-edge", "h-in"],
    "only this book's headlines inside (freeze, deadline], newest first",
  );
  assert.equal(early.rows[0]!.resolved_scenario, "A");
  assert.equal(late.rows[0]!.resolved_scenario, "A", "day-9 news about B must not grade a 24h book");
});

test("the deadline is the freeze plus the book's own horizon, and it is stored", async () => {
  const { seen, rows } = await gradeAt("2026-09-10T12:00:00Z");
  const deadline = resolutionDeadlineMs(T(FROZEN), 24);
  assert.equal(deadline, T("2026-09-02T00:00:00Z"));
  assert.equal(seen[0]!.deadlineMs, deadline);
  assert.equal(new Date(rows[0]!.deadline).getTime(), deadline);
  assert.deepEqual(
    JSON.parse(rows[0]!.evidence).map((e: { id: string }) => e.id),
    ["h-edge", "h-in"],
  );
});

test("nothing is graded before its horizon has passed", async () => {
  const { out, seen } = await gradeAt("2026-09-01T23:59:00Z");
  assert.equal(out.checked, 0);
  assert.equal(seen.length, 0);
});

test("the judge is told the deadline and when each headline was published", () => {
  const prompt = buildJudgePrompt({
    eventTitle: "Ceasefire talks",
    scenarios: SCENARIOS,
    asOfMs: T(FROZEN),
    deadlineMs: T("2026-09-02T00:00:00Z"),
    evidence: [{ id: "h-in", title: "Talks hold through the first day", publishedMs: T("2026-09-01T12:00:00Z") }],
  });
  assert.match(prompt, /horizon ending 2026-09-02T00:00:00\.000Z/);
  assert.match(prompt, /BY 2026-09-02T00:00:00\.000Z/);
  assert.match(prompt, /\[2026-09-01T12:00:00\.000Z\] Talks hold/);
});

test("calibration counts only resolutions graded at their own horizon", async () => {
  const { sql } = await gradeAt("2026-09-10T12:00:00Z");
  // A resolution written before the cutoff existed: no deadline recorded.
  await sql`
    insert into forecast_snapshots (id, event_id, event_title, as_of, scenarios, provenance, horizon_hours)
    values ('snap-old', 'ev9', 'Old book', '2026-08-01T00:00:00Z', ${JSON.stringify(SCENARIOS)}, 'heuristic', 24)
  `;
  await sql`
    insert into forecast_resolutions (id, snapshot_id, resolved_scenario, method, confidence, rationale)
    values ('res-old', 'snap-old', 'B', 'llm_judge', 'high', 'graded on later news')
  `;
  const cal = await getCalibrationFrom(sql);
  assert.equal(cal.n, 1, "the legacy, unbounded resolution is not counted");
});
