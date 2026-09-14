/** The engine knows HOW to reason. The world supplies WHICH events. */
export const ENGINE_STEPS = [
  { id: "detect", label: "Detect" },
  { id: "understand", label: "Understand" },
  { id: "hypothesize", label: "Hypothesize" },
  { id: "probability", label: "Probabilities" },
  { id: "players", label: "Players" },
  { id: "graph", label: "Causal graph" },
  { id: "exposures", label: "Exposures" },
  { id: "markets", label: "Markets" },
  { id: "update", label: "Update" },
  { id: "invalidate", label: "Invalidate" },
  { id: "learn", label: "Learn" },
] as const;

export const DAILY_LOOP = [
  "Ingest evidence",
  "Detect candidates",
  "Update existing",
  "Flag material changes",
  "Regenerate scenarios",
  "Recalculate probabilities",
  "Update game theory",
  "Rebuild causal paths",
  "Discover assets",
  "Rerank exposures",
  "Market confirmation",
  "Crowding / awareness",
  "Invalidate theses",
  "Freeze forecast snapshot",
  "Resolve completed",
  "Calibration",
  "Surface only material changes",
] as const;

export function stageOf(lifecycle?: string): (typeof ENGINE_STEPS)[number]["id"] {
  switch (lifecycle) {
    case "candidate":
      return "detect";
    case "emerging":
      return "understand";
    case "active":
    case "escalating":
      return "graph";
    case "stabilizing":
    case "de-escalating":
      return "update";
    case "resolving":
    case "resolved":
      return "learn";
    case "archived":
      return "learn";
    default:
      return "hypothesize";
  }
}
