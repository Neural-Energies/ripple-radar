import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeConservative, modelsDisagree, type ClusterJudgeLabel } from "./judge.ts";
import {
  BudgetGate,
  isModelRoutingEnabled,
  route,
  type RouteContext,
} from "./routing.ts";

function label(partial: Partial<ClusterJudgeLabel> & Pick<ClusterJudgeLabel, "disposition" | "family" | "marketMoving">): ClusterJudgeLabel {
  return {
    schemaVersion: "cluster-judge/v0",
    clusterId: "c1",
    confidence: "high",
    why: "test",
    ...partial,
  };
}

test("flag off: isModelRoutingEnabled is false unless RIPPLE_MODEL_ROUTING=1", () => {
  const prev = process.env.RIPPLE_MODEL_ROUTING;
  try {
    delete process.env.RIPPLE_MODEL_ROUTING;
    assert.equal(isModelRoutingEnabled(), false);
    process.env.RIPPLE_MODEL_ROUTING = "0";
    assert.equal(isModelRoutingEnabled(), false);
    process.env.RIPPLE_MODEL_ROUTING = "1";
    assert.equal(isModelRoutingEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.RIPPLE_MODEL_ROUTING;
    else process.env.RIPPLE_MODEL_ROUTING = prev;
  }
});

test("no key → route returns rules/null model (legacy offline path)", () => {
  const ctx: RouteContext = { hasXaiKey: false, budgetOk: true };
  const plan = route("analyze", ctx);
  assert.equal(plan.class, "rules");
  assert.equal(plan.model, null);
  assert.equal(plan.maxTokens, 0);
  assert.equal(plan.schemaVersion, "analyze/v0");

  const gate = new BudgetGate(() => 1_000_000);
  const deny = gate.allow("analyze", "fp", ctx);
  assert.equal(deny.allow, false);
  assert.equal(deny.reason, "no_key");
});

test("cooldown deny after successful accept; stamp only via markAccepted", () => {
  let now = 1_000_000;
  const gate = new BudgetGate(() => now);
  const ctx: RouteContext = { hasXaiKey: true, budgetOk: true };

  assert.equal(gate.allow("analyze", "k1", ctx).allow, true);
  // Without markAccepted, second allow still passes (fail/timeout must not stamp).
  assert.equal(gate.allow("analyze", "k1", ctx).allow, true);

  gate.markAccepted("analyze", "k1");
  const denied = gate.allow("analyze", "k1", ctx);
  assert.equal(denied.allow, false);
  assert.equal(denied.reason, "cooldown");
  assert.ok((denied.retryAfterMs ?? 0) > 0);

  now += 45_000;
  assert.equal(gate.allow("analyze", "k1", ctx).allow, true);
});

test("rescore cooldown is 90s per event key", () => {
  let now = 5_000_000;
  const gate = new BudgetGate(() => now);
  const ctx: RouteContext = { hasXaiKey: true, budgetOk: true };
  gate.markAccepted("rescore", "evt-1");
  const denied = gate.allow("rescore", "evt-1", ctx);
  assert.equal(denied.allow, false);
  assert.equal(denied.reason, "cooldown");
  now += 89_999;
  assert.equal(gate.allow("rescore", "evt-1", ctx).allow, false);
  now += 1;
  assert.equal(gate.allow("rescore", "evt-1", ctx).allow, true);
});

test("route online plans use deep/cheap classes and env model ids", () => {
  const ctx: RouteContext = {
    hasXaiKey: true,
    budgetOk: true,
    cheapModel: "cheap-id",
    deepModel: "deep-id",
  };
  const analyze = route("analyze", ctx);
  assert.equal(analyze.class, "deep");
  assert.equal(analyze.model, "deep-id");
  assert.equal(analyze.maxTokens, 2400);
  assert.equal(analyze.timeoutMs, 28_000);

  const judge = route("judge", ctx);
  assert.equal(judge.class, "cheap");
  assert.equal(judge.model, "cheap-id");
  assert.equal(judge.schemaVersion, "cluster-judge/v0");
  assert.equal(judge.allowEnsemble, true);
});

test("concurrency deny while in flight", () => {
  const gate = new BudgetGate(() => 9_000_000);
  const ctx: RouteContext = { hasXaiKey: true, budgetOk: true };
  gate.beginFlight();
  const denied = gate.allow("judge", "c1", ctx);
  assert.equal(denied.allow, false);
  assert.equal(denied.reason, "concurrency");
  gate.endFlight();
  assert.equal(gate.allow("judge", "c1", ctx).allow, true);
});

test("modelsDisagree only on real disposition/family/marketMoving diffs", () => {
  const a = label({ disposition: "watch", family: "policy", marketMoving: false });
  const b = label({ disposition: "watch", family: "policy", marketMoving: false, confidence: "very_high", why: "other" });
  assert.equal(modelsDisagree(a, b), false, "confidence/why alone must not invent disagreement");

  const c = label({ disposition: "onRadar", family: "policy", marketMoving: false });
  assert.equal(modelsDisagree(a, c), true);

  const d = label({ disposition: "watch", family: "credit", marketMoving: false });
  assert.equal(modelsDisagree(a, d), true);

  const e = label({ disposition: "watch", family: "policy", marketMoving: true });
  assert.equal(modelsDisagree(a, e), true);

  const merged = mergeConservative(a, c);
  assert.equal(merged.disposition, "watch", "conservative pick");
  assert.equal(merged.modelsDisagree, true);
  assert.equal(merged.confidence, "medium", "confidence floored one step on disagree");
});
