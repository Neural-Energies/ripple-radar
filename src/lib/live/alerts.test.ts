import assert from "node:assert/strict";
import { test } from "node:test";
import type { AlertRule } from "../../data/types.ts";
import type { LiveDesk } from "./types.ts";
import { evaluateAlert } from "./alerts.ts";

function desk(probability: number, prev: number): LiveDesk {
  return {
    books: {
      e1: {
        eventId: "e1",
        probability: 40,
        probabilityDelta: 0,
        hits: 2,
        evidence: [],
        sources: [],
        marketReaction: [],
        scenarios: [
          {
            id: "s1",
            name: "Escalation",
            detail: "",
            probability,
            prevProbability: prev,
            range: "1–7 days",
            keyOutcomes: "",
            audit: {
              previous: prev,
              updated: probability,
              evidence: "Fundamental prints outweighed the fade.",
              direction: probability >= prev ? "up" : "down",
              weight: 1,
              affectedNodes: [],
              rescoredAssets: [],
            },
          },
        ],
        heatPoint: { t: 0, narrative: 0, price: 0 },
        sentiment: [],
      },
    },
    liveEvents: [],
    headlines: [],
    quotes: {},
  } as unknown as LiveDesk;
}

const rule: AlertRule = {
  id: "p1",
  title: "Path move",
  detail: "",
  kind: "path",
  active: true,
  created: "",
  eventId: "e1",
  threshold: 5,
};

test("a path alert fires only when the frozen mix actually moved", () => {
  const hit = evaluateAlert(rule, desk(41, 26));
  assert.ok(hit);
  assert.match(hit.reason, /26% → 41%/);
  assert.match(hit.reason, /Fundamental prints/);
  assert.equal(evaluateAlert(rule, desk(28, 26)), null);
});

test("an inactive path rule never fires", () => {
  assert.equal(evaluateAlert({ ...rule, active: false }, desk(41, 26)), null);
});
