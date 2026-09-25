import type { FredPoint } from "./macro-regime.ts";

/** Close-to-close log returns. Skips a print that is not positive. */
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (prev == null || next == null || prev <= 0 || next <= 0) continue;
    out.push(Math.log(next / prev));
  }
  return out;
}

/** Annualized close-to-close volatility, in percent. Sample standard deviation. */
export function realizedVol(returns: number[], window: number): number | null {
  if (window < 2 || returns.length < window) return null;
  const slice = returns.slice(-window);
  const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
  const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Spot VIX against the 3-month index. Positive slope is contango. */
export function termStructure(vix: number, vix3m: number): { slope: number; regime: "contango" | "backwardation" } | null {
  if (!(vix > 0) || !(vix3m > 0)) return null;
  const slope = vix3m / vix - 1;
  return { slope, regime: slope >= 0 ? "contango" : "backwardation" };
}

/** Share of history strictly below the value, in percent. Not a probability. */
export function percentileRank(history: number[], value: number): number | null {
  if (!history.length || !Number.isFinite(value)) return null;
  const below = history.filter((point) => point < value).length;
  return (below / history.length) * 100;
}

export type VolRead = {
  date: string;
  vix: number;
  vix3m: number;
  slope: number;
  term: "contango" | "backwardation";
  percentile: number;
  since: string;
  rv21: number;
  rv252: number;
  realized: "expanding" | "compressing";
  premium: number;
  spxDate: string;
};

export function volRead(vix: FredPoint[], vix3m: FredPoint[], spx: FredPoint[]): VolRead | null {
  const threeMonth = new Map(vix3m.map((point) => [point.date, point.value]));
  let spot: FredPoint | null = null;
  for (const point of vix) {
    if (threeMonth.has(point.date)) spot = point;
  }
  if (!spot) return null;
  const longer = threeMonth.get(spot.date);
  const term = longer == null ? null : termStructure(spot.value, longer);
  if (!term || longer == null) return null;
  const history = vix.filter((point) => point.date <= spot.date).map((point) => point.value);
  const percentile = percentileRank(history, spot.value);
  const closes = spx.map((point) => point.value);
  const returns = logReturns(closes);
  const rv21 = realizedVol(returns, 21);
  const rv252 = realizedVol(returns, 252);
  const spxDate = spx.at(-1)?.date;
  if (percentile == null || rv21 == null || rv252 == null || !spxDate) return null;
  return {
    date: spot.date,
    vix: spot.value,
    vix3m: longer,
    slope: term.slope,
    term: term.regime,
    percentile,
    since: vix[0]?.date ?? spot.date,
    rv21,
    rv252,
    realized: rv21 > rv252 ? "expanding" : "compressing",
    premium: spot.value - rv21,
    spxDate,
  };
}

