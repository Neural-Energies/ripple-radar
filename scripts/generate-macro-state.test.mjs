import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMacroState } from "./generate-macro-state.mjs";

const doc = (json) => ({ json, sha256: "a".repeat(64) });

function inputs(over = {}) {
  return {
    pca: doc({
      as_of: "2026-09-29",
      generated: "2026-09-29",
      snapshot: {
        global: { components: [{ index: 1, explained_variance_ratio: 0.12 }] },
        domains: { labor: { components: [{ index: 1, explained_variance_ratio: 0.57 }] } },
      },
      factor_states: {
        "labor.PC1": {
          factor_id: "labor.PC1", panel_label: "labor", factor_name: "labor PC1", model_version: "v1",
          as_of_date: "2026-08-01", last_model_fit: "2026-09-29", level: 0.9, change_1m: 0.2, change_3m: 0.6,
          historical_percentile: 87.2, direction: "rising",
          drivers: [{ series_id: "PAYEMS", label: "x", loading: 0.25, z: 1, contribution: 0.25, through: "2026-08-01", days_behind: 59 }],
        },
        "labor.PC2": { factor_id: "labor.PC2", panel_label: "labor", level: 1 },
        "global.PC1": { factor_id: "global.PC1", panel_label: "global", factor_name: "global PC1", level: 2, model_version: "v1" },
      },
    }),
    news: doc({
      previous_as_of: "2026-09-22",
      updated_as_of: "2026-09-29",
      lookback_days: 7,
      blocks: {
        labor: {
          proxy_series: "PAYEMS", proxy_label: "Payrolls", impact_date: "2026-09-01",
          estimate_previous: 0.1, estimate_updated: 0.12, impact_of_news: 0.015, impact_of_revisions: 0.005, total_impact: 0.02,
          contributions: [
            { kind: "news", series_id: "CCSA", observation_date: "2026-09-01", observed_value: -0.29, previous_forecast: -0.37, weight: 0.25, impact: 0.02 },
            { kind: "news", series_id: "ICSA", observation_date: "2026-09-01", observed_value: 0.1, previous_forecast: 0.1, weight: 0.1, impact: -0.005 },
            { kind: "revision", series_id: "all prior revisions", impact: 0.005 },
          ],
        },
      },
    }),
    regimes: doc({ panels: [{ converged: false, blocks: { labor: ["PAYEMS"] }, factors: [{ factor: "labor", level_regime: false, mean_gain: 6.2 }] }] }),
    panel: doc({ as_of: "2026-09-29", n_used: 89, n_panel: 89, groups: { labor: [] }, edge: { CCSA: { through: "2026-09-12", days_behind: 17, frequency: "weekly" } } }),
    registry: doc({ records: [{ series_id: "CCSA", canonical_name: "Continuing claims", units: "Number" }, { series_id: "PAYEMS", canonical_name: "Nonfarm payrolls" }] }),
    ...over,
  };
}

test("builds headline factors, releases and regimes with provenance", () => {
  const s = buildMacroState(inputs(), { generatedAt: "2026-09-29T00:00:00Z" });
  assert.deepEqual(s.factors.map((f) => f.id), ["global.PC1", "labor.PC1"], "PC1 of each domain, global first");
  const labor = s.factors.find((f) => f.id === "labor.PC1");
  assert.equal(labor.varianceShare, 0.57);
  assert.deepEqual(labor.path.map((p) => p.level), [0.3, 0.7, 0.9], "path is level minus the 3m and 1m changes");
  assert.equal(labor.drivers[0].label, "Nonfarm payrolls", "driver labels come from the registry");
  assert.deepEqual(s.whatChanged.releases.map((r) => r.seriesId), ["CCSA", "ICSA"], "news only, ranked by |impact|");
  assert.equal(s.whatChanged.releases[0].surprise, 0.08);
  assert.equal(s.whatChanged.releases[0].label, "Continuing claims");
  assert.equal(s.series.CCSA.through, "2026-09-12");
  assert.equal(s.regimes.converged, false);
  assert.equal(s.regimes.status, "provisional");
  assert.equal(s.provenance.news.file, "artifacts/reports/macro_what_changed.json");
  assert.equal(s.provenance.news.sha256.length, 16);
  assert.equal(s.factorModel.version, "factor_state v1");
});

test("a missing input is a refusal, not an empty panel", () => {
  const partial = inputs();
  delete partial.news;
  assert.throws(() => buildMacroState(partial), /missing input macro_what_changed\.json/);
});

test("a run with no headline factors is refused", () => {
  const bad = inputs({ pca: doc({ as_of: "x", snapshot: {}, factor_states: {} }) });
  assert.throws(() => buildMacroState(bad), /no headline factors/);
});
