import type {
  EvidenceItem,
  ForecastProvenance,
  HeatPoint,
  RadarEvent,
  Scenario,
  TriageDisposition,
} from "@/data/types";

export type QuoteState = "live" | "last" | "stale";

export interface LiveQuote {
  ticker: string;
  last: number;
  prevClose: number;
  change: number;
  changePct: number;
  spark: number[];
  state: QuoteState;
  /** Print/event time (ms UTC). Alias of eventTimeMs for existing call sites. */
  asOf: number;
  /** When the print occurred (ms UTC); source of truth. */
  eventTimeMs: number;
  /** When this quote entered our info-set (ms UTC). */
  availableTimeMs: number;
  exchange: string;
}

export interface LiveHeadline {
  id: string;
  title: string;
  source: string;
  url: string;
  /** Event time (ms UTC). Deprecated alias of eventTimeMs. */
  published: number;
  /** When the world fact / pubDate occurred (ms UTC); source of truth. */
  eventTimeMs: number;
  /** When this headline entered our info-set (ms UTC). */
  availableTimeMs: number;
  eventIds: string[];
  tone: "up" | "down" | "neutral";
}

/** Client DTO for a headline cluster (no Set tokens / full headline payloads). */
export interface LiveCluster {
  id: string;
  title: string;
  significance: number;
  sources: number;
  headlineCount: number;
  entities: string[];
  tags: string[];
  tone: "up" | "down" | "neutral";
  newest: number;
  oldest: number;
  /** Composed book id when present (composeFromCluster uses cluster.id). */
  eventId?: string;
  /** Judge triage — omit until DS/ML ships. No % on this field. */
  disposition?: TriageDisposition;
}

export interface LiveBook {
  eventId: string;
  probability: number;
  probabilityDelta: number;
  hits: number;
  evidence: EvidenceItem[];
  sources: { name: string; count: number; latest: string }[];
  marketReaction: { label: string; ticker: string; change: number }[];
  scenarios: Scenario[];
  heatPoint: HeatPoint;
  sentiment: { source: string; score: number; label: string }[];
}

export interface LiveSessions {
  ny: boolean;
  london: boolean;
  tokyo: boolean;
  futures: boolean;
}

export interface LiveDesk {
  asOf: number;
  asOfLabel: string;
  status: "live" | "degraded";
  statusDetail: string;
  sessions: LiveSessions;
  quotes: Record<string, LiveQuote>;
  headlines: LiveHeadline[];
  clusters: LiveCluster[];
  books: Record<string, LiveBook>;
  liveEvents: RadarEvent[];
  quoteLive: number;
  quoteCount: number;
  /** Delayed FRED+ALFRED macro prints. Empty when FRED_API_KEY is unset. */
  macroEvidence?: EvidenceItem[];
}

export interface RescoreResult {
  eventId: string;
  probability: number;
  takeaway: string;
  narrative: string;
  scenarioShifts: { id: string; probability: number }[];
  asOf: number;
  /** Stamped by rescore path — llm_proposal | unchanged. Never calibrated from this call alone. */
  provenance?: ForecastProvenance;
}

export interface AlertHit {
  id: string;
  reason: string;
}
