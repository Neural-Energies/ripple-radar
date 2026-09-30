/**
 * /macro renders producer output or says the producer is unavailable — never
 * the reference comp's figures (PR #6 B01).
 *
 * Tests the rendered markup of the overview and the four detail panels, not
 * the data layer: the defect was at the render boundary, where a design
 * reference's constants shipped as current intelligence.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MacroState } from "../../lib/ace/macro-state.server.ts";
import {
  GlobalDetailView,
  GrowthDetailView,
  InflationDetailView,
  MacroOverviewView,
  ordinal,
  RatesDetailView,
  type MacroReadPayload,
} from "./mirror.tsx";

/** Values that only ever came from the reference comp. None may render. */
const COMP_FIGURES = [
  "All systems operational",
  "Oct 3, 2024",
  "ISM Services",
  "Initial Claims (Sep 28)",
  "GDP Nowcast",
  "54.9",
  "4.61%",
  "4.25%",
  "3.82%",
  "1.6%",
  "2.7%",
  "13 / 20",
  "Eurozone",
  "US exceptionalism",
  "Term Premium",
];

function html(read: MacroReadPayload | null, state: MacroState | { available: false; reason: string } | null) {
  return [
    renderToStaticMarkup(<MacroOverviewView read={read} state={state} />),
    renderToStaticMarkup(<GrowthDetailView read={read} state={state} />),
    renderToStaticMarkup(<InflationDetailView read={read} state={state} />),
    renderToStaticMarkup(<RatesDetailView read={read} />),
    renderToStaticMarkup(<GlobalDetailView state={state} />),
  ].join("\n");
}

function assertNoComp(markup: string) {
  for (const figure of COMP_FIGURES) {
    assert.ok(!markup.includes(figure), `comp figure rendered: ${figure}`);
  }
}

const READ: MacroReadPayload = {
  status: "ok",
  detail: "fixture",
  quad: 1,
  name: "Goldilocks",
  date: "2026-08-01",
  fetchedAt: "2026-09-29T17:37:54.000Z",
  growth: { yoy: 0.38, delta: 0.15, direction: "accelerating", up: 3, n: 5 },
  inflation: { yoy: 3.35, delta: -0.81, direction: "slowing", up: 1, n: 5 },
  legs: [{ id: "PAYEMS", label: "Payrolls", side: "growth", yoy: 1.11, level: 1, delta: 0.07, direction: "accelerating" }],
  prints: [
    { id: "FEDFUNDS", label: "Fed funds", date: "2026-08-01", value: 3.63, unit: "%", monthAgo: 3.63 },
    { id: "DGS10", label: "10y Treasury", date: "2026-09-25", value: 5.17, unit: "%", monthAgo: 4.64 },
    { id: "DGS2", label: "2y Treasury", date: "2026-09-25", value: 4.81, unit: "%" },
  ],
  nfci: { value: -0.555, date: "2026-09-18", monthAgo: -0.547 },
  recessionProbability: { value: 0.76, date: "2026-07-01" },
  history: [
    { date: "2026-07-01", growthYoy: 0.23, inflationYoy: 3.3, cpi: 3.3, core: 2.47, pceCore: 3.34, dgs10: 4.75, funds: 3.63 },
    { date: "2026-08-01", growthYoy: 0.38, inflationYoy: 3.35, cpi: 3.35, core: 2.45, pceCore: null, dgs10: 4.75, funds: 3.63 },
  ],
};

const STATE: MacroState = {
  available: true,
  generatedAt: "2026-09-29T17:35:00.000Z",
  provenance: { news: { file: "artifacts/reports/macro_what_changed.json", sha256: "f6acb0be357b7f12" } },
  panel: { asOf: "2026-09-29", used: 89, size: 89, groups: ["labor"] },
  factorModel: { asOf: "2026-09-29", lastFit: "2026-09-29", method: "m", version: "factor_state v1", validation: "v" },
  factors: [
    {
      id: "trade_external.PC1", domain: "trade_external", name: "trade_external PC1", asOf: "2026-08-01", lastFit: "2026-09-29",
      modelVersion: "v1", level: -0.42, percentile: 31.64, direction: "falling", momentum: null, acceleration: null,
      change1m: -0.1, change3m: -0.2, changeSincePreviousRun: null, freshnessDays: 59, coverage: 1, activeSeries: 5,
      missingSeries: 0, varianceShare: 0.36, path: [{ at: "3m ago", level: -0.22 }, { at: "now", level: -0.42 }],
      drivers: [{ seriesId: "BOPGSTB", label: "Trade balance", loading: 0.4, z: 1, contribution: 0.4, through: "2026-07-01", daysBehind: 90 }],
    },
  ],
  whatChanged: {
    previousAsOf: "2026-09-22",
    updatedAsOf: "2026-09-29",
    lookbackDays: 7,
    method: "news",
    units: "σ",
    validation: "v",
    blocks: [
      {
        block: "labor", proxySeries: "PAYEMS", proxyLabel: "Payrolls", impactDate: "2026-09-01", estimatePrevious: 0.1,
        estimateUpdated: 0.12, news: 0.015, revisions: 0.005, total: 0.02,
        releases: [{ seriesId: "CCSA", label: "Continuing claims", block: "labor", observationDate: "2026-09-01", observed: -0.29, expected: -0.37, surprise: 0.08, weight: 0.25, impact: 0.0206 }],
      },
    ],
    releases: [{ seriesId: "CCSA", label: "Continuing claims", block: "labor", observationDate: "2026-09-01", observed: -0.29, expected: -0.37, surprise: 0.08, weight: 0.25, impact: 0.0206 }],
  },
  regimes: null,
  series: {},
};

test("with no producers yet, nothing from the comp renders and every panel is loading", () => {
  const markup = html(null, null);
  assertNoComp(markup);
  assert.match(markup, /FRED loading/);
  assert.match(markup, /Factor engine loading/);
});

test("failed producers render as unavailable with their reason, not as numbers", () => {
  const markup = html(
    { status: "unavailable", detail: "FRED did not answer." },
    { available: false, reason: "the factor-engine artifact has no factors" },
  );
  assertNoComp(markup);
  assert.match(markup, /FRED unavailable/);
  assert.match(markup, /FRED did not answer\./);
  assert.match(markup, /Factor engine unavailable/);
  assert.match(markup, /the factor-engine artifact has no factors/);
  assert.ok(!/\d\.\d+%/.test(markup), "no percentage may render without a producer");
});

test("live producer values are what renders, with their dates and sources", () => {
  const markup = html(READ, STATE);
  assertNoComp(markup);
  for (const expected of [
    "5.17%", // 10Y from the read
    "53 bp 1m", // 5.17 vs 4.64 a month earlier
    "3.63%", // funds
    "0.4%", // growth basket, 1dp
    "3.4%", // inflation basket
    "-0.555", // NFCI
    "Looser than average",
    "0.8%", // recession probability 0.76 -> 1dp
    "Continuing claims",
    "+0.08σ", // surprise
    "Sep 29, 17:37 UTC", // fetchedAt
    "as of 2026-09-29", // factor engine
    "32nd", // external factor percentile 31.64, as an ordinal
  ]) {
    assert.ok(markup.includes(expected), `missing producer value: ${expected}`);
  }
});

test("a release's drawer is bound to its own block decomposition", () => {
  const markup = renderToStaticMarkup(<MacroOverviewView read={READ} state={STATE} />);
  assert.match(markup, /Payrolls estimate/);
  assert.match(markup, /\+0\.100/);
  assert.match(markup, /\+0\.120/);
});

test("percentiles read as ordinals", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 31.64, 100, 101, 112].map(ordinal), [
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "32nd", "100th", "101st", "112th",
  ]);
  assert.equal(ordinal(null), "—");
});
