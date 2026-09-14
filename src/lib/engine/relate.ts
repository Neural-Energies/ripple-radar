import type { EventRelation, EventRelationKind, RadarEvent } from "@/data/types";
import { TRANSMIT } from "./ontology";

function bag(e: RadarEvent): Set<string> {
  return new Set(
    [...(e.industries ?? []), ...(e.commodities ?? []), ...(e.economicVariables ?? []), e.eventType ?? ""]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

function kindBetween(a: RadarEvent, b: RadarEvent): EventRelationKind | null {
  const entsA = new Set((a.entities ?? []).map((x) => x.toLowerCase()).filter((x) => x.length > 3));
  const entsB = new Set((b.entities ?? []).map((x) => x.toLowerCase()).filter((x) => x.length > 3));
  let shared = 0;
  for (const x of entsA) if (entsB.has(x)) shared += 1;
  const A = bag(a);
  const B = bag(b);
  let causes = false;
  let reverse = false;
  for (const e of TRANSMIT) {
    if (A.has(e.from) && B.has(e.to)) causes = true;
    if (B.has(e.from) && A.has(e.to)) reverse = true;
  }
  const overlap = [...A].filter((t) => B.has(t)).length;
  if (shared >= 1 && (causes || reverse || overlap >= 1)) {
    if (causes && !reverse) return "escalates";
    if (reverse && !causes) return "dependent_on";
    return "correlated_with";
  }
  if (causes && overlap >= 2 && a.eventType !== b.eventType) return "contributes_to";
  if (reverse && overlap >= 2 && a.eventType !== b.eventType) return "dependent_on";
  if (a.eventType && a.eventType === b.eventType && overlap >= 2 && shared === 0) return "reaction_to";
  return null;
}

export function relateEvents(events: RadarEvent[]): RadarEvent[] {
  return events.map((e) => {
    const related: EventRelation[] = [];
    for (const o of events) {
      if (o.id === e.id) continue;
      const kind = kindBetween(e, o);
      if (!kind) continue;
      if (related.length >= 3) break;
      related.push({
        targetId: o.id,
        targetTitle: o.title,
        kind,
        note:
          kind === "contributes_to" || kind === "escalates"
            ? "Transmission into the other book. Combined outcome is not the sum of scores."
            : kind === "dependent_on"
              ? "This book sits downstream. Do not trade it as an independent shock."
              : "Shared actors or family. Interaction effects are not additive.",
      });
    }
    return { ...e, relatedEvents: related };
  });
}
