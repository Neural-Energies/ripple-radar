import type { EventRelation, EventRelationKind, RadarEvent } from "@/data/types";
import { TRANSMIT } from "./ontology";

/** Calendar / phenomenon / wire labels that look like shared entities but are not actors. */
const WEAK_ENTITY =
  /^(hurricane|typhoon|cyclone|earthquake|wildfire|tornado|blizzard|flood|storm|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|reuters|bloomberg|associated|press|update|breaking|live|analysis|opinion|watch|alert)$/i;

const BAG_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "other",
  "unclassified",
  "event",
  "shock",
]);

function substantiveEntities(names: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of names ?? []) {
    const x = raw.toLowerCase().trim();
    if (x.length < 4 || WEAK_ENTITY.test(x) || /^\d+$/.test(x)) continue;
    out.add(x);
  }
  return out;
}

function bag(e: RadarEvent): Set<string> {
  return new Set(
    [...(e.industries ?? []), ...(e.commodities ?? []), ...(e.economicVariables ?? []), e.eventType ?? ""]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !BAG_STOP.has(t)),
  );
}

function structuralOverlap(a: RadarEvent, b: RadarEvent): number {
  const keys = (e: RadarEvent) =>
    new Set(
      [...(e.industries ?? []), ...(e.commodities ?? []), ...(e.economicVariables ?? [])].map((x) =>
        x.toLowerCase(),
      ),
    );
  const A = keys(a);
  const B = keys(b);
  let n = 0;
  for (const x of A) if (B.has(x)) n += 1;
  return n;
}

function kindBetween(a: RadarEvent, b: RadarEvent): EventRelationKind | null {
  const entsA = substantiveEntities(a.entities);
  const entsB = substantiveEntities(b.entities);
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
  const struct = structuralOverlap(a, b);

  // Shared substantive actor + transmission or multi-token bag overlap.
  if (shared >= 1 && (causes || reverse || overlap >= 2 || struct >= 1)) {
    if (causes && !reverse) return "escalates";
    if (reverse && !causes) return "dependent_on";
    if (shared >= 2 || overlap >= 2 || struct >= 1) return "correlated_with";
    return null;
  }

  // No shared actor: only strong TRANSMIT + structural signal across different families.
  if (causes && overlap >= 3 && struct >= 1 && a.eventType !== b.eventType) return "contributes_to";
  if (reverse && overlap >= 3 && struct >= 1 && a.eventType !== b.eventType) return "dependent_on";

  // Same-family reaction without shared actor needs real industry/commodity/econ overlap —
  // not just two weather books that share the token "weather".
  if (
    a.eventType &&
    a.eventType === b.eventType &&
    struct >= 1 &&
    overlap >= 3 &&
    shared === 0
  ) {
    return "reaction_to";
  }
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
