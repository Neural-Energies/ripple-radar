import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENTITY_FLOOR,
  MAX_DORMANT_MS,
  fingerprintOf,
  mintEventId,
  resolveIdentities,
  similarity,
  topTokens,
  type EventCandidate,
  type KnownEvent,
} from "./event-identity.ts";

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

function cand(over: Partial<EventCandidate> = {}): EventCandidate {
  return {
    clusterId: "c1",
    title: "Israel strikes Hezbollah targets in southern Lebanon",
    entities: ["Israel", "Hezbollah", "Lebanon"],
    tokens: ["strikes", "targets", "southern", "border", "escalation"],
    tags: ["geopolitics"],
    newestMs: NOW - 60_000,
    oldestMs: NOW - 3 * 3600_000,
    headlineIds: ["h1", "h2"],
    ...over,
  };
}

function known(over: Partial<KnownEvent> = {}): KnownEvent {
  const entities = over.entities ?? ["Israel", "Hezbollah", "Lebanon"];
  const tokens = over.tokens ?? ["strikes", "targets", "southern", "border", "escalation"];
  return {
    id: "ev-existing",
    fingerprint: fingerprintOf(entities, tokens),
    title: "Israel / Hezbollah border escalation",
    entities,
    tokens,
    lastSeenMs: NOW - 3600_000,
    ...over,
  };
}

// ---------------------------------------------------------------- fingerprint

test("the fingerprint ignores headline text, which is what changes every poll", () => {
  const a = fingerprintOf(["Israel", "Hezbollah"], ["strikes", "border"]);
  const b = fingerprintOf(["Hezbollah", "Israel"], ["border", "strikes"]);
  assert.equal(a, b, "entity/token ORDER must not change identity");
});

test("the fingerprint survives one new token on a running story", () => {
  const before = fingerprintOf(["Israel", "Hezbollah", "Lebanon"], ["strikes", "border"]);
  const after = fingerprintOf(["Israel", "Hezbollah", "Lebanon"], ["strikes", "border", "retaliation"]);
  assert.equal(before, after, "entities carry identity once there are two of them");
});

test("different stories get different fingerprints", () => {
  assert.notEqual(
    fingerprintOf(["Israel", "Lebanon"], ["strikes"]),
    fingerprintOf(["Russia", "Ukraine"], ["strikes"]),
  );
});

test("topTokens is a deterministic slice, not an arbitrary one", () => {
  const a = topTokens(["alpha", "b", "gamma-long", "cc"], 3);
  const b = topTokens(["cc", "gamma-long", "b", "alpha"], 3);
  assert.deepEqual(a, b);
  assert.ok(a.includes("gamma-long"), "the most specific token must survive the cut");
});

// ------------------------------------------------------------- the regression

test("REGRESSION: a new headline on a running story keeps the same event id", () => {
  // This is the exact failure that made the forecast ledger unreachable.
  const existing = known();
  const withNewHeadline = cand({
    title: "Israel expands Lebanon operation, Hezbollah vows response",
    tokens: ["strikes", "targets", "southern", "border", "escalation", "expands", "vows"],
    newestMs: NOW,
  });
  const [res] = resolveIdentities([withNewHeadline], [existing], NOW);
  assert.equal(res!.eventId, "ev-existing");
  assert.equal(res!.isNew, false);
});

test("an unseen story mints a new event rather than forcing a match", () => {
  const [res] = resolveIdentities(
    [cand({ entities: ["Taiwan", "TSMC"], tokens: ["semiconductor", "export", "controls"] })],
    [known()],
    NOW,
  );
  assert.equal(res!.isNew, true);
  assert.equal(res!.method, "new");
  assert.match(res!.eventId, /^ev-/);
});

// ------------------------------------------------------------- over-merging

test("two stories sharing ONE actor are not fused", () => {
  // Israel/Lebanon vs Israel/Gaza share exactly one of three entities:
  // Jaccard 1/5 = 0.2, below the entity floor.
  const gaza = cand({
    clusterId: "c2",
    entities: ["Israel", "Gaza", "Hamas"],
    tokens: ["ceasefire", "aid", "crossing"],
  });
  const sim = similarity(gaza, known());
  assert.ok(sim.entityOverlap < ENTITY_FLOOR, `entity overlap ${sim.entityOverlap} must be below the floor`);
  const [res] = resolveIdentities([gaza], [known()], NOW);
  assert.equal(res!.isNew, true, "a shared actor is not a shared event");
});

test("shared vocabulary alone does not merge two stories", () => {
  const other = cand({
    clusterId: "c3",
    entities: ["Russia", "Ukraine"],
    tokens: ["strikes", "targets", "southern", "border", "escalation"],
  });
  const [res] = resolveIdentities([other], [known()], NOW);
  assert.equal(res!.isNew, true);
});

test("one event cannot absorb two clusters in a single cycle", () => {
  const a = cand({ clusterId: "a" });
  const b = cand({ clusterId: "b", title: "Hezbollah rockets hit northern Israel" });
  const res = resolveIdentities([a, b], [known()], NOW);
  const matched = res.filter((r) => !r.isNew);
  assert.equal(matched.length, 1, "fusing two clusters into one event corrupts its forecast series");
  assert.equal(res.filter((r) => r.isNew).length, 1);
});

test("two new clusters with the same fingerprint still get distinct ids", () => {
  const a = cand({ clusterId: "a" });
  const b = cand({ clusterId: "b" });
  const res = resolveIdentities([a, b], [], NOW);
  assert.ok(res.every((r) => r.isNew));
  assert.notEqual(res[0]!.eventId, res[1]!.eventId);
});

// ----------------------------------------------------------------- dormancy

test("a dormant event is not resurrected by a later flare-up", () => {
  const stale = known({ lastSeenMs: NOW - MAX_DORMANT_MS - 1 });
  const [res] = resolveIdentities([cand()], [stale], NOW);
  assert.equal(res!.isNew, true, "an old event must not accumulate a new flare-up's forecasts");
});

test("an event seen just inside the window still matches", () => {
  const recent = known({ lastSeenMs: NOW - MAX_DORMANT_MS + 60_000 });
  const [res] = resolveIdentities([cand()], [recent], NOW);
  assert.equal(res!.eventId, "ev-existing");
});

// ---------------------------------------------------------------- provenance

test("every resolution records how it was decided", () => {
  const res = resolveIdentities(
    [cand(), cand({ clusterId: "c9", entities: ["Norway", "Equinor"], tokens: ["gas", "field"] })],
    [known()],
    NOW,
  );
  assert.equal(res[0]!.method, "fingerprint");
  assert.ok(res[0]!.matchedOn.includes("israel"), "the match must name the entities that drove it");
  assert.equal(res[0]!.score, 1);
  assert.equal(res[1]!.method, "new");
  assert.equal(res[1]!.score, 0);
});

test("a drifted entity set matches by similarity and reports its score", () => {
  // Four of five entities shared: Jaccard 4/6 = 0.67, well clear of the floor,
  // but the fingerprint differs so this must come through pass 2.
  const drifted = cand({
    entities: ["Israel", "Hezbollah", "Lebanon", "Beirut"],
    tokens: ["strikes", "targets", "southern", "border", "escalation"],
  });
  const base = known({ entities: ["Israel", "Hezbollah", "Lebanon", "UNIFIL"] });
  const [res] = resolveIdentities([drifted], [base], NOW);
  assert.equal(res!.method, "similarity");
  assert.equal(res!.eventId, "ev-existing");
  assert.ok(res!.score > 0 && res!.score < 1);
  assert.ok(res!.entityOverlap >= ENTITY_FLOOR);
});

test("the stronger match claims a contested event first", () => {
  const weak = cand({
    clusterId: "weak",
    entities: ["Israel", "Hezbollah", "Lebanon", "Cyprus", "Greece"],
    tokens: ["strikes"],
  });
  const strong = cand({ clusterId: "strong" });
  const res = resolveIdentities([weak, strong], [known()], NOW);
  const byId = new Map(res.map((r) => [r.clusterId, r]));
  assert.equal(byId.get("strong")!.eventId, "ev-existing");
  assert.equal(byId.get("weak")!.isNew, true);
});

// ------------------------------------------------------------------- shapes

test("every candidate gets exactly one resolution, in order", () => {
  const cands = [cand({ clusterId: "a" }), cand({ clusterId: "b" }), cand({ clusterId: "c" })];
  const res = resolveIdentities(cands, [known()], NOW);
  assert.equal(res.length, 3);
  assert.deepEqual(res.map((r) => r.clusterId), ["a", "b", "c"]);
});

test("no known events means everything is new, and nothing throws", () => {
  const res = resolveIdentities([cand()], [], NOW);
  assert.equal(res.length, 1);
  assert.equal(res[0]!.isNew, true);
});

test("a cluster with no entities falls back to a stricter token rule", () => {
  const noEnts = cand({ entities: [], tokens: ["strikes", "targets", "southern", "border", "escalation"] });
  const same = known({ entities: [], tokens: ["strikes", "targets", "southern", "border", "escalation"] });
  assert.equal(resolveIdentities([noEnts], [same], NOW)[0]!.isNew, false);

  const looser = known({ entities: [], tokens: ["strikes", "targets", "unrelated", "vocabulary", "here"] });
  assert.equal(
    resolveIdentities([noEnts], [looser], NOW)[0]!.isNew,
    true,
    "half-shared vocabulary with no entities is not identity",
  );
});

test("minted ids are stable for the same fingerprint and start time", () => {
  assert.equal(mintEventId("abc", 1_700_000_000_000), mintEventId("abc", 1_700_000_000_000));
});
