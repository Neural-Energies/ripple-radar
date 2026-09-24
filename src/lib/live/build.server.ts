import { composeFromCluster } from "@/lib/engine/compose";
import { clusterHeadlines, stampHeadlineClusters, type Cluster } from "@/lib/engine/cluster";
import { resolveAndRecord } from "./event-registry.server";
import { filterMarketRelevantHeadlines } from "@/lib/engine/relevance";
import { relateEvents } from "@/lib/engine/relate";
import type { EvidenceItem, RadarEvent } from "@/data/types";
import { headlineToEvidence } from "./evidence";
import { etParts, quoteState, sessionFlags } from "./clock";
import { attachFredEvidence, fetchFredSeriesBundle, latestFredEvidence } from "./fred.server";
import { parseRss } from "./rss";
import { DESK_TICKERS, fromYahoo, toYahoo } from "./symbols";
import type { LiveBook, LiveCluster, LiveDesk, LiveHeadline, LiveQuote } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const QUOTE_TTL = 12_000;
const NEWS_TTL = 40_000;

type QuoteCache = { at: number; quotes: Record<string, LiveQuote> };
type NewsCache = { at: number; headlines: LiveHeadline[] };

let quoteCache: QuoteCache | null = null;
let newsCache: NewsCache | null = null;

const FEEDS: { source: string; url: string }[] = [
  { source: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { source: "NYT Business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "OilPrice", url: "https://oilprice.com/rss/main" },
  { source: "CNBC World", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html" },
  { source: "CNBC Markets", url: "https://www.cnbc.com/id/15839069/device/rss/rss.html" },
  { source: "Defense One", url: "https://www.defenseone.com/rss/all/" },
  { source: "Guardian", url: "https://www.theguardian.com/world/rss" },
  { source: "Guardian Business", url: "https://www.theguardian.com/uk/business/rss" },
  { source: "Reuters World", url: "https://feeds.reuters.com/Reuters/worldNews" },
  { source: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews" },
  { source: "Fed", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  {
    source: "Google News",
    url: "https://news.google.com/rss/search?q=when:1d+(markets+OR+geopolitics+OR+%22central+bank%22+OR+%22supply+chain%22+OR+sanctions+OR+hurricane+OR+semiconductor)&hl=en-US&gl=US&ceid=US:en",
  },
];

async function fetchText(url: string, ms = 7000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function loadNews(): Promise<LiveHeadline[]> {
  if (newsCache && Date.now() - newsCache.at < NEWS_TTL) return newsCache.headlines;
  const ingestMs = Date.now();
  const priorAvailable = new Map((newsCache?.headlines ?? []).map((h) => [h.id, h.availableTimeMs]));
  const results = await Promise.allSettled(
    FEEDS.map((f) => fetchText(f.url).then((xml) => parseRss(xml, f.source, ingestMs))),
  );
  const seen = new Set<string>();
  const headlines: LiveHeadline[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const h of r.value) {
      const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key) || key.length < 18) continue;
      seen.add(key);
      const first = priorAvailable.get(h.id);
      if (first !== undefined) h.availableTimeMs = Math.max(first, h.eventTimeMs);
      headlines.push(h);
    }
  }
  headlines.sort((a, b) => b.published - a.published);
  const trimmed = headlines.slice(0, 80);
  newsCache = { at: Date.now(), headlines: trimmed };
  return trimmed;
}

type SparkMeta = {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  exchangeName?: string;
};

type SparkResult = {
  symbol: string;
  response?: {
    meta?: SparkMeta;
    indicators?: { quote?: { close?: Array<number | null> }[] };
  }[];
};

async function sparkBatch(tickers: string[]): Promise<Record<string, LiveQuote>> {
  const symbols = tickers.map(toYahoo).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols)}&range=1d&interval=5m`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`spark ${res.status}`);
  const json = (await res.json()) as { spark?: { result?: SparkResult[] } };
  const now = Date.now();
  const quotes: Record<string, LiveQuote> = {};
  for (const row of json.spark?.result ?? []) {
    const resp = row.response?.[0];
    const meta = resp?.meta ?? {};
    const closes = (resp?.indicators?.quote?.[0]?.close ?? []).filter((n): n is number => typeof n === "number");
    const last = meta.regularMarketPrice ?? closes.at(-1);
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? closes[0];
    if (typeof last !== "number" || typeof prev !== "number" || !Number.isFinite(last)) continue;
    const eventTimeMs = (meta.regularMarketTime ?? 0) * 1000 || now;
    const availableTimeMs = now;
    const change = last - prev;
    const changePct = prev !== 0 ? (change / prev) * 100 : 0;
    const step = Math.max(1, Math.floor(closes.length / 24));
    const spark = closes.filter((_, i) => i % step === 0).slice(-24);
    const ticker = fromYahoo(row.symbol);
    quotes[ticker] = {
      ticker,
      last,
      prevClose: prev,
      change,
      changePct,
      spark,
      state: quoteState(eventTimeMs, now),
      asOf: eventTimeMs,
      eventTimeMs,
      availableTimeMs,
      exchange: meta.exchangeName ?? "",
    };
  }
  return quotes;
}

async function loadQuotes(): Promise<Record<string, LiveQuote>> {
  if (quoteCache && Date.now() - quoteCache.at < QUOTE_TTL) return quoteCache.quotes;
  const chunks: string[][] = [];
  for (let i = 0; i < DESK_TICKERS.length; i += 12) {
    chunks.push([...DESK_TICKERS.slice(i, i + 12)]);
  }
  const parts = await Promise.allSettled(chunks.map((c) => sparkBatch(c)));
  const quotes: Record<string, LiveQuote> = {};
  for (const p of parts) {
    if (p.status === "fulfilled") Object.assign(quotes, p.value);
  }
  quoteCache = { at: Date.now(), quotes };
  return quotes;
}

function clockOf(ms: number) {
  return etParts(ms).clock.replace(" ET", "");
}

async function loadFredMacroEvidence(): Promise<EvidenceItem[]> {
  try {
    const bundle = await fetchFredSeriesBundle();
    return latestFredEvidence(bundle, clockOf);
  } catch {
    return [];
  }
}

function bookFromEvent(
  event: RadarEvent,
  headlines: LiveHeadline[],
  quotes: Record<string, LiveQuote>,
  fredEvidence: EvidenceItem[] = [],
): LiveBook {
  const matched = headlines.filter((h) => h.eventIds.includes(event.id));
  const use = matched.length ? matched : event.evidence.length ? matched : headlines.filter((h) => event.entities?.some((e) => h.title.toLowerCase().includes(e.toLowerCase())));
  const baseEvidence: EvidenceItem[] = event.evidence.length
    ? event.evidence
    : use.slice(0, 8).map((h) => headlineToEvidence(h, clockOf));
  const evidence = attachFredEvidence(baseEvidence, fredEvidence);
  return {
    eventId: event.id,
    probability: event.probability,
    probabilityDelta: event.probabilityDelta,
    hits: use.length || event.evidence.length,
    evidence,
    sources: event.sources,
    marketReaction: event.marketReaction.map((m) => ({
      ...m,
      change: quotes[m.ticker]?.changePct ?? m.change,
    })),
    // Left as the composed prior — buildDesk applies the evidence-driven
    // Dirichlet update (ace/probability) against the last frozen snapshot and
    // writes the posterior back onto both the event and this book. Tilting
    // here too would double-count the same tape.
    scenarios: event.scenarios,
    heatPoint: event.narrativeHeat[event.narrativeHeat.length - 1] ?? { date: "Now", news: 40, social: 20, search: 18 },
    sentiment: event.sentiment,
  };
}

function toLiveCluster(c: Cluster, eventIds: Set<string>): LiveCluster {
  return {
    id: c.id,
    title: c.title,
    significance: c.significance,
    sources: c.sources,
    headlineCount: c.headlines.length,
    entities: c.entities,
    tags: c.tags,
    tone: c.tone,
    newest: c.newest,
    oldest: c.oldest,
    ...(eventIds.has(c.id) ? { eventId: c.id } : {}),
  };
}

/**
 * Clusters in, events out.
 *
 * Clustering happens in `buildDesk` rather than here, because the clusters
 * have to pass through the event registry first: a cluster's id is per-poll
 * and content-derived, an event's id is persistent. Everything downstream --
 * the book, the headline stamps, the forecast prior lookup -- keys off the
 * event id, so the registry rewrites it before any of them see it.
 */
function discover(
  headlines: LiveHeadline[],
  quotes: Record<string, LiveQuote>,
  clusters: Cluster[],
): { events: RadarEvent[]; headlines: LiveHeadline[]; clusters: LiveCluster[] } {
  const stamped = stampHeadlineClusters(headlines, clusters);
  // Desk tape: only market-relevant headlines (or ones stamped to a surviving cluster).
  const deskHeadlines = filterMarketRelevantHeadlines(stamped);
  const events = relateEvents(
    clusters.map((c) => composeFromCluster(c, quotes)).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)),
  );
  const eventIds = new Set(events.map((e) => e.id));
  // Empty clusters → empty events; overlay falls back to EMPTY_EVENT. Do not invent fixtures.
  return {
    events,
    headlines: deskHeadlines,
    clusters: clusters.map((c) => toLiveCluster(c, eventIds)),
  };
}

export async function buildDesk(): Promise<LiveDesk> {
  const now = Date.now();
  const [quotes, rawNews, fredEvidence] = await Promise.all([
    loadQuotes().catch(() => quoteCache?.quotes ?? {}),
    loadNews().catch(() => newsCache?.headlines ?? []),
    loadFredMacroEvidence(),
  ]);
  // Identity before anything else. `clusterHeadlines` gives per-poll clusters
  // whose ids change whenever their newest headline does; the registry maps
  // each onto a persistent event -- or opens a new one -- and records how it
  // decided. Rewriting the id here is what makes the prior lookup below able
  // to find anything at all.
  const rawClusters = clusterHeadlines(rawNews);
  const registry = await resolveAndRecord(rawClusters, now);
  const identified: Cluster[] = registry.resolved.map((r) => ({
    ...r.cluster,
    id: r.resolution.eventId,
  }));
  const newIdsByEvent = new Map(
    registry.resolved.map((r) => [r.resolution.eventId, r.newHeadlineIds]),
  );
  const identityByEvent = new Map(
    registry.resolved.map((r) => [
      r.resolution.eventId,
      {
        method: r.resolution.method,
        score: r.resolution.score,
        matchedOn: r.resolution.matchedOn,
        newEvidence: r.newHeadlineIds.length,
        firstSeenMs: r.cluster.oldest,
      },
    ]),
  );
  if (registry.degraded) {
    console.warn("[build] event registry unavailable — identity is per-poll this cycle");
  }
  const { events, headlines, clusters } = discover(rawNews, quotes, identified);
  const books: Record<string, LiveBook> = {};
  for (const ev of events) {
    // How this event was identified, and how much of its evidence is actually
    // new — both counted, neither inferred.
    const identity = identityByEvent.get(ev.id);
    if (identity) ev.identity = identity;
    const book = bookFromEvent(ev, headlines, quotes, fredEvidence);
    books[ev.id] = book;
    ev.evidence = book.evidence;
  }

  // Expected evidence is a falsifiable promise, so check it on every cycle —
  // independent of the ledger, because a ledger outage must not quietly turn
  // the check off and leave every row reading "awaiting". Authored `appeared`
  // is always false; only this pass may set it true, and only by naming the
  // item that did it.
  try {
    const { monitorExpectedEvidence } = await import("@/lib/ace/expected-evidence");
    for (const ev of events) {
      if (!ev.expectedEvidence?.length) continue;
      ev.expectedEvidence = monitorExpectedEvidence(ev.expectedEvidence, ev.evidence);
    }
  } catch (err) {
    console.error("[build] expected-evidence monitor skipped:", err);
  }

  // ACE forecast lifecycle: prior → gate → posterior → bands → provenance.
  // The last frozen snapshot is the prior; only evidence that entered the
  // info-set since that freeze, survived the materiality gate, and is neither
  // stale nor a syndicated re-run of a fact already counted is allowed to move
  // it. Awaited, because it changes the probabilities the desk actually shows —
  // but batched into one query, and non-fatal if the ledger is unreachable.
  // Written to the book as well as the event: overlay reads the book's copy.
  try {
    const { latestSnapshots } = await import("./forecast-ledger.server");
    const { updateScenarios } = await import("@/lib/ace/probability");
    const { gateEvidence } = await import("@/lib/ace/materiality");
    const { forecastBands } = await import("@/lib/ace/bands");
    const priors = await latestSnapshots(events.map((e) => e.id));
    for (const ev of events) {
      const prior = priors.get(ev.id);
      if (!prior) continue; // first sighting: the composed book IS the prior
      // The registry already recorded which headlines this event did not hold
      // before this poll. That is a better answer to "what is new" than the
      // clock, which both rejects late-attaching evidence and admits
      // re-syndication. Falls back to the clock on a degraded cycle.
      const gate = gateEvidence(ev.evidence, {
        sinceMs: prior.asOfMs,
        nowMs: now,
        ...(registry.degraded ? {} : { newHeadlineIds: newIdsByEvent.get(ev.id) }),
      });
      const { scenarios, alpha, provenance } = updateScenarios({
        current: ev.scenarios,
        prior: prior.scenarios,
        evidence: gate.admitted,
        nodes: ev.nodes,
        trades: ev.trades,
      });
      // Bands come from the posterior concentration, never from the rounded
      // display percentages — rounding would invent precision we do not have.
      const bands = forecastBands(scenarios.map((s) => s.id), alpha);
      // The headline probability IS the materialization mass, so it has to
      // move with the posterior — otherwise the desk shows a number the model
      // no longer holds, next to the mix that superseded it.
      const { probabilityFromScenarios } = await import("@/lib/ace/probability");
      const posteriorProbability = probabilityFromScenarios(scenarios);
      ev.scenarios = scenarios;
      ev.bands = bands.length ? bands : undefined;
      ev.provenance = provenance;
      ev.probabilityDelta = posteriorProbability - ev.probability;
      ev.probability = posteriorProbability;
      const book = books[ev.id];
      if (book) {
        book.scenarios = scenarios;
        book.bands = bands.length ? bands : undefined;
        book.provenance = provenance;
        book.probabilityDelta = posteriorProbability - book.probability;
        book.probability = posteriorProbability;
      }
    }
  } catch (err) {
    console.error("[build] scenario update skipped:", err);
  }

  // Freeze-at-T ledger: best-effort, never blocks the poll response. Archives
  // this cycle's relevance-filtered headlines and freezes a new snapshot per
  // event only when its scenario mix actually moved (see forecast-ledger.server).
  //
  // Skipped entirely on a degraded cycle. With the registry unreachable the ids
  // are per-poll again, so every freeze would land under an id no later poll
  // can resolve: rows that can never be matched to an outcome, can never be
  // scored, and would sit in the calibration set as permanent unresolved
  // noise. Archiving headlines is still safe and still useful.
  void import("./forecast-ledger.server").then(({ freezeIfChanged, archiveHeadlines }) => {
    void archiveHeadlines(headlines);
    if (registry.degraded) return;
    for (const ev of events) void freezeIfChanged(ev);
  });

  const quoteCount = Object.keys(quotes).length;
  const quoteLive = Object.values(quotes).filter((q) => q.state === "live").length;
  const sessions = sessionFlags(now);
  let status: LiveDesk["status"] = "degraded";
  let statusDetail = "Waiting on public tape.";
  if (quoteCount > 0 && headlines.length > 0) {
    status = quoteLive > 0 || headlines.length > 0 ? "live" : "degraded";
    if (quoteLive > 0 && sessions.ny) statusDetail = "Cash + futures tape live.";
    else if (quoteLive > 0 && sessions.futures) statusDetail = "Futures live · cash last print.";
    else statusDetail = "Last session prints · news live.";
  } else if (headlines.length > 0) {
    statusDetail = "News live · quotes unavailable.";
  } else if (quoteCount > 0) {
    status = "degraded";
    statusDetail = "Quotes live · news feed thin.";
  } else if (fredEvidence.length > 0) {
    statusDetail = "FRED delayed macro available · tape thin.";
  }
  return {
    asOf: now,
    asOfLabel: etParts(now).label,
    status,
    statusDetail,
    sessions,
    quotes,
    headlines: headlines.slice(0, 40),
    clusters,
    books,
    liveEvents: events,
    quoteLive,
    quoteCount,
    macroEvidence: fredEvidence,
  };
}
