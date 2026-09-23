/**
 * Freeze-at-T forecast ledger: append-only snapshots, model-graded (not
 * human) resolution, and calibration computed from real resolved rows only.
 *
 * Every write here is best-effort and swallows its own errors — this must
 * never slow down or break the live desk poll it's called from.
 *
 * Resolution methodology (deliberately not silent, not "calibrated"):
 *   an LLM judge (xAI, same provider as Analyze/Rescore) reads the frozen
 *   scenario set plus headlines archived after the snapshot's `as_of` and
 *   decides which scenario, if any, the later evidence confirms. Stamped
 *   `method: "llm_judge"` — this is a model grading a model, not a verified
 *   ground truth. Brier/calibration computed from these rows describes how
 *   well this desk's heuristics track its own judge, nothing stronger, and
 *   the Learning page must say so.
 */
import type { RadarEvent } from "@/data/types";
import type { LiveHeadline } from "./types";

type ScenarioRow = { id: string; name: string; probability: number };

function snapshotId(eventId: string, atMs: number) {
  return `snap-${eventId}-${atMs.toString(36)}`;
}

/** Freeze a new snapshot only when this event's scenario mix actually moved
 * (first sighting, or a material rescore) — never on an unchanged poll. */
/**
 * How long to wait before this book can be graded.
 *
 * A flat 72h was wrong in both directions: a weather book is knowable inside a
 * day, and a licensing or capex book is not settled in three. Grading too
 * early produces an inconclusive verdict that is really just "nothing has
 * happened yet", and those verdicts are what keep calibration empty.
 *
 * The engine already states each book's own horizons (`horizons[].horizon`,
 * e.g. 24h / 7d / 30d / 2q / 12m). Grade at the SHORTEST one — the first
 * checkpoint the book itself claims is meaningful — clamped so a malformed or
 * absurd horizon cannot make a forecast ungradeable or instantly due.
 */
export const MIN_HORIZON_HOURS = 12;
export const MAX_HORIZON_HOURS = 24 * 30;

export function parseHorizonHours(label: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks|m|mo|month|months|q|quarter|quarters|y|yr|year|years)\s*$/i.exec(
    label,
  );
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!.toLowerCase();
  const perUnit = unit.startsWith("h")
    ? 1
    : unit.startsWith("d")
      ? 24
      : unit.startsWith("w")
        ? 24 * 7
        : unit.startsWith("q")
          ? 24 * 91
          : unit.startsWith("y")
            ? 24 * 365
            : 24 * 30; // m / mo / month
  return n * perUnit;
}

export function horizonHoursFor(event: {
  horizons?: { horizon: string }[];
  forecastHorizon?: string;
}): number {
  const labels = [
    ...(event.horizons ?? []).map((h) => h.horizon),
    ...(event.forecastHorizon ? event.forecastHorizon.split(/[\s/·,]+/) : []),
  ];
  const parsed = labels
    .map(parseHorizonHours)
    .filter((n): n is number => n != null && n > 0);
  if (parsed.length === 0) return 72; // no stated horizon: the previous default
  const shortest = Math.min(...parsed);
  return Math.round(Math.min(MAX_HORIZON_HOURS, Math.max(MIN_HORIZON_HOURS, shortest)));
}

export async function freezeIfChanged(event: RadarEvent): Promise<void> {
  try {
    if (!event.id || !event.scenarios?.length) return;
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const nextScenarios: ScenarioRow[] = event.scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      probability: s.probability,
    }));
    const nextJson = JSON.stringify(nextScenarios);

    const latest = await sql<{ scenarios: string }>`
      select scenarios from forecast_snapshots
      where event_id = ${event.id}
      order by as_of desc
      limit 1
    `;
    if (latest[0]?.scenarios === nextJson) return;

    const id = snapshotId(event.id, Date.now());
    await sql`
      insert into forecast_snapshots (id, event_id, event_title, scenarios, provenance, horizon_hours)
      values (${id}, ${event.id}, ${event.title}, ${nextJson}, ${event.provenance ?? "heuristic"}, ${horizonHoursFor(event)})
      on conflict (id) do nothing
    `;
  } catch (err) {
    console.error("[forecast-ledger] freeze failed:", err);
  }
}

export interface PriorSnapshot {
  asOfMs: number;
  scenarios: { id: string; probability: number }[];
}

/**
 * Latest frozen snapshot per event, in one query — this runs on the live poll
 * path, so it must not be a round-trip per book.
 */
export async function latestSnapshots(eventIds: string[]): Promise<Map<string, PriorSnapshot>> {
  const out = new Map<string, PriorSnapshot>();
  if (eventIds.length === 0) return out;
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ event_id: string; scenarios: string; as_of: string }>`
      select distinct on (event_id) event_id, scenarios, as_of
      from forecast_snapshots
      where event_id = any(${eventIds})
      order by event_id, as_of desc
    `;
    for (const r of rows) {
      out.set(r.event_id, {
        asOfMs: new Date(r.as_of).getTime(),
        scenarios: JSON.parse(r.scenarios) as { id: string; probability: number }[],
      });
    }
  } catch (err) {
    console.error("[forecast-ledger] prior lookup failed:", err);
  }
  return out;
}

/** Archive already-relevance-filtered headlines so a resolution pass days
 * later has real text to judge against — the live RSS tape itself is a
 * rolling window with no memory. */
export async function archiveHeadlines(headlines: LiveHeadline[]): Promise<void> {
  if (headlines.length === 0) return;
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    for (const h of headlines.slice(0, 40)) {
      // The cluster match is the whole point of archiving: without it the
      // resolution pass cannot tell which headlines are about which book.
      const eventIds = JSON.stringify(h.eventIds ?? []);
      await sql`
        insert into headline_archive (id, title, source, published, event_ids)
        values (${h.id}, ${h.title}, ${h.source}, to_timestamp(${h.eventTimeMs} / 1000.0), ${eventIds})
        on conflict (id) do update set event_ids = excluded.event_ids
      `;
    }
  } catch (err) {
    console.error("[forecast-ledger] archive failed:", err);
  }
}

interface JudgeResult {
  scenarioId: string | null;
  confidence: "low" | "medium" | "high";
  rationale: string;
}

async function judgeResolution(
  apiKey: string,
  eventTitle: string,
  scenarios: ScenarioRow[],
  laterHeadlines: { title: string }[],
): Promise<JudgeResult> {
  const prompt = `You are grading a past forecast after the fact. You are NOT making a new prediction.

Book: "${eventTitle}"
It predicted these mutually exclusive scenarios:
${scenarios.map((s) => `- ${s.id}: ${s.name}`).join("\n")}

Headlines that appeared after this forecast was frozen (may be empty, unrelated, or inconclusive):
${laterHeadlines.map((h) => `- ${h.title}`).join("\n") || "(none archived)"}

Which scenario id, if any, do these later headlines confirm actually happened? If the evidence is empty, unrelated, or genuinely ambiguous, say so — do not guess or default to the highest-probability scenario. Respond with ONLY this JSON shape:
{"scenarioId": "<one of the ids above, or null>", "confidence": "low"|"medium"|"high", "rationale": "<one sentence citing what confirmed it, or why it's inconclusive>"}`;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 300,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { scenarioId: null, confidence: "low", rationale: "Judge call failed (HTTP error)." };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { scenarioId?: string | null; confidence?: string; rationale?: string };
    const validId = scenarios.some((s) => s.id === parsed.scenarioId) ? (parsed.scenarioId as string) : null;
    const confidence =
      parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high"
        ? parsed.confidence
        : "low";
    return {
      scenarioId: validId,
      confidence,
      rationale: String(parsed.rationale || "No rationale given.").slice(0, 400),
    };
  } catch {
    return { scenarioId: null, confidence: "low", rationale: "Judge call failed (network/timeout)." };
  }
}

/** Resolve up to `limit` snapshots whose horizon has passed and have no
 * resolution yet. Requires XAI_API_KEY — without one this is a true no-op,
 * same honest degrade as Analyze/Rescore, not a silent fake pass. */
export async function runResolutionPass(limit = 10): Promise<{ checked: number; resolved: number }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey?.trim()) return { checked: 0, resolved: 0 };

  const { getSql } = await import("@/lib/db");
  const sql = await getSql();

  const due = await sql<{
    id: string;
    event_id: string;
    event_title: string;
    scenarios: string;
    as_of: string;
  }>`
    select s.id, s.event_id, s.event_title, s.scenarios, s.as_of
    from forecast_snapshots s
    left join forecast_resolutions r on r.snapshot_id = s.id
    where r.id is null
      and s.as_of < now() - (s.horizon_hours || ' hours')::interval
    order by s.as_of asc
    limit ${limit}
  `;

  let resolved = 0;
  for (const row of due) {
    const scenarios = JSON.parse(row.scenarios) as ScenarioRow[];
    const asOfMs = new Date(row.as_of).getTime();
    // Only headlines the desk matched to THIS book, and newest first: the
    // outcome shows up at the end of the horizon, not in the minutes right
    // after the freeze. A global, oldest-first slice made every grading
    // inconclusive, which is why calibration never filled.
    const later = await sql<{ title: string }>`
      select title from headline_archive
      where published > to_timestamp(${asOfMs} / 1000.0)
        and event_ids is not null
        and event_ids like ${"%\"" + row.event_id + "\"%"}
      order by published desc
      limit 15
    `;
    const judged = await judgeResolution(apiKey, row.event_title, scenarios, later);
    const resId = "res-" + row.id;
    await sql`
      insert into forecast_resolutions (id, snapshot_id, resolved_scenario, method, confidence, rationale)
      values (${resId}, ${row.id}, ${judged.scenarioId}, 'llm_judge', ${judged.confidence}, ${judged.rationale})
      on conflict (snapshot_id) do nothing
    `;
    resolved++;
  }
  return { checked: due.length, resolved };
}

export interface CalibrationBucket {
  bucket: string;
  predicted: number;
  observed: number;
  n: number;
}

export interface LiveCalibration {
  n: number;
  brier: number | null;
  buckets: CalibrationBucket[];
}

/** Real Brier score + calibration curve computed only from resolved rows.
 * n=0 is the honest, expected state until resolutions accumulate. */
export async function getCalibration(): Promise<LiveCalibration> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{ scenarios: string; resolved_scenario: string | null }>`
    select s.scenarios, r.resolved_scenario
    from forecast_snapshots s
    join forecast_resolutions r on r.snapshot_id = s.id
    where r.resolved_scenario is not null
  `;
  if (rows.length === 0) return { n: 0, brier: null, buckets: [] };

  const BUCKET_CENTERS = [10, 30, 50, 70, 90];
  const bucketAcc = new Map<number, { predicted: number; hits: number; n: number }>();
  for (const b of BUCKET_CENTERS) bucketAcc.set(b, { predicted: 0, hits: 0, n: 0 });

  let sumSq = 0;
  let scenarioCount = 0;
  for (const row of rows) {
    const scenarios = JSON.parse(row.scenarios) as ScenarioRow[];
    for (const s of scenarios) {
      const outcome = s.id === row.resolved_scenario ? 1 : 0;
      const p = s.probability / 100;
      sumSq += (p - outcome) ** 2;
      scenarioCount++;
      const bucket = BUCKET_CENTERS.reduce((closest, b) =>
        Math.abs(b - s.probability) < Math.abs(closest - s.probability) ? b : closest,
      )!;
      const acc = bucketAcc.get(bucket)!;
      acc.predicted += s.probability;
      acc.hits += outcome;
      acc.n += 1;
    }
  }

  const buckets: CalibrationBucket[] = BUCKET_CENTERS.map((b) => {
    const acc = bucketAcc.get(b)!;
    return acc.n === 0
      ? null
      : {
          bucket: `${b}%`,
          predicted: Math.round(acc.predicted / acc.n),
          observed: Math.round((acc.hits / acc.n) * 100),
          n: acc.n,
        };
  }).filter((x): x is CalibrationBucket => x != null);

  return {
    n: rows.length,
    brier: scenarioCount > 0 ? Math.round((sumSq / scenarioCount) * 1000) / 1000 : null,
    buckets,
  };
}

export interface ScoredForecast {
  snapshotId: string;
  eventId: string;
  eventTitle: string;
  /** When the forecast was frozen — the T in freeze-at-T. */
  frozenAt: string;
  resolvedAt: string;
  /** The scenario the desk ranked highest at T, and the mass it carried. */
  topScenario: string;
  topProbability: number;
  /** What the judge concluded actually happened. */
  resolvedScenario: string;
  /** 1 when the top-ranked scenario is the one that occurred. */
  hit: boolean;
  /** Multi-class Brier over the whole frozen scenario set. */
  brier: number;
  method: string;
  confidence: string | null;
  rationale: string;
}

/** Multi-class Brier for one frozen set against the scenario that occurred. */
function brierOf(scenarios: ScenarioRow[], resolvedId: string): number {
  if (scenarios.length === 0) return 0;
  const sumSq = scenarios.reduce((a, s) => {
    const outcome = s.id === resolvedId ? 1 : 0;
    return a + (s.probability / 100 - outcome) ** 2;
  }, 0);
  return Math.round((sumSq / scenarios.length) * 10000) / 10000;
}

/**
 * The real scored ledger: forecasts this desk actually froze, later graded.
 *
 * Every row here is something the desk committed to before the outcome was
 * known. Nothing is seeded and nothing is back-filled — an empty list means
 * no forecast has passed its horizon and been resolved yet, which is the
 * honest state of a young ledger rather than a reason to show a sample.
 */
export async function getScoredForecasts(limit = 50): Promise<ScoredForecast[]> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{
    snapshot_id: string;
    event_id: string;
    event_title: string;
    as_of: string;
    resolved_at: string;
    scenarios: string;
    resolved_scenario: string;
    method: string;
    confidence: string | null;
    rationale: string;
  }>`
    select s.id as snapshot_id, s.event_id, s.event_title, s.as_of, s.scenarios,
           r.resolved_at, r.resolved_scenario, r.method, r.confidence, r.rationale
    from forecast_snapshots s
    join forecast_resolutions r on r.snapshot_id = s.id
    where r.resolved_scenario is not null
    order by r.resolved_at desc
    limit ${limit}
  `;

  return rows.map((row) => {
    const scenarios = JSON.parse(row.scenarios) as ScenarioRow[];
    const top = scenarios.reduce(
      (best, s) => (s.probability > best.probability ? s : best),
      scenarios[0] ?? { id: "", name: "—", probability: 0 },
    );
    const resolved = scenarios.find((s) => s.id === row.resolved_scenario);
    return {
      snapshotId: row.snapshot_id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      frozenAt: new Date(row.as_of).toISOString(),
      resolvedAt: new Date(row.resolved_at).toISOString(),
      topScenario: top.name,
      topProbability: top.probability,
      resolvedScenario: resolved?.name ?? row.resolved_scenario,
      hit: top.id === row.resolved_scenario,
      brier: brierOf(scenarios, row.resolved_scenario),
      method: row.method,
      confidence: row.confidence,
      rationale: row.rationale,
    };
  });
}

export interface SkillPoint {
  date: string;
  /** Share of that day's resolutions where the top-ranked scenario occurred. */
  accuracy: number;
  /** Mean multi-class Brier for that day. */
  brier: number;
  n: number;
}

/**
 * Skill over time, from resolved rows only.
 *
 * Grouped by resolution date because that is when a score becomes knowable.
 * A short series is a young ledger, not a broken chart — it is never padded.
 */
export async function getSkillSeries(): Promise<SkillPoint[]> {
  const scored = await getScoredForecasts(500);
  if (scored.length === 0) return [];
  const byDay = new Map<string, { hits: number; brier: number; n: number }>();
  for (const f of scored) {
    const day = f.resolvedAt.slice(0, 10);
    const acc = byDay.get(day) ?? { hits: 0, brier: 0, n: 0 };
    acc.hits += f.hit ? 1 : 0;
    acc.brier += f.brier;
    acc.n += 1;
    byDay.set(day, acc);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, a]) => ({
      date,
      accuracy: Math.round((a.hits / a.n) * 100),
      brier: Math.round((a.brier / a.n) * 1000) / 1000,
      n: a.n,
    }));
}

export interface ReplayFrame {
  snapshotId: string;
  asOf: string;
  provenance: string;
  scenarios: ScenarioRow[];
  /** True once a judge has graded this frame. */
  resolved: boolean;
  resolvedScenario: string | null;
}

/**
 * Real as-of replay for one book: the forecasts this desk actually froze,
 * in order.
 *
 * This is not a recomputation and does not claim to be one — it is the
 * append-only record of what the desk believed at each T, which is the only
 * version of "replay" that cannot peek past T. Walking it shows how the book
 * actually moved, not how it would look if rebuilt with today's information.
 */
export async function getReplayFrames(eventId: string, limit = 40): Promise<ReplayFrame[]> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    as_of: string;
    provenance: string;
    scenarios: string;
    resolved_scenario: string | null;
    resolution_id: string | null;
  }>`
    select s.id, s.as_of, s.provenance, s.scenarios,
           r.resolved_scenario, r.id as resolution_id
    from forecast_snapshots s
    left join forecast_resolutions r on r.snapshot_id = s.id
    where s.event_id = ${eventId}
    order by s.as_of asc
    limit ${limit}
  `;
  return rows.map((row) => ({
    snapshotId: row.id,
    asOf: new Date(row.as_of).toISOString(),
    provenance: row.provenance,
    scenarios: JSON.parse(row.scenarios) as ScenarioRow[],
    resolved: Boolean(row.resolution_id),
    resolvedScenario: row.resolved_scenario,
  }));
}
