#!/usr/bin/env node
/**
 * Build the macro workstation's factor-engine payload from the Python runs.
 *
 *   artifacts/reports/macro_pca_research.json            Factor State API (global + domain PCA)
 *   artifacts/reports/macro_what_changed.json            DFM news decomposition (release -> block)
 *   artifacts/reports/macro_regime_mean_vs_variance.json level-vs-volatility regime verdicts
 *   artifacts/reports/macro_panel_build.json             per-series freshness on the PIT panel
 *   artifacts/reports/macro_registry.json                series names, units, sources
 *
 * The app cannot run Python on the request path, so this is how those runs
 * reach /macro: one JSON the server reads on request. Every section carries
 * the date it describes, the model that produced it, and its validation
 * status, and the file records a hash of each input so a displayed number can
 * be traced to the run that made it. A missing input is a refusal, not an
 * empty panel — an absent run must never render as a quiet zero.
 *
 * Usage: node scripts/generate-macro-state.mjs [reportsDir] [outFile]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const INPUTS = {
  pca: "macro_pca_research.json",
  news: "macro_what_changed.json",
  regimes: "macro_regime_mean_vs_variance.json",
  panel: "macro_panel_build.json",
  registry: "macro_registry.json",
};

/** Domains shown as headline factors: the first principal component of each. */
const HEADLINE_COMPONENT = "PC1";

const round = (n, d = 4) => (typeof n === "number" && Number.isFinite(n) ? Number(n.toFixed(d)) : null);

function labeller(registry) {
  const byId = new Map();
  for (const rec of registry.records ?? []) {
    byId.set(rec.series_id, {
      label: rec.canonical_name || rec.series_id,
      units: rec.units || null,
      source: rec.source || null,
      transformation: rec.transformation || null,
      releaseLagDays: typeof rec.release_lag_median_days === "number" ? rec.release_lag_median_days : null,
      category: rec.economic_category || null,
    });
  }
  return (id) => byId.get(id) ?? { label: id, units: null, source: null, transformation: null, releaseLagDays: null, category: null };
}

function factorRow(state, component, meta) {
  const path =
    typeof state.level === "number"
      ? [
          { at: "3m ago", level: round(state.level - (state.change_3m ?? NaN)) },
          { at: "1m ago", level: round(state.level - (state.change_1m ?? NaN)) },
          { at: "now", level: round(state.level) },
        ].filter((p) => p.level != null)
      : [];
  return {
    id: state.factor_id,
    domain: state.panel_label,
    name: state.factor_name,
    asOf: state.as_of_date,
    lastFit: state.last_model_fit,
    modelVersion: state.model_version ?? null,
    level: round(state.level),
    percentile: round(state.historical_percentile, 2),
    direction: state.direction ?? null,
    momentum: round(state.momentum),
    acceleration: round(state.acceleration),
    change1m: round(state.change_1m),
    change3m: round(state.change_3m),
    changeSincePreviousRun: round(state.change_since_previous_run),
    freshnessDays: round(state.data_freshness_days, 1),
    coverage: round(state.data_coverage, 3),
    activeSeries: state.number_of_active_series ?? null,
    missingSeries: state.number_of_missing_series ?? null,
    varianceShare: component ? round(component.explained_variance_ratio, 4) : null,
    path,
    drivers: (state.drivers ?? []).slice(0, 6).map((d) => ({
      seriesId: d.series_id,
      label: meta(d.series_id).label === d.series_id ? d.label ?? d.series_id : meta(d.series_id).label,
      loading: round(d.loading),
      z: round(d.z),
      contribution: round(d.contribution),
      through: d.through ?? null,
      daysBehind: d.days_behind ?? null,
    })),
  };
}

function componentOf(snapshot, domain, id) {
  const panel = domain === "global" ? snapshot.global : snapshot.domains?.[domain];
  const n = Number(String(id).split(".PC")[1]);
  return (panel?.components ?? []).find((c) => Number(c.index) === n) ?? null;
}

function newsBlock(name, block, meta) {
  const releases = (block.contributions ?? [])
    .filter((c) => c.kind === "news")
    .map((c) => {
      const m = meta(c.series_id);
      const surprise =
        typeof c.observed_value === "number" && typeof c.previous_forecast === "number"
          ? c.observed_value - c.previous_forecast
          : null;
      return {
        seriesId: c.series_id,
        label: m.label,
        block: name,
        observationDate: c.observation_date,
        observed: round(c.observed_value),
        expected: round(c.previous_forecast),
        surprise: round(surprise),
        weight: round(c.weight, 6),
        impact: round(c.impact, 6),
      };
    })
    .sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0));
  return {
    block: name,
    proxySeries: block.proxy_series ?? block.impacted_series ?? null,
    proxyLabel: block.proxy_label ?? null,
    impactDate: block.impact_date ?? null,
    estimatePrevious: round(block.estimate_previous),
    estimateUpdated: round(block.estimate_updated),
    news: round(block.impact_of_news, 6),
    revisions: round(block.impact_of_revisions, 6),
    total: round(block.total_impact, 6),
    releases: releases.slice(0, 8),
  };
}

function regimePanel(panel) {
  return {
    factors: (panel.factors ?? []).map((f) => ({
      factor: f.factor,
      levelRegime: !!f.level_regime,
      verdict: f.verdict ?? null,
      meanSeparation: round(f.mean_separation, 3),
      meanBuysBic: typeof f.mean_gain === "number" ? round(-f.mean_gain, 1) : null,
      varianceRatio: round(f.variance_ratio, 2),
      durations: Array.isArray(f.expected_duration) ? f.expected_duration.map((d) => round(d, 1)) : null,
    })),
    converged: panel.converged === true,
    series: Object.values(panel.blocks ?? {}).reduce((n, ids) => n + ids.length, 0),
  };
}

/** Pure: inputs are the parsed JSON documents plus their hashes. */
export function buildMacroState(docs, { generatedAt = new Date().toISOString() } = {}) {
  for (const key of Object.keys(INPUTS)) {
    if (!docs[key]?.json) throw new Error(`macro-state: missing input ${INPUTS[key]}`);
  }
  const { pca, news, regimes, panel, registry } = Object.fromEntries(
    Object.entries(docs).map(([k, v]) => [k, v.json]),
  );
  const meta = labeller(registry);

  const states = pca.factor_states ?? {};
  const factors = Object.values(states)
    .filter((s) => String(s.factor_id).endsWith(`.${HEADLINE_COMPONENT}`))
    .map((s) => factorRow(s, componentOf(pca.snapshot ?? {}, s.panel_label, s.factor_id), meta))
    .sort((a, b) => (a.domain === "global" ? -1 : b.domain === "global" ? 1 : a.domain.localeCompare(b.domain)));
  if (factors.length === 0) throw new Error("macro-state: no headline factors in the PCA run");

  const blocks = Object.entries(news.blocks ?? {}).map(([name, block]) => newsBlock(name, block, meta));
  const releases = blocks
    .flatMap((b) => b.releases)
    .sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0))
    .slice(0, 15);

  // The panel the regime table is quoted from is the full production panel.
  const regimePanels = (regimes.panels ?? []).map(regimePanel);
  const full = regimePanels.reduce((best, p) => (best && best.factors.length >= p.factors.length ? best : p), null);

  const seriesIds = new Set([
    ...releases.map((r) => r.seriesId),
    ...factors.flatMap((f) => f.drivers.map((d) => d.seriesId)),
  ]);
  const series = {};
  for (const id of seriesIds) {
    const m = meta(id);
    const edge = panel.edge?.[id];
    series[id] = {
      label: m.label,
      units: m.units,
      source: m.source,
      transformation: m.transformation,
      releaseLagDays: m.releaseLagDays,
      through: edge?.through ?? null,
      daysBehind: edge?.days_behind ?? null,
      frequency: edge?.frequency ?? null,
    };
  }

  const provenance = Object.fromEntries(
    Object.entries(docs).map(([k, v]) => [k, { file: `artifacts/reports/${INPUTS[k]}`, sha256: v.sha256.slice(0, 16) }]),
  );

  return {
    generatedAt,
    provenance,
    panel: {
      asOf: panel.as_of,
      used: panel.n_used,
      size: panel.n_panel,
      groups: Object.keys(panel.groups ?? {}),
    },
    factorModel: {
      asOf: pca.as_of,
      lastFit: pca.generated,
      method: "Static PCA on the point-in-time panel (global + 12 domains)",
      version: factors[0]?.modelVersion ? `factor_state ${factors[0].modelVersion}` : null,
      validation:
        "Descriptive. Levels, percentiles and drivers are computed; static PCA has no posterior, so no uncertainty band is claimed.",
    },
    factors,
    whatChanged: {
      previousAsOf: news.previous_as_of,
      updatedAsOf: news.updated_as_of,
      lookbackDays: news.lookback_days,
      method: "Dynamic factor model news decomposition (statsmodels DynamicFactorMQ.news)",
      units:
        "Standardized, transformed units of each series: observed is the print, expected is the model's forecast of it before the print.",
      validation: "Decomposition is exact given the fit; the fit is not validated as a forecaster.",
      blocks,
      releases,
    },
    regimes: full
      ? {
          asOf: panel.as_of,
          method: "Two-state Markov switching per factor: switching mean vs switching variance, BIC",
          converged: full.converged,
          status: "provisional",
          validation:
            "Descriptive. No regime probability is published until the climatology test (WP3) passes; the factor model behind it reports non-convergence when converged is false.",
          series: full.series,
          factors: full.factors,
        }
      : null,
    series,
  };
}

function load(dir) {
  const docs = {};
  for (const [key, file] of Object.entries(INPUTS)) {
    const raw = readFileSync(join(dir, file), "utf8");
    docs[key] = { json: JSON.parse(raw), sha256: createHash("sha256").update(raw).digest("hex") };
  }
  return docs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? "artifacts/reports";
  const out = process.argv[3] ?? "src/lib/ace/macro-state.json";
  const state = buildMacroState(load(dir));
  writeFileSync(out, JSON.stringify(state, null, 1) + "\n");
  console.log(
    `generated ${out} — ${state.factors.length} factors (as of ${state.factorModel.asOf}), ` +
      `${state.whatChanged.releases.length} releases (${state.whatChanged.previousAsOf} → ${state.whatChanged.updatedAsOf}), ` +
      `${state.regimes?.factors.length ?? 0} regime factors (converged ${state.regimes?.converged})`,
  );
}
