import type { Claim } from "@/data/types";
import type { LiveHeadline } from "@/lib/live/types";
import { toneOf, type Tag } from "./ontology";
import { properPhrases } from "./tokenize";

/** Alias resolution is NER, not a list of events. */
const ALIAS: Record<string, string> = {
  fed: "Federal Reserve",
  fomc: "Federal Reserve",
  "federal reserve": "Federal Reserve",
  powell: "Federal Reserve",
  boj: "Bank of Japan",
  "bank of japan": "Bank of Japan",
  ueda: "Bank of Japan",
  ecb: "ECB",
  lagarde: "ECB",
  pboc: "PBOC",
  opec: "OPEC+",
  "opec+": "OPEC+",
  tsmc: "TSMC",
  "taiwan semiconductor": "TSMC",
  nvidia: "NVIDIA",
  irgc: "IRGC",
  pentagon: "U.S. Defense",
  "white house": "U.S. Administration",
  mofcom: "MOFCOM",
  "bank of england": "Bank of England",
  boe: "Bank of England",
};

const ORG_HINT = /(bank|reserve|commission|ministry|agency|corp|inc|ltd|plc|etf|opec|ecb|fed|union|court|party)/i;
const PERSON_HINT = /^(mr|ms|president|chair|governor|ceo|minister|secretary)\b/i;

export type EventFamily =
  | "physical"
  | "policy"
  | "credit"
  | "tech"
  | "fx"
  | "weather"
  | "corporate"
  | "kinetic"
  | "commodity"
  | "other";

export function familyOf(tags: Tag[]): EventFamily {
  if (tags.includes("weather")) return "weather";
  if (tags.includes("banking") || tags.includes("credit")) return "credit";
  if (tags.includes("yen") || (tags.includes("fx") && !tags.includes("energy"))) return "fx";
  if (tags.includes("semiconductor") || tags.includes("rareearth") || tags.includes("cyber")) return "tech";
  if (tags.includes("rates") || tags.includes("policy") || tags.includes("inflation")) return "policy";
  if (tags.includes("defense") && (tags.includes("shipping") || tags.includes("energy"))) return "kinetic";
  if (tags.includes("copper") || tags.includes("lithium") || tags.includes("industrial")) return "commodity";
  if (tags.includes("energy") || tags.includes("shipping") || tags.includes("ag")) return "physical";
  if (tags.includes("equity") && tags.length <= 2) return "corporate";
  if (tags.includes("defense")) return "kinetic";
  return "other";
}

export function canonicalize(name: string): string {
  const key = name.toLowerCase().trim();
  return ALIAS[key] ?? name.replace(/\s+/g, " ").trim();
}

export function resolveEntities(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const c = canonicalize(r);
    const k = c.toLowerCase();
    if (k.length < 3 || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.slice(0, 10);
}

export function splitEntities(names: string[]): { organizations: string[]; people: string[]; other: string[] } {
  const organizations: string[] = [];
  const people: string[] = [];
  const other: string[] = [];
  for (const n of names) {
    const words = n.split(/\s+/);
    if (ORG_HINT.test(n) || ALIAS[n.toLowerCase()]) organizations.push(n);
    else if (PERSON_HINT.test(n) || (words.length === 2 && /^[A-Z]/.test(words[0]!) && /^[A-Z]/.test(words[1]!))) people.push(n);
    else other.push(n);
  }
  return { organizations, people, other };
}

export function extractClaims(headlines: LiveHeadline[], extraEntities: string[] = []): Claim[] {
  return headlines.slice(0, 10).map((h) => ({
    text: h.title,
    source: h.source,
    direction: h.tone === "neutral" ? toneOf(h.title) : h.tone,
    entities: resolveEntities([...properPhrases(h.title), ...extraEntities]).slice(0, 4),
  }));
}

export function industriesFrom(tags: Tag[]): string[] {
  const map: Record<string, string> = {
    energy: "Energy",
    shipping: "Shipping",
    airlines: "Airlines",
    semiconductor: "Semiconductors",
    banking: "Banks",
    defense: "Aerospace & defense",
    insurance: "Insurance",
    ag: "Agriculture",
    tech: "Technology",
    logistics: "Logistics",
    consumer: "Consumer",
    industrial: "Industrials",
    ev: "EV / batteries",
  };
  return [...new Set(tags.map((t) => map[t]).filter(Boolean))] as string[];
}

export function commoditiesFrom(tags: Tag[]): string[] {
  const map: Record<string, string> = {
    crude: "Crude oil",
    refined: "Diesel / gasoline",
    gas: "Natural gas / LNG",
    gold: "Gold",
    copper: "Copper",
    rareearth: "Rare earths",
    ag: "Grains / nutrients",
    lithium: "Lithium",
  };
  return [...new Set(tags.map((t) => map[t]).filter(Boolean))] as string[];
}

export function economicVarsFrom(tags: Tag[]): string[] {
  const map: Record<string, string> = {
    inflation: "CPI / inflation",
    rates: "Policy rate / curve",
    fx: "FX / dollar funding",
    credit: "Credit spreads / funding",
    equity: "Equity risk premium",
    vol: "Implied vol",
    freight: "Freight / tonne-miles",
    crypto: "Digital liquidity / crypto beta",
    liquidity: "Funding / liquidity conditions",
  };
  return [...new Set(tags.map((t) => map[t]).filter(Boolean))] as string[];
}

export function subtypeOf(family: EventFamily, tags: Tag[]): string {
  if (family === "physical" && tags.includes("shipping")) return "physical-bottleneck";
  if (family === "physical") return "supply-shock";
  if (family === "policy") return "monetary-fiscal";
  if (family === "credit") return "funding-stress";
  if (family === "tech") return "tech-regulatory";
  if (family === "fx") return "official-fx";
  if (family === "weather") return "natural-disaster";
  if (family === "kinetic") return "geopolitical";
  if (family === "corporate") return "corporate";
  if (family === "commodity") return "commodity-supply";
  return "unclassified";
}
