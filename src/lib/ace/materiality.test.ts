import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvidenceItem } from "../../data/types.ts";
import { MATERIAL_MASS_THRESHOLD, factKey, gateEvidence } from "./materiality.ts";

const NOW = 1_700_000_000_000;

function ev(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: over.id ?? `e${Math.random().toString(36).slice(2, 8)}`,
    time: "10:00",
    eventTimeMs: NOW - 60_000,
    availableTimeMs: NOW - 60_000,
    source: "Reuters",
    evidenceClass: "narrative",
    kind: "news",
    headline: "Gulf refinery cuts run rates as storm approaches",
    delayed: false,
    reliability: "B",
    direction: "neutral",
    ...over,
  };
}

test("evidence already inside the frozen info-set is withheld, not recounted", () => {
  const out = gateEvidence([ev({ availableTimeMs: NOW - 10_000 })], {
    sinceMs: NOW - 5_000,
    nowMs: NOW,
  });
  assert.equal(out.admitted.length, 0);
  assert.equal(out.withheld[0]!.reason, "pre-freeze");
});

test("the same fact from twenty outlets is admitted once", () => {
  const wires = Array.from({ length: 20 }, (_, i) =>
    ev({
      id: `wire-${i}`,
      source: `Outlet ${i}`,
      headline: "Gulf refinery cuts run rates as storm approaches",
    }),
  );
  const out = gateEvidence(wires, { sinceMs: 0, nowMs: NOW });
  assert.equal(out.admitted.length, 1, "one underlying fact is one observation");
  assert.equal(out.withheld.length, 19);
  assert.ok(out.withheld.every((w) => w.reason === "duplicate-fact"));
});

test("genuinely different facts both get through", () => {
  const out = gateEvidence(
    [
      ev({ id: "a", headline: "Gulf refinery cuts run rates as storm approaches" }),
      ev({ id: "b", headline: "Port authority orders closure of Houston ship channel" }),
    ],
    { sinceMs: 0, nowMs: NOW },
  );
  assert.equal(out.admitted.length, 2);
});

test("word order and punctuation do not defeat duplicate detection", () => {
  assert.equal(
    factKey("Port closure ordered at Houston!"),
    factKey("ordered, port CLOSURE at Houston"),
  );
});

test("stale evidence is withheld", () => {
  const out = gateEvidence([ev({ eventTimeMs: NOW - 200 * 3_600_000 })], {
    sinceMs: 0,
    nowMs: NOW,
    maxAgeHours: 96,
  });
  assert.equal(out.admitted.length, 0);
  assert.equal(out.withheld[0]!.reason, "stale");
});

test("one A-tier fundamental print is material; a lone weak narrative echo is not", () => {
  const strong = gateEvidence([ev({ evidenceClass: "fundamental", reliability: "A" })], {
    sinceMs: 0,
    nowMs: NOW,
  });
  assert.equal(strong.material, true);

  const weak = gateEvidence(
    [ev({ evidenceClass: "narrative", reliability: "D", headline: "Analysts weigh in on storm" })],
    { sinceMs: 0, nowMs: NOW },
  );
  assert.ok(
    weak.admitted.length === 1 && !weak.material,
    "admitted but below the freeze threshold",
  );
});

test("nothing is dropped silently — every withheld item carries a reason", () => {
  const out = gateEvidence(
    [
      ev({ id: "dup-1" }),
      ev({ id: "dup-2" }),
      ev({ id: "old", eventTimeMs: NOW - 500 * 3_600_000, headline: "Unrelated ancient story" }),
    ],
    { sinceMs: 0, nowMs: NOW },
  );
  assert.equal(out.admitted.length + out.withheld.length, 3);
  assert.ok(out.withheld.every((w) => Boolean(w.reason)));
});

test("the threshold is a documented constant, not a magic number", () => {
  assert.ok(MATERIAL_MASS_THRESHOLD > 0);
});
