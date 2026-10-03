import assert from "node:assert/strict";
import { test } from "node:test";
import { safeHttpUrl } from "./safe-url.ts";

test("only http and https survive", () => {
  assert.equal(safeHttpUrl("https://www.npr.org/story"), "https://www.npr.org/story");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl(""), null);
  assert.equal(safeHttpUrl("/events"), null);
});
