/**
 * Integration test for the event registry, against a real PGLite database.
 *
 * Driven through `resolveAndRecordWith` with a live connection rather than a
 * mocked one: the SQL in that module IS most of its behaviour, and a test that
 * stubbed the database out would pass while the upsert, the conflict clause
 * and the new-evidence diff were all wrong.
 *
 * The central assertion is the one that was failing in production: an event's
 * id must survive a new headline, because `buildDesk` looks the previous
 * forecast up by that id and skips the Bayesian update when it misses.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";
import type { Cluster } from "@/lib/engine/cluster";
import type { LiveHeadline } from "./types.ts";
import { eventHistoryWith, resolveAndRecordWith } from "./event-registry.server.ts";

let db: PGlite;
let sql: Sql;

before(async () => {
  db = new PGlite();
  // 0003 too: the whole point of stable identity is that the forecast ledger
  // can find a prior, and that claim is only worth testing against both tables.
  await db.exec(readFileSync("migrations/0003_forecasts.sql", "utf8"));
  await db.exec(readFileSync("migrations/0005_events.sql", "utf8"));
  const tagged = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), "");
    const res = await db.query(text, values as never[]);
    return res.rows;
  }) as Sql;
  tagged.query = async (text: string, params?: unknown[]) =>
    (await db.query(text, (params ?? []) as never[])).rows as never;
  sql = tagged;
});

after(async () => {
  await db.close();
});

const T0 = Date.UTC(2026, 8, 23, 9, 0, 0);
const HOUR = 3600_000;

function headline(id: string, title: string, atMs: number): LiveHeadline {
  return {
    id, title, source: "Reuters", url: `https://example.test/${id}`,
    published: atMs, eventTimeMs: atMs, availableTimeMs: atMs,
    eventIds: [], tone: "neutral",
  };
}

function cluster(over: Partial<Cluster> = {}): Cluster {
  const headlines = over.headlines ?? [
    headline("h1", "Israel strikes Hezbollah targets in southern Lebanon", T0 - HOUR),
    headline("h2", "Lebanon says strikes kill several in border villages", T0 - 2 * HOUR),
  ];
  return {
    id: "ev-poll1",
    title: "Israel / Hezbollah border escalation",
    headlines,
    tokens: new Set(["strikes", "targets", "southern", "border", "escalation"]),
    entities: ["Israel", "Hezbollah", "Lebanon"],
    tags: ["geopolitics"],
    tone: "down",
    significance: 70,
    sources: 2,
    newest: headlines[0]!.published,
    oldest: headlines[headlines.length - 1]!.published,
    ...over,
  };
}

test("THE REGRESSION: an event id survives a new headline on the same story", async () => {
  // Poll 1 — first sighting.
  const first = await resolveAndRecordWith(sql, [cluster()], T0);
  assert.equal(first.degraded, false);
  const eventId = first.resolved[0]!.resolution.eventId;
  assert.equal(first.resolved[0]!.resolution.isNew, true);
  assert.equal(first.resolved[0]!.newHeadlineIds.length, 2);

  // Poll 2 — one more wire item, and a per-poll cluster id that has moved.
  const grown = cluster({
    id: "ev-poll2-different-hash",
    headlines: [
      headline("h3", "Israel expands Lebanon operation, Hezbollah vows response", T0 + HOUR),
      headline("h1", "Israel strikes Hezbollah targets in southern Lebanon", T0 - HOUR),
      headline("h2", "Lebanon says strikes kill several in border villages", T0 - 2 * HOUR),
    ],
    newest: T0 + HOUR,
  });
  const second = await resolveAndRecordWith(sql, [grown], T0 + HOUR);

  assert.equal(
    second.resolved[0]!.resolution.eventId,
    eventId,
    "the forecast prior lookup keys off this id — it must not move",
  );
  assert.equal(second.resolved[0]!.resolution.isNew, false);
  assert.deepEqual(
    second.resolved[0]!.newHeadlineIds,
    ["h3"],
    "only the genuinely new item counts as new evidence",
  );
});

test("evidence accumulates on the event with its attachment provenance", async () => {
  const rows = await sql<{
    headline_id: string; attach_method: string; attach_score: number; matched_on: string;
  }>`select headline_id, attach_method, attach_score, matched_on
     from event_evidence order by headline_id`;
  assert.equal(rows.length, 3, "all three headlines are linked to the one event");
  const h1 = rows.find((r) => r.headline_id === "h1")!;
  const h3 = rows.find((r) => r.headline_id === "h3")!;
  assert.equal(h1.attach_method, "new", "the opening items record that they opened the event");
  assert.ok(
    h3.attach_method === "fingerprint" || h3.attach_method === "similarity",
    `later evidence records how it was matched, got ${h3.attach_method}`,
  );
  if (h3.attach_method === "similarity") assert.ok(h3.attach_score > 0);
  assert.ok(Array.isArray(JSON.parse(h3.matched_on)));
});

test("re-observing the same evidence does not double-count it", async () => {
  const before = await sql<{ n: string }>`select count(*) as n from event_evidence`;
  const again = await resolveAndRecordWith(sql, [cluster()], T0 + 2 * HOUR);
  assert.deepEqual(again.resolved[0]!.newHeadlineIds, [], "nothing here is new");
  const after = await sql<{ n: string }>`select count(*) as n from event_evidence`;
  assert.equal(before[0]!.n, after[0]!.n);
});

test("headline_count tracks new evidence, not re-syndication", async () => {
  const rows = await sql<{ headline_count: number; observation_count: number }>`
    select headline_count, observation_count from events`;
  assert.equal(rows.length, 1, "one story, one event");
  assert.equal(
    Number(rows[0]!.headline_count),
    3,
    "two opening items plus one new one — the third poll added nothing",
  );
  assert.equal(Number(rows[0]!.observation_count), 3, "but it was still observed three times");
});

test("first_seen is immutable while the title keeps improving", async () => {
  const rows = await sql<{ first_seen: string; title: string }>`
    select first_seen, title from events`;
  assert.equal(
    new Date(rows[0]!.first_seen).getTime(),
    T0 - 2 * HOUR,
    "an event's start is its earliest evidence, not the last poll that saw it",
  );
  assert.ok(rows[0]!.title.length > 0);
});

test("every poll is recorded, so 'nothing new' is distinguishable from 'not seen'", async () => {
  const rows = await sql<{ id: string }>`select id from events`;
  const history = await eventHistoryWith(sql, rows[0]!.id);
  assert.equal(history.length, 3);
  assert.deepEqual(
    history.map((h) => h.newHeadlines).sort(),
    [0, 1, 2],
    "one poll opened it, one added an item, one added nothing",
  );
});

test("a genuinely different story opens its own event", async () => {
  const taiwan = cluster({
    id: "ev-taiwan",
    title: "Taiwan semiconductor export controls tighten",
    entities: ["Taiwan", "TSMC", "Netherlands"],
    tokens: new Set(["semiconductor", "export", "controls", "lithography", "restrictions"]),
    headlines: [headline("t1", "Taiwan chip export controls tighten further", T0 + 3 * HOUR)],
    newest: T0 + 3 * HOUR,
    oldest: T0 + 3 * HOUR,
  });
  const res = await resolveAndRecordWith(sql, [taiwan], T0 + 3 * HOUR);
  assert.equal(res.resolved[0]!.resolution.isNew, true);
  const rows = await sql<{ n: string }>`select count(*) as n from events`;
  assert.equal(Number(rows[0]!.n), 2, "two distinct stories, two events");
});

test("a dormant event is not resurrected weeks later", async () => {
  const later = T0 + 30 * 24 * HOUR;
  const res = await resolveAndRecordWith(sql, [cluster({ id: "ev-flareup" })], later);
  assert.equal(
    res.resolved[0]!.resolution.isNew,
    true,
    "a new flare-up must not inherit an old event's forecast history",
  );
});

test("an unreachable registry degrades to per-poll ids and says so", async () => {
  const broken = (() => {
    throw new Error("connection lost");
  }) as unknown as Sql;
  const res = await resolveAndRecordWith(broken, [cluster({ id: "ev-fallback" })], T0);
  assert.equal(res.degraded, true);
  assert.equal(res.resolved[0]!.resolution.eventId, "ev-fallback");
});

test("no clusters is not an error", async () => {
  const res = await resolveAndRecordWith(sql, [], T0);
  assert.deepEqual(res, { resolved: [], degraded: false });
});


test("END TO END: the forecast prior is findable on the next poll", async () => {
  // This is what the whole change exists for. Before stable identity,
  // buildDesk's `priors.get(ev.id)` missed on every developing story, so
  // `if (!prior) continue` skipped the Bayesian update and the posterior
  // never ran. Here: freeze a snapshot under poll 1's id, then confirm poll 2
  // resolves to that same id and the prior comes back.
  const story = cluster({
    id: "ev-pollA",
    entities: ["Norway", "Equinor", "Troll"],
    tokens: new Set(["gas", "field", "outage", "compressor", "unplanned"]),
    headlines: [headline("n1", "Equinor reports unplanned outage at Troll gas field", T0)],
    newest: T0,
    oldest: T0,
  });
  const poll1 = await resolveAndRecordWith(sql, [story], T0);
  const eventId = poll1.resolved[0]!.resolution.eventId;

  // The desk freezes its book at T.
  await sql`
    insert into forecast_snapshots (id, event_id, event_title, as_of, scenarios, provenance, horizon_hours)
    values (${"snap-" + eventId}, ${eventId}, ${"Troll outage"}, ${new Date(T0).toISOString()},
            ${JSON.stringify([{ id: "s1", name: "Binding constraint", probability: 31 }])},
            ${"heuristic"}, ${24})
  `;

  // Poll 2: same story, new wire item, different per-poll cluster id.
  const poll2 = await resolveAndRecordWith(sql, [cluster({
    id: "ev-pollB-different-hash",
    entities: ["Norway", "Equinor", "Troll"],
    tokens: new Set(["gas", "field", "outage", "compressor", "unplanned"]),
    headlines: [
      headline("n2", "Troll outage extended, European gas rallies", T0 + HOUR),
      headline("n1", "Equinor reports unplanned outage at Troll gas field", T0),
    ],
    newest: T0 + HOUR,
    oldest: T0,
  })], T0 + HOUR);

  assert.equal(poll2.resolved[0]!.resolution.eventId, eventId);

  // The exact query buildDesk runs to fetch its prior.
  const priors = await sql<{ event_id: string; scenarios: string; as_of: string }>`
    select distinct on (event_id) event_id, scenarios, as_of
    from forecast_snapshots
    where event_id = any(${[poll2.resolved[0]!.resolution.eventId]})
    order by event_id, as_of desc
  `;
  assert.equal(priors.length, 1, "the prior must be findable — this is what was broken");
  assert.equal(JSON.parse(priors[0]!.scenarios)[0].probability, 31);

  // And the poll knows exactly which evidence is new, which is what the
  // materiality gate and any probability-change alert have to key off.
  assert.deepEqual(poll2.resolved[0]!.newHeadlineIds, ["n2"]);
});


test("a busy poll writes a bounded number of statements", async () => {
  // The first cut issued one query per event plus one per new headline. On the
  // live desk path a few hundred sequential round-trips made the poll itself
  // the slowest thing on the page.
  let queries = 0;
  const counting = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries += 1;
    const text = strings.reduce((a, s2, i) => a + s2 + (i < values.length ? `$${i + 1}` : ""), "");
    return (await db.query(text, values as never[])).rows;
  }) as Sql;
  counting.query = async (text: string, params?: unknown[]) => {
    queries += 1;
    return (await db.query(text, (params ?? []) as never[])).rows as never;
  };

  const many = Array.from({ length: 25 }, (_, i) =>
    cluster({
      id: `ev-bulk-${i}`,
      title: `Bulk story ${i}`,
      entities: [`ActorA${i}`, `ActorB${i}`, `PlaceC${i}`],
      tokens: new Set([`tok${i}a`, `tok${i}b`, `tok${i}c`, `tok${i}d`, `tok${i}e`]),
      headlines: Array.from({ length: 8 }, (_, j) =>
        headline(`bulk-${i}-${j}`, `Bulk story ${i} update ${j}`, T0 + j * 60_000),
      ),
      newest: T0 + 7 * 60_000,
      oldest: T0,
    }),
  );

  const res = await resolveAndRecordWith(counting, many, T0 + 40 * 24 * HOUR);
  assert.equal(res.resolved.length, 25);
  assert.ok(
    queries <= 6,
    `25 events and 200 headlines must not cost a round-trip each; used ${queries}`,
  );

  const rows = await sql<{ n: string }>`select count(*) as n from event_evidence
    where headline_id like 'bulk-%'`;
  assert.equal(Number(rows[0]!.n), 200, "batching must not drop rows");
});

// ------------------------------------------------ real probability history

test("probability history comes from the ledger, not from a formula", async () => {
  // compose.ts used to emit `probability - 8 / -4 / -2` as "history": a
  // synthetic ramp that would show a trend whatever had actually happened.
  const { probabilityHistoryWith } = await import("./forecast-ledger.server.ts");
  const eventId = "ev-history-test";
  const mix = (top: number) =>
    JSON.stringify([
      { id: "s1", name: "Materializes", probability: top },
      { id: "s2", name: "Fades", probability: 100 - top },
    ]);

  // Three freezes, deliberately inserted out of order.
  for (const [n, top, hours] of [
    ["b", 27, 2],
    ["a", 18, 8],
    ["c", 31, 0],
  ] as const) {
    await sql`
      insert into forecast_snapshots (id, event_id, event_title, as_of, scenarios, provenance, horizon_hours)
      values (${"snap-" + n}, ${eventId}, ${"History"},
              ${new Date(T0 - hours * HOUR).toISOString()}, ${mix(top)}, ${"heuristic"}, ${24})
    `;
  }

  const got = await probabilityHistoryWith(sql, [eventId]);
  const series = got.get(eventId)!;
  assert.equal(series.length, 3);
  assert.deepEqual(
    series.map((p) => p.value),
    [18, 27, 31],
    "oldest first — a delta read off this must point the right way",
  );
  for (let i = 1; i < series.length; i++) {
    assert.ok(
      Date.parse(series[i]!.date) > Date.parse(series[i - 1]!.date),
      "timestamps must be strictly increasing",
    );
  }
});

test("an event with no freezes gets no history, not an invented one", async () => {
  const { probabilityHistoryWith } = await import("./forecast-ledger.server.ts");
  const got = await probabilityHistoryWith(sql, ["ev-never-frozen"]);
  assert.equal(got.get("ev-never-frozen"), undefined);
});

test("history is fetched for every event in one query, not one per event", async () => {
  const { probabilityHistoryWith } = await import("./forecast-ledger.server.ts");
  let queries = 0;
  const counting = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries += 1;
    const text = strings.reduce((a, s2, i) => a + s2 + (i < values.length ? `$${i + 1}` : ""), "");
    return (await db.query(text, values as never[])).rows;
  }) as Sql;
  counting.query = async (text: string, params?: unknown[]) => {
    queries += 1;
    return (await db.query(text, (params ?? []) as never[])).rows as never;
  };
  await probabilityHistoryWith(counting, ["a", "b", "c", "d", "e"]);
  assert.equal(queries, 1, `five events cost ${queries} round-trips on the live poll path`);
});

test("the window keeps the most recent freezes, not the oldest", async () => {
  const { probabilityHistoryWith } = await import("./forecast-ledger.server.ts");
  const eventId = "ev-window";
  for (let i = 0; i < 6; i++) {
    await sql`
      insert into forecast_snapshots (id, event_id, event_title, as_of, scenarios, provenance, horizon_hours)
      values (${`snap-w${i}`}, ${eventId}, ${"Window"},
              ${new Date(T0 - (6 - i) * HOUR).toISOString()},
              ${JSON.stringify([{ id: "s1", name: "x", probability: 10 + i }])},
              ${"heuristic"}, ${24})
    `;
  }
  const got = await probabilityHistoryWith(sql, [eventId], 3);
  assert.deepEqual(got.get(eventId)!.map((p) => p.value), [13, 14, 15]);
});

test("a malformed snapshot is skipped rather than breaking the series", async () => {
  const { probabilityHistoryWith } = await import("./forecast-ledger.server.ts");
  const eventId = "ev-malformed";
  await sql`
    insert into forecast_snapshots (id, event_id, event_title, as_of, scenarios, provenance, horizon_hours)
    values (${"snap-bad"}, ${eventId}, ${"Bad"}, ${new Date(T0 - HOUR).toISOString()},
            ${"{not json"}, ${"heuristic"}, ${24})
  `;
  await sql`
    insert into forecast_snapshots (id, event_id, event_title, as_of, scenarios, provenance, horizon_hours)
    values (${"snap-good"}, ${eventId}, ${"Good"}, ${new Date(T0).toISOString()},
            ${JSON.stringify([{ id: "s1", name: "x", probability: 44 }])}, ${"heuristic"}, ${24})
  `;
  const got = await probabilityHistoryWith(sql, [eventId]);
  assert.deepEqual(got.get(eventId)!.map((p) => p.value), [44]);
});
