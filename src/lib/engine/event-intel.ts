import type { EvidenceItem, RadarEvent } from "@/data/types";

/** How long an event class can sit in Developing Now without a new story. */
export function freshnessWindowMs(eventType?: string): number {
  const t = (eventType ?? "").toLowerCase();
  if (t.includes("weather") || t.includes("physical")) return 36 * 3_600_000;
  if (t.includes("policy") || t.includes("rates") || t.includes("credit")) return 18 * 3_600_000;
  if (t.includes("kinetic")) return 12 * 3_600_000;
  return 8 * 3_600_000;
}

export function storyTimes(event: RadarEvent): number[] {
  return event.evidence.map((e) => e.eventTimeMs).filter((n) => Number.isFinite(n) && n > 0);
}

export function latestStoryMs(event: RadarEvent): number {
  const times = storyTimes(event);
  return times.length ? Math.max(...times) : 0;
}

export function firstStoryMs(event: RadarEvent): number {
  const times = storyTimes(event);
  return times.length ? Math.min(...times) : 0;
}

export function developingNow(events: RadarEvent[], now = Date.now()): RadarEvent[] {
  return events
    .filter((e) => {
      if (e.lifecycle === "resolved" || e.lifecycle === "archived") return false;
      const last = latestStoryMs(e);
      if (!last) return false;
      return now - last <= freshnessWindowMs(e.eventType);
    })
    .sort((a, b) => latestStoryMs(b) - latestStoryMs(a) || (b.importance ?? 0) - (a.importance ?? 0));
}

export type StoryRole =
  | "escalation"
  | "de-escalation"
  | "market"
  | "second-order"
  | "confirmation"
  | "reprint";

export function storyRole(item: Pick<EvidenceItem, "headline" | "duplicateOf">): StoryRole {
  if (item.duplicateOf) return "reprint";
  const t = item.headline.toLowerCase();
  if (/\b(weaken|downgrad|no landfall|not expected|eases|reopen|recede)\b/.test(t)) return "de-escalation";
  if (/\b(upgrade|intensif|category [3-5]|explodes|invade|airstrike|missile|halt|closure|suspend|annihilat)\b/.test(t)) {
    return "escalation";
  }
  if (/\b(futures|stocks|shares|rally|plunge|oil price|yields)\b/.test(t)) return "market";
  if (/\b(port|refiner|evacuat|crop|shipping|freight)\b/.test(t)) return "second-order";
  return "confirmation";
}

export function feedHealth(asOf: number, status: "live" | "degraded" | "connecting" | string, now = Date.now()): {
  label: "LIVE" | "DELAYED" | "STALE";
  detail: string;
} {
  const age = Math.max(0, now - asOf);
  if (!asOf) return { label: "STALE", detail: "No feed timestamp" };
  if (status === "degraded" || age > 20 * 60_000) {
    const mins = Math.round(age / 60_000);
    return { label: "STALE", detail: `No new feed data for ${mins}m` };
  }
  if (age > 3 * 60_000) {
    const mins = Math.round(age / 60_000);
    return { label: "DELAYED", detail: `Last update ${mins}m ago` };
  }
  return { label: "LIVE", detail: "Feed updated just now" };
}
