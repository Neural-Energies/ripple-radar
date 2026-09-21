export type RippleLevel = 0 | 1 | 2 | 3 | 4;
export type NodeKind =
  | "event"
  | "commodity"
  | "industry"
  | "bottleneck"
  | "company"
  | "etf"
  | "futures"
  | "currency"
  | "rates"
  | "policy"
  | "sentiment"
  | "crypto"
  | "other";
export type EvidenceClass = "narrative" | "fundamental" | "market" | "expectation";
export type EvidenceKind = "news" | "filing" | "data" | "social";
export type TradeSide = "long" | "short";
export type TradeCategory = "etf" | "stock" | "futures" | "forex" | "commodities" | "crypto";
export type EventBadge = "MAJOR EVENT" | "WATCH" | "DEVELOPING" | "CASE STUDY";
export type EventMode = "standing" | "live" | "desk";
export type Crowding = "low" | "emerging" | "medium" | "high" | "saturated";
export type Confirmation = "none" | "early" | "confirming" | "strong" | "diverging" | "invalidating";
/** Mass / probability provenance. Omit on RadarEvent until stamped — never fake. */
export type ForecastProvenance = "heuristic" | "llm_proposal" | "calibrated" | "unchanged";
/** Judge triage disposition. Chip only when field exists — no % on triage. */
export type TriageDisposition = "onRadar" | "watch" | "drop" | "duplicate";
export type Reliability = "A" | "B" | "C" | "D";
export type Liquidity = "high" | "medium" | "thin";
export type Lifecycle =
  | "candidate"
  | "emerging"
  | "active"
  | "escalating"
  | "stabilizing"
  | "de-escalating"
  | "resolving"
  | "resolved"
  | "archived";

export interface RippleNode {
  id: string;
  label: string;
  ticker?: string;
  level: RippleLevel;
  kind: NodeKind;
  angle: number;
  impact: number;
  direction: "up" | "down" | "mixed";
  blurb: string;
}

export interface CausalLink {
  source: string;
  dest: string;
  direction: 1 | -1;
  distance: number;
  confidence: number;
  evidence: string;
  expectedLag: string;
  invalidation: string;
  historicalSupport: string;
  scenarioDependence?: string;
}

export interface ProbabilityAudit {
  previous: number;
  updated: number;
  evidence: string;
  direction: "up" | "down";
  weight: number;
  affectedNodes: string[];
  rescoredAssets: string[];
}

export interface Scenario {
  id: string;
  name: string;
  detail: string;
  probability: number;
  prevProbability: number;
  range: string;
  keyOutcomes: string;
  audit: ProbabilityAudit;
}

export interface GameCell {
  a: number;
  b: number;
  label: string;
}

export interface GameTheory {
  actor: string;
  counterpart: string;
  columns: string[];
  rows: { name: string; cells: GameCell[] }[];
  insight: string;
  players: {
    name: string;
    objective: string;
    incentives: string;
    constraints: string;
    moves: string[];
    batna: string;
  }[];
}

export interface TradeIdea {
  ticker: string;
  name: string;
  score: number;
  reason: string;
  side: TradeSide;
  category: TradeCategory;
  horizon: string;
  crowding?: Crowding;
  confirmation?: Confirmation;
  awareness?: number;
  liquidity?: Liquidity;
  causalPath?: string;
  invalidation?: string;
  distance?: RippleLevel;
  headline?: boolean;
}

export interface EvidenceItem {
  id: string;
  time: string;
  /** When the world fact / print occurred (ms UTC). */
  eventTimeMs: number;
  /** When this observation entered our info-set (ms UTC). */
  availableTimeMs: number;
  source: string;
  evidenceClass: EvidenceClass;
  kind: EvidenceKind;
  headline: string;
  delayed: boolean;
  url?: string;
  reliability?: Reliability;
  direction?: "up" | "down" | "neutral";
  strength?: number;
  duplicateOf?: string;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface HeatPoint {
  date: string;
  news: number;
  social: number;
  search: number;
}

export interface TimelineItem {
  date: string;
  title: string;
  detail: string;
}

export interface ResearchQuestion {
  q: string;
  value: "critical" | "high" | "medium";
  unknown: string;
}

export type EventRelationKind =
  | "causes"
  | "contributes_to"
  | "escalates"
  | "de_escalates"
  | "correlated_with"
  | "dependent_on"
  | "supersedes"
  | "part_of"
  | "reaction_to";

export interface EventRelation {
  targetId: string;
  targetTitle: string;
  kind: EventRelationKind;
  note: string;
}

export interface HorizonProbability {
  horizon: string;
  probability: number;
  note: string;
}

export interface ExpectedEvidence {
  id: string;
  scenarioId: string;
  ifTrue: string;
  observe: string;
  lag: string;
  appeared: boolean;
}

export type KnowledgeKind = "known" | "likely" | "uncertain" | "unknown" | "critical";

export interface KnowledgeItem {
  kind: KnowledgeKind;
  text: string;
  value: "critical" | "high" | "medium";
}

export interface ForecastSnapshot {
  at: string;
  probability: number;
  importance: number;
  scenarioTop: string;
  evidence: string;
}

export interface Claim {
  text: string;
  source: string;
  direction: "up" | "down" | "neutral";
  entities: string[];
}

export interface RadarEvent {
  id: string;
  badge: EventBadge;
  timestamp: string;
  region: string;
  theme: string;
  title: string;
  summary: string;
  story: string;
  probability: number;
  probabilityDelta: number;
  nodes: RippleNode[];
  links: CausalLink[];
  impacts: { label: string; value: number; direction: "up" | "down" }[];
  probabilityHistory: SeriesPoint[];
  marketReaction: { label: string; ticker: string; change: number }[];
  narrativeHeat: HeatPoint[];
  scenarios: Scenario[];
  gameTheory: GameTheory;
  trades: TradeIdea[];
  evidence: EvidenceItem[];
  takeaways: string[];
  timeline: TimelineItem[];
  sentiment: { source: string; score: number; label: string }[];
  sources: { name: string; count: number; latest: string }[];
  mode?: EventMode;
  eventType?: string;
  forecastHorizon?: string;
  headlineTicker?: string;
  lifecycle?: Lifecycle;
  importance?: number;
  entities?: string[];
  questions?: ResearchQuestion[];
  invalidation?: string[];
  eventSubtype?: string;
  geography?: string;
  organizations?: string[];
  people?: string[];
  industries?: string[];
  commodities?: string[];
  economicVariables?: string[];
  firstDetected?: string;
  sourceCount?: number;
  primarySourceCount?: number;
  relatedEvents?: EventRelation[];
  crowdingState?: Crowding;
  confirmationState?: Confirmation;
  horizons?: HorizonProbability[];
  expectedEvidence?: ExpectedEvidence[];
  knowledge?: KnowledgeItem[];
  forecasts?: ForecastSnapshot[];
  claims?: Claim[];
  lineage?: { parentId?: string; mergedFrom?: string[] };
  /** Judge triage — omit until DS/ML ships. Never invent onRadar. */
  disposition?: TriageDisposition;
  /** Ensemble disagreement — show muted chip only when true. */
  modelsDisagree?: boolean;
  /** Prob/scenario mass provenance — omit if unset; never invent heuristic badge. */
  provenance?: ForecastProvenance;
}

export interface AssetRecord {
  ticker: string;
  name: string;
  kind: NodeKind | "index";
  category: TradeCategory | "index";
  last: number;
  change: number;
  score: number;
  eventIds: string[];
  thesis: string;
  bottleneck: string;
  lag: string;
  crowding?: Crowding;
  confirmation?: Confirmation;
  awareness?: number;
  liquidity?: Liquidity;
  causalPath?: string;
  invalidation?: string;
  distance?: RippleLevel;
}

export interface ModelStats {
  accuracy: number;
  accuracyDelta: number;
  brier: number;
  brierDelta: number;
  leadDays: number;
  leadDelta: number;
  insights: number;
  insightsDelta: number;
  series: { date: string; accuracy: number; brier: number }[];
  improvements: string[];
  calibration: { bucket: string; predicted: number; observed: number }[];
  scoredForecasts: {
    id: string;
    date: string;
    event: string;
    predicted: number;
    outcome: number;
    brier: number;
    frozen: true;
  }[];
}

export interface PortfolioSlice {
  label: string;
  weight: number;
  color: string;
}

export type AlertKind =
  | "probability"
  | "price"
  | "narrative"
  | "scenario"
  | "crowding"
  | "confirmation"
  | "invalidation";

export interface AlertRule {
  id: string;
  title: string;
  detail: string;
  kind: AlertKind;
  active: boolean;
  created: string;
  ticker?: string;
  threshold?: number;
  eventId?: string;
}

/** User-opened book. Optional payload is a fully constructed research object. */
export interface DeskBook {
  id: string;
  title: string;
  region: string;
  note: string;
  created: string;
  templateId?: string;
  payload?: RadarEvent;
}
