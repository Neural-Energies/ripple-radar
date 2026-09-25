import {
  commoditiesFrom,
  economicVarsFrom,
  industriesFrom,
} from "./extract";
import {
  MARKET_CORE_TAGS,
  SOFT_NEWS_CUES,
  TRANSMIT,
  tagsFromText,
  type Tag,
} from "./ontology";

/** Minimum score for a headline/cluster to survive on the live desk. */
export const MARKET_RELEVANCE_THRESHOLD = 2;

export interface RelevanceBreakdown {
  score: number;
  marketTags: Tag[];
  softHits: string[];
  hasTransmission: boolean;
  keep: boolean;
}

function uniqueTags(tags: Tag[]): Tag[] {
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (const t of tags) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function softHitsIn(text: string): string[] {
  const hay = text.toLowerCase();
  const hits: string[] = [];
  for (const cue of SOFT_NEWS_CUES) {
    // Word-boundary for short cues so "actor" does not hit "factory" / "factor".
    if (cue.includes(" ") || cue.length >= 8) {
      if (hay.includes(cue)) hits.push(cue);
    } else {
      const re = new RegExp(`(?:^|[^a-z0-9])${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`);
      if (re.test(hay)) hits.push(cue);
    }
  }
  return hits;
}

function transmissionTags(tags: Tag[]): Tag[] {
  return tags.filter(
    (t) =>
      MARKET_CORE_TAGS.has(t) ||
      TRANSMIT.some((e) => e.from === t || e.to === t),
  );
}

/**
 * Generic market-relevance score.
 * Positive: ontology tags with a path to liquid markets (industries / commodities /
 * economic vars / policy / geo-risk). Negative: soft-news cues (crime, sports,
 * entertainment, celebrity) when they are not outweighed by market tags.
 * Prefer this over brittle per-event bans.
 */
export function marketRelevanceOf(text: string, seedTags: Tag[] = []): RelevanceBreakdown {
  const tags = uniqueTags([...(seedTags.length ? seedTags : []), ...tagsFromText(text)]);
  const marketTags = transmissionTags(tags);
  const softHits = softHitsIn(text);
  const industries = industriesFrom(tags);
  const commodities = commoditiesFrom(tags);
  const economic = economicVarsFrom(tags);

  let score = 0;
  score += marketTags.length * 2;
  score += industries.length * 1.5;
  score += commodities.length * 2;
  score += economic.length * 2;

  // Policy / rates / defense / energy are first-order desk material.
  if (marketTags.some((t) => t === "rates" || t === "policy" || t === "inflation")) score += 2;
  if (marketTags.some((t) => t === "defense" || t === "energy" || t === "crude" || t === "shipping")) score += 2;
  if (marketTags.some((t) => t === "fx" || t === "yen" || t === "banking" || t === "credit")) score += 1.5;
  if (marketTags.some((t) => t === "semiconductor" || t === "rareearth" || t === "copper" || t === "lithium")) score += 1.5;

  const structural =
    industries.length + commodities.length + economic.length;

  // Lone "weather" (storm/flood/quake with no energy/ag/shipping hop) is local forecast
  // noise — Gulf hurricanes keep energy; drought keeps ag.
  const weatherOnly =
    marketTags.length > 0 &&
    marketTags.every((t) => t === "weather") &&
    structural === 0;

  const hasTransmission =
    (!weatherOnly && marketTags.length > 0) ||
    industries.length > 0 ||
    commodities.length > 0 ||
    economic.length > 0;

  if (softHits.length) {
    // Soft news alone is noise. Soft + structural market extraction can still survive
    // (e.g. celebrity CEO + rate decision). Lone spurious tags do not clear soft news.
    if (structural === 0) score -= softHits.length * 3 + 5;
    else score -= Math.min(2, softHits.length * 0.5);
  }

  // No path to liquid markets → not desk material, even without soft cues.
  if (!hasTransmission) score -= 2;

  // Soft news clears only with structural industries/commodities/econ vars —
  // a pile of lone market-adjacent tags (weather+consumer+equity) is not enough.
  const softCleared = softHits.length === 0 || structural > 0;

  // Extra reject: soft-heavy with weak structural signal even if score clears by accident.
  const softDominated = softHits.length >= 2 && structural < 2;

  const keep =
    score >= MARKET_RELEVANCE_THRESHOLD &&
    hasTransmission &&
    softCleared &&
    !softDominated;
  return { score, marketTags, softHits, hasTransmission, keep };
}

export function isMarketRelevant(text: string, seedTags: Tag[] = []): boolean {
  return marketRelevanceOf(text, seedTags).keep;
}

const FIRST_ORDER = new Set<Tag>([
  "energy",
  "crude",
  "rates",
  "policy",
  "inflation",
  "defense",
  "shipping",
  "banking",
  "credit",
  "fx",
]);

const SHOCK_VERB =
  /\b(war|invade|invasion|missile|airstrike|sanctions?|embargo|blockade|ceasefire|nuclear|tariffs?|default|bailout|bank run|pipeline|opec|hormuz|fomc|rate cut|rate hike|landfall|annihilat\w*|threaten\w*|halts? loadings|supply halt)\b/i;
const WEATHER_SPECTACLE = /\b(hurricane|typhoon|cyclone)\b/i;
const WEATHER_HIT = /\b(landfall|gulf|refin|oil|lng|\bport\b|insur|crop|wheat|corn|pipeline|power grid|outage)\b/i;
const NOT_A_HIT = /\b(not expected to|no landfall|miss(?:es|ed)? landfall|recurve)\b/i;
const LABOR_SOFT = /\b(union|workplace)\b/i;
const COURT_SOFT = /\b(no sanctions|acquitted|sentenced|lawsuit|inflation case)\b/i;

/**
 * World-tape gate. Stricter than {@link isMarketRelevant}: a headline has to be
 * able to shock a liquid market, not merely mention weather, a court, or labor.
 */
export function isTapeShock(text: string): boolean {
  if (NOT_A_HIT.test(text)) return false;
  if (WEATHER_SPECTACLE.test(text) && !WEATHER_HIT.test(text)) return false;
  if (LABOR_SOFT.test(text) && !/\b(strike|walkout|port|rail)\b/i.test(text)) return false;
  if (COURT_SOFT.test(text) && !/\b(bankrupt|default|systemic|contagion)\b/i.test(text)) return false;
  if (SHOCK_VERB.test(text)) return true;
  const r = marketRelevanceOf(text);
  return r.keep && r.score >= 4 && r.marketTags.some((t) => FIRST_ORDER.has(t));
}

/** Drop clusters with no transmission path to liquid markets. */
export function filterMarketRelevantClusters<
  T extends { title: string; tags: string[]; headlines: { title: string }[] },
>(clusters: T[]): T[] {
  return clusters.filter((c) => {
    const blob = [c.title, ...c.headlines.map((h) => h.title)].join(" · ");
    return marketRelevanceOf(blob, c.tags).keep;
  });
}

/** Keep desk-tape headlines that are market-relevant or already stamped to a surviving cluster. */
export function filterMarketRelevantHeadlines<
  T extends { title: string; eventIds: string[] },
>(headlines: T[]): T[] {
  return headlines.filter((h) => (h.eventIds?.length ?? 0) > 0 || isMarketRelevant(h.title));
}
