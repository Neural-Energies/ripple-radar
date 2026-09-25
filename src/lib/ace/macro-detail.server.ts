/**
 * Server-side detail for the macro regime engine.
 *
 * The live reading and everything needed to qualify it live in the generated
 * `macro-quads.ts`, which every page can afford. The history, the per-spec
 * scorecards, the survival curves and the full channel results are another
 * 57 KB that only the macro route needs, so they stay here and travel on
 * request — the same split the analog pool uses.
 */
import detail from "./macro-detail.json";

export interface DetailHistoryRow {
  asOf: string;
  quad: number;
  name: string;
  growthYoy: number | null;
  inflationYoy: number | null;
  growthRoc: number | null;
  inflationRoc: number | null;
  margin: number | null;
  growthThrough: string | null;
  monthsBehind: number | null;
}

export interface DetailSpell {
  quad: number;
  start: string;
  end: string;
  months: number;
  censored: boolean;
}

export interface DetailAgreementRow {
  as_of: string;
  n: number;
  modal: number | null;
  share: number | null;
}

export interface SurvivalPoint {
  t: number;
  at_risk: number;
  deaths: number;
  hazard: number;
  survival: number;
}

export interface SpecScoreRow {
  name: string;
  n: number;
  survival: number;
  survival_train: number;
  survival_holdout: number;
  median_lag_days: number;
  unclassified: number;
}

export interface SpecPersistence {
  n_spells: number | null;
  n_completed: number | null;
  median_months: number | null;
  mean_completed_months: number | null;
  /** Share of completed spells reaching three months — the framework's own claim. */
  share_ge_quarter: number | null;
}

export interface SpecCallNow {
  spec: string;
  quad: number | null;
  name: string;
  growth_roc: number | null;
  inflation_roc: number | null;
  margin: number | null;
  months_behind: number | null;
  data_lag_days: number | null;
  rationale: string;
}

export interface PublicationLag {
  label: string;
  axis: string | null;
  note: string;
  median_days: number;
  p90_days: number;
  n: number;
  first_obs: string;
  last_obs: string;
}

export interface MacroDetail {
  available: true;
  generatedAt: string;
  history: DetailHistoryRow[];
  spells: DetailSpell[];
  agreementHistory: DetailAgreementRow[];
  /** What each candidate specification says right now, with its reasoning. */
  agreementReadings: Record<string, SpecCallNow>;
  durationCurves: { pooled: SurvivalPoint[]; byQuad: Record<string, SurvivalPoint[]> };
  selection: {
    chosen: string;
    criterion: string;
    trainFrac: number;
    persistenceFloorMonths: number;
    settlingMonths: number;
    holdoutRank: number | null;
    nCandidatesRanked: number;
    scores: Record<string, SpecScoreRow>;
    persistence: Record<string, SpecPersistence>;
    eligible: Record<string, boolean>;
    disqualified: Record<string, string>;
  };
  specs: Record<string, { growth: string[]; inflation: string[]; lookback: number; rationale: string }>;
  series: { id: string; label: string; axis: string; typical_lag_days: number; vintage_from: string; note: string }[];
  publicationLags: Record<string, PublicationLag>;
}

export interface MacroDetailUnavailable {
  available: false;
  reason: string;
}

const artifact = detail as unknown as Omit<MacroDetail, "available">;

/**
 * The full detail payload, or an honest miss.
 *
 * Never throws: a missing or truncated artifact returns `available: false`
 * with a reason, because the route is built to render that rather than a
 * half-populated page.
 */
export function macroDetail(): MacroDetail | MacroDetailUnavailable {
  const history = artifact?.history ?? [];
  if (!history.length) {
    return { available: false, reason: "the macro detail artifact is empty" };
  }
  if (!artifact.selection?.chosen) {
    return { available: false, reason: "the macro detail artifact records no chosen specification" };
  }
  return { available: true, ...artifact };
}
