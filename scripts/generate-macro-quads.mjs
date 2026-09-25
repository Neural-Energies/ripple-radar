/**
 * Turn the point-in-time quad run into typed modules the app can import.
 *
 * Generated, never hand-edited. Two outputs, deliberately:
 *
 *   src/lib/ace/macro-quads.ts    the live reading and everything needed to
 *                                 qualify it — margin calibration, spec
 *                                 agreement, occupancy, spell odds, verdicts.
 *                                 Small enough to ship to every page.
 *
 *   src/lib/ace/macro-detail.json the history, the per-spec scores, the
 *                                 survival curves and the full channel
 *                                 results. Server-side only; the deep route
 *                                 fetches it rather than every page paying for
 *                                 it.
 *
 * WHAT THIS GENERATOR REFUSES TO EMIT
 *
 * The quad framework makes three separable claims, and they came out
 * differently:
 *
 *   1. The economy can be classified this way in real time.      HELD
 *   2. Knowing the quad tells you how to be positioned.          FAILED
 *   3. Knowing the quad improves a volatility forecast that
 *      already knows last month's volatility.                    FAILED
 *
 * So `POSITIONING_VALIDATED` and `VOL_FORECAST_VALIDATED` are written from the
 * runs, not by hand, and the generator refuses to emit at all if the live
 * reading is unclassified, the history is too short, or a verdict is missing
 * entirely. An absent scorecard must never read as a pass.
 */
import { readFileSync, writeFileSync } from "node:fs";

const IN = process.argv[2] ?? "artifacts/reports/ace_macro_quad_v1_panel.json";
const OUT = process.argv[3] ?? "src/lib/ace/macro-quads.ts";
const OUT_DETAIL = process.argv[4] ?? "src/lib/ace/macro-detail.json";

const art = JSON.parse(readFileSync(IN, "utf8"));
const fail = (msg) => {
  console.error(`generate-macro-quads: ${msg} — refusing to emit`);
  process.exit(1);
};

const current = art.current ?? {};
if (current.quad == null) fail("the live reading is unclassified");
const history = (art.history ?? []).filter((r) => r.quad != null);
if (history.length < 24) fail(`only ${history.length} classified months in the display window`);
if (!art.revision?.available) fail("no revision measurement was produced");
if (!art.validation?.returns?.available) fail("the returns verdict is missing");
if (!art.validation?.volatility?.available) fail("the volatility verdict is missing");

const positioningValidated = art.validation.returns.passes === true;
const volValidated = art.validation.volatility.passes === true;

const j = (v) => JSON.stringify(v ?? null);
const num = (v) => (v == null || Number.isNaN(v) ? "null" : v);

const readingLiteral = (r, ind) => {
  const p = " ".repeat(ind);
  return `{
${p}  asOf: ${j(r.as_of)},
${p}  spec: ${j(r.spec)},
${p}  quad: ${r.quad},
${p}  name: ${j(r.name)},
${p}  description: ${j(r.reason ?? "")},
${p}  growthYoy: ${num(r.growth_yoy)},
${p}  inflationYoy: ${num(r.inflation_yoy)},
${p}  growthRoc: ${num(r.growth_roc)},
${p}  inflationRoc: ${num(r.inflation_roc)},
${p}  growthMargin: ${num(r.growth_margin)},
${p}  inflationMargin: ${num(r.inflation_margin)},
${p}  margin: ${num(r.margin)},
${p}  growthThrough: ${j(r.growth_through)},
${p}  inflationThrough: ${j(r.inflation_through)},
${p}  dataLagDays: ${num(r.data_lag_days)},
${p}  monthsBehind: ${num(r.months_behind)},
${p}  growthUsed: ${j(r.growth_used ?? [])},
${p}  inflationUsed: ${j(r.inflation_used ?? [])},
${p}  growthAgreement: ${num(r.growth_agreement)},
${p}  inflationAgreement: ${num(r.inflation_agreement)},
${p}  contributions: ${j(r.contributions ?? {})},
${p}}`;
};

const rev = art.revision;
const cal = rev.calibration ?? {};
const agree = art.agreement ?? {};
const dur = art.durations ?? {};
const cur = dur.current ?? {};
const sel = art.selection ?? {};
const spec = art.spec ?? {};
const ret = art.validation.returns;
const vol = art.validation.volatility;

const calRows = Object.entries(cal)
  .map(
    ([label, c]) =>
      `  ${j(label)}: { label: ${j(label)}, lo: ${num(c.lo)}, hi: ${num(c.hi)}, n: ${num(
        c.n,
      )}, survived: ${num(c.survived)}, survival: ${num(c.survival)}, usable: ${!!c.usable} },`,
  )
  .join("\n");

const confRows = Object.entries(rev.confusion ?? {})
  .map(([q, c]) => {
    const to = Object.entries(c.to ?? {})
      .map(([k, v]) => `${k}: ${Number(v).toFixed(4)}`)
      .join(", ");
    return `  ${q}: { name: ${j(c.name)}, n: ${num(c.n)}, to: { ${to} } },`;
  })
  .join("\n");

const transitions = Object.entries(art.transitions ?? {})
  .map(([from, row]) => {
    const cells = Object.entries(row)
      .map(([to, p]) => `${to}: ${Number(p).toFixed(4)}`)
      .join(", ");
    return `  ${from}: { ${cells} },`;
  })
  .join("\n");

const occRows = Object.entries(art.occupancy ?? {})
  .map(
    ([w, o]) =>
      `  ${w}: { window: ${w}, months: ${num(o.months)}, dominant: ${num(
        o.dominant,
      )}, dominantShare: ${num(o.dominant_share)}, tied: ${!!o.tied}, tiedWith: ${j(
        o.tied_with ?? [],
      )}, distinctQuads: ${num(o.distinct_quads)}, switches: ${num(
        o.switches,
      )}, shares: ${j(o.shares ?? {})} },`,
  )
  .join("\n");

const byQuadDur = Object.entries(dur.by_quad ?? {})
  .map(
    ([q, d]) =>
      `  ${q}: { nSpells: ${num(d.n_spells)}, nCompleted: ${num(
        d.n_completed,
      )}, medianMonths: ${num(d.median_months)}, meanCompletedMonths: ${num(
        d.mean_completed_months,
      )}, usable: ${!!d.usable} },`,
  )
  .join("\n");

const specRows = Object.entries(art.specs ?? {})
  .map(([n, s]) => {
    const score = sel.scores?.[n] ?? {};
    const pers = sel.persistence?.[n] ?? {};
    const reading = agree.readings?.[n] ?? {};
    return `  ${j(n)}: {
    name: ${j(n)},
    growth: ${j(s.growth ?? [])},
    inflation: ${j(s.inflation ?? [])},
    lookback: ${num(s.lookback)},
    rationale: ${j(s.rationale ?? "")},
    eligible: ${sel.eligible?.[n] !== false},
    disqualifiedBecause: ${j(sel.disqualified?.[n] ?? null)},
    survivalTrain: ${num(score.survival_train)},
    survivalHoldout: ${num(score.survival_holdout)},
    medianSpellMonths: ${num(pers.median_months)},
    shareSpellsAtLeastAQuarter: ${num(pers.share_ge_quarter)},
    quadNow: ${num(reading.quad)},
    marginNow: ${num(reading.margin)},
  },`;
  })
  .join("\n");

const retRows = Object.entries(ret.channel_results ?? {})
  .map(
    ([c, e]) =>
      `  ${j(c)}: { edgePctPerMonth: ${num(e.edge_pct_per_month)}, edgeCi: [${num(
        e.edge_ci?.[0],
      )}, ${num(e.edge_ci?.[1])}], signsHeld: ${num(e.signs_held)}, usableCells: ${num(
        e.usable_cells,
      )}, holdoutMonths: ${num(e.holdout_months)} },`,
  )
  .join("\n");

const volRows = Object.entries(vol.channel_results ?? {})
  .map(([c, e]) => {
    const ratios = Object.entries(e.cells ?? {})
      .map(
        ([q, cell]) =>
          `${q}: { trainVolRatio: ${num(cell.train_vol_ratio)}, holdoutVolRatio: ${num(
            cell.holdout_vol_ratio,
          )}, signHeld: ${cell.sign_held == null ? "null" : cell.sign_held} }`,
      )
      .join(", ");
    return `  ${j(c)}: { quadGainOverAr: ${num(e.quad_gain_over_ar)}, arGainOverUnconditional: ${num(
      e.ar_gain_over_unconditional,
    )}, pValue: ${num(e.p_value)}, reductionCi: [${num(e.reduction_ci?.[0])}, ${num(
      e.reduction_ci?.[1],
    )}], signsHeld: ${num(e.signs_held)}, usableCells: ${num(
      e.usable_cells,
    )}, holdoutMonths: ${num(e.holdout_months)}, volRatios: { ${ratios} } },`;
  })
  .join("\n");

const lags = Object.entries(art.all_publication_lags ?? {})
  .map(
    ([sid, l]) =>
      `  ${j(sid)}: { label: ${j(l.label)}, axis: ${j(l.axis)}, medianDays: ${num(
        l.median_days,
      )}, p90Days: ${num(l.p90_days)}, note: ${j(l.note)} },`,
  )
  .join("\n");

const file = `// GENERATED by scripts/generate-macro-quads.mjs — do not edit by hand.
// Source: ${IN}
//
// The growth/inflation quad: classify the economy by the RATE OF CHANGE of
// growth and inflation rather than their level, into four regimes.
//
//                   inflation decelerating   inflation accelerating
//   growth accel          Quad 1                    Quad 2
//                       "Goldilocks"              "Reflation"
//   growth decel          Quad 4                    Quad 3
//                       "Deflation"              "Stagflation"
//
// ESTABLISHED: the classification, point-in-time. Every reading was built from
// ALFRED first-release vintages filtered to what had actually been PUBLISHED by
// its own date. ${art.coverage?.n_classified} month-ends, ${art.coverage?.first} to ${art.coverage?.last}.
// Real GDP is excluded: a ~119-day publication lag means the print describes a
// quarter that ended four months ago.
//
// MEASURED, AND UNCOMFORTABLE: ${Math.round((rev.pooled_survival ?? 0) * 100)}% of real-time labels survived contact
// with the revised data. ${Math.round((rev.flip_axis?.growth_share ?? 0) * 100)}% of the failures flipped the GROWTH axis —
// growth data revises far more than price data does, so the top row of the 2x2
// is where a real-time quad is most likely to be wrong. And a reading's margin
// matters enormously: readings in the "${Object.keys(cal)[0]}" bin survived
// ${Math.round((cal[Object.keys(cal)[0]]?.survival ?? 0) * 100)}% of the time against ${Math.round((cal.clear?.survival ?? 0) * 100)}% for "clear" ones.
//
// ALSO MEASURED: the median spell is ${dur.pooled?.median_months} months. Under EVERY specification
// tested. A framework presented as quarterly regimes produces, on honest
// point-in-time monthly data, a label that changes about every two months —
// which is why this module ships OCCUPANCY alongside the point reading.
//
// NOT ESTABLISHED, twice:
//   returns    — ${ret.channels_beating_baseline?.length ?? 0}/${ret.channels_tested?.length ?? 0} channels beat always-long out of sample;
//                ${ret.sign_stability?.held ?? 0}/${ret.sign_stability?.usable ?? 0} quad cells kept their sign. A coin flip.
//   volatility — ${vol.channels_beating_baseline?.length ?? 0}/${vol.channels_tested?.length ?? 0} channels improved on an AR(1) in log realised
//                vol after Holm correction. The vol SIGNATURE is sign-stable
//                (${vol.sign_stability?.held ?? 0}/${vol.sign_stability?.usable ?? 0} cells held), but the tape already knew it.
//
// Consequence for display: show the quad, its margin, how many specifications
// agree, how far behind the data is, and where the last year was actually
// spent. Do not rank assets by it and do not size risk by it.

export type Quad = 1 | 2 | 3 | 4;

export interface QuadReading {
  /** The date this classification was made FOR, not when data was observed. */
  asOf: string;
  /** Which specification produced it. */
  spec: string;
  quad: Quad;
  name: string;
  description: string;
  /** Year-on-year rate of the composite, in percent. The LEVEL. */
  growthYoy: number | null;
  inflationYoy: number | null;
  /**
   * How that year-on-year rate compares with itself \`lookback\` months ago, in
   * points. The second derivative the framework turns on — and the reason a
   * quad can read "Goldilocks" while growth is still negative in level.
   */
  growthRoc: number | null;
  inflationRoc: number | null;
  /** Distance from the boundary on each axis. */
  growthMargin: number | null;
  inflationMargin: number | null;
  /**
   * The smaller of the two. The quad changes as soon as EITHER axis crosses,
   * so a reading is only as firm as its weaker axis.
   */
  margin: number | null;
  /** Newest observation month each input had published by \`asOf\`. */
  growthThrough: string | null;
  inflationThrough: string | null;
  /** Days from the START of that observation month to \`asOf\`. */
  dataLagDays: number | null;
  /** Whole months behind. The number to put on screen. */
  monthsBehind: number | null;
  growthUsed: readonly string[];
  inflationUsed: readonly string[];
  /** Share of an axis's inputs whose own rate of change has the composite's sign. */
  growthAgreement: number | null;
  inflationAgreement: number | null;
  contributions: Record<string, { yoy: number; roc: number }>;
}

export const QUADS: Record<number, { name: string; description: string }> = {
${Object.entries(art.framework?.quads ?? {})
  .map(([q, m]) => `  ${q}: { name: ${j(m.name)}, description: ${j(m.description)} },`)
  .join("\n")}
};

/** The live reading, from what was published when this module was generated. */
export const CURRENT_QUAD: QuadReading = ${readingLiteral(current, 0)};

// ---------------------------------------------------------------------------
// Gates. Written from the validation runs, never by hand.
// ---------------------------------------------------------------------------

/** Whether the POSITIONING claim cleared its gate. */
export const POSITIONING_VALIDATED = ${positioningValidated};

/** Whether the quad improved a volatility forecast that knows lagged vol. */
export const VOL_FORECAST_VALIDATED = ${volValidated};

// ---------------------------------------------------------------------------
// Revision risk: what a real-time label is actually worth.
// ---------------------------------------------------------------------------

export interface MarginBin {
  label: string;
  lo: number;
  hi: number | null;
  n: number;
  survived: number;
  /** Share whose real-time label matched what the revised data later said. */
  survival: number | null;
  /** False when the bin is too thin to quote. Render the absence, not a guess. */
  usable: boolean;
}

export const MARGIN_CALIBRATION: Record<string, MarginBin> = {
${calRows}
};

/**
 * Where a real-time label ended up once the data settled. Rows are the
 * real-time quad, columns what the revised data said; the diagonal is survival.
 */
export const REVISION_CONFUSION: Record<number, { name: string; n: number; to: Record<number, number> }> = {
${confRows}
};

export const REVISION = {
  pooledSurvival: ${num(rev.pooled_survival)},
  measuredOver: { first: ${j(rev.measured_over?.first)}, last: ${j(rev.measured_over?.last)}, n: ${num(rev.measured_over?.n)} },
  /** Readings younger than this were excluded — the data has not revised yet. */
  settlingMonths: ${num(sel.settling_months)},
  /**
   * Which axis revision breaks. Q1<->Q4 and Q2<->Q3 hold inflation fixed and
   * flip growth; Q1<->Q2 and Q3<->Q4 do the reverse.
   */
  flipAxis: {
    growth: ${num(rev.flip_axis?.growth)},
    inflation: ${num(rev.flip_axis?.inflation)},
    both: ${num(rev.flip_axis?.both)},
    total: ${num(rev.flip_axis?.total)},
    growthShare: ${num(rev.flip_axis?.growth_share)},
  },
  /** The live reading's own bin and its measured survival rate. */
  live: {
    bin: ${j(rev.live?.bin)},
    survival: ${num(rev.live?.survival)},
    n: ${num(rev.live?.n)},
    usable: ${!!rev.live?.usable},
  },
} as const;

// ---------------------------------------------------------------------------
// Specification agreement: how contingent the label is on how you measure it.
// ---------------------------------------------------------------------------

export interface SpecInfo {
  name: string;
  growth: readonly string[];
  inflation: readonly string[];
  lookback: number;
  rationale: string;
  /** False when the spec failed the pre-registered persistence floor. */
  eligible: boolean;
  disqualifiedBecause: string | null;
  survivalTrain: number | null;
  survivalHoldout: number | null;
  medianSpellMonths: number | null;
  shareSpellsAtLeastAQuarter: number | null;
  /** What this specification says right now. */
  quadNow: number | null;
  marginNow: number | null;
}

export const SPECS: Record<string, SpecInfo> = {
${specRows}
};

export const SELECTION = {
  chosen: ${j(sel.chosen ?? spec.name)},
  criterion: ${j(sel.criterion ?? "")},
  trainFrac: ${num(sel.train_frac)},
  persistenceFloorMonths: ${num(sel.persistence_floor_months)},
  /** Where the training-window winner ranked on the holdout. Lower is better. */
  holdoutRank: ${num(sel.chosen_holdout_rank)},
  nCandidatesRanked: ${num(sel.n_candidates_ranked)},
  growth: ${j(spec.growth ?? [])} as readonly string[],
  inflation: ${j(spec.inflation ?? [])} as readonly string[],
  lookback: ${num(spec.lookback)},
  rationale: ${j(spec.rationale ?? "")},
} as const;

export const AGREEMENT = {
  nSpecs: ${num(agree.n_specs)},
  nClassified: ${num(agree.n_classified)},
  counts: ${j(agree.counts ?? {})} as Record<string, number>,
  modalQuad: ${num(agree.modal_quad)},
  modalShare: ${num(agree.modal_share)},
  /** Where today's agreement sits in the historical distribution of agreement. */
  percentileToday: ${num(agree.percentile_today)},
  historical: {
    median: ${num(agree.historical_share?.median)},
    p25: ${num(agree.historical_share?.p25)},
    p75: ${num(agree.historical_share?.p75)},
    n: ${num(agree.historical_share?.n)},
  },
} as const;

// ---------------------------------------------------------------------------
// Occupancy and persistence: the stable answer next to the fresh one.
// ---------------------------------------------------------------------------

export interface Occupancy {
  window: number;
  months: number;
  dominant: number | null;
  dominantShare: number | null;
  /**
   * True when two or more quads share the top count. Naming either as "the
   * regime" would then be an artefact of ordering, so callers must say split.
   */
  tied: boolean;
  tiedWith: readonly number[];
  distinctQuads: number | null;
  switches: number | null;
  /** Largest-remainder rounded, so a stacked bar cannot overflow its track. */
  shares: Record<string, number>;
}

/** Share of the last N classified month-ends spent in each quad. */
export const OCCUPANCY: Record<number, Occupancy> = {
${occRows}
};

export const DURATIONS = {
  pooled: {
    nSpells: ${num(dur.pooled?.n_spells)},
    nCompleted: ${num(dur.pooled?.n_completed)},
    nCensored: ${num(dur.pooled?.n_censored)},
    medianMonths: ${num(dur.pooled?.median_months)},
    meanCompletedMonths: ${num(dur.pooled?.mean_completed_months)},
    usable: ${!!dur.pooled?.usable},
  },
  byQuad: {
${byQuadDur}
  } as Record<number, { nSpells: number; nCompleted: number; medianMonths: number | null; meanCompletedMonths: number | null; usable: boolean }>,
  /** The spell in progress. Right-censored: it has not ended yet. */
  current: {
    quad: ${num(cur.quad)},
    elapsedMonths: ${num(cur.elapsed_months)},
    start: ${j(cur.start)},
    basis: ${j(cur.basis)},
    basisNCompleted: ${num(cur.basis_n_completed)},
    beyondSample: ${!!cur.beyond_sample},
    exitWithin: ${j(cur.exit_within ?? {})} as Record<string, number | null>,
  },
} as const;

/**
 * The last three years of labels, for a compact timeline.
 *
 * Just the date and the quad — two fields, so every page can afford it. The
 * full history with margins and contributions is in the detail payload the
 * macro route fetches.
 */
export const RECENT_STRIP: readonly { asOf: string; quad: Quad }[] = [
${history
  .slice(-36)
  .map((r) => `  { asOf: ${j(r.as_of)}, quad: ${r.quad} },`)
  .join("\n")}
];

/** Where the quad has historically gone next. Descriptive, run-collapsed. */
export const QUAD_TRANSITIONS: Record<number, Record<number, number>> = {
${transitions}
};

// ---------------------------------------------------------------------------
// What the two forecasting claims did against their baselines.
// ---------------------------------------------------------------------------

export const RETURNS_TEST = {
  claim: ${j(ret.claim)},
  baseline: ${j(ret.baseline)},
  passes: ${ret.passes === true},
  horizonMonths: ${num(ret.horizon_months)},
  channelsTested: ${j(ret.channels_tested ?? [])} as readonly string[],
  channelsBeatingBaseline: ${j(ret.channels_beating_baseline ?? [])} as readonly string[],
  signsHeld: ${num(ret.sign_stability?.held)},
  usableCells: ${num(ret.sign_stability?.usable)},
} as const;

export const RETURNS_BY_CHANNEL: Record<
  string,
  { edgePctPerMonth: number | null; edgeCi: [number | null, number | null]; signsHeld: number | null; usableCells: number | null; holdoutMonths: number | null }
> = {
${retRows}
};

export const VOL_TEST = {
  claim: ${j(vol.claim)},
  baseline: ${j(vol.baseline)},
  passes: ${vol.passes === true},
  channelsTested: ${j(vol.channels_tested ?? [])} as readonly string[],
  channelsBeatingBaseline: ${j(vol.channels_beating_baseline ?? [])} as readonly string[],
  signsHeld: ${num(vol.sign_stability?.held)},
  usableCells: ${num(vol.sign_stability?.usable)},
} as const;

/**
 * Per-channel volatility results. \`volRatios\` is the DESCRIPTIVE part: how
 * volatile each quad's months were relative to the training average. Those
 * ratios are sign-stable and worth showing as context. \`quadGainOverAr\` is the
 * part that failed — what the quad added once the model already knew last
 * month's volatility.
 */
export const VOL_BY_CHANNEL: Record<
  string,
  {
    quadGainOverAr: number | null;
    arGainOverUnconditional: number | null;
    pValue: number | null;
    reductionCi: [number | null, number | null];
    signsHeld: number | null;
    usableCells: number | null;
    holdoutMonths: number | null;
    volRatios: Record<string, { trainVolRatio: number | null; holdoutVolRatio: number | null; signHeld: boolean | null }>;
  }
> = {
${volRows}
};

/** Median and 90th-percentile publication lag per eligible input, in days. */
export const PUBLICATION_LAGS: Record<
  string,
  { label: string; axis: string | null; medianDays: number; p90Days: number; note: string }
> = {
${lags}
};

export const QUAD_RUN = {
  generatedAt: ${j(art.generated_at)},
  gdpExcludedReason: ${j(art.framework?.gdp_excluded_reason ?? "")},
  nClassified: ${num(art.coverage?.n_classified)},
  first: ${j(art.coverage?.first)},
  last: ${j(art.coverage?.last)},
  medianDataLagDays: ${num(art.coverage?.median_data_lag_days)},
  maxDataLagDays: ${num(art.coverage?.max_data_lag_days)},
  medianMonthsBehind: ${num(art.coverage?.median_months_behind)},
  distribution: ${j(art.coverage?.distribution ?? {})} as Record<string, number>,
  displayMonths: ${history.length},
} as const;

// ---------------------------------------------------------------------------
// Helpers. Every one of these reads measured numbers; none invents one.
// ---------------------------------------------------------------------------

/** Where the quad has historically gone next, most likely first. */
export function likelyNextQuads(from: Quad): { quad: Quad; p: number }[] {
  const row = QUAD_TRANSITIONS[from] ?? {};
  return Object.entries(row)
    .map(([q, p]) => ({ quad: Number(q) as Quad, p }))
    .filter((r) => r.p > 0)
    .sort((a, b) => b.p - a.p);
}

/** How stale the reading's DATA is, given a clock. Not how old the label is. */
export function stalenessDays(reading: QuadReading, nowMs: number): number | null {
  if (reading.growthThrough == null && reading.inflationThrough == null) return null;
  const newest = Math.max(
    reading.growthThrough ? Date.parse(reading.growthThrough + "T00:00:00Z") : 0,
    reading.inflationThrough ? Date.parse(reading.inflationThrough + "T00:00:00Z") : 0,
  );
  if (!Number.isFinite(newest) || newest <= 0) return null;
  return Math.floor((nowMs - newest) / 86_400_000);
}

/** The calibration bin a margin falls in, or null when there is no margin. */
export function marginBinFor(margin: number | null): MarginBin | null {
  if (margin == null || !Number.isFinite(margin)) return null;
  for (const bin of Object.values(MARGIN_CALIBRATION)) {
    if (margin >= bin.lo && (bin.hi == null || margin < bin.hi)) return bin;
  }
  return null;
}

/**
 * The measured share of past readings this close to a boundary that survived
 * revision — or an honest miss.
 *
 * A caller that gets \`usable: false\` must render the absence rather than fall
 * back to the pooled rate: the pooled rate is dominated by decisive readings
 * and would flatter a knife-edge one.
 */
export function revisionSurvivalFor(margin: number | null): {
  bin: string | null;
  survival: number | null;
  n: number;
  usable: boolean;
} {
  const bin = marginBinFor(margin);
  if (!bin) return { bin: null, survival: null, n: 0, usable: false };
  return { bin: bin.label, survival: bin.survival, n: bin.n, usable: bin.usable };
}

/**
 * How much weight a reading carries, from two measured quantities.
 *
 * The GRADE is a rendering convention, not a model output: it applies stated
 * cutoffs to the margin's measured survival rate and to the share of
 * specifications that agree. It is not a probability and must never be shown
 * as one. The components are returned alongside it so a reader can see what
 * produced the word.
 */
export function confidenceOf(reading: QuadReading): {
  grade: "firm" | "mixed" | "fragile";
  basis: string;
  marginBin: string | null;
  marginSurvival: number | null;
  marginUsable: boolean;
  specShare: number | null;
  specAgreeing: number;
  specTotal: number;
} {
  const surv = revisionSurvivalFor(reading.margin);
  const share = reading.quad === AGREEMENT.modalQuad ? AGREEMENT.modalShare : null;
  const agreeing = Number(
    (AGREEMENT.counts as Record<string, number>)[String(reading.quad)] ?? 0,
  );
  const base = {
    marginBin: surv.bin,
    marginSurvival: surv.survival,
    marginUsable: surv.usable,
    specShare: share,
    specAgreeing: agreeing,
    specTotal: Number(AGREEMENT.nClassified ?? 0),
  };
  const thin = surv.survival != null && surv.survival < 0.75;
  const split = share != null && share < 0.6;
  if (thin || split) {
    return {
      ...base,
      grade: "fragile",
      basis: thin
        ? \`readings this close to the boundary held \${Math.round((surv.survival ?? 0) * 100)}% of the time\`
        : "fewer than three in five specifications agree",
    };
  }
  if (surv.survival != null && surv.survival >= 0.9 && share != null && share >= 0.75) {
    return { ...base, grade: "firm", basis: "a clear margin and broad agreement across specifications" };
  }
  return { ...base, grade: "mixed", basis: "neither margin nor agreement is decisive" };
}

/** P(the current spell ends within N months | it has already lasted this long). */
export function exitOdds(withinMonths: 1 | 3 | 6): number | null {
  const v = DURATIONS.current.exitWithin[String(withinMonths)];
  return v == null ? null : v;
}

/** Occupancy over a window, or null when that window was not exported. */
export function occupancyFor(window: number): Occupancy | null {
  return OCCUPANCY[window] ?? null;
}

/** Every eligible specification's current call, disagreements first. */
export function specCalls(): SpecInfo[] {
  const modal = AGREEMENT.modalQuad;
  return Object.values(SPECS).sort((a, b) => {
    const ad = a.quadNow === modal ? 1 : 0;
    const bd = b.quadNow === modal ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return (b.survivalHoldout ?? 0) - (a.survivalHoldout ?? 0);
  });
}
`;

writeFileSync(OUT, file);

// --- the server-side detail payload ---------------------------------------
const detail = {
  generatedAt: art.generated_at,
  spec: art.spec,
  series: art.series,
  specs: art.specs,
  selection: {
    chosen: sel.chosen,
    criterion: sel.criterion,
    trainFrac: sel.train_frac,
    persistenceFloorMonths: sel.persistence_floor_months,
    settlingMonths: sel.settling_months,
    holdoutRank: sel.chosen_holdout_rank,
    nCandidatesRanked: sel.n_candidates_ranked,
    scores: sel.scores ?? {},
    persistence: sel.persistence ?? {},
    eligible: sel.eligible ?? {},
    disqualified: sel.disqualified ?? {},
  },
  agreementReadings: agree.readings ?? {},
  agreementHistory: art.agreement_history ?? [],
  history: history.map((r) => ({
    asOf: r.as_of,
    quad: r.quad,
    name: r.name,
    growthYoy: r.growth_yoy,
    inflationYoy: r.inflation_yoy,
    growthRoc: r.growth_roc,
    inflationRoc: r.inflation_roc,
    margin: r.margin,
    growthThrough: r.growth_through,
    monthsBehind: r.months_behind,
  })),
  spells: art.spells ?? [],
  durationCurves: {
    pooled: art.durations?.pooled?.curve ?? [],
    byQuad: Object.fromEntries(
      Object.entries(art.durations?.by_quad ?? {}).map(([q, d]) => [q, d.curve ?? []]),
    ),
  },
  publicationLags: art.all_publication_lags ?? {},
};
// Revision, validation and coverage are deliberately NOT duplicated here: they
// are already in the light module, and shipping a second copy invites the two
// to drift and a reader to be shown whichever one a component happened to
// import.
writeFileSync(OUT_DETAIL, JSON.stringify(detail));

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(
  `generated ${OUT} (${kb(file)}) — Q${current.quad} ${current.name} as of ${current.as_of} ` +
    `under '${sel.chosen ?? spec.name}', margin ${current.margin} (${rev.live?.bin}), ` +
    `${agree.counts?.[String(agree.modal_quad)] ?? 0}/${agree.n_classified} specs agree`,
);
console.log(
  `generated ${OUT_DETAIL} (${kb(JSON.stringify(detail))}) — ` +
    `${detail.history.length} months, ${detail.spells.length} spells`,
);
console.log(
  `gates: positioning ${positioningValidated}, volatility forecast ${volValidated}`,
);
