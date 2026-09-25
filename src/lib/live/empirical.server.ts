import historyFile from "@/data/iran-2026-history.json";
import {
  bucketOf,
  historyApplies,
  marketBullets,
  type EmpiricalBook,
  type HistoryBlock,
  type MarketContract,
  type SideShare,
} from "./empirical";

interface GammaEvent {
  slug?: string;
  title?: string;
  markets?: GammaMarket[];
}

interface GammaMarket {
  question?: string;
  slug?: string;
  closed?: boolean;
  outcomePrices?: string | string[];
  volumeNum?: number;
  volume?: string | number;
  endDate?: string;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; book: EmpiricalBook }>();

function queriesFor(title: string, actors: string[]): string[] {
  const names = actors
    .map((s) => s.trim())
    .filter((s) => s && !/market|positioning/i.test(s))
    .slice(0, 2);
  const blob = `${title} ${names.join(" ")}`.toLowerCase();
  const q: string[] = [];
  if (names.length >= 2) q.push(`${names[0]} ${names[1]}`);
  if (blob.includes("iran")) {
    q.push("US Iran ceasefire");
    q.push("invade Iran");
    q.push("US-Iran nuclear deal");
  } else if (names[0]) {
    q.push(names[0]);
  }
  return [...new Set(q)].slice(0, 4);
}

function yesPrice(raw: GammaMarket["outcomePrices"]): number | null {
  try {
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const n = Number(parsed[0]);
    if (!Number.isFinite(n) || n < 0 || n > 1) return null;
    return n;
  } catch {
    return null;
  }
}

async function search(q: string): Promise<GammaEvent[]> {
  const url = new URL("https://gamma-api.polymarket.com/public-search");
  url.searchParams.set("q", q);
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "AlphaRecon/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Polymarket returned ${res.status}`);
  const body = (await res.json()) as { events?: GammaEvent[] };
  return body.events ?? [];
}

function contractsFrom(events: GammaEvent[]): MarketContract[] {
  const seen = new Set<string>();
  const out: MarketContract[] = [];
  for (const event of events) {
    for (const market of event.markets ?? []) {
      if (market.closed) continue;
      const question = market.question?.trim();
      if (!question || seen.has(question)) continue;
      const yes = yesPrice(market.outcomePrices);
      if (yes == null) continue;
      const volumeUsd = Number(market.volumeNum ?? market.volume ?? 0);
      if (!Number.isFinite(volumeUsd) || volumeUsd < 5_000) continue;
      seen.add(question);
      const slug = event.slug || market.slug;
      out.push({
        question,
        yes,
        volumeUsd,
        endDate: market.endDate ?? null,
        url: slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com",
        bucket: bucketOf(question),
      });
    }
  }
  out.sort((a, b) => b.volumeUsd - a.volumeUsd);
  return out;
}

function historyFor(title: string, actors: string[]): HistoryBlock {
  if (!historyApplies(title, actors)) {
    return {
      available: false,
      reason: `No coded action history for this book (${title.slice(0, 80)} | ${actors.join(", ")}).`,
    };
  }
  const file = historyFile as unknown as {
    citation: string;
    url: string;
    window: [string, string];
    rows: number;
    diplomaticUnattributed: number;
    model: string;
    sides: SideShare[];
  };
  return {
    available: true,
    citation: file.citation,
    url: file.url,
    window: file.window,
    rows: file.rows,
    diplomaticUnattributed: file.diplomaticUnattributed,
    model: file.model,
    sides: file.sides,
  };
}

export async function empiricalBook(title: string, actors: string[]): Promise<EmpiricalBook> {
  const key = `${title}\n${actors.join("|")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.book;

  const history = historyFor(title, actors);
  const qs = queriesFor(title, actors);
  let contracts: MarketContract[] = [];
  let error: string | undefined;
  try {
    const batches = await Promise.all(qs.map((q) => search(q)));
    contracts = contractsFrom(batches.flat());
  } catch (err) {
    error = err instanceof Error ? err.message : "Market prices unavailable";
  }

  const book: EmpiricalBook = {
    asOf: new Date().toISOString(),
    bullets: error && contracts.length === 0 ? [`Market prices unavailable (${error}).`] : marketBullets(contracts),
    contracts: contracts.slice(0, 8),
    history,
    error,
  };
  if (!error) cache.set(key, { at: Date.now(), book });
  return book;
}
