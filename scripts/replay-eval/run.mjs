/**
 * Replay the deterministic engine on scripts/replay-eval/events.json
 * and score the books against cached Yahoo prices.
 *
 *   node scripts/replay-eval/run.mjs            # predict, download, score
 *   node scripts/replay-eval/run.mjs --offline  # predict and score the cache
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
const offline = process.argv.includes("--offline");

function step(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

step("npx", ["tsx", "scripts/replay-eval/predict.ts"]);
if (!offline) step("node", ["scripts/replay-eval/prices.mjs"]);
step("node", ["scripts/replay-eval/score.mjs"]);
