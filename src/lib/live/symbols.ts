export const YAHOO_SYMBOL: Record<string, string> = {
  CL: "CL=F",
  BZ: "BZ=F",
  HO: "HO=F",
  RB: "RB=F",
  NG: "NG=F",
  GC: "GC=F",
  HG: "HG=F",
  SPX: "^GSPC",
  VIX: "^VIX",
  TNX: "^TNX",
  TWD: "TWD=X",
  EUR: "EURUSD=X",
  JPY: "USDJPY=X",
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  LYC: "LYC.AX",
  ES: "ES=F",
  NQ: "NQ=F",
  YM: "YM=F",
  RTY: "RTY=F",
  ZN: "ZN=F",
  ZB: "ZB=F",
  SI: "SI=F",
};

/**
 * What a futures quote on this desk is (PR #5 B06). The feed is Yahoo's
 * continuous front-month series: it rolls to the next contract on its own
 * schedule, so a change across a roll mixes two contracts; and exchange data
 * arrives delayed. Stated per contract rather than implied.
 */
export const FUTURES: Record<string, { contract: string; exchange: string; roll: string; delayMinutes: number; session: string }> = {
  ES: { contract: "E-mini S&P 500", exchange: "CME", roll: "quarterly (Mar/Jun/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  NQ: { contract: "E-mini Nasdaq-100", exchange: "CME", roll: "quarterly (Mar/Jun/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  YM: { contract: "E-mini Dow", exchange: "CBOT", roll: "quarterly (Mar/Jun/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  RTY: { contract: "E-mini Russell 2000", exchange: "CME", roll: "quarterly (Mar/Jun/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  ZN: { contract: "10-year T-note", exchange: "CBOT", roll: "quarterly (Mar/Jun/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  ZB: { contract: "30-year T-bond", exchange: "CBOT", roll: "quarterly (Mar/Jun/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  CL: { contract: "WTI crude", exchange: "NYMEX", roll: "monthly", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  BZ: { contract: "Brent crude", exchange: "NYMEX", roll: "monthly", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  HO: { contract: "ULSD (heating oil)", exchange: "NYMEX", roll: "monthly", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  RB: { contract: "RBOB gasoline", exchange: "NYMEX", roll: "monthly", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  NG: { contract: "Henry Hub natural gas", exchange: "NYMEX", roll: "monthly", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  GC: { contract: "Gold", exchange: "COMEX", roll: "bi-monthly active months", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  SI: { contract: "Silver", exchange: "COMEX", roll: "active months (Mar/May/Jul/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
  HG: { contract: "Copper", exchange: "COMEX", roll: "active months (Mar/May/Jul/Sep/Dec)", delayMinutes: 10, session: "Sun–Fri 18:00–17:00 ET" },
};

/** Tickers a quote may be requested for on demand. Letters, digits and . = ^ - only. */
export const QUOTABLE = /^\^?[A-Z0-9][A-Z0-9.=^-]{0,14}$/;

export const DESK_TICKERS = [
  "BWET",
  "USO",
  "INSW",
  "XOP",
  "CL",
  "BZ",
  "HO",
  "RB",
  "NG",
  "GC",
  "GLD",
  "HG",
  "JETS",
  "UUP",
  "DBA",
  "TSM",
  "NVDA",
  "MU",
  "MP",
  "ITA",
  "AAPL",
  "DRIV",
  "XLE",
  "UNG",
  "SPX",
  "QQQ",
  "SMH",
  "ASML",
  "AMAT",
  "AMD",
  "DAC",
  "FDX",
  "AIG",
  "XRT",
  "TIP",
  "ICLN",
  "TWD",
  "BTC",
  "ETH",
  "EUR",
  "JPY",
  "FXY",
  "TNX",
  "TLT",
  "VIX",
  "KRE",
  "XLF",
  "VLO",
  "MPC",
  "FRO",
  "STNG",
  "LMT",
  "RTX",
  "DAL",
  "MOS",
  "CF",
  "FCX",
  "UNP",
  "IWM",
  "COPX",
  "ES",
  "NQ",
  "ZN",
] as const;

const YAHOO_TO_DESK: Record<string, string> = Object.fromEntries(
  Object.entries(YAHOO_SYMBOL).map(([desk, yahoo]) => [yahoo, desk]),
);

export function toYahoo(ticker: string) {
  return YAHOO_SYMBOL[ticker] ?? ticker;
}

export function fromYahoo(symbol: string) {
  return YAHOO_TO_DESK[symbol] ?? symbol;
}
