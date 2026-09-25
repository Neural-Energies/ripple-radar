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
  /** As-of date for the whole read. Every field below is cut to it. */
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
  /** Spot VIX minus 21-day realized vol, both as of `date`. */
  premium: number;
  /**
   * Newest index close at or before `date`. Normally equals `date`; when it
   * does not, the index simply had no print that session and the caller can
   * say how stale the realized leg is.
   */
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
  // Cut the index to the SAME as-of date as the volatility pair before
  // computing anything from it. `premium` subtracts realized vol from spot
  // VIX, and the two series do not always end on the same day — VIX3M can lag
  // a session, or the index can print when the vol complex has not. Taking
  // `spx.at(-1)` regardless meant the premium could compare today's realized
  // vol against yesterday's VIX and call the difference a risk premium.
  const aligned = spx.filter((point) => point.date <= spot.date);
  const returns = logReturns(aligned.map((point) => point.value));
  const rv21 = realizedVol(returns, 21);
  const rv252 = realizedVol(returns, 252);
  const spxDate = aligned.at(-1)?.date;
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

