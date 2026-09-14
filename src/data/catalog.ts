import type { AlertRule, ModelStats, PortfolioSlice } from "./types";

export const PIPELINE = [
  "Detect",
  "Understand",
  "Hypothesize",
  "Probabilities",
  "Players",
  "Causal graph",
  "Exposures",
  "Markets",
  "Update",
  "Invalidate",
  "Learn",
] as const;

export const EVIDENCE_CLASSES = [
  { id: "narrative", label: "Narrative", detail: "News, speeches, filings, press releases, search trends." },
  { id: "fundamental", label: "Fundamental", detail: "Inventories, production, capex, shipping, power demand, orders." },
  { id: "market", label: "Market", detail: "Price, volume, volatility, open interest, curves, options, RS." },
  { id: "expectation", label: "Expectation", detail: "Prediction markets, analyst forecasts, implied distributions." },
] as const;

export const LEVEL_META: Record<0 | 1 | 2 | 3 | 4, { label: string; hint: string; color: string }> = {
  0: { label: "Core Event", hint: "The originating shock", color: "var(--color-core)" },
  1: { label: "Ripple 1 (Direct)", hint: "First-order transmission", color: "var(--color-r1)" },
  2: { label: "Ripple 2 (Secondary)", hint: "Industry & ETF beta", color: "var(--color-r2)" },
  3: { label: "Ripple 3 (Tertiary)", hint: "Macro & cross-asset", color: "var(--color-r3)" },
  4: { label: "Longer-Term", hint: "Policy, capex, multi-quarter", color: "var(--color-r4)" },
};

export const DEFAULT_PORTFOLIO: PortfolioSlice[] = [
  { label: "Distance 1 (headline)", weight: 15, color: "var(--color-r1)" },
  { label: "Distance 2 (bottleneck)", weight: 35, color: "var(--color-r2)" },
  { label: "Distance 3 (macro)", weight: 20, color: "var(--color-r3)" },
  { label: "Haven / vol", weight: 15, color: "var(--color-r4)" },
  { label: "Duration", weight: 10, color: "var(--color-warn)" },
  { label: "Cash", weight: 5, color: "var(--color-subtle)" },
];

export const SEED_ALERTS: AlertRule[] = [
  {
    id: "a1",
    title: "Lead book probability ≥ 70%",
    detail: "Notify if the selected event's live probability crosses 70%.",
    kind: "probability",
    active: true,
    created: "12 Jun 2025",
  },
  {
    id: "a2",
    title: "First-order +8% session",
    detail: "Headline ticker on the selected book prints a confirmation move.",
    kind: "price",
    active: true,
    created: "12 Jun 2025",
    threshold: 8,
  },
  {
    id: "a3",
    title: "Top scenario > 35%",
    detail: "A distinguishable future is dominating the book.",
    kind: "scenario",
    active: true,
    created: "12 Jun 2025",
    threshold: 35,
  },
  {
    id: "a4",
    title: "Any tracked book ≥ 55%",
    detail: "Material probability on whichever event is currently leading.",
    kind: "probability",
    active: false,
    created: "2 Sep 2026",
    threshold: 55,
  },
  {
    id: "a5",
    title: "Second-order crowding stays low",
    detail: "Distance 2–3 names still under-owned versus the first print.",
    kind: "crowding",
    active: true,
    created: "13 Sep 2026",
  },
  {
    id: "a6",
    title: "Confirmation early on a bottleneck",
    detail: "A second-order node is starting to confirm the transmission thesis.",
    kind: "confirmation",
    active: true,
    created: "13 Sep 2026",
  },
];

/** Frozen calibration series. Historical class-level scores — not a live event book. */
export const MODEL_STATS: ModelStats = {
  accuracy: 61,
  accuracyDelta: 2,
  brier: 0.19,
  brierDelta: -0.01,
  leadDays: 4,
  leadDelta: 1,
  insights: 18,
  insightsDelta: 3,
  series: [
    { date: "T-5", accuracy: 54, brier: 0.24 },
    { date: "T-4", accuracy: 56, brier: 0.22 },
    { date: "T-3", accuracy: 58, brier: 0.21 },
    { date: "T-2", accuracy: 59, brier: 0.2 },
    { date: "T-1", accuracy: 60, brier: 0.2 },
    { date: "Now", accuracy: 61, brier: 0.19 },
  ],
  improvements: [
    "Weighted evidence class by historical Brier, not source volume",
    "Separated importance from scenario probability",
    "Penalized crowded first-order in discovery score",
    "Required a second-order confirmation print before lifting confidence",
    "Froze forecast snapshots so outcomes cannot rewrite priors",
  ],
  calibration: [
    { bucket: "10%", predicted: 10, observed: 12 },
    { bucket: "30%", predicted: 30, observed: 27 },
    { bucket: "50%", predicted: 50, observed: 48 },
    { bucket: "70%", predicted: 70, observed: 66 },
    { bucket: "90%", predicted: 90, observed: 84 },
  ],
  scoredForecasts: [
    { id: "f1", date: "2024-01-18", event: "Shipping-lane multi-quarter diversion", predicted: 0.34, outcome: 1, brier: 0.4356, frozen: true },
    { id: "f2", date: "2024-01-18", event: "Shipping-lane fast reopen < 6w", predicted: 0.18, outcome: 0, brier: 0.0324, frozen: true },
    { id: "f3", date: "2025-04-02", event: "Producer-cartel unwind within 60d", predicted: 0.22, outcome: 0, brier: 0.0484, frozen: true },
    { id: "f4", date: "2025-06-12", event: "Energy-chokepoint partial disruption", predicted: 0.32, outcome: 0, brier: 0.1024, frozen: true },
  ],
};
