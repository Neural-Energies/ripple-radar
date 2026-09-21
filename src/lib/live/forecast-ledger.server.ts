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
      values (${id}, ${event.id}, ${event.title}, ${nextJson}, ${event.provenance ?? "heuristic"}, 72)
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
      await sql`
        insert into headline_archive (id, title, source, published)
        values (${h.id}, ${h.title}, ${h.source}, to_timestamp(${h.eventTimeMs} / 1000.0))
        on conflict (id) do nothing
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
    const later = await sql<{ title: string }>`
      select title from headline_archive
      where published > to_timestamp(${asOfMs} / 1000.0)
      order by published asc
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
