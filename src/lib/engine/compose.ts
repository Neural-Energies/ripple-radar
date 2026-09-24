import type { Lifecycle, RadarEvent } from "@/data/types";
import { gameSensitivity } from "@/lib/ace/game-sensitivity";
import { probabilityFromScenarios } from "@/lib/ace/probability";
import { etParts } from "@/lib/live/clock";
import { rankTrades } from "@/lib/live/discover";
import { headlineToEvidence, markDuplicates } from "@/lib/live/evidence";
import type { LiveHeadline, LiveQuote } from "@/lib/live/types";
import type { Cluster } from "./cluster";
import {
  commoditiesFrom,
  economicVarsFrom,
  extractClaims,
  familyOf,
  industriesFrom,
  resolveEntities,
  splitEntities,
  subtypeOf,
} from "./extract";
import { buildCausalGraph } from "./graph";
import {
  expectedEvidenceFor,
  gameTheoryFor,
  horizonsFor,
  importanceOf,
  knowledgeFor,
  playersFor,
  questionsFor,
  scenariosFor,
  snapshotOf,
} from "./hypothesize";
import { regionFromText, tagsFromText, themeFromTags, toneOf } from "./ontology";
import { hid, properPhrases, tokens } from "./tokenize";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function clockOf(ms: number) {
  try {
    return etParts(ms).clock.replace(" ET", "");
  } catch {
    return "";
  }
}

function lifecycleOf(cluster: { headlines: LiveHeadline[]; tone: Cluster["tone"]; significance: number }): Lifecycle {
  const n = cluster.headlines.length;
  if (cluster.tone === "up" && n >= 4) return "escalating";
  if (cluster.tone === "down" && n >= 3) return "de-escalating";
  if (n >= 5 || cluster.significance >= 55) return "active";
  if (n >= 2) return "emerging";
  return "candidate";
}

export function composeEvent(opts: {
  id: string;
  title: string;
  headlines: LiveHeadline[];
  quotes?: Record<string, LiveQuote>;
  entities?: string[];
  tags?: string[];
  mode?: RadarEvent["mode"];
  note?: string;
  significance?: number;
  tone?: Cluster["tone"];
}): RadarEvent {
  const headlines = opts.headlines;
  const quotes = opts.quotes ?? {};
  const blob = [opts.title, opts.note, ...headlines.map((h) => h.title)].filter(Boolean).join(" · ");
  const tags = (opts.tags?.length ? opts.tags : tagsFromText(blob)).slice(0, 8);
  const entities = resolveEntities([
    ...(opts.entities ?? []),
    ...headlines.flatMap((h) => properPhrases(h.title)),
    ...properPhrases(opts.title),
  ]);
  const entity = entities[0] || tags[0] || "this event";
  const tone = opts.tone ?? toneOf(blob);
  const hits = headlines.length;
  const esc = headlines.filter((h) => toneOf(h.title) === "up").length;
  const de = headlines.filter((h) => toneOf(h.title) === "down").length;
  const family = familyOf(tags);
  const split = splitEntities(entities);
  const claims = extractClaims(headlines.length ? headlines : [{
    id: hid(opts.title),
    title: opts.note || opts.title,
    source: "Desk",
    url: "",
    published: Date.now(),
    eventTimeMs: Date.now(),
    availableTimeMs: Date.now(),
    eventIds: [],
    tone,
  }], entities);

  const graph = buildCausalGraph({
    title: opts.title,
    note: opts.note,
    tags,
    tone,
    coreLabel: entity.length >= 3 && entity.length <= 28 ? entity : opts.title.length > 40 ? opts.title.slice(0, 38) + "…" : opts.title,
  });
  const { nodes, links, trades, headlineTicker } = graph;

  const marketReaction = nodes
    .filter((n) => n.ticker)
    .slice(0, 6)
    .map((n) => ({
      label: n.label,
      ticker: n.ticker!,
      change: quotes[n.ticker!]?.changePct ?? 0,
    }));

  const evidence = markDuplicates(headlines.slice(0, 12).map((h) => headlineToEvidence(h, clockOf)));
  const sourceMap = new Map<string, { count: number; latest: number }>();
  for (const h of headlines) {
    const cur = sourceMap.get(h.source) ?? { count: 0, latest: 0 };
    cur.count += 1;
    cur.latest = Math.max(cur.latest, h.published);
    sourceMap.set(h.source, cur);
  }
  const sources = [...sourceMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([name, v]) => ({ name, count: v.count, latest: clockOf(v.latest) }));

  const life = lifecycleOf({ headlines, tone, significance: opts.significance ?? hits * 8 });
  const region = regionFromText(blob, tags);
  const theme = themeFromTags(tags);
  const players = playersFor(entities, tags, family);
  const baseGt = gameTheoryFor({ family, players });
  // The Nash solve is correct; its inputs are assumptions. Measure how much of
  // the answer survives them before anything renders it as a finding.
  const gtSensitivity = gameSensitivity(baseGt);
  const gt: typeof baseGt = {
    ...baseGt,
    sensitivity: {
      draws: gtSensitivity.draws,
      jitter: gtSensitivity.jitter,
      equilibriumStability: gtSensitivity.equilibriumStability,
      primaryStability: gtSensitivity.primaryStability,
      likelyStability: gtSensitivity.likelyStability,
      noEquilibriumShare: gtSensitivity.noEquilibriumShare,
      verdict: gtSensitivity.verdict,
      alternatives: gtSensitivity.alternatives.slice(0, 4),
      note: gtSensitivity.note,
    },
  };
  // esc/de are deliberately NOT passed: escalation and de-escalation keyword
  // counts used to drive the prior through authored constants, and they no
  // longer drive anything. They remain in scope for the evidence copy below.
  const scenarios = scenariosFor({ entity, tags, family, tone, hits });

  // The book's headline probability is P(the causal thesis materializes) —
  // the mass on the materialization end of the scenario axis, which is where
  // `scenariosFor` always puts its first row.
  //
  // It used to be `clamp(16 + hits*4 + esc*4 - de*3, 8, 82)`: a count of
  // matched articles plus a count of articles containing escalation keywords.
  // That measured how heavily a story was being covered, not how likely it
  // was — and coverage follows events that have already happened, so the
  // number peaked exactly when a move was most priced in. Worse, it could
  // disagree with the scenario mix displayed beside it, because the two were
  // computed by different rules.
  //
  // Deriving it from the scenario distribution makes it one number from one
  // model: it moves when the Dirichlet posterior moves (see ace/probability),
  // it cannot contradict the mix, and it carries that model's provenance
  // rather than implying a calibration nothing here has earned.
  const probability = probabilityFromScenarios(scenarios);
  const mkt = marketReaction[0]?.change ?? 0;
  const importance = importanceOf({
    significance: opts.significance ?? hits * 8,
    hits,
    nodes: nodes.length,
    absMove: Math.abs(mkt),
    probability,
    sources: sources.length,
  });
  const firstDetected = headlines.length
    ? etParts(Math.min(...headlines.map((h) => h.published))).label
    : etParts().label;
  const questions = questionsFor({
    entity,
    actor: players[0]?.name ?? "Primary actor",
    counterpart: players[1]?.name ?? "Counterpart",
    headlineTicker,
    nextTicker: trades[1]?.ticker,
    invalidation: links[0]?.invalidation ?? "The constraint eases.",
  });
  const horizons = horizonsFor(family, probability, scenarios);
  // Second-order watch targets come from the causal graph this book actually
  // built, so an expectation names instruments the thesis depends on.
  const expectedEvidence = expectedEvidenceFor(
    scenarios,
    headlineTicker,
    family,
    nodes.map((n) => n.ticker).filter((t): t is string => Boolean(t)),
  );
  const knowledge = knowledgeFor({ claims, entity, headlineTicker, family, hits });
  const snapshot = snapshotOf(
    Math.round(probability),
    Math.round(importance),
    scenarios,
    headlines[0]?.title ?? "Constructed prior from description.",
    etParts().label,
  );

  const event: RadarEvent = {
    id: opts.id,
    badge: importance >= 64 || hits >= 6 ? "MAJOR EVENT" : life === "emerging" ? "DEVELOPING" : "WATCH",
    timestamp: headlines[0] ? etParts(headlines[0].published).label : etParts().label,
    region,
    theme,
    title: opts.title,
    summary: `Don't trade the headline. ${theme}: first-order is ${headlineTicker}. The book maps what that causes next.`,
    story:
      opts.note ||
      headlines
        .slice(0, 5)
        .map((h) => `${h.source}: ${h.title}`)
        .join(" ") ||
      `${opts.title} — constructed from live evidence, not a fixture.`,
    probability: Math.round(probability),
    probabilityDelta: Math.round(clamp(hits * 1.1 + (esc - de), -12, 18)),
    nodes,
    links,
    impacts: nodes
      .filter((n) => n.level > 0)
      .slice(0, 8)
      .map((n) => ({ label: n.label, value: n.impact, direction: n.direction === "down" ? "down" : "up" })),
    // Empty by construction. This used to be `probability - 8 / -4 / -2`: a
    // synthetic ramp that would show a trend whatever had actually happened.
    // Real history comes from the frozen forecast ledger, which buildDesk
    // attaches; an event seen for the first time genuinely has none, and one
    // point is not a trend.
    probabilityHistory: [
      { date: "Now", value: Math.round(probability) },
    ],
    marketReaction,
    narrativeHeat: [
      { date: "T-2", news: 18, social: 10, search: 8 },
      { date: "T-1", news: 26, social: 16, search: 14 },
      {
        date: "Now",
        news: clamp(28 + hits * 6, 8, 100),
        social: clamp(16 + hits * 4, 8, 100),
        search: clamp(14 + hits * 3, 8, 100),
      },
    ],
    scenarios,
    gameTheory: gt,
    trades,
    evidence,
    takeaways: [
      `Headline print: ${headlineTicker}. Ranked trades prefer distance 2–3 when crowding on the first print is high.`,
      headlines[0]?.title ?? "Live tape is thin — holding the constructed prior.",
      links[0] ? `Mechanism: ${links[0].evidence}` : theme,
      mkt
        ? `First-order session move ${mkt >= 0 ? "+" : ""}${mkt.toFixed(1)}% is ${Math.abs(mkt) > 1.2 ? "confirming" : "not yet confirmation"}.`
        : "Awaiting a market print on the first-order ticker.",
    ],
    timeline: headlines.slice(0, 8).map((h) => ({
      date: clockOf(h.published),
      title: h.source,
      detail: h.title,
    })),
    sentiment: [
      { source: "News mentions", score: clamp(36 + hits * 6, 8, 96), label: hits > 5 ? "Hot" : hits > 1 ? "Active" : "Quiet" },
      { source: "Escalation language", score: clamp(40 + (esc - de) * 8, 8, 96), label: tone === "up" ? "Hawkish" : tone === "down" ? "Softening" : "Mixed" },
      { source: "Market confirmation", score: clamp(50 + mkt * 6, 8, 96), label: mkt > 0.4 ? "Confirming" : mkt < -0.4 ? "Fading" : "Neutral" },
    ],
    sources: sources.length ? sources : [{ name: "Desk", count: 1, latest: "now" }],
    mode: opts.mode ?? "live",
    eventType: family,
    eventSubtype: subtypeOf(family, tags),
    geography: region,
    forecastHorizon: horizons.map((h) => h.horizon).join(" / "),
    headlineTicker,
    lifecycle: life,
    importance: Math.round(importance),
    entities,
    organizations: split.organizations,
    people: split.people,
    industries: industriesFrom(tags),
    commodities: commoditiesFrom(tags),
    economicVariables: economicVarsFrom(tags),
    firstDetected,
    sourceCount: headlines.length || 1,
    primarySourceCount: sources.length,
    questions,
    invalidation: [
      links[0]?.invalidation ?? "The constraint eases.",
      "First-order crowded longs unwind while second-order never confirms.",
      "A policy offset arrives inside the forecast horizon.",
    ],
    horizons,
    expectedEvidence,
    knowledge,
    forecasts: [snapshot],
    claims,
    crowdingState: "emerging",
    confirmationState: Math.abs(mkt) > 1.2 ? "confirming" : Math.abs(mkt) > 0.4 ? "early" : "none",
    relatedEvents: [],
  };
  event.trades = rankTrades(event, { quotes, headlines });
  const crowd = event.trades[0]?.crowding;
  if (crowd) event.crowdingState = crowd;
  const conf = event.trades[0]?.confirmation;
  if (conf) event.confirmationState = conf;
  return event;
}

export function composeFromCluster(
  cluster: Cluster,
  quotes: Record<string, LiveQuote> = {},
): RadarEvent {
  return composeEvent({
    id: cluster.id,
    title: cluster.title,
    headlines: cluster.headlines,
    quotes,
    entities: cluster.entities,
    tags: cluster.tags,
    mode: "live",
    significance: cluster.significance,
    tone: cluster.tone,
  });
}

export function composeFromText(
  text: string,
  headlines: LiveHeadline[] = [],
  quotes: Record<string, LiveQuote> = {},
  id?: string,
): RadarEvent {
  const hay = text.toLowerCase();
  const related = headlines.filter((h) => {
    const t = h.title.toLowerCase();
    const keys = tokens(text).slice(0, 6);
    return keys.filter((k) => t.includes(k)).length >= 2 || (text.length > 12 && t.includes(hay.slice(0, 18)));
  });
  const seedNow = Date.now();
  const seed: LiveHeadline = {
    id: hid(text),
    title: text,
    source: "Desk",
    url: "",
    published: seedNow,
    eventTimeMs: seedNow,
    availableTimeMs: seedNow,
    eventIds: [],
    tone: toneOf(text),
  };
  const items = related.length ? related : [seed, ...headlines.slice(0, 2)];
  return composeEvent({
    id: id ?? "desk-" + hid(text).slice(0, 8),
    title: text.length > 140 ? text.slice(0, 137) + "…" : text,
    headlines: items,
    quotes,
    tags: tagsFromText(text),
    entities: properPhrases(text),
    mode: "desk",
    note: text,
    significance: 40 + items.length * 4,
    tone: toneOf(text),
  });
}
