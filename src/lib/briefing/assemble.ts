/**
 * Windowed bot scores, market mood, causal "what matters" rows, and the
 * morning summary. Every number is computed from stored headlines, engine
 * events, or a quote. A missing input stays null.
 */
import type { RadarEvent, RippleNode } from "@/data/types";
import { BOTS, overlaySign, routeHeadline, sourceWeight } from "./bots";
import { lexiconSentiment } from "./lexicon";

export const WINDOWS = {
  today: { hours: 24, tau: 12 },
  d3: { hours: 72, tau: 36 },
  d5: { hours: 120, tau: 36 },
} as const;

/** Points of window-score difference before the trend label moves. */
export const TREND_POINTS = 5;

export type Trend = "rising" | "falling" | "flat" | "collecting";
export type Confidence = "high" | "medium" | "low" | "none";

export interface ScoredHeadline {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedMs: number;
  sentiment: number | null;
  method: "lexicon" | "xai";
  bots: Record<string, number>;
}

export interface WindowScore {
  score: number | null;
  n: number;
  sources: number;
  variance: number | null;
}

export interface BotDriver {
  title: string;
  source: string;
  publishedMs: number;
  contribution: number;
}

export interface BotView {
  id: string;
  name: string;
  weight: number;
  today: WindowScore;
  d3: WindowScore;
  d5: WindowScore;
  trend: Trend;
  confidence: Confidence;
  drivers: BotDriver[];
}

export interface Mood {
  today: number | null;
  d3: number | null;
  d5: number | null;
  label: string;
  trend: Trend;
  confidence: Confidence;
}

export interface MatterNode {
  label: string;
  direction: "up" | "down" | "mixed";
}

export interface Matter {
  id: string;
  title: string;
  source: string;
  time: string;
  importance: number;
  sources: number;
  /** importance × sources × headline relevance. Ranking only. */
  impact: number;
  impactLabel: "High" | "Medium" | "Low";
  chain: MatterNode[];
}

export interface LevelRow {
  ticker: string;
  last: number;
  changePct: number | null;
  prevClose: number | null;
  why: string;
}

const EMPTY_WINDOW: WindowScore = { score: null, n: 0, sources: 0, variance: null };

export function scoreHeadline(title: string): { sentiment: number | null; bots: Record<string, number> } {
  const sentiment = lexiconSentiment(title);
  return { sentiment, bots: botsFromSentiment(title, sentiment) };
}

export function botsFromSentiment(title: string, sentiment: number | null): Record<string, number> {
  const bots: Record<string, number> = {};
  for (const id of routeHeadline(title)) {
    const risk = botRisk(id, title, sentiment);
    if (risk == null) continue;
    bots[id] = risk;
  }
  return bots;
}

export function botRisk(botId: string, title: string, sentiment: number | null): number | null {
  const overlay = overlaySign(botId, title);
  if (overlay !== 0) {
    const mag = Math.max(Math.abs(sentiment ?? 0), 0.45);
    return clamp(overlay * mag, -1, 1);
  }
  return sentiment == null ? null : clamp(sentiment, -1, 1);
}

export function parseXaiScores(raw: string): { id: string; sentiment: number }[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: { id: string; sentiment: number }[] = [];
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const sentiment = (row as { sentiment?: unknown }).sentiment;
    if (typeof id !== "string" || !id.trim()) continue;
    if (typeof sentiment !== "number" || !Number.isFinite(sentiment)) continue;
    if (sentiment < -1 || sentiment > 1) continue;
    out.push({ id, sentiment });
  }
  return out;
}

export function scoreBots(headlines: ScoredHeadline[], now: number): { bots: BotView[]; mood: Mood } {
  const bots = BOTS.map((bot) => {
    const today = windowScore(headlines, bot.id, now, WINDOWS.today);
    const d3 = windowScore(headlines, bot.id, now, WINDOWS.d3);
    const d5 = windowScore(headlines, bot.id, now, WINDOWS.d5);
    return {
      id: bot.id,
      name: bot.name,
      weight: bot.weight,
      today,
      d3,
      d5,
      trend: trendOf(today.score, d3.score),
      confidence: confidenceOf(today),
      drivers: driversOf(headlines, bot.id, now),
    };
  });
  return { bots, mood: moodOf(bots) };
}

export function windowScore(
  headlines: ScoredHeadline[],
  botId: string,
  now: number,
  window: { hours: number; tau: number },
): WindowScore {
  let num = 0;
  let den = 0;
  const sources = new Set<string>();
  const samples: number[] = [];
  for (const h of headlines) {
    const s = h.bots[botId];
    if (typeof s !== "number" || !Number.isFinite(s)) continue;
    const age = ageHours(h.publishedMs, now);
    if (age == null || age > window.hours) continue;
    const w = sourceWeight(h.source) * Math.exp(-age / window.tau);
    if (!(w > 0)) continue;
    num += w * s;
    den += w;
    sources.add(h.source);
    samples.push(s);
  }
  if (!(den > 0)) return EMPTY_WINDOW;
  return {
    score: Math.round((100 * num) / den),
    n: samples.length,
    sources: sources.size,
    variance: variance(samples),
  };
}

export function whatMatters(events: RadarEvent[], scored: { title: string; magnitude: number }[] = []): Matter[] {
  const mag = new Map(scored.map((s) => [norm(s.title), s.magnitude]));
  return events
    .filter((ev) => ev.title)
    .map((ev) => {
      const sources = sourceCount(ev);
      const importance = typeof ev.importance === "number" && Number.isFinite(ev.importance) ? ev.importance : 0;
      const relevance = 1 + (mag.get(norm(ev.title)) ?? matchedMagnitude(ev, mag));
      const impact = importance * Math.max(1, sources) * relevance;
      const lead = ev.evidence.find((e) => e.headline) ?? null;
      return {
        id: ev.id,
        title: ev.title,
        source: lead?.source || ev.sources[0]?.name || "",
        time: lead?.time || ev.timestamp || "",
        importance,
        sources,
        impact,
        impactLabel: importance >= 70 ? "High" : importance >= 40 ? "Medium" : "Low",
        chain: chainOf(ev),
      } satisfies Matter;
    })
    .sort((a, b) => b.impact - a.impact || b.importance - a.importance)
    .slice(0, 5);
}

export function levelsToWatch(
  matters: { id: string; title: string }[],
  events: RadarEvent[],
  quotes: Record<string, { last: number; prevClose?: number; changePct?: number } | undefined> | undefined,
): LevelRow[] {
  const byId = new Map(events.map((ev) => [ev.id, ev]));
  const rows: LevelRow[] = [];
  const seen = new Set<string>();
  for (const matter of matters) {
    const ev = byId.get(matter.id);
    if (!ev) continue;
    for (const ticker of tickersOf(ev)) {
      if (seen.has(ticker) || rows.length >= 6) continue;
      const q = quotes?.[ticker];
      if (!q || !Number.isFinite(q.last) || q.last <= 0) continue;
      seen.add(ticker);
      const prev = typeof q.prevClose === "number" && q.prevClose > 0 ? q.prevClose : null;
      const changePct =
        typeof q.changePct === "number" && Number.isFinite(q.changePct)
          ? q.changePct
          : prev
            ? ((q.last - prev) / prev) * 100
            : null;
      rows.push({ ticker, last: q.last, changePct, prevClose: prev, why: ev.title });
    }
  }
  return rows;
}

export function morningSummary(opts: {
  mood: Mood;
  bots: BotView[];
  matters: { title: string }[];
  stored: number;
}): string {
  if (opts.stored <= 0) return "Collecting headlines. Scores appear once the tape has been stored.";
  const parts: string[] = [];
  if (opts.mood.today == null) {
    parts.push("Headlines are stored, and the bots are still collecting a scored sample.");
  } else {
    parts.push(
      `Market mood is ${opts.mood.label} at ${fmt(opts.mood.today)} (${opts.mood.trend}, confidence ${opts.mood.confidence}).`,
    );
    const ranked = opts.bots
      .filter((b) => b.today.score != null)
      .sort((a, b) => b.today.score! - a.today.score!);
    if (ranked.length >= 2) {
      const hi = ranked[0]!;
      const lo = ranked[ranked.length - 1]!;
      parts.push(`${hi.name} is the strongest bot at ${fmt(hi.today.score!)}. ${lo.name} is the weakest at ${fmt(lo.today.score!)}.`);
    } else if (ranked.length === 1) {
      parts.push(`${ranked[0]!.name} is the only bot with a score (${fmt(ranked[0]!.today.score!)}).`);
    }
    const collecting = opts.bots.filter((b) => b.today.score == null).length;
    if (collecting) parts.push(`${collecting} of ${opts.bots.length} bots are still collecting.`);
  }
  parts.push(opts.matters[0] ? `Largest book on the desk: ${opts.matters[0].title}.` : "No book on the desk yet.");
  return parts.join(" ");
}

export function moodLabel(score: number | null): string {
  if (score == null) return "collecting";
  if (score >= 20) return "risk-on";
  if (score >= 8) return "firm";
  if (score > -8) return "balanced";
  if (score > -20) return "cautious";
  return "risk-off";
}

function moodOf(bots: BotView[]): Mood {
  const today = composite(bots, "today");
  const d3 = composite(bots, "d3");
  const d5 = composite(bots, "d5");
  const scored = bots.filter((b) => b.today.score != null);
  return {
    today,
    d3,
    d5,
    label: moodLabel(today),
    trend: trendOf(today, d3),
    confidence: weakest(scored.map((b) => b.confidence)),
  };
}

function composite(bots: BotView[], key: "today" | "d3" | "d5"): number | null {
  let num = 0;
  let den = 0;
  for (const bot of bots) {
    const score = bot[key].score;
    if (score == null) continue;
    num += bot.weight * score;
    den += bot.weight;
  }
  if (!(den > 0)) return null;
  return Math.round(num / den);
}

function driversOf(headlines: ScoredHeadline[], botId: string, now: number): BotDriver[] {
  const rows: BotDriver[] = [];
  for (const h of headlines) {
    const s = h.bots[botId];
    if (typeof s !== "number" || !Number.isFinite(s)) continue;
    const age = ageHours(h.publishedMs, now);
    if (age == null || age > WINDOWS.today.hours) continue;
    const w = sourceWeight(h.source) * Math.exp(-age / WINDOWS.today.tau);
    rows.push({ title: h.title, source: h.source, publishedMs: h.publishedMs, contribution: w * s });
  }
  rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const seen = new Set<string>();
  const out: BotDriver[] = [];
  for (const row of rows) {
    if (seen.has(row.title)) continue;
    seen.add(row.title);
    out.push(row);
    if (out.length === 3) break;
  }
  return out;
}

function trendOf(today: number | null, prior: number | null): Trend {
  if (today == null || prior == null) return "collecting";
  const diff = today - prior;
  if (diff >= TREND_POINTS) return "rising";
  if (diff <= -TREND_POINTS) return "falling";
  return "flat";
}

function confidenceOf(w: WindowScore): Confidence {
  if (w.n === 0 || w.score == null) return "none";
  if (w.n < 3 || w.sources < 2) return "low";
  if (w.n >= 8 && w.sources >= 3 && w.variance != null && w.variance < 0.2) return "high";
  return "medium";
}

function weakest(values: Confidence[]): Confidence {
  if (values.length === 0) return "none";
  const rank: Record<Confidence, number> = { none: 0, low: 1, medium: 2, high: 3 };
  return values.reduce((a, b) => (rank[a] <= rank[b] ? a : b));
}

function ageHours(publishedMs: number, now: number): number | null {
  if (!Number.isFinite(publishedMs)) return null;
  let age = (now - publishedMs) / 3_600_000;
  if (age < 0) {
    if (age < -1) return null;
    age = 0;
  }
  return age;
}

function variance(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
}

function sourceCount(ev: RadarEvent): number {
  const named = new Set(ev.evidence.map((e) => e.source).filter(Boolean));
  if (named.size) return named.size;
  return ev.sources.length;
}

function matchedMagnitude(ev: RadarEvent, mag: Map<string, number>): number {
  let best = 0;
  for (const e of ev.evidence) {
    const hit = mag.get(norm(e.headline));
    if (hit != null && hit > best) best = hit;
  }
  return best;
}

function chainOf(ev: RadarEvent): MatterNode[] {
  const byId = new Map(ev.nodes.map((n) => [n.id, n]));
  if (ev.links.length && ev.nodes.length) {
    const incoming = new Set(ev.links.map((l) => l.dest));
    const roots = ev.nodes.filter((n) => !incoming.has(n.id)).sort((a, b) => a.level - b.level);
    let cur: RippleNode | undefined = roots[0] ?? ev.nodes[0];
    const out: MatterNode[] = [];
    const seen = new Set<string>();
    while (cur && out.length < 4 && !seen.has(cur.id)) {
      const node: RippleNode = cur;
      seen.add(node.id);
      out.push({ label: node.label, direction: node.direction });
      const next = ev.links.find((l) => l.source === node.id);
      cur = next ? byId.get(next.dest) : undefined;
    }
    if (out.length) return out;
  }
  return [...ev.nodes]
    .sort((a, b) => a.level - b.level)
    .slice(0, 4)
    .map((n) => ({ label: n.label, direction: n.direction }));
}

function tickersOf(ev: RadarEvent): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (ticker?: string) => {
    if (!ticker || seen.has(ticker)) return;
    seen.add(ticker);
    out.push(ticker);
  };
  for (const n of [...ev.nodes].sort((a, b) => a.level - b.level)) push(n.ticker);
  for (const t of ev.trades) push(t.ticker);
  return out;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function fmt(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
