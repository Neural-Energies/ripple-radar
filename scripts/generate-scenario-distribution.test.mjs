import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScenarioModule } from "./generate-scenario-distribution.mjs";

const probs = {
  "P(move > +2%)": 0.3,
  "P(move < -2%)": 0.2,
  "P(move > +5%)": 0.1,
  "P(move < -5%)": 0.05,
};

function row(overrides = {}) {
  return {
    horizon: 20,
    as_of: "2026-09-25",
    passes: true,
    chosen_family: "filtered_historical_simulation",
    n_confirmation: 90,
    example_bands: { family: "filtered_historical_simulation", probabilities: probs },
    ...overrides,
  };
}

test("each channel ships the family that was chosen, with that family's probabilities", () => {
  const out = buildScenarioModule({ SP500: row() }, "artifacts/reports/ace_scenario_distribution_v2_scorecard.json");
  assert.equal(out.model, "ace_scenario_distribution_v2");
  assert.equal(out.channels.SP500.family, "filtered_historical_simulation");
  assert.equal(out.channels.SP500.probabilities["Up more than 2%"], 0.3);
  assert.equal(out.horizonSessions, 20);
});

test("a mismatch between emitted and evaluated family is refused, not shipped", () => {
  const bad = row({ example_bands: { family: "student_t", probabilities: probs } });
  assert.throws(() => buildScenarioModule({ SP500: bad }, "s.json"), /not the evaluated family/);
});

test("a channel that failed confirmation is listed with no probabilities", () => {
  const out = buildScenarioModule({ WTI: row({ passes: false }) }, "s.json");
  assert.equal(out.channels.WTI.passes, false);
  assert.deepEqual(out.channels.WTI.probabilities, {});
});
