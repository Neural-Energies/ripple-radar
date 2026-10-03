import assert from "node:assert/strict";
import { test } from "node:test";
import { deskFileFromStorage, parseDeskFile } from "./desk-file.ts";

test("a desk file keeps only desk keys", () => {
  const text = deskFileFromStorage(
    [
      { key: "ripple-radar-v2", value: "{\"state\":{}}" },
      { key: "ripple-radar-v2:u:abc", value: "{\"state\":{\"a\":1}}" },
      { key: "other", value: "no" },
    ],
    new Date("2026-10-03T17:00:00.000Z"),
  );
  const parsed = parseDeskFile(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.entries.map((e) => e.key), ["ripple-radar-v2", "ripple-radar-v2:u:abc"]);
});

test("a random file is refused", () => {
  assert.equal(parseDeskFile("not json").ok, false);
  assert.equal(parseDeskFile('{"kind":"other","entries":[]}').ok, false);
  const empty = parseDeskFile('{"kind":"ripple-radar-desk","entries":[]}');
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.message, /no saved desk/);
});
