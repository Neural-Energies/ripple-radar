/**
 * Turn the scenario-distribution scorecard into the JSON the app imports.
 *
 *   node scripts/generate-scenario-distribution.mjs [scorecard] [out]
 *
 * Generated, never hand-edited. The file this replaces was copied by hand: it
 * said "filtered historical simulation" and shipped the runner's Student-t
 * example probabilities, because the runner always emitted Student-t bands
 * whichever family had won. Each channel now carries the family that was
 * chosen and confirmed, and the probabilities that family produced.
 *
 * Every channel is listed so `published.ts` keeps one key per ticker mapping;
 * a channel that did not pass on its held-back windows has `passes: false` and
 * no probabilities, and the app renders absence.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const LABELS = [
  ["P(move > +2%)", "Up more than 2%"],
  ["P(move < -2%)", "Down more than 2%"],
  ["P(move > +5%)", "Up more than 5%"],
  ["P(move < -5%)", "Down more than 5%"],
];

export function buildScenarioModule(scorecard, source) {
  const channels = {};
  let horizon = null;
  for (const [name, row] of Object.entries(scorecard)) {
    const bands = row.example_bands ?? {};
    if (bands.family !== row.chosen_family) {
      throw new Error(`${name}: emitted family ${bands.family} is not the evaluated family ${row.chosen_family}`);
    }
    if (horizon !== null && row.horizon !== horizon) {
      throw new Error(`${name}: horizon ${row.horizon} differs from ${horizon}`);
    }
    horizon = row.horizon;
    const probabilities = {};
    if (row.passes) {
      for (const [key, label] of LABELS) {
        const p = bands.probabilities?.[key];
        if (typeof p !== "number") throw new Error(`${name}: missing ${key}`);
        probabilities[label] = p;
      }
    }
    channels[name] = {
      passes: Boolean(row.passes),
      family: row.chosen_family,
      asOf: row.as_of,
      confirmationWindows: row.n_confirmation,
      probabilities,
    };
  }
  if (horizon === null) throw new Error("scorecard has no channels");
  return {
    model: basename(source).replace(/_scorecard\.json$/, ""),
    source,
    horizonSessions: horizon,
    channels,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const IN = process.argv[2] ?? "artifacts/reports/ace_scenario_distribution_v2_scorecard.json";
  const OUT = process.argv[3] ?? "src/data/ace-scenario-distribution.json";
  const out = buildScenarioModule(JSON.parse(readFileSync(IN, "utf8")), IN);
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const passing = Object.entries(out.channels).filter(([, c]) => c.passes).map(([n]) => n);
  console.log(`wrote ${OUT}: ${passing.length}/${Object.keys(out.channels).length} channels pass (${passing.join(", ") || "none"})`);
}
