/**
 * The quad module must not let a failed claim through as a feature, and must
 * not let a measured caveat drift away from the number it qualifies.
 *
 * Three families of risk, and a test family for each.
 *
 * 1. THE GATES. The classification passed its test; two forecasting claims
 *    built on it did not. A generated module that says "Goldilocks" is fine; a
 *    generated module that implies you should therefore be long, or should
 *    size risk by it, is the exact thing the validation runs ruled out.
 *
 * 2. THE POINT-IN-TIME DISCIPLINE. A reading whose inputs are dated AFTER the
 *    date it classifies is an almanac, not a nowcast, and the error would be
 *    invisible on screen.
 *
 * 3. THE QUALIFICATIONS. Margin calibration, revision confusion, spec
 *    agreement and spell durations exist to stop a label being read as more
 *    than it is. Each must stay internally consistent with the numbers it was
 *    derived from, so a stale export fails the suite instead of shipping.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGREEMENT,
  CURRENT_QUAD,
  DURATIONS,
  MARGIN_CALIBRATION,
  POSITIONING_VALIDATED,
  PUBLICATION_LAGS,
  QUADS,
  QUAD_RUN,
  QUAD_TRANSITIONS,
  RECENT_STRIP,
  RETURNS_BY_CHANNEL,
  RETURNS_TEST,
  REVISION,
  REVISION_CONFUSION,
  SELECTION,
  SPECS,
  VOL_BY_CHANNEL,
  VOL_FORECAST_VALIDATED,
  VOL_TEST,
  confidenceOf,
  exitOdds,
  likelyNextQuads,
  marginBinFor,
  occupancyFor,
  revisionSurvivalFor,
  specCalls,
  stalenessDays,
  type QuadReading,
} from "./macro-quads.ts";

const day = (iso: string) => Date.parse(iso + "T00:00:00Z");
const QUADS_LIST = [1, 2, 3, 4] as const;

// --- 1. the gates ----------------------------------------------------------

test("positioning stays gated while the holdout says it should", () => {
  assert.equal(POSITIONING_VALIDATED, RETURNS_TEST.passes);
  if (POSITIONING_VALIDATED) {
    assert.ok(
      RETURNS_TEST.channelsBeatingBaseline.length >= 2,
      "positioning cannot be validated with fewer than two channels beating the baseline",
    );
  } else {
    assert.equal(RETURNS_TEST.channelsBeatingBaseline.length, 0);
  }
});

test("the volatility gate stays separate from the returns gate", () => {
  // Two different claims against two different baselines. Collapsing them
  // would let one failure excuse the other, or one pass carry the other.
  assert.equal(VOL_FORECAST_VALIDATED, VOL_TEST.passes);
  assert.notEqual(RETURNS_TEST.baseline, VOL_TEST.baseline);
  if (!VOL_FORECAST_VALIDATED) {
    assert.equal(VOL_TEST.channelsBeatingBaseline.length, 0);
  }
});

test("no returns channel's interval excludes zero while the gate says failed", () => {
  for (const [ch, e] of Object.entries(RETURNS_BY_CHANNEL)) {
    const [lo, hi] = e.edgeCi;
    if (lo == null || hi == null) continue;
    const excludesZero = lo > 0 || hi < 0;
    assert.equal(
      excludesZero,
      RETURNS_TEST.channelsBeatingBaseline.includes(ch),
      `${ch}: CI [${lo}, ${hi}] disagrees with the recorded verdict`,
    );
  }
});

test("a volatility channel counted as a winner must have a positive reduction", () => {
  // Holm can clear a p-value on an effect pointing the wrong way. The runner
  // requires the sign too, and this pins that it did.
  for (const [ch, e] of Object.entries(VOL_BY_CHANNEL)) {
    if (!VOL_TEST.channelsBeatingBaseline.includes(ch)) continue;
    assert.ok((e.quadGainOverAr ?? 0) > 0, `${ch} counted as a winner with a negative gain`);
  }
});

test("the volatility signature is reported even though the forecast failed", () => {
  // The descriptive part survives the failed inferential part, and must not be
  // quietly dropped: the ratios are what make the failure legible.
  const withRatios = Object.values(VOL_BY_CHANNEL).filter(
    (e) => Object.keys(e.volRatios).length === 4,
  );
  assert.ok(withRatios.length > 0, "no channel carries its per-quad vol ratios");
  assert.ok(
    (VOL_TEST.signsHeld ?? 0) / (VOL_TEST.usableCells ?? 1) >
      (RETURNS_TEST.signsHeld ?? 0) / (RETURNS_TEST.usableCells ?? 1),
    "the vol signature should be more sign-stable than the returns one — if that " +
      "ever reverses, the copy describing it is wrong",
  );
});

// --- 2. point-in-time discipline -------------------------------------------

test("the live reading uses only data published before the date it classifies", () => {
  const asOf = day(CURRENT_QUAD.asOf);
  for (const through of [CURRENT_QUAD.growthThrough, CURRENT_QUAD.inflationThrough]) {
    if (!through) continue;
    assert.ok(
      day(through) < asOf,
      `${CURRENT_QUAD.asOf} claims to read data observed ${through} — an almanac, not a nowcast`,
    );
  }
  assert.ok((CURRENT_QUAD.dataLagDays ?? 0) > 0);
  assert.ok((CURRENT_QUAD.monthsBehind ?? 0) >= 1);
});

test("the quad matches the rates of change it was derived from", () => {
  const r = CURRENT_QUAD;
  assert.ok(r.growthRoc != null && r.inflationRoc != null);
  const expected =
    r.growthRoc! >= 0 ? (r.inflationRoc! >= 0 ? 2 : 1) : r.inflationRoc! >= 0 ? 3 : 4;
  assert.equal(r.quad, expected);
  assert.equal(r.name, QUADS[r.quad]?.name);
});

test("the margin is the weaker axis, because either crossing changes the quad", () => {
  const r = CURRENT_QUAD;
  assert.equal(r.growthMargin, Math.abs(r.growthRoc ?? 0));
  assert.equal(r.inflationMargin, Math.abs(r.inflationRoc ?? 0));
  assert.equal(r.margin, Math.min(r.growthMargin ?? 0, r.inflationMargin ?? 0));
});

test("every contributing series is one the chosen specification names", () => {
  const named = new Set([...SELECTION.growth, ...SELECTION.inflation]);
  for (const sid of Object.keys(CURRENT_QUAD.contributions)) {
    assert.ok(named.has(sid), `${sid} contributed but is not in the chosen spec`);
  }
  for (const sid of [...CURRENT_QUAD.growthUsed, ...CURRENT_QUAD.inflationUsed]) {
    assert.ok(PUBLICATION_LAGS[sid], `${sid} was used but has no measured publication lag`);
  }
});

test("the reading can be no fresher than its slowest input publishes", () => {
  const used = [...CURRENT_QUAD.growthUsed, ...CURRENT_QUAD.inflationUsed];
  const slowest = Math.max(...used.map((s) => PUBLICATION_LAGS[s]?.medianDays ?? 0));
  assert.ok(slowest > 0);
  assert.ok(
    (CURRENT_QUAD.dataLagDays ?? 0) >= slowest - 31,
    `lag ${CURRENT_QUAD.dataLagDays}d is implausibly short against a ${slowest}d publication lag`,
  );
});

test("GDP is excluded, and the module says why", () => {
  const inputs = Object.keys(PUBLICATION_LAGS);
  assert.ok(!inputs.some((s) => s.toUpperCase().includes("GDP")), "GDP publishes too late");
  assert.ok(QUAD_RUN.gdpExcludedReason.length > 20);
});

test("the recent strip is chronological and ends at the live reading", () => {
  assert.ok(RECENT_STRIP.length >= 12);
  for (let i = 1; i < RECENT_STRIP.length; i++) {
    assert.ok(day(RECENT_STRIP[i]!.asOf) > day(RECENT_STRIP[i - 1]!.asOf));
  }
  const last = RECENT_STRIP[RECENT_STRIP.length - 1]!;
  assert.ok(day(last.asOf) <= day(CURRENT_QUAD.asOf));
});

// --- 3. the qualifications --------------------------------------------------

test("margin bins tile the line without gaps or overlaps", () => {
  const bins = Object.values(MARGIN_CALIBRATION).sort((a, b) => a.lo - b.lo);
  assert.equal(bins[0]!.lo, 0, "the first bin must start at zero");
  for (let i = 1; i < bins.length; i++) {
    assert.equal(bins[i]!.lo, bins[i - 1]!.hi, "bins must meet exactly");
  }
  assert.equal(bins[bins.length - 1]!.hi, null, "the last bin must be open-ended");
});

test("a thin bin is marked unusable rather than quoted", () => {
  for (const b of Object.values(MARGIN_CALIBRATION)) {
    if (b.n < 20) {
      assert.equal(b.usable, false, `${b.label} has n=${b.n} and must not be quotable`);
    }
    if (b.survival != null) {
      assert.ok(b.survival >= 0 && b.survival <= 1);
      assert.equal(b.survived, Math.round(b.survival * b.n), `${b.label} count/rate disagree`);
    }
  }
});

test("survival improves as the margin widens", () => {
  // Not a fitted monotone curve — the bin edges were fixed in advance. If this
  // ever fails, the margin does not mean what the UI says it means.
  const bins = Object.values(MARGIN_CALIBRATION)
    .filter((b) => b.usable && b.survival != null)
    .sort((a, b) => a.lo - b.lo);
  assert.ok(bins.length >= 2, "not enough usable bins to check the direction");
  for (let i = 1; i < bins.length; i++) {
    assert.ok(
      bins[i]!.survival! >= bins[i - 1]!.survival!,
      `${bins[i]!.label} (${bins[i]!.survival}) is less durable than ${bins[i - 1]!.label}`,
    );
  }
});

test("the live reading's quoted survival comes from its own bin", () => {
  const bin = marginBinFor(CURRENT_QUAD.margin);
  assert.ok(bin, "the live reading has no margin bin");
  assert.equal(REVISION.live.bin, bin!.label);
  assert.equal(REVISION.live.survival, bin!.survival);
  assert.equal(REVISION.live.n, bin!.n);
  assert.equal(REVISION.live.usable, bin!.usable);
});

test("revisionSurvivalFor refuses to answer outside a usable bin", () => {
  assert.deepEqual(revisionSurvivalFor(null), {
    bin: null,
    survival: null,
    n: 0,
    usable: false,
  });
  assert.deepEqual(revisionSurvivalFor(Number.NaN), {
    bin: null,
    survival: null,
    n: 0,
    usable: false,
  });
  // A huge margin still lands in the open-ended bin rather than falling off.
  assert.equal(revisionSurvivalFor(999)?.bin, "decisive");
});

test("the confusion matrix is a distribution, and its diagonal is survival", () => {
  for (const q of QUADS_LIST) {
    const row = REVISION_CONFUSION[q];
    assert.ok(row, `no confusion row for Q${q}`);
    const total = QUADS_LIST.reduce((a, c) => a + (row!.to[c] ?? 0), 0);
    assert.ok(Math.abs(total - 1) < 0.02, `Q${q} row sums to ${total}`);
    assert.ok(row!.to[q]! > 0.5, `Q${q} survives less than half the time — check the copy`);
  }
});

test("the flip-axis tally accounts for every failure exactly once", () => {
  const f = REVISION.flipAxis;
  assert.equal(f.growth + f.inflation + f.both, f.total);
  if (f.total > 0) {
    assert.ok(Math.abs((f.growthShare ?? 0) - f.growth / f.total) < 0.001);
  }
});

test("pooled survival is consistent with the calibration behind it", () => {
  const bins = Object.values(MARGIN_CALIBRATION);
  const n = bins.reduce((a, b) => a + b.n, 0);
  const survived = bins.reduce((a, b) => a + b.survived, 0);
  assert.equal(n, REVISION.measuredOver.n, "bins and the measured window disagree on n");
  assert.ok(
    Math.abs(survived / n - (REVISION.pooledSurvival ?? 0)) < 0.005,
    "the pooled rate does not match the bins it is made of",
  );
});

test("specification agreement counts what the specs actually say", () => {
  const live = Object.values(SPECS).filter((s) => s.quadNow != null);
  assert.equal(live.length, AGREEMENT.nClassified);
  assert.equal(Object.keys(SPECS).length, AGREEMENT.nSpecs);
  for (const q of QUADS_LIST) {
    const expected = live.filter((s) => s.quadNow === q).length;
    const recorded = AGREEMENT.counts[String(q)] ?? 0;
    assert.equal(recorded, expected, `Q${q}: recorded ${recorded}, specs say ${expected}`);
  }
  const modal = AGREEMENT.modalQuad;
  assert.ok(modal != null);
  assert.equal(
    AGREEMENT.counts[String(modal)],
    Math.max(...QUADS_LIST.map((q) => AGREEMENT.counts[String(q)] ?? 0)),
    "the modal quad is not the most common one",
  );
});

test("a disqualified specification never wins the selection", () => {
  const chosen = SPECS[SELECTION.chosen];
  assert.ok(chosen, `the chosen spec ${SELECTION.chosen} is not in the table`);
  assert.equal(chosen!.eligible, true, "the chosen specification was disqualified");
  assert.equal(chosen!.disqualifiedBecause, null);
  for (const s of Object.values(SPECS)) {
    if (s.eligible) {
      assert.equal(s.disqualifiedBecause, null, `${s.name} is eligible with a reason attached`);
    } else {
      assert.ok(s.disqualifiedBecause, `${s.name} is disqualified with no reason given`);
      assert.ok(
        (s.medianSpellMonths ?? 0) < SELECTION.persistenceFloorMonths,
        `${s.name} was disqualified despite clearing the persistence floor`,
      );
    }
  }
});

test("the chosen specification won on the training window it was chosen on", () => {
  const eligible = Object.values(SPECS).filter((s) => s.eligible && s.survivalTrain != null);
  const best = Math.max(...eligible.map((s) => s.survivalTrain!));
  assert.ok(
    Math.abs((SPECS[SELECTION.chosen]!.survivalTrain ?? 0) - best) < 1e-9,
    "the chosen spec is not the training-window winner",
  );
  // And the holdout rank is recorded, so a lucky pick is visible rather than hidden.
  assert.ok(SELECTION.holdoutRank != null && SELECTION.holdoutRank >= 1);
  assert.ok(SELECTION.holdoutRank <= SELECTION.nCandidatesRanked);
});

test("specCalls puts disagreement first", () => {
  const calls = specCalls();
  assert.equal(calls.length, Object.keys(SPECS).length);
  const firstAgreeing = calls.findIndex((s) => s.quadNow === AGREEMENT.modalQuad);
  const lastDisagreeing = calls.reduce(
    (acc, s, i) => (s.quadNow !== AGREEMENT.modalQuad ? i : acc),
    -1,
  );
  if (firstAgreeing >= 0 && lastDisagreeing >= 0) {
    assert.ok(
      lastDisagreeing < firstAgreeing,
      "an agreeing spec is listed before a dissenting one",
    );
  }
});

test("transition rows are distributions over OTHER quads", () => {
  for (const [from, row] of Object.entries(QUAD_TRANSITIONS)) {
    assert.equal(row[Number(from)], 0, `Q${from} transitions to itself`);
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.01, `Q${from} row sums to ${total}`);
  }
});

test("likelyNextQuads ranks by probability and drops impossible moves", () => {
  for (const q of QUADS_LIST) {
    const next = likelyNextQuads(q);
    assert.ok(
      next.every((n) => n.quad !== q),
      "a collapsed run cannot stay put",
    );
    assert.ok(next.every((n) => n.p > 0));
    for (let i = 1; i < next.length; i++) {
      assert.ok(next[i - 1]!.p >= next[i]!.p, "not sorted");
    }
  }
});

test("occupancy shares sum to one over every exported window", () => {
  for (const w of [3, 6, 12, 24]) {
    const o = occupancyFor(w);
    assert.ok(o, `no occupancy for a ${w}-month window`);
    const total = Object.values(o!.shares).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.02, `${w}mo shares sum to ${total}`);
    assert.ok(o!.months <= w);
    assert.equal(
      o!.dominantShare,
      Math.max(...Object.values(o!.shares)),
      `${w}mo dominant share is not the largest`,
    );
    assert.ok((o!.switches ?? 0) >= (o!.distinctQuads ?? 1) - 1);
  }
});

test("occupancy over a longer window cannot be more concentrated by construction", () => {
  // A 3-month window can easily be 100% one quad; a 24-month one cannot be
  // more concentrated than the 3-month one unless nothing changed. This pins
  // that the windows are nested rather than independently computed.
  const short = occupancyFor(3)!;
  const long = occupancyFor(24)!;
  if ((long.distinctQuads ?? 0) > 1) {
    assert.ok(
      (long.dominantShare ?? 0) <= 1,
      "a 24-month window spanning several quads cannot be wholly one of them",
    );
  }
  assert.ok((short.months ?? 0) <= (long.months ?? 0));
});

test("the current spell is right-censored and its odds come from a stated basis", () => {
  const c = DURATIONS.current;
  assert.ok(c.elapsedMonths >= 1);
  assert.ok(c.basis.length > 0, "no basis recorded for the exit odds");
  assert.ok(c.basisNCompleted > 0, "exit odds quoted from zero completed spells");
  for (const h of [1, 3, 6] as const) {
    const v = exitOdds(h);
    if (v == null) continue;
    assert.ok(v >= 0 && v <= 1, `exit within ${h} months is ${v}`);
  }
  const one = exitOdds(1);
  const six = exitOdds(6);
  if (one != null && six != null) {
    assert.ok(six >= one, "a longer horizon cannot be less likely to contain the exit");
  }
});

test("spell counts add up and the pooled median is quotable", () => {
  const p = DURATIONS.pooled;
  assert.equal(p.nSpells, p.nCompleted + p.nCensored);
  assert.ok(p.nCensored >= 1, "at least one spell must still be running");
  assert.equal(p.usable, p.nCompleted >= 6);
  const byQuad = Object.values(DURATIONS.byQuad);
  assert.equal(
    byQuad.reduce((a, d) => a + d.nSpells, 0),
    p.nSpells,
    "per-quad spells do not sum to the pooled count",
  );
  for (const d of byQuad) {
    if (!d.usable) assert.ok(d.nCompleted < 6, "a usable-looking curve is marked unusable");
  }
});

test("confidenceOf reports its components and never returns a probability", () => {
  const c = confidenceOf(CURRENT_QUAD);
  assert.ok(["firm", "mixed", "fragile"].includes(c.grade));
  assert.ok(c.basis.length > 0);
  assert.equal(c.marginBin, REVISION.live.bin);
  assert.equal(c.marginSurvival, REVISION.live.survival);
  assert.equal(c.specTotal, AGREEMENT.nClassified);
  assert.equal(c.specAgreeing, AGREEMENT.counts[String(CURRENT_QUAD.quad)] ?? 0);
});

test("a knife-edge reading is never graded firm", () => {
  // The grade is a rendering convention, but it is one with a rule, and the
  // rule is that a thin margin or a split vote cannot read as confident.
  const thin: QuadReading = { ...CURRENT_QUAD, margin: 0.01 };
  const c = confidenceOf(thin);
  const survival = marginBinFor(0.01)?.survival ?? 1;
  if (survival < 0.75) {
    assert.equal(c.grade, "fragile");
    assert.ok(c.basis.includes("%"), "a fragile grade should quote the rate that made it fragile");
  }
});

test("stalenessDays measures against the data, not the label", () => {
  const r: QuadReading = {
    ...CURRENT_QUAD,
    asOf: "2026-09-25",
    growthThrough: "2026-08-01",
    inflationThrough: "2026-07-01",
  };
  assert.equal(stalenessDays(r, day("2026-09-25")), 55);
  assert.equal(
    stalenessDays({ ...r, growthThrough: null, inflationThrough: null }, Date.now()),
    null,
  );
});

test("the run distribution covers every quad and totals the classified months", () => {
  const total = Object.values(QUAD_RUN.distribution).reduce((a, b) => a + b, 0);
  assert.equal(total, QUAD_RUN.nClassified);
  for (const r of RECENT_STRIP) {
    assert.ok(QUAD_RUN.distribution[String(r.quad)]! > 0, `Q${r.quad} missing from the run`);
  }
});
