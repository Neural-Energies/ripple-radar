import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictGap, excelDate, taylorRule } from "./macro-models.ts";

test("the Taylor rule uses r-star, the inflation gap, and an Okun gap", () => {
  const rule = taylorRule({
    funds: 3.63,
    inflation: 2.4,
    unemployment: 4.1,
    nairu: 4.39,
    rStar: 1.01,
  });
  assert.ok(Math.abs(rule.gap - 0.58) < 1e-9);
  assert.ok(Math.abs(rule.rule - 3.9) < 1e-9);
  assert.ok(rule.stance < 0);
});

test("conflict is wage growth minus price growth", () => {
  assert.ok(Math.abs(conflictGap(4, 3.4) - 0.6) < 1e-9);
});

test("excel dates land on the quarter HLW uses", () => {
  assert.equal(excelDate(46113), "2026-04-01");
});
