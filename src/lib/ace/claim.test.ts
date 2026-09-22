/**
 * What the desk is allowed to claim about a number it is showing.
 *
 * These are honesty tests, not math tests: the failure they exist to catch is
 * a credible interval left on screen around a probability it was not computed
 * from, or an LLM proposal inheriting the stronger `model_based` badge.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForecastBand } from "@/data/types";
import { overlayForecastClaim } from "@/lib/live/overlay";

const BAND: ForecastBand[] = [{ scenarioId: "s1", p10: 20, p50: 35, p90: 52, width: 32 }];

test("the book's posterior band and provenance reach the screen", () => {
  const out = overlayForecastClaim(
    { bands: undefined, provenance: undefined },
    { bands: BAND, provenance: "model_based" },
  );
  assert.deepEqual(out.bands, BAND);
  assert.equal(out.provenance, "model_based");
});

test("a rescore that moved mass drops the band instead of bracketing a different number", () => {
  const out = overlayForecastClaim(
    { bands: BAND, provenance: "model_based" },
    { bands: BAND, provenance: "model_based" },
    {
      eventId: "e1",
      probability: 61,
      takeaway: "t",
      narrative: "n",
      scenarioShifts: [{ id: "s1", probability: 61 }],
      asOf: 0,
      provenance: "llm_proposal",
    },
  );
  assert.equal(out.bands, undefined, "a band must never survive the numbers it described");
  assert.equal(out.provenance, "llm_proposal", "an LLM proposal never inherits model_based");
});

test("a rescore that shifted nothing leaves the posterior claim intact", () => {
  const out = overlayForecastClaim(
    { bands: undefined, provenance: undefined },
    { bands: BAND, provenance: "model_based" },
    {
      eventId: "e1",
      probability: 35,
      takeaway: "t",
      narrative: "n",
      scenarioShifts: [],
      asOf: 0,
      provenance: "unchanged",
    },
  );
  assert.deepEqual(out.bands, BAND);
  assert.equal(out.provenance, "model_based");
});

test("nothing is invented when neither book nor base carries a claim", () => {
  const out = overlayForecastClaim({ bands: undefined, provenance: undefined }, undefined);
  assert.equal(out.bands, undefined);
  assert.equal(out.provenance, undefined, "an unstamped forecast stays unstamped");
});

test("no path can mint a calibrated badge", () => {
  for (const rescore of [undefined, { scenarioShifts: [{ id: "s1", probability: 9 }] }]) {
    const out = overlayForecastClaim(
      { bands: BAND, provenance: "model_based" },
      { bands: BAND, provenance: "model_based" },
      rescore as never,
    );
    assert.notEqual(out.provenance, "calibrated");
  }
});
