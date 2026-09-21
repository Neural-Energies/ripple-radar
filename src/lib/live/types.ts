import type {
  EvidenceItem,
  HeatPoint,
  RadarEvent,
  Scenario,
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
  asOf: number;
  exchange: string;
}

export interface LiveHeadline {
  id: string;
  title: string;
  source: string;
  url: string;
  published: number;
  eventIds: string[];
  tone: "up" | "down" | "neutral";
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
}

export interface AlertHit {
  id: string;
  reason: string;
}
