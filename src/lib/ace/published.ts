import scorecard from "@/data/ace-scenario-distribution.json";

/**
 * Channels whose 20-session move distribution passed ACE's calibration gate
 * (filtered historical simulation, ace_scenario_distribution_v1).
 * A ticker with no passing channel returns null. Callers must not invent one.
 */
const TICKER_CHANNEL: Record<string, keyof typeof scorecard.channels> = {
  SPX: "SP500",
  SPY: "SP500",
  ES: "SP500",
  NDX: "NASDAQ",
  QQQ: "NASDAQ",
  NQ: "NASDAQ",
  CL: "WTI",
  USO: "WTI",
  WTI: "WTI",
  DXY: "USD_BROAD",
  UUP: "USD_BROAD",
  DX: "USD_BROAD",
};

export interface AceScenarioRow {
  id: string;
  name: string;
  probability: number;
}

export interface AceScenarioRead {
  channel: string;
  rows: AceScenarioRow[];
  caption: string;
}

export function aceScenariosFor(ticker?: string): AceScenarioRead | null {
  if (!ticker) return null;
  const channel = TICKER_CHANNEL[ticker.toUpperCase()];
  if (!channel) return null;
  const row = scorecard.channels[channel];
  if (!row?.passes) return null;
  const rows = Object.entries(row.probabilities).map(([name, p]) => ({
    id: `${channel}-${name}`,
    name: `${channel} · ${name} · ${scorecard.horizonSessions} sessions`,
    probability: Math.round(p * 1000) / 10,
  }));
  return {
    channel,
    rows,
    caption: `Separate model. Last scored ${scorecard.horizonSessions}-session move odds for ${channel}. Not a path on this book.`,
  };
}
