import assert from "node:assert/strict";
import { test } from "node:test";
import { plainError } from "./plain-error.ts";

test("a stack trace does not reach the screen", () => {
  const err = new Error("Tape interrupted\n    at buildDesk (build.server.ts:1:1)");
  assert.equal(plainError(err), "Tape interrupted");
});

test("a long message is cut, and an empty one gets a sentence", () => {
  assert.equal(plainError(new Error("x".repeat(400))).endsWith("…"), true);
  assert.match(plainError("   \n    at foo"), /Try again/);
  assert.equal(plainError(null, "The tape did not answer."), "The tape did not answer.");
});
