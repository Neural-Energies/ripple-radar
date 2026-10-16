/**
 * The six morning-briefing bots. Routing is keyword match. A supply shock is
 * negative for risk assets and positive for energy — that flip is an explicit
 * phrase list, applied only after a headline has been routed to the bot.
 */

export interface BotDef {
  id: string;
  name: string;
  /** Share of the market-mood composite. Renormalized over bots that have a score. */
  weight: number;
}

export const BOTS: BotDef[] = [
  { id: "macro", name: "Macro", weight: 0.2 },
  { id: "rates", name: "Rates / Fed", weight: 0.2 },
  { id: "energy", name: "Energy", weight: 0.15 },
  { id: "equities", name: "Equities / Tech", weight: 0.2 },
  { id: "geopolitics", name: "Geopolitics", weight: 0.15 },
  { id: "crypto", name: "Crypto", weight: 0.1 },
];

export const BOT_IDS = BOTS.map((b) => b.id);

const ROUTES: Record<string, RegExp> = {
  macro: words("gdp", "inflation", "cpi", "payroll", "payrolls", "unemployment", "recession", "retail sales", "pmi", "stimulus", "tariff", "tariffs", "fiscal", "trade deficit", "imf", "consumer spending", "jobless"),
  rates: words("fed", "fomc", "powell", "treasury", "treasuries", "yield", "yields", "basis point", "basis points", "central bank", "ecb", "boe", "boj", "dovish", "hawkish", "funds rate", "discount rate", "fomc minutes"),
  energy: words("oil", "crude", "brent", "wti", "opec", "lng", "diesel", "refinery", "refiners", "barrel", "barrels", "pipeline", "gasoline", "natural gas", "coal", "uranium", "hormuz", "tanker", "tankers", "freight"),
  equities: words("stock", "stocks", "equity", "equities", "nasdaq", "s&p", "shares", "chip", "chips", "semiconductor", "semiconductors", "nvidia", "earnings", "ipo", "tech"),
  geopolitics: words("war", "missile", "missiles", "attack", "attacks", "sanction", "sanctions", "military", "troops", "ceasefire", "invasion", "nato", "hormuz", "strike", "strikes", "airstrike", "blockade", "navy", "conflict"),
  crypto: words("bitcoin", "btc", "ethereum", "ether", "crypto", "cryptocurrency", "stablecoin", "solana", "digital asset"),
};

const OVERLAYS: Record<string, { re: RegExp; sign: 1 | -1 }[]> = {
  energy: [
    { re: words("shortage", "disruption", "outage", "draw", "blockade", "explosion", "attack", "attacks", "sanction", "sanctions", "sunk", "sank", "supply risk", "production cut", "inventory draw"), sign: 1 },
    { re: words("glut", "oversupply", "surplus", "inventory build", "demand destruction"), sign: -1 },
  ],
  rates: [
    { re: words("dovish", "rate cut", "rate cuts", "easing", "holds rates"), sign: 1 },
    { re: words("hawkish", "rate hike", "rate hikes", "higher for longer", "tightening"), sign: -1 },
  ],
  geopolitics: [
    { re: words("ceasefire", "peace talks", "peace talk", "de-escalation", "deescalation"), sign: 1 },
    { re: words("invasion", "invade", "missile", "missiles", "airstrike", "airstrikes", "blockade", "attack", "attacks"), sign: -1 },
  ],
  equities: [
    { re: words("upgrade", "upgraded", "beats estimates", "buyback"), sign: 1 },
    { re: words("sell off", "selloff", "downgrade", "downgraded"), sign: -1 },
  ],
  crypto: [
    { re: words("etf approval", "inflow", "inflows"), sign: 1 },
    { re: words("hack", "hacked", "exploit", "ban", "banned"), sign: -1 },
  ],
  macro: [
    { re: words("expansion", "stimulus", "growth"), sign: 1 },
    { re: words("recession", "contraction", "layoff", "layoffs"), sign: -1 },
  ],
};

const SOURCE_WEIGHT: Record<string, number> = {
  "BBC World": 1,
  "BBC Business": 1,
  "NYT World": 1,
  "NYT Business": 1,
  Guardian: 1,
  "Guardian Business": 1,
  "NPR World": 1,
  "NPR Business": 1,
  Fed: 1,
  ECB: 1,
  "Bank of England": 1,
  "Al Jazeera": 0.95,
  "Defense One": 0.9,
  "CNBC World": 0.85,
  "CNBC Markets": 0.85,
  OilPrice: 0.85,
  MarketWatch: 0.85,
  CoinDesk: 0.8,
  "Google News": 0.55,
};

export function sourceWeight(source: string): number {
  return SOURCE_WEIGHT[source] ?? 0.7;
}

export function routeHeadline(title: string): string[] {
  return BOT_IDS.filter((id) => ROUTES[id]?.test(title));
}

/** +1 / −1 when a bot-specific phrase overrides the raw tone, else 0. */
export function overlaySign(botId: string, title: string): -1 | 0 | 1 {
  let sign: -1 | 0 | 1 = 0;
  for (const rule of OVERLAYS[botId] ?? []) {
    if (!rule.re.test(title)) continue;
    if (sign !== 0 && sign !== rule.sign) return 0;
    sign = rule.sign;
  }
  return sign;
}

function words(...list: string[]): RegExp {
  const body = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|");
  return new RegExp(`\\b(?:${body})\\b`, "i");
}
