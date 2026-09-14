import type { NodeKind, TradeCategory } from "@/data/types";

/** Seed tags for transmission. Unknown tokens may also become tags at compose time. */
export type Tag = string;

export const ESCALATE = [
  "attack",
  "strike",
  "missile",
  "drone",
  "blockade",
  "invasion",
  "closure",
  "close",
  "halt",
  "ban",
  "restrict",
  "curb",
  "sanction",
  "outage",
  "rupture",
  "explosion",
  "fire",
  "crash",
  "collapse",
  "default",
  "run",
  "hike",
  "cut",
  "emergency",
  "seize",
  "hijack",
  "war",
  "conflict",
  "escalate",
  "escalation",
  "kill",
  "killed",
  "dead",
  "hostage",
  "mine",
  "shutdown",
  "force majeure",
  "recession",
  "inflation surprise",
  "intervention",
  "quota",
];

export const DEESCALATE = [
  "talks",
  "deal",
  "ceasefire",
  "truce",
  "ease",
  "eased",
  "resume",
  "repair",
  "de-escalat",
  "diplomacy",
  "negotiate",
  "pause",
  "exempt",
  "relax",
  "reopen",
  "hold",
  "unchanged",
  "in line",
];

export const TICKER_META: Record<
  string,
  { name: string; tags: Tag[]; kind: NodeKind | "index"; category: TradeCategory | "index"; lag: string }
> = {
  CL: { name: "WTI crude", tags: ["energy", "crude"], kind: "futures", category: "futures", lag: "minutes–days" },
  BZ: { name: "Brent", tags: ["energy", "crude"], kind: "futures", category: "futures", lag: "minutes–days" },
  HO: { name: "ULSD diesel", tags: ["energy", "refined"], kind: "futures", category: "futures", lag: "hours–weeks" },
  RB: { name: "RBOB gasoline", tags: ["energy", "refined"], kind: "futures", category: "futures", lag: "hours–weeks" },
  NG: { name: "Henry Hub gas", tags: ["energy", "gas"], kind: "futures", category: "futures", lag: "days–weeks" },
  UNG: { name: "US Natural Gas", tags: ["energy", "gas"], kind: "etf", category: "etf", lag: "days–weeks" },
  USO: { name: "US Oil Fund", tags: ["energy", "crude"], kind: "etf", category: "etf", lag: "hours–days" },
  XLE: { name: "Energy Select", tags: ["energy", "equity"], kind: "etf", category: "etf", lag: "hours–weeks" },
  XOP: { name: "Oil & Gas E&P", tags: ["energy", "equity"], kind: "etf", category: "etf", lag: "days–weeks" },
  BWET: { name: "Breakwave Tanker", tags: ["shipping", "freight", "energy"], kind: "etf", category: "etf", lag: "days–weeks" },
  INSW: { name: "International Seaways", tags: ["shipping", "freight"], kind: "company", category: "stock", lag: "days–weeks" },
  FRO: { name: "Frontline", tags: ["shipping", "freight"], kind: "company", category: "stock", lag: "days–weeks" },
  STNG: { name: "Scorpio Tankers", tags: ["shipping", "refined"], kind: "company", category: "stock", lag: "days–weeks" },
  DAC: { name: "Danaos", tags: ["shipping", "container"], kind: "company", category: "stock", lag: "weeks" },
  FDX: { name: "FedEx", tags: ["shipping", "logistics"], kind: "company", category: "stock", lag: "weeks" },
  AIG: { name: "AIG", tags: ["insurance", "shipping"], kind: "company", category: "stock", lag: "days–weeks" },
  JETS: { name: "US Global Jets", tags: ["airlines", "energy"], kind: "etf", category: "etf", lag: "days–weeks" },
  DAL: { name: "Delta", tags: ["airlines"], kind: "company", category: "stock", lag: "days–weeks" },
  MOS: { name: "Mosaic", tags: ["ag", "gas"], kind: "company", category: "stock", lag: "weeks" },
  CF: { name: "CF Industries", tags: ["ag", "gas"], kind: "company", category: "stock", lag: "weeks" },
  DBA: { name: "Agriculture", tags: ["ag"], kind: "etf", category: "etf", lag: "weeks" },
  GC: { name: "Gold", tags: ["gold", "haven"], kind: "futures", category: "commodities", lag: "minutes–days" },
  GLD: { name: "SPDR Gold", tags: ["gold", "haven"], kind: "etf", category: "etf", lag: "minutes–days" },
  UUP: { name: "US Dollar", tags: ["fx", "usd"], kind: "etf", category: "etf", lag: "minutes–weeks" },
  EUR: { name: "EUR/USD", tags: ["fx", "europe"], kind: "currency", category: "forex", lag: "minutes–weeks" },
  JPY: { name: "USD/JPY", tags: ["fx", "yen", "policy"], kind: "currency", category: "forex", lag: "minutes" },
  FXY: { name: "Yen", tags: ["fx", "yen"], kind: "etf", category: "etf", lag: "minutes–days" },
  TWD: { name: "USD/TWD", tags: ["fx", "semiconductor"], kind: "currency", category: "forex", lag: "hours–weeks" },
  TNX: { name: "10-year yield", tags: ["rates", "policy"], kind: "rates", category: "futures", lag: "minutes" },
  TLT: { name: "20+ Treasury", tags: ["rates", "duration"], kind: "etf", category: "etf", lag: "minutes–weeks" },
  TIP: { name: "TIPS", tags: ["inflation", "rates"], kind: "etf", category: "etf", lag: "days–weeks" },
  VIX: { name: "VIX", tags: ["vol", "equity"], kind: "etf", category: "index", lag: "minutes–days" },
  SPX: { name: "S&P 500", tags: ["equity"], kind: "index", category: "index", lag: "minutes–days" },
  QQQ: { name: "Nasdaq 100", tags: ["equity", "tech", "duration"], kind: "etf", category: "etf", lag: "minutes–days" },
  IWM: { name: "Russell 2000", tags: ["equity", "conditions"], kind: "etf", category: "etf", lag: "days–weeks" },
  KRE: { name: "Regional banks", tags: ["banking", "credit"], kind: "etf", category: "etf", lag: "hours–weeks" },
  XLF: { name: "Financials", tags: ["banking", "equity"], kind: "etf", category: "etf", lag: "days" },
  BTC: { name: "Bitcoin", tags: ["crypto", "liquidity"], kind: "commodity", category: "crypto", lag: "minutes–weeks" },
  ETH: { name: "Ether", tags: ["crypto", "liquidity"], kind: "commodity", category: "crypto", lag: "minutes–weeks" },
  TSM: { name: "TSMC", tags: ["semiconductor", "foundry"], kind: "company", category: "stock", lag: "days–quarters" },
  NVDA: { name: "NVIDIA", tags: ["semiconductor", "compute"], kind: "company", category: "stock", lag: "weeks–quarters" },
  SMH: { name: "VanEck Semi", tags: ["semiconductor"], kind: "etf", category: "etf", lag: "days–weeks" },
  MU: { name: "Micron", tags: ["semiconductor", "memory"], kind: "company", category: "stock", lag: "weeks" },
  ASML: { name: "ASML", tags: ["semiconductor", "capex"], kind: "company", category: "stock", lag: "weeks–quarters" },
  AMAT: { name: "Applied Materials", tags: ["semiconductor", "capex"], kind: "company", category: "stock", lag: "weeks–quarters" },
  AMD: { name: "AMD", tags: ["semiconductor", "compute"], kind: "company", category: "stock", lag: "weeks–quarters" },
  AVGO: { name: "Broadcom", tags: ["semiconductor", "networking"], kind: "company", category: "stock", lag: "weeks–quarters" },
  AAPL: { name: "Apple", tags: ["tech", "semiconductor"], kind: "company", category: "stock", lag: "weeks–quarters" },
  MP: { name: "MP Materials", tags: ["rareearth", "magnets"], kind: "company", category: "stock", lag: "days–weeks" },
  DRIV: { name: "Global X Autonomous", tags: ["rareearth", "ev"], kind: "etf", category: "etf", lag: "weeks" },
  ITA: { name: "US Aerospace & Defense", tags: ["defense"], kind: "etf", category: "etf", lag: "weeks–quarters" },
  LMT: { name: "Lockheed Martin", tags: ["defense"], kind: "company", category: "stock", lag: "weeks–quarters" },
  RTX: { name: "RTX", tags: ["defense"], kind: "company", category: "stock", lag: "weeks–quarters" },
  HG: { name: "Copper", tags: ["copper", "industrial"], kind: "futures", category: "commodities", lag: "hours–weeks" },
  FCX: { name: "Freeport-McMoRan", tags: ["copper"], kind: "company", category: "stock", lag: "days–weeks" },
  COPX: { name: "Copper miners", tags: ["copper"], kind: "etf", category: "etf", lag: "days–weeks" },
  VLO: { name: "Valero", tags: ["energy", "refined"], kind: "company", category: "stock", lag: "days–weeks" },
  MPC: { name: "Marathon Petroleum", tags: ["energy", "refined"], kind: "company", category: "stock", lag: "days–weeks" },
  UNP: { name: "Union Pacific", tags: ["logistics", "energy"], kind: "company", category: "stock", lag: "weeks" },
  ICLN: { name: "Clean Energy", tags: ["energy", "alt"], kind: "etf", category: "etf", lag: "weeks" },
  XRT: { name: "Retail", tags: ["consumer"], kind: "etf", category: "etf", lag: "weeks" },
};

/** Word/phrase → tags. This is NER, not a list of events. */
export const LEXICON: Record<string, Tag[]> = {
  oil: ["energy", "crude"],
  crude: ["energy", "crude"],
  brent: ["energy", "crude"],
  wti: ["energy", "crude"],
  petroleum: ["energy", "crude"],
  gasoline: ["energy", "refined"],
  diesel: ["energy", "refined"],
  ulsd: ["energy", "refined"],
  refinery: ["energy", "refined"],
  lng: ["energy", "gas"],
  gas: ["energy", "gas"],
  opec: ["energy", "policy"],
  tanker: ["shipping", "freight"],
  insurance: ["insurance", "shipping"],
  freight: ["shipping", "freight"],
  shipping: ["shipping"],
  vessel: ["shipping"],
  suez: ["shipping"],
  chokepoint: ["shipping", "energy"],
  strait: ["shipping"],
  blockade: ["shipping", "defense"],
  houthi: ["shipping", "defense"],
  yemen: ["shipping", "defense"],
  iran: ["energy", "defense"],
  tehran: ["energy"],
  irgc: ["energy", "defense"],
  hormuz: ["energy", "shipping"],
  kharg: ["energy"],
  pipeline: ["energy"],
  aramco: ["energy"],
  taiwan: ["semiconductor", "defense"],
  tsmc: ["semiconductor", "foundry"],
  taipei: ["semiconductor"],
  semiconductor: ["semiconductor"],
  chip: ["semiconductor"],
  chips: ["semiconductor"],
  foundry: ["semiconductor"],
  nvidia: ["semiconductor", "compute"],
  "rare earth": ["rareearth"],
  magnet: ["rareearth"],
  mofcom: ["rareearth", "policy"],
  fed: ["rates", "policy"],
  fomc: ["rates", "policy"],
  "federal reserve": ["rates", "policy"],
  powell: ["rates", "policy"],
  rate: ["rates"],
  rates: ["rates"],
  "rate cut": ["rates", "policy"],
  hike: ["rates", "policy"],
  treasury: ["rates"],
  yield: ["rates"],
  inflation: ["inflation", "rates"],
  cpi: ["inflation"],
  yen: ["fx", "yen"],
  boj: ["fx", "yen", "policy"],
  "bank of japan": ["fx", "yen", "policy"],
  intervention: ["fx", "policy"],
  dollar: ["fx", "usd"],
  euro: ["fx", "europe"],
  ecb: ["rates", "europe"],
  pboc: ["policy", "china"],
  china: ["china"],
  beijing: ["china"],
  hurricane: ["weather", "energy"],
  storm: ["weather"],
  flood: ["weather"],
  earthquake: ["weather"],
  drought: ["weather", "ag"],
  bank: ["banking", "credit"],
  banks: ["banking"],
  deposit: ["banking"],
  svb: ["banking"],
  bitcoin: ["crypto"],
  crypto: ["crypto"],
  etf: ["equity"],
  strike: ["labor"],
  union: ["labor"],
  cyber: ["cyber"],
  ransomware: ["cyber"],
  election: ["policy"],
  sanction: ["policy", "defense"],
  sanctions: ["policy"],
  war: ["defense"],
  missile: ["defense"],
  nato: ["defense"],
  pentagon: ["defense"],
  copper: ["copper", "industrial"],
  mine: ["copper", "industrial"],
  lithium: ["lithium", "industrial"],
  fertilizer: ["ag"],
  wheat: ["ag"],
  corn: ["ag"],
  airline: ["airlines"],
  aviation: ["airlines"],
  jet: ["airlines", "energy"],
  export: ["policy", "shipping"],
  license: ["policy"],
  licenses: ["policy"],
  customs: ["policy", "shipping"],
  uranium: ["industrial"],
  nuclear: ["industrial"],
  port: ["shipping", "logistics"],
  crane: ["logistics", "labor"],
  trucking: ["logistics"],
  "supply chain": ["logistics", "shipping"],
  kazakhstan: ["industrial"],
  "gulf coast": ["energy", "weather"],
  refining: ["energy", "refined"],
  "basis-point": ["rates", "policy"],
  "basis point": ["rates", "policy"],
  fedwatch: ["rates", "policy"],
  euv: ["semiconductor"],
};

export interface Transmit {
  from: Tag;
  to: Tag;
  direction: 1 | -1;
  lag: string;
  mechanism: string;
  confidence: number;
}

export const TRANSMIT: Transmit[] = [
  { from: "crude", to: "refined", direction: 1, lag: "hours–days", mechanism: "Crude tightness reprices product cracks unless stocks absorb it.", confidence: 0.82 },
  { from: "energy", to: "shipping", direction: 1, lag: "hours–weeks", mechanism: "Barrels and molecules move on hulls; war-risk and tonne-miles reprice first.", confidence: 0.8 },
  { from: "shipping", to: "freight", direction: 1, lag: "1–15 sessions", mechanism: "Reroutes and insurance ration effective capacity.", confidence: 0.84 },
  { from: "freight", to: "insurance", direction: 1, lag: "hours–days", mechanism: "Underwriters ration slips before AIS fully reroutes.", confidence: 0.74 },
  { from: "refined", to: "airlines", direction: -1, lag: "days–weeks", mechanism: "Jet kero is the same complex. Stage length does not hedge it.", confidence: 0.76 },
  { from: "gas", to: "ag", direction: 1, lag: "weeks", mechanism: "Gas into Haber-Bosch; freight is a second hit.", confidence: 0.64 },
  { from: "energy", to: "inflation", direction: 1, lag: "weeks–months", mechanism: "Gasoline and diesel are CPI-visible.", confidence: 0.6 },
  { from: "inflation", to: "rates", direction: 1, lag: "days–weeks", mechanism: "The curve prices the second derivative of the print.", confidence: 0.66 },
  { from: "inflation", to: "fx", direction: 1, lag: "days–weeks", mechanism: "Importers fund a higher bill in dollars.", confidence: 0.55 },
  { from: "rates", to: "duration", direction: -1, lag: "minutes–days", mechanism: "Higher path → lower long-duration price.", confidence: 0.8 },
  { from: "rates", to: "crypto", direction: -1, lag: "minutes–days", mechanism: "High-beta duration to financial conditions.", confidence: 0.58 },
  { from: "rates", to: "equity", direction: -1, lag: "minutes–weeks", mechanism: "Discount rates and financial conditions.", confidence: 0.62 },
  { from: "policy", to: "rates", direction: 1, lag: "minutes", mechanism: "The reaction function is the product.", confidence: 0.78 },
  { from: "yen", to: "fx", direction: 1, lag: "minutes", mechanism: "Official FX is a print, then a path.", confidence: 0.86 },
  { from: "semiconductor", to: "tech", direction: 1, lag: "weeks–quarters", mechanism: "Foundry and license shocks hit compute and hardware with a lag.", confidence: 0.72 },
  { from: "foundry", to: "compute", direction: 1, lag: "weeks–quarters", mechanism: "Wafer allocation and lead times, not the press conference.", confidence: 0.7 },
  { from: "rareearth", to: "magnets", direction: 1, lag: "days–weeks", mechanism: "Oxide → magnet → motor. The midstream is the bottleneck.", confidence: 0.74 },
  { from: "rareearth", to: "defense", direction: 1, lag: "weeks–quarters", mechanism: "Qualified magnets are a budget, not a ticker.", confidence: 0.6 },
  { from: "defense", to: "equity", direction: 1, lag: "weeks–quarters", mechanism: "Restock is appropriations, not the incident.", confidence: 0.52 },
  { from: "banking", to: "credit", direction: 1, lag: "hours–weeks", mechanism: "Uninsured deposits and AFS holes transmit as funding stress.", confidence: 0.8 },
  { from: "credit", to: "equity", direction: -1, lag: "days", mechanism: "Tighter credit hits cyclicals and small caps first.", confidence: 0.64 },
  { from: "lithium", to: "industrial", direction: 1, lag: "days–weeks", mechanism: "Chemical feedstock into cathodes and glass. The tonne is the confirmation.", confidence: 0.7 },
  { from: "lithium", to: "ev", direction: 1, lag: "weeks–quarters", mechanism: "Brine and hard-rock feed battery plants with a lag, not a press conference.", confidence: 0.66 },
  { from: "weather", to: "energy", direction: 1, lag: "hours–days", mechanism: "Gulf weather hits refining and power, not the wellhead first.", confidence: 0.68 },
  { from: "weather", to: "ag", direction: 1, lag: "days–weeks", mechanism: "Yields and barge traffic, then the curve.", confidence: 0.66 },
  { from: "cyber", to: "logistics", direction: 1, lag: "hours–weeks", mechanism: "Ops downtime is the transmission, not the ticker of the victim.", confidence: 0.58 },
  { from: "labor", to: "logistics", direction: 1, lag: "days–weeks", mechanism: "Ports, rails, and plants ration physical throughput.", confidence: 0.62 },
  { from: "vol", to: "equity", direction: -1, lag: "minutes–days", mechanism: "Gap risk and carry unwind.", confidence: 0.6 },
  { from: "haven", to: "gold", direction: 1, lag: "minutes–days", mechanism: "Geopolitical premium mixed with real rates.", confidence: 0.64 },
  { from: "refined", to: "logistics", direction: -1, lag: "days–weeks", mechanism: "Diesel is the fuel trucking actually burns. Transport opex follows the crack.", confidence: 0.7 },
  { from: "logistics", to: "consumer", direction: -1, lag: "weeks", mechanism: "Freight into shelf prices with a lag — not the same-session print.", confidence: 0.52 },
  { from: "shipping", to: "industrial", direction: -1, lag: "weeks", mechanism: "Lead times and inventory buffers, then production schedules.", confidence: 0.5 },
  { from: "copper", to: "industrial", direction: 1, lag: "days–weeks", mechanism: "The tonne confirms industrial demand or a mine shock.", confidence: 0.7 },
  { from: "industrial", to: "equity", direction: 1, lag: "days–weeks", mechanism: "Cyclicals reprice the demand impulse after the commodity.", confidence: 0.55 },
  { from: "rates", to: "banking", direction: -1, lag: "days–weeks", mechanism: "Higher path marks AFS books and tightens credit supply.", confidence: 0.6 },
  { from: "fx", to: "equity", direction: -1, lag: "minutes–weeks", mechanism: "A dollar squeeze is a financial-conditions print for risk assets.", confidence: 0.5 },
  { from: "policy", to: "equity", direction: -1, lag: "minutes–weeks", mechanism: "The reaction function hits duration and high-beta first.", confidence: 0.58 },
];

export function toneOf(text: string): "up" | "down" | "neutral" {
  const hay = text.toLowerCase();
  const esc = ESCALATE.filter((k) => hay.includes(k)).length;
  const de = DEESCALATE.filter((k) => hay.includes(k)).length;
  if (esc > de) return "up";
  if (de > esc) return "down";
  return "neutral";
}

export function tagsFromText(text: string): Tag[] {
  const hay = text.toLowerCase();
  const hits = new Map<Tag, number>();
  for (const [key, tags] of Object.entries(LEXICON)) {
    if (hay.includes(key)) {
      for (const t of tags) hits.set(t, (hits.get(t) ?? 0) + 1 + (key.includes(" ") ? 1 : 0));
    }
  }
  if (hits.size === 0) {
    const toks = hay.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    for (const t of toks) {
      if (TRANSMIT.some((e) => e.from === t || e.to === t)) hits.set(t, 1);
    }
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

export function regionFromText(text: string, tags: Tag[]): string {
  const hay = text.toLowerCase();
  const geo: [string, string][] = [
    ["taiwan", "East Asia"],
    ["china", "China"],
    ["beijing", "China"],
    ["iran", "Middle East"],
    ["tehran", "Middle East"],
    ["hormuz", "Middle East seaborne"],
    ["red sea", "Red Sea / Suez"],
    ["houthi", "Red Sea / Suez"],
    ["suez", "Red Sea / Suez"],
    ["ukraine", "Europe"],
    ["russia", "Eurasia"],
    ["japan", "Japan"],
    ["yen", "Japan"],
    ["boj", "Japan"],
    ["ecb", "Euro area"],
    ["europe", "Europe"],
    ["fed", "United States"],
    ["fomc", "United States"],
    ["gulf", "US Gulf / energy"],
    ["hurricane", "US weather"],
  ];
  for (const [k, r] of geo) if (hay.includes(k)) return r;
  if (tags.includes("rates") || tags.includes("policy")) return "Macro / policy";
  if (tags.includes("crypto")) return "Digital liquidity";
  if (tags.includes("semiconductor")) return "Tech supply chain";
  if (tags.includes("energy")) return "Energy";
  if (tags.includes("shipping")) return "Seaborne logistics";
  if (tags.includes("banking")) return "Credit / funding";
  return "Global";
}

export function themeFromTags(tags: Tag[]): string {
  if (tags.includes("energy") && tags.includes("shipping")) return "Energy / freight transmission";
  if (tags.includes("rates") || tags.includes("policy")) return "Policy / financial conditions";
  if (tags.includes("semiconductor")) return "Compute / foundry";
  if (tags.includes("shipping")) return "Physical logistics";
  if (tags.includes("banking")) return "Credit stress";
  if (tags.includes("fx")) return "FX / official intervention";
  if (tags.includes("weather")) return "Physical disruption";
  if (tags.includes("rareearth")) return "Critical minerals";
  if (tags.includes("crypto")) return "Liquidity / digital duration";
  if (tags[0]) return tags[0].replace(/-/g, " ");
  return "Unclassified transmission";
}

export function hopsFrom(tag: Tag, depth: number): { tag: Tag; depth: number; edge: Transmit }[] {
  const out: { tag: Tag; depth: number; edge: Transmit }[] = [];
  const seen = new Set<Tag>([tag]);
  let frontier: Tag[] = [tag];
  for (let d = 1; d <= depth; d++) {
    const next: Tag[] = [];
    for (const f of frontier) {
      for (const e of TRANSMIT) {
        if (e.from !== f || seen.has(e.to)) continue;
        seen.add(e.to);
        next.push(e.to);
        out.push({ tag: e.to, depth: d, edge: e });
      }
    }
    frontier = next;
  }
  return out;
}
