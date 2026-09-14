import type { EvidenceClass, EvidenceItem, EvidenceKind, Reliability } from "@/data/types";
import type { LiveHeadline } from "./types";

const TIER_A = ["federal reserve", "treasury", "white house", "eia", "sec ", "ecb", "boj", "imf", "opec", "iea"];
const TIER_B = ["reuters", "bbc", "nyt", "new york times", "ap ", "associated press", "ft ", "financial times", "wsj"];
const TIER_C = ["cnbc", "guardian", "al jazeera", "oilprice", "defense one", "coindesk", "bloomberg"];

const FUNDAMENTAL = [
  "production",
  "inventory",
  "inventories",
  "barrel",
  "transit",
  "shipment",
  "output",
  "shutdown",
  "outage",
  "strike",
  "pipeline",
  "refinery",
  "ais",
  "loadings",
  "force majeure",
];
const MARKET = [
  "yield",
  "futures",
  "spread",
  "rally",
  "selloff",
  "sell-off",
  "volatility",
  "options",
  "open interest",
  "bitcoin",
  "s&p",
  "nasdaq",
  "treasury",
];
const EXPECTATION = [
  "fedwatch",
  "odds",
  "implied",
  "forecast",
  "prices in",
  "expected to",
  "probability",
  "dot plot",
  "consensus",
];

export function reliabilityOf(source: string): Reliability {
  const s = source.toLowerCase();
  if (TIER_A.some((k) => s.includes(k))) return "A";
  if (TIER_B.some((k) => s.includes(k))) return "B";
  if (TIER_C.some((k) => s.includes(k))) return "C";
  return "D";
}

export function classifyText(title: string): { evidenceClass: EvidenceClass; kind: EvidenceKind } {
  const hay = title.toLowerCase();
  if (EXPECTATION.some((k) => hay.includes(k))) return { evidenceClass: "expectation", kind: "data" };
  if (FUNDAMENTAL.some((k) => hay.includes(k))) return { evidenceClass: "fundamental", kind: "data" };
  if (MARKET.some((k) => hay.includes(k))) return { evidenceClass: "market", kind: "data" };
  return { evidenceClass: "narrative", kind: "news" };
}

export function headlineToEvidence(h: LiveHeadline, clock: (ms: number) => string): EvidenceItem {
  const cls = classifyText(h.title);
  return {
    id: h.id,
    time: clock(h.published),
    source: h.source,
    evidenceClass: cls.evidenceClass,
    kind: cls.kind,
    headline: h.title,
    delayed: false,
    url: h.url,
    reliability: reliabilityOf(h.source),
    direction: h.tone,
    strength: cls.evidenceClass === "fundamental" ? 3 : cls.evidenceClass === "expectation" ? 2 : 1,
  };
}

export function fingerprintTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Same story on twenty wires is one observation, not twenty confirmations. */
export function markDuplicates(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Map<string, string>();
  return items.map((item) => {
    const fp = fingerprintTitle(item.headline);
    if (!fp) return item;
    const first = seen.get(fp);
    if (first && first !== item.id) {
      return { ...item, duplicateOf: first, strength: Math.max(0, (item.strength ?? 1) - 1) };
    }
    seen.set(fp, item.id);
    return item;
  });
}
