#!/usr/bin/env node
/**
 * Ask GitHub Releases whether a newer Ripple Radar build is published.
 * Prints one log line. Exit 0 always — a missing release is a normal state,
 * not a failed check.
 */
import { decideRelease } from "../src/lib/desktop/update-check.ts";
import { APP_VERSION, RELEASE_REPO } from "../src/lib/desktop/version.ts";

const url = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
let decision;
try {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "RippleRadar",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 404) {
    decision = decideRelease(APP_VERSION, null);
  } else if (!res.ok) {
    decision = decideRelease(APP_VERSION, null, `GitHub answered ${res.status}.`);
  } else {
    const json = await res.json();
    const tag = typeof json.tag_name === "string" ? json.tag_name.replace(/^v/i, "") : null;
    decision = decideRelease(APP_VERSION, tag);
  }
} catch (err) {
  decision = decideRelease(APP_VERSION, null, err instanceof Error ? err.message : "Could not reach GitHub.");
}

const line = `[update-check] ${new Date().toISOString()} state=${decision.state} current=${decision.current} latest=${decision.latest ?? "-"} ${decision.message}`;
console.log(line);
