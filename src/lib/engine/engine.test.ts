import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveHeadline } from "../live/types.ts";
import { clusterHeadlines } from "./cluster.ts";
import { economicVarsFrom, familyOf } from "./extract.ts";
import { buildCausalGraph } from "./graph.ts";
import { gameTheoryFor, playersFor, questionsFor, scenariosFor } from "./hypothesize.ts";
import { hopsFrom, tagsFromText, themeFromTags, TICKER_META, toneOf } from "./ontology.ts";
import { nodeNavTarget } from "./instruments.ts";
import { relateEvents } from "./relate.ts";
import { pageIntel } from "./page-intel.ts";
import { isMarketRelevant, isTapeShock, marketRelevanceOf } from "./relevance.ts";
import type { RadarEvent } from "../../data/types.ts";

/**
 * Generalization fixtures. Named events here are TEST DATA only.
 * Production compose/graph/hypothesize must not special-case any of them.
 */
const FIXTURES = [
  {
    id: "geo",
    text: "Overnight attack on a major Middle East crude pipeline; loadings delayed and tanker insurance quotes jump.",
    family: "physical",
  },
  {
    id: "credit",
    text: "Uninsured deposit run at a $40bn US regional bank; emergency funding window rumors.",
    family: "credit",
  },
  {
    id: "tech",
    text: "New export-license rules on leading-edge semiconductor equipment shipments take effect next month.",
    family: "tech",
  },
  {
    id: "weather",
    text: "Category 4 hurricane is 48 hours from landfall over the US Gulf Coast refining belt.",
    family: "weather",
  },
  {
    id: "policy",
    text: "FedWatch 50 basis-point hike probability jumps to 90 percent into this week's FOMC.",
    family: "policy",
  },
] as const;

const UNKNOWN = "Kazakhstan delays uranium export licenses for two quarters after a customs-system outage.";

function book(text: string) {
  const tags = tagsFromText(text);
  const family = familyOf(tags);
  const tone = toneOf(text);
  const graph = buildCausalGraph({ title: text, tags, tone });
  const players = playersFor(["Primary actor"], tags, family);
  const gt = gameTheoryFor({ family, players });
  const scenarios = scenariosFor({ entity: tags[0] ?? "the development", tags, family, tone, hits: 3 });
  const questions = questionsFor({
    entity: tags[0] ?? "the development",
    actor: gt.actor,
    counterpart: gt.counterpart,
    headlineTicker: graph.headlineTicker,
    invalidation: graph.links[0]?.invalidation ?? "The constraint eases.",
  });
  return { tags, family, tone, graph, gt, scenarios, questions, theme: themeFromTags(tags) };
}

test("same engine, unrelated fixtures, no event-specific branches", () => {
  const books = FIXTURES.map((f) => ({ ...f, built: book(f.text) }));

  for (const b of books) {
    assert.equal(b.built.family, b.family, `${b.id} family`);
    assert.ok(b.built.graph.nodes.length >= 3, `${b.id} needs a causal graph`);
    assert.ok(b.built.graph.links.length >= 2, `${b.id} needs causal edges`);
    assert.ok(b.built.scenarios.length >= 3, `${b.id} needs distinguishable scenarios`);
    assert.ok(b.built.gt.players.length >= 2, `${b.id} needs discovered players`);
    assert.ok(b.built.graph.trades.length >= 3, `${b.id} needs asset discovery after the graph`);
    assert.ok(b.built.questions.length >= 3, `${b.id} needs research questions`);
    assert.ok(b.built.graph.trades.every((t) => t.causalPath), `${b.id} trades need a causal path`);
    assert.ok(!/hormuz|taiwan strait|red sea|rare earth/i.test(b.built.theme), `${b.id} leaked a fixture theme`);
  }

  const families = new Set(books.map((b) => b.built.family));
  assert.ok(families.size >= 4, "fixtures must land in different families");

  const tickers = books.map((b) => b.built.graph.headlineTicker);
  assert.ok(new Set(tickers).size >= 3, "first-order tickers must differ across event types");

  const insights = books.map((b) => b.built.gt.insight);
  assert.ok(new Set(insights).size >= 3, "game-theory insight must follow the event family");
});

test("unknown event constructs a full book without new production code", () => {
  const built = book(UNKNOWN);
  assert.ok(built.graph.nodes.length >= 2);
  assert.ok(built.scenarios.length >= 3);
  assert.ok(built.gt.players.length >= 2);
  assert.ok(built.graph.trades.length >= 1);
  assert.ok(built.questions.length >= 3);
  assert.ok(built.graph.links.length >= 1);
  assert.ok(!/hormuz/i.test(JSON.stringify(built.gt.players)));
});


/** Synthetic tape rows — never assert a specific production event id. */
function hl(title: string, source = "Wire", i = 0): LiveHeadline {
  const eventTimeMs = Date.now() - i * 60_000;
  const availableTimeMs = Date.now();
  return {
    id: `h-${i}-${title.slice(0, 12)}`,
    title,
    source,
    url: "",
    published: eventTimeMs,
    eventTimeMs,
    availableTimeMs,
    eventIds: [],
    tone: "neutral",
  };
}

const DROP_FAMILY = [
  {
    family: "local-crime",
    text: "Local police warn residents of phone scam targeting seniors in three neighborhoods",
  },
  {
    family: "sports-owner",
    text: "NBA franchise owner explores selling controlling stake after stadium deal talks stall",
  },
  {
    family: "celebrity",
    text: "Celebrity couple announces divorce after red carpet appearance at film awards",
  },
  {
    family: "consumer-fluff",
    text: "Candy company opens new chocolate factory and offers viral video recipe contest",
  },
  {
    family: "medical-oddity",
    text: "Doctors describe bizarre medical oddity after rare disease mystery baffles clinic",
  },
] as const;

const KEEP_FAMILY = [
  {
    family: "policy-rates",
    text: "Central bank signals surprise policy pivot as inflation prints hot and rate-cut odds collapse",
  },
  {
    family: "pipeline-oil",
    text: "Major crude pipeline rupture halts loadings; tanker insurance quotes and freight rates jump",
  },
  {
    family: "fx-policy",
    text: "Bank of Japan officials flag yen intervention risk after sharp FX move in Tokyo session",
  },
  {
    family: "geo-energy",
    text: "Missile strike near a key energy shipping chokepoint raises war-risk premiums on tankers",
  },
] as const;

test("market-relevance gate drops soft news without transmission path", () => {
  for (const row of DROP_FAMILY) {
    const r = marketRelevanceOf(row.text);
    assert.equal(r.keep, false, `${row.family} should DROP (score=${r.score}, tags=${r.marketTags.join(",")})`);
    assert.equal(isMarketRelevant(row.text), false, `${row.family} isMarketRelevant`);
  }
});

test("market-relevance drops lone local weather, keeps weather→commodity shocks", () => {
  const local = marketRelevanceOf("Flash flood advisory for Kauai after overnight storms soak the north shore");
  assert.equal(local.keep, false, `local weather should DROP (score=${local.score}, tags=${local.marketTags.join(",")})`);

  const gulf = marketRelevanceOf("Category 4 hurricane is 48 hours from landfall over the US Gulf Coast refining belt");
  assert.equal(gulf.keep, true, `gulf weather→energy should KEEP (score=${gulf.score}, tags=${gulf.marketTags.join(",")})`);

  const drought = marketRelevanceOf("Severe drought cuts corn and wheat yields across the Midwest breadbasket");
  assert.equal(drought.keep, true, `drought→ag should KEEP (score=${drought.score}, tags=${drought.marketTags.join(",")})`);
});

test("world tape keeps shocks and drops spectacle, labor, and single-name court noise", () => {
  assert.equal(isTapeShock("Trump threatens to annihilate Iran in UN speech as officials meet on sidelines"), true);
  assert.equal(
    isTapeShock("Cat. 5 Hurricane Polo moves along Mexico's coastline, not expected to make landfall"),
    false,
  );
  assert.equal(isTapeShock("Hurricane Polo explodes into one of Pacific's strongest hurricanes ever"), false);
  assert.equal(isTapeShock("How Unions Are Confronting A.I. Threats in the Workplace"), false);
  assert.equal(isTapeShock("No sanctions for Carvana in artificial stock inflation case"), false);
  assert.equal(
    isTapeShock("Category 4 hurricane is 48 hours from landfall over the US Gulf Coast refining belt"),
    true,
  );
  assert.equal(
    isTapeShock("Major crude pipeline rupture halts loadings; tanker insurance quotes and freight rates jump"),
    true,
  );
});

test("market-relevance gate keeps macro commodity policy geo shocks", () => {
  for (const row of KEEP_FAMILY) {
    const r = marketRelevanceOf(row.text);
    assert.equal(r.keep, true, `${row.family} should KEEP (score=${r.score}, tags=${r.marketTags.join(",")})`);
    assert.ok(r.hasTransmission, `${row.family} needs a transmission path`);
    assert.ok(r.marketTags.length >= 1, `${row.family} needs market tags`);
  }
});

test("cluster pipeline surfaces keep families and suppresses drop families", () => {
  const now = Date.now();
  const tape: LiveHeadline[] = [];
  let i = 0;
  // Pair each KEEP title with a near-paraphrase so clustering can form multi-item groups.
  for (const row of KEEP_FAMILY) {
    tape.push(hl(row.text, "WireA", i++));
    tape.push(hl(row.text.replace(/\.$/, "") + " — market desks watch closely", "WireB", i++));
  }
  for (const row of DROP_FAMILY) {
    tape.push(hl(row.text, "SoftA", i++));
    tape.push(hl(row.text + " · local coverage continues", "SoftB", i++));
  }
  // Stamp published times so recency is stable
  for (let j = 0; j < tape.length; j++) {
    const t = now - j * 30_000;
    tape[j]!.published = t;
    tape[j]!.eventTimeMs = t;
    tape[j]!.availableTimeMs = now;
  }

  const clusters = clusterHeadlines(tape);
  const blob = clusters.map((c) => c.title + " " + c.tags.join(" ")).join(" || ").toLowerCase();

  assert.ok(clusters.length >= 1, "expected at least one market cluster");
  // Soft families must not dominate the desk cluster set
  assert.ok(!/phone scam|franchise owner|celebrity couple|candy company|medical oddity/.test(blob), "soft noise leaked into clusters");
  // At least one keep signal should survive somewhere in tags or titles
  assert.ok(
    /oil|crude|pipeline|rate|inflation|yen|fx|shipping|energy|policy|tanker/.test(blob),
    "expected a macro/commodity/policy signal in surviving clusters",
  );
});

test("all-noise tape yields empty clusters (EMPTY_EVENT path stays valid)", () => {
  const tape = DROP_FAMILY.flatMap((row, i) => [
    hl(row.text, "A", i * 2),
    hl(row.text + " update from city desk", "B", i * 2 + 1),
  ]);
  const clusters = clusterHeadlines(tape);
  assert.equal(clusters.length, 0, "noise-only tape must not invent desk events");
});

test("crypto ontology is first-class, not a commodity sink", () => {
  assert.equal(TICKER_META.BTC?.kind, "crypto");
  assert.equal(TICKER_META.ETH?.kind, "crypto");
  assert.equal(TICKER_META.BTC?.category, "crypto");
  const hops = hopsFrom("crypto", 4);
  const tos = new Set(hops.map((h) => h.tag));
  assert.ok(tos.has("liquidity"), "crypto must hop to liquidity");
  assert.ok(tos.has("equity"), "crypto must hop to risk-on equities");
  assert.ok(tos.has("vol") || tos.has("fx"), "crypto must hop to vol or fx");
  assert.equal(familyOf(["crypto", "liquidity"]), "other", "no crypto EventFamily — DS lock");
  assert.ok(economicVarsFrom(["crypto", "liquidity"]).length >= 1, "relate bag must see crypto/liquidity");
});

test("crypto-origin graph attaches crypto-kind nodes then liquid tickers", () => {
  const text = "Major bitcoin exchange halts withdrawals; stablecoin floats and digital-asset liquidity seize up.";
  const tags = tagsFromText(text);
  assert.ok(tags.includes("crypto"), `expected crypto tag, got ${tags.join(",")}`);
  const graph = buildCausalGraph({ title: text, tags, tone: "down" });
  const cryptoNodes = graph.nodes.filter((n) => n.kind === "crypto");
  assert.ok(cryptoNodes.length >= 1, "graph must not coerce crypto nodes to commodity");
  assert.ok(graph.nodes.every((n) => n.kind !== "commodity" || !/crypto|bitcoin|ether/i.test(n.label)));
  assert.ok(graph.trades.some((tr) => tr.category === "crypto" || tr.ticker === "BTC" || tr.ticker === "ETH"), "asset discovery after graph");
});

test("market-relevance keeps crypto liquidity shocks", () => {
  const r = marketRelevanceOf("Bitcoin ETF outflows and stablecoin floats tighten digital-asset liquidity");
  assert.equal(r.keep, true, `crypto liquidity should KEEP (score=${r.score}, tags=${r.marketTags.join(",")})`);
});

test("cluster does not over-merge unrelated books that share a surname", () => {
  const tape = [
    hl("Energy minister Chen warns crude loadings delayed after pipeline rupture", "Wire", 0),
    hl("Chen named university chancellor after campus expansion vote", "Campus", 1),
    hl("Pipeline rupture halts crude loadings; tanker insurance quotes jump", "Desk", 2),
  ];
  const clusters = clusterHeadlines(tape);
  const blob = clusters.map((c) => c.title).join(" || ");
  // Crude book may survive; campus chancellor must not ride along.
  assert.ok(!/chancellor|campus expansion/i.test(blob), `campus story leaked into market clusters: ${blob}`);
});

test("named storm headlines share one cluster; a different storm does not", () => {
  const tape = [
    hl("Hurricane Polo intensifies to category 5 off Mexico", "Reuters", 0),
    hl("Hurricane Polo explodes into one of the Pacific's strongest storms", "AP", 1),
    hl("Cat. 5 Hurricane Polo moves along Mexico's coastline", "BBC", 2),
    hl("Hurricane Polo churns off Mexico as officials watch the track", "NYT", 3),
    hl("Why did Hurricane Polo rapidly intensify so fast in the Pacific", "Local", 4),
    hl("Hurricane Marie damage prompts a Long Beach emergency declaration", "LAT", 5),
  ];
  const clusters = clusterHeadlines(tape);
  const polo = clusters.filter((c) => /polo/i.test(c.title + c.headlines.map((h) => h.title).join(" ")));
  const poloHeads = polo.reduce((n, c) => n + c.headlines.filter((h) => /polo/i.test(h.title)).length, 0);
  assert.equal(polo.length, 1, `Polo split across ${polo.length} clusters`);
  assert.equal(poloHeads, 5, `expected 5 Polo headlines in one cluster, got ${poloHeads}`);
  const marieInsidePolo = polo[0]?.headlines.some((h) => /marie/i.test(h.title));
  assert.equal(marieInsidePolo, false, "Marie must not join Polo");
  const poloTitle = polo[0]?.title ?? "";
  assert.match(poloTitle, /^Hurricane Polo/, `title should be the storm, not an article: ${poloTitle}`);
});

test("event page does not attach VLO or CL without a named facility", () => {
  const titles = [
    "Maps: Tracking Hurricane Polo",
    "Hurricane Polo intensifies to category 5 off Mexico's Pacific coast",
    "Hurricane Polo moves along Mexico's coastline, not expected to make landfall",
  ];
  const event = {
    id: "ev-polo",
    title: titles[0],
    evidence: titles.map((headline, i) => ({
      id: `e${i}`,
      headline,
      source: "Wire",
      eventTimeMs: Date.now() - i * 60_000,
      availableTimeMs: Date.now(),
      time: "",
      evidenceClass: "narrative" as const,
      kind: "news" as const,
      delayed: true,
    })),
  } as unknown as RadarEvent;
  const intel = pageIntel(event, []);
  assert.match(intel.name, /^Hurricane Polo/);
  assert.ok(intel.omitted.includes("VLO"));
  assert.ok(intel.omitted.includes("CL"));
  assert.ok(intel.omitted.includes("MOS"));
  assert.equal(intel.places.length, 0);
  assert.ok(intel.invalidation.some((line) => /not expected/i.test(line)));
});

test("cluster still merges paraphrased market headlines", () => {
  const tape = [
    hl("Central bank signals surprise policy pivot as inflation prints hot and rate-cut odds collapse", "A", 0),
    hl("Central bank signals surprise policy pivot as inflation prints hot and rate-cut odds collapse — market desks watch closely", "B", 1),
  ];
  const clusters = clusterHeadlines(tape);
  assert.ok(clusters.length >= 1, "paraphrase pair must form a cluster");
  assert.ok(clusters.some((c) => c.headlines.length >= 2), "paraphrase pair must merge, not split");
});

test("map nodes carry a liquid ticker for asset nav", () => {
  const text = "Overnight attack on a major crude pipeline; loadings delayed and tanker insurance quotes jump.";
  const graph = buildCausalGraph({ title: text, tags: tagsFromText(text), tone: "up" });
  const hopNodes = graph.nodes.filter((n) => n.level > 0);
  assert.ok(hopNodes.length >= 2, "need causal hops");
  const withTicker = hopNodes.filter((n) => n.ticker);
  assert.ok(withTicker.length >= 1, "non-core nodes must attach a liquid ticker for map nav");
  assert.ok(withTicker.every((n) => TICKER_META[n.ticker!] || n.ticker), "no invented tickers");
  const cryptoText = "Bitcoin ETF outflows and stablecoin floats tighten digital-asset liquidity";
  const cg = buildCausalGraph({ title: cryptoText, tags: tagsFromText(cryptoText), tone: "down" });
  const cnode = cg.nodes.find((n) => n.kind === "crypto");
  assert.ok(cnode, "crypto kind preserved");
  assert.ok(cnode!.ticker === "BTC" || cnode!.ticker === "ETH", `crypto node nav ticker, got ${cnode!.ticker}`);
});


function stubEvent(
  partial: {
    id: string;
    title: string;
    entities?: string[];
    eventType?: string;
    industries?: string[];
    commodities?: string[];
    economicVariables?: string[];
    headlineTicker?: string;
    trades?: RadarEvent["trades"];
    marketReaction?: RadarEvent["marketReaction"];
  },
): RadarEvent {
  return {
    id: partial.id,
    title: partial.title,
    badge: "WATCH",
    timestamp: "",
    region: "",
    theme: "",
    summary: partial.title,
    story: "",
    probability: 40,
    probabilityDelta: 0,
    nodes: [],
    links: [],
    impacts: [],
    probabilityHistory: [],
    marketReaction: partial.marketReaction ?? [],
    narrativeHeat: [],
    scenarios: [],
    gameTheory: { actor: "A", counterpart: "B", columns: [], rows: [], insight: "", players: [] },
    trades: partial.trades ?? [],
    evidence: [],
    takeaways: [],
    timeline: [],
    sentiment: [],
    sources: [],
    mode: "live",
    eventType: partial.eventType ?? "other",
    entities: partial.entities ?? [],
    industries: partial.industries ?? [],
    commodities: partial.commodities ?? [],
    economicVariables: partial.economicVariables ?? [],
    headlineTicker: partial.headlineTicker,
    relatedEvents: [],
  };
}

test("relate ignores weak phenomenon entities and lone shared family tokens", () => {
  const weatherA = stubEvent({
    id: "w1",
    title: "Hurricane watch posted for coastal towns after overnight storms",
    entities: ["Hurricane", "Kauai"],
    eventType: "weather",
  });
  const weatherB = stubEvent({
    id: "w2",
    title: "Flood advisory for inland counties after heavy rain",
    entities: ["Hurricane", "Midwest"],
    eventType: "weather",
  });
  const related = relateEvents([weatherA, weatherB]);
  assert.equal((related[0]?.relatedEvents ?? []).length, 0, "weak Hurricane token must not glue unrelated weather books");
  assert.equal((related[1]?.relatedEvents ?? []).length, 0);
});

test("relate links books that share a substantive actor and transmission", () => {
  const a = stubEvent({
    id: "e1",
    title: "OPEC+ surprise cut tightens crude balances",
    entities: ["OPEC+"],
    eventType: "physical",
    industries: ["Energy"],
    commodities: ["Crude oil"],
  });
  const b = stubEvent({
    id: "e2",
    title: "OPEC+ cut lifts tanker freight and war-risk quotes",
    entities: ["OPEC+"],
    eventType: "physical",
    industries: ["Shipping", "Energy"],
    commodities: ["Crude oil"],
    economicVariables: ["Freight / tonne-miles"],
  });
  const related = relateEvents([a, b]);
  assert.ok((related[0]?.relatedEvents ?? []).some((r) => r.targetId === "e2"), "shared OPEC+ + energy path should relate");
});

test("nodeNavTarget resolves ticker and sector filter without inventing symbols", () => {
  const event = stubEvent({
    id: "nav",
    title: "Crude pipeline rupture",
    headlineTicker: "CL",
    trades: [
      {
        ticker: "USO",
        name: "US Oil",
        score: 80,
        reason: "proxy",
        side: "long",
        category: "etf",
        horizon: "days",
        distance: 1,
        headline: true,
      },
    ],
    marketReaction: [{ label: "Crude", ticker: "CL", change: 1.2 }],
  });
  const coreNav = nodeNavTarget({ id: "core", label: "Pipeline rupture", level: 0 }, event);
  assert.equal(coreNav?.kind, "ticker");
  if (coreNav?.kind === "ticker") assert.equal(coreNav.ticker, "CL");

  const energyNav = nodeNavTarget({ id: "energy", label: "Energy prices", level: 1 }, event);
  assert.ok(energyNav, "energy node needs a nav target");
  if (energyNav?.kind === "ticker") {
    assert.ok(Boolean(TICKER_META[energyNav.ticker]), `proxy must be known liquid: ${energyNav.ticker}`);
  }

  const filt = nodeNavTarget({ id: "obscure-theme", label: "Obscure Theme", level: 3 }, event);
  assert.equal(filt?.kind, "filter");
  if (filt?.kind === "filter") assert.match(filt.q, /obscure theme/i);
});

test("soft-news reject survives multi-cue entertainment without structural markets", () => {
  const r = marketRelevanceOf("TikTok influencer and reality show star announce royal wedding after fashion week");
  assert.equal(r.keep, false, `soft entertainment should DROP (score=${r.score}, soft=${r.softHits.join(",")})`);
  assert.ok(r.softHits.length >= 1, "expected soft cues");
});

// ------------------------------------- nothing invented on first sighting

function wire(title: string, n: number, tone: "up" | "down" | "neutral" = "up") {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i}`, title: `${title} ${i}`, source: "Reuters", url: "",
    published: now, eventTimeMs: now, availableTimeMs: now, eventIds: [], tone,
  }));
}

test("a freshly composed book claims no probability change", async () => {
  // This used to be `clamp(hits * 1.1 + (esc - de), -12, 18)` — a "change"
  // computed from a headline count, rendered with an up arrow in three places.
  // A book seen for the first time has no prior to have moved from.
  const { composeFromText } = await import("./compose.ts");
  for (const n of [1, 5, 20]) {
    const title = "Strait closure escalates";
    const ev = composeFromText(title, wire(title, n));
    assert.equal(ev.probabilityDelta, 0, `${n} headlines implied a delta of ${ev.probabilityDelta}`);
  }
});

test("attention is a headline count, and unmeasured channels are absent", async () => {
  // `social` and `search` were `16 + hits*4` and `14 + hits*3`: two entire
  // series invented for platforms this product does not connect to.
  const { composeFromText } = await import("./compose.ts");
  const title = "Strait closure reported";
  const ev = composeFromText(title, wire(title, 3));
  assert.equal(ev.narrativeHeat.length, 1, "no fabricated history points");
  const now = ev.narrativeHeat[0]!;
  assert.equal(now.date, "Now");
  assert.equal(now.social, undefined, "no social feed is connected");
  assert.equal(now.search, undefined, "no search feed is connected");
  assert.ok(Number.isInteger(now.news) && now.news >= 0, "news must be a count");
});

test("probability history carries no synthetic past", async () => {
  const { composeFromText } = await import("./compose.ts");
  const title = "First sighting of a thing";
  const ev = composeFromText(title, wire(title, 1, "neutral"));
  // One "Now" point is the current reading, not a trend. What must NOT be here
  // is the old synthetic `T-3 / T-2 / T-1` ramp.
  assert.ok(ev.probabilityHistory.length <= 1, `got ${ev.probabilityHistory.length} points`);
  assert.ok(!ev.probabilityHistory.some((p) => /^T-/.test(p.date)), "no synthetic past points");
});

test("sentiment reports observations, not scores on an invented scale", async () => {
  // The scores were `36 + hits*6`, `40 + (esc-de)*8`, `50 + mkt*6` — three
  // hand-tuned formulas on a 0-96 scale, which reads as a measurement.
  const { composeFromText } = await import("./compose.ts");
  const title = "Escalation reported at the strait";
  const ev = composeFromText(title, wire(title, 4));
  const news = ev.sentiment.find((x) => x.source === "News mentions")!;
  assert.ok(news.score <= 10, `a headline count should be small, got ${news.score}`);
  assert.ok(ev.sentiment.every((x) => x.label.length > 0), "every row keeps its label");
});
