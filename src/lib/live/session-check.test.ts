import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionCheck } from "./session-check.ts";

test("quad 1 agrees when equities and credit are up and duration is down", () => {
  const check = sessionCheck(1, { SPX: 0.4, KRE: 0.2, TLT: -0.3 });
  assert.equal(check.read, "agrees");
  assert.equal(check.met, 3);
  assert.equal(check.rows[0]?.ticker, "SPX");
});

test("a flat print does not count as leading", () => {
  const check = sessionCheck(4, { TLT: 0, XLE: -0.5 });
  assert.equal(check.rows[0]?.met, false);
  assert.equal(check.read, "split");
});

test("the tape fights when every leg is the wrong way", () => {
  const check = sessionCheck(2, { CL: -1, XLE: -0.4, TLT: 0.6 });
  assert.equal(check.read, "fights");
});

test("no prints is not a vote", () => {
  assert.equal(sessionCheck(3, {}).read, "no tape");
});

test("the backup ticker is used when the primary is missing", () => {
  const check = sessionCheck(1, { QQQ: 0.8, XLF: 0.1, TLT: -0.2 });
  assert.deepEqual(
    check.rows.map((row) => row.ticker),
    ["QQQ", "XLF", "TLT"],
  );
});
