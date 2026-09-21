import type { LiveHeadline } from "@/lib/live/types";
import { familyOf } from "./extract";
import { tagsFromText, toneOf } from "./ontology";
import { filterMarketRelevantClusters, isMarketRelevant } from "./relevance";
import { bigrams, hid, jaccard, properPhrases, tokens } from "./tokenize";

export interface Cluster {
  id: string;
  title: string;
  headlines: LiveHeadline[];
  tokens: Set<string>;
  entities: string[];
  tags: string[];
  tone: "up" | "down" | "neutral";
  significance: number;
  sources: number;
  newest: number;
  oldest: number;
}

/** Phenomena / calendar / wire words that look like entities but over-merge unrelated stories. */
const WEAK_ENTITY =
  /^(hurricane|typhoon|cyclone|earthquake|wildfire|tornado|blizzard|flood|storm|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|reuters|bloomberg|associated|press|update|breaking|live|analysis|opinion|watch|alert)$/i;

function substantiveEntities(ents: string[]): string[] {
  return ents.filter(
    (e) => e.length >= 4 && !WEAK_ENTITY.test(e.trim()) && !/^\d+$/.test(e),
  );
}

function featureSet(title: string): Set<string> {
  const toks = tokens(title);
  return new Set([...toks, ...bigrams(toks)]);
}

function clusterTitle(items: LiveHeadline[], entities: string[]): string {
  const named = entities[0];
  const shortest = [...items].sort((a, b) => a.title.length - b.title.length)[0]!;
  const t = shortest.title.replace(/\s+/g, " ").trim();
  if (named && t.toLowerCase().includes(named.toLowerCase())) return t.length > 140 ? t.slice(0, 137) + "…" : t;
  if (named && t.length > 88) return `${named}: ${t.slice(0, 100)}`;
  return t.length > 140 ? t.slice(0, 137) + "…" : t;
}

function significance(items: LiveHeadline[], tags: string[], tone: Cluster["tone"]): number {
  const sources = new Set(items.map((h) => h.source)).size;
  const esc = tone === "up" ? 12 : tone === "down" ? 4 : 0;
  const recency = items[0] ? Math.max(0, 18 - (Date.now() - items[0].published) / 3_600_000) : 0;
  return Math.round(items.length * 7 + sources * 6 + tags.length * 2 + esc + recency);
}

function sharedSubstantive(a: string[], b: Iterable<string>): number {
  const B = [...b].map((x) => x.toLowerCase());
  return substantiveEntities(a).filter((e) =>
    B.some(
      (x) =>
        x === e.toLowerCase() ||
        (e.length > 8 && x.includes(e.toLowerCase())) ||
        (x.length > 8 && e.toLowerCase().includes(x)),
    ),
  ).length;
}

/** Distant families should not merge on a single shared name. */
function familiesCompatible(tagsA: string[], tagsB: string[]): boolean {
  const fa = familyOf(tagsA);
  const fb = familyOf(tagsB);
  if (fa === fb) return true;
  if (fa === "other" || fb === "other") return true;
  // Policy ↔ fx / credit often co-move; physical ↔ weather / commodity likewise.
  const soft = new Set([
    "policy|fx",
    "fx|policy",
    "policy|credit",
    "credit|policy",
    "physical|weather",
    "weather|physical",
    "physical|commodity",
    "commodity|physical",
    "kinetic|physical",
    "physical|kinetic",
  ]);
  return soft.has(`${fa}|${fb}`);
}

export function clusterHeadlines(headlines: LiveHeadline[]): Cluster[] {
  const ranked = [...headlines].sort((a, b) => b.published - a.published);
  const groups: { feats: Set<string>; items: LiveHeadline[]; entities: Set<string> }[] = [];

  for (const h of ranked) {
    const feats = featureSet(h.title);
    const ents = properPhrases(h.title);
    let best = -1;
    let bestSim = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      let sim = jaccard(feats, g.feats);
      const sharedEnt = sharedSubstantive(ents, g.entities);
      // Entity overlap boosts similarity, but weak/calendar names never do.
      if (sharedEnt >= 2) sim += 0.16;
      else if (sharedEnt === 1 && ents.some((e) => substantiveEntities([e]).length && e.length > 10)) sim += 0.06;
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    }
    // Raised from 0.2 — sparse days were over-merging on shared proper names.
    if (best >= 0 && bestSim >= 0.26) {
      const g = groups[best]!;
      g.items.push(h);
      for (const f of feats) g.feats.add(f);
      for (const e of ents) g.entities.add(e);
    } else {
      groups.push({ feats, items: [h], entities: new Set(ents) });
    }
  }

  const clusters: Cluster[] = [];
  for (const g of groups) {
    if (g.items.length < 2 && g.items.length === 1) {
      const h = g.items[0]!;
      // Single-headline clusters must clear the market-relevance gate.
      if (!isMarketRelevant(h.title)) continue;
    }
    const blob = g.items.map((h) => h.title).join(" · ");
    const tags = tagsFromText(blob);
    const tone = toneOf(blob);
    const entities = [...g.entities].slice(0, 8);
    const sig = significance(g.items, tags, tone);
    if (g.items.length === 1 && sig < 22) continue;
    const title = clusterTitle(g.items, entities);
    const id = "ev-" + hid(
      (entities.slice(0, 3).join("|") || [...g.feats].slice(0, 6).sort().join("|")) +
        "|" +
        g.items[0]!.title.slice(0, 40),
    );
    clusters.push({
      id,
      title,
      headlines: g.items.sort((a, b) => b.published - a.published),
      tokens: g.feats,
      entities,
      tags,
      tone,
      significance: sig,
      sources: new Set(g.items.map((h) => h.source)).size,
      newest: g.items[0]?.published ?? Date.now(),
      oldest: g.items[g.items.length - 1]?.published ?? Date.now(),
    });
  }

  clusters.sort((a, b) => b.significance - a.significance);
  const seen = new Set<string>();
  const uniq: Cluster[] = [];
  for (const c of clusters) {
    if (seen.has(c.id)) {
      const alt = { ...c, id: c.id + "-" + hid(c.title).slice(0, 4) };
      if (seen.has(alt.id)) continue;
      seen.add(alt.id);
      uniq.push(alt);
    } else {
      seen.add(c.id);
      uniq.push(c);
    }
  }
  const merged = mergeSimilar(uniq);
  // Market-relevance gate: only clusters with a transmission path to liquid markets.
  return filterMarketRelevantClusters(merged).slice(0, 10);
}

function mergeSimilar(clusters: Cluster[]): Cluster[] {
  const used = new Set<number>();
  const out: Cluster[] = [];
  for (let i = 0; i < clusters.length; i++) {
    if (used.has(i)) continue;
    let acc = clusters[i]!;
    for (let j = i + 1; j < clusters.length; j++) {
      if (used.has(j)) continue;
      const b = clusters[j]!;
      const sharedEnt = sharedSubstantive(acc.entities, b.entities);
      const sim = jaccard(acc.tokens, b.tokens);
      const tagOverlap = acc.tags.filter((t) => b.tags.includes(t)).length;
      const familyOk = familiesCompatible(acc.tags, b.tags);
      // Tightened merge gates — no lone shared-name glue across distant families.
      const strongLexical = sim >= 0.36;
      const multiEntity = sharedEnt >= 2 && sim >= 0.18 && familyOk;
      const entityTag = sharedEnt >= 1 && tagOverlap >= 2 && sim >= 0.22 && familyOk;
      if (!(strongLexical || multiEntity || entityTag)) continue;
      used.add(j);
      const headlines = [...acc.headlines, ...b.headlines].sort((x, y) => y.published - x.published);
      const feats = new Set([...acc.tokens, ...b.tokens]);
      acc = {
        ...acc,
        headlines,
        tokens: feats,
        entities: [...new Set([...acc.entities, ...b.entities])].slice(0, 10),
        tags: [...new Set([...acc.tags, ...b.tags])].slice(0, 10),
        sources: new Set(headlines.map((h) => h.source)).size,
        newest: Math.max(acc.newest, b.newest),
        oldest: Math.min(acc.oldest, b.oldest),
        significance: Math.max(acc.significance, b.significance) + 4,
        title: acc.headlines.length >= b.headlines.length ? acc.title : b.title,
      };
    }
    out.push(acc);
  }
  return out;
}

export function stampHeadlineClusters(headlines: LiveHeadline[], clusters: Cluster[]): LiveHeadline[] {
  const map = new Map<string, string[]>();
  for (const c of clusters) {
    for (const h of c.headlines) {
      const cur = map.get(h.id) ?? [];
      cur.push(c.id);
      map.set(h.id, cur);
    }
  }
  return headlines.map((h) => ({
    ...h,
    eventIds: map.get(h.id) ?? h.eventIds,
    tone: h.tone === "neutral" ? toneOf(h.title) : h.tone,
  }));
}
