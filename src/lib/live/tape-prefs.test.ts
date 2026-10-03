import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleTape } from "../../components/world-tape-helpers.tsx";
import { defaultTapePrefs, parseTapePrefs } from "./tape-prefs.ts";
import type { LiveHeadline } from "./types.ts";

function item(title: string, source: string): LiveHeadline {
  return {
    id: title,
    title,
    source,
    url: "https://example.com/story",
    published: 1,
    eventTimeMs: 1,
    availableTimeMs: 1,
    eventIds: [],
    tone: "neutral",
  };
}

test("an unknown tape preference is the live default", () => {
  const prefs = parseTapePrefs({ shockOnly: "yes", refreshMs: 999, allSources: false, sources: ["NPR World", 4] });
  assert.equal(prefs.shockOnly, false);
  assert.equal(prefs.refreshMs, defaultTapePrefs().refreshMs);
  assert.equal(prefs.allSources, false);
  assert.deepEqual(prefs.sources, ["NPR World"]);
});

test("the tape shows every headline unless shocks or a source list is on", () => {
  const rows = [item("City council names a park", "NPR World"), item("OPEC embargo halts loadings", "BBC World")];
  const all = visibleTape(rows, defaultTapePrefs());
  assert.equal(all.length, 2);
  const shocks = visibleTape(rows, { ...defaultTapePrefs(), shockOnly: true });
  assert.equal(shocks.length, 1);
  assert.match(shocks[0]!.title, /embargo/i);
  const one = visibleTape(rows, { ...defaultTapePrefs(), allSources: false, sources: ["NPR World"] });
  assert.equal(one.length, 1);
  assert.equal(one[0]!.source, "NPR World");
});
