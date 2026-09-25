/** Growth/inflation regime from FRED levels.
 *
 * Each leg is a year-over-year rate, then the change in that rate over three
 * months. The basket is accelerating when more than half the legs are.
 * The quad is the sign pair. This is the published rate-of-change rule,
 * not a proprietary nowcast.
 */

export type FredPoint = { date: string; value: number };

export type RatePoint = { date: string; rate: number; delta: number };

export type Quad = 1 | 2 | 3 | 4;

export const QUAD_NAME: Record<Quad, string> = {
  1: "Goldilocks",
  2: "Reflation",
  3: "Stagflation",
  4: "Both slowing",
};

export function monthIndex(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

export function parseFredCsv(text: string): FredPoint[] {
  const lines = text.trim().split(/\r?\n/).slice(1);
  const out: FredPoint[] = [];
  for (const line of lines) {
    const [date, raw] = line.split(",");
    if (!date || !raw || raw.trim() === ".") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || monthIndex(date) == null) continue;
    out.push({ date, value });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Year-over-year percent, matched to the same month a year earlier. */
export function yearOverYear(points: FredPoint[]): { date: string; rate: number }[] {
  const byMonth = new Map<number, number>();
  for (const p of points) {
    const idx = monthIndex(p.date);
    if (idx != null) byMonth.set(idx, p.value);
  }
  const out: { date: string; rate: number }[] = [];
  for (const p of points) {
    const idx = monthIndex(p.date);
    if (idx == null) continue;
    const prev = byMonth.get(idx - 12);
    if (prev == null || prev === 0) continue;
    out.push({ date: p.date, rate: ((p.value / prev) - 1) * 100 });
  }
  return out;
}

/** Change in the year-over-year rate versus `months` earlier. */
export function changeInRate(
  rates: { date: string; rate: number }[],
  months = 3,
): RatePoint[] {
  const byMonth = new Map<number, number>();
  for (const r of rates) {
    const idx = monthIndex(r.date);
    if (idx != null) byMonth.set(idx, r.rate);
  }
  const out: RatePoint[] = [];
  for (const r of rates) {
    const idx = monthIndex(r.date);
    if (idx == null) continue;
    const prev = byMonth.get(idx - months);
    if (prev == null) continue;
    out.push({ date: r.date, rate: r.rate, delta: r.rate - prev });
  }
  return out;
}

export function directionOf(delta: number): "accelerating" | "slowing" | "flat" {
  if (delta > 0) return "accelerating";
  if (delta < 0) return "slowing";
  return "flat";
}

/** Flat counts with accelerating. The sign rule has no third state. */
export function quadOf(growthDelta: number, inflationDelta: number): Quad {
  const growthUp = growthDelta >= 0;
  const inflationUp = inflationDelta >= 0;
  if (growthUp && !inflationUp) return 1;
  if (growthUp && inflationUp) return 2;
  if (!growthUp && inflationUp) return 3;
  return 4;
}

export function alignRegime(growth: RatePoint[], inflation: RatePoint[]) {
  const inflationByMonth = new Map<number, RatePoint>();
  for (const row of inflation) {
    const idx = monthIndex(row.date);
    if (idx != null) inflationByMonth.set(idx, row);
  }
  const path: { date: string; quad: Quad }[] = [];
  for (const g of growth) {
    const idx = monthIndex(g.date);
    if (idx == null) continue;
    const inf = inflationByMonth.get(idx);
    if (!inf) continue;
    path.push({ date: g.date, quad: quadOf(g.delta, inf.delta) });
  }
  const last = path.at(-1);
  if (!last) return null;
  const g = growth.find((row) => row.date === last.date);
  const inf = inflation.find((row) => row.date === last.date);
  if (!g || !inf) return null;
  return { date: last.date, growth: g, inflation: inf, quad: last.quad, path };
}

export function lastOfMonth(points: FredPoint[]): FredPoint[] {
  const by = new Map<number, FredPoint>();
  for (const p of points) {
    const idx = monthIndex(p.date);
    if (idx == null) continue;
    const prev = by.get(idx);
    if (!prev || p.date >= prev.date) {
      const month = String((idx % 12) + 1).padStart(2, "0");
      by.set(idx, { date: `${Math.floor(idx / 12)}-${month}-01`, value: p.value });
    }
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Monthly year-over-year change, then the three-month change in that rate.
 * `invert` flips the delta only, so a rising claims rate counts as slowing growth. */
export function legPath(points: FredPoint[], invert = false): RatePoint[] {
  const rows = changeInRate(yearOverYear(lastOfMonth(points)));
  if (!invert) return rows;
  return rows.map((row) => ({ ...row, delta: -row.delta }));
}

export type Basket = {
  up: number;
  n: number;
  median: number;
  direction: "accelerating" | "slowing" | "flat";
};

/** Accelerating when more than half the legs are. A tie uses the median delta. */
export function basketOf(deltas: number[]): Basket | null {
  if (!deltas.length) return null;
  const up = deltas.filter((d) => d > 0).length;
  const mid = median(deltas);
  const breadth = up / deltas.length;
  const direction: Basket["direction"] =
    breadth > 0.5 ? "accelerating" : breadth < 0.5 ? "slowing" : directionOf(mid);
  return { up, n: deltas.length, median: mid, direction };
}

function signOf(basket: Basket): number {
  return basket.direction === "slowing" ? -1 : 1;
}

function dateFromIndex(idx: number): string {
  const month = String((idx % 12) + 1).padStart(2, "0");
  return `${Math.floor(idx / 12)}-${month}-01`;
}

/** Quad path from two baskets. A month counts only when each side has at least three legs. */
export function basketRegime(growth: RatePoint[][], inflation: RatePoint[][]) {
  const index = (rows: RatePoint[]) => {
    const map = new Map<number, RatePoint>();
    for (const row of rows) {
      const idx = monthIndex(row.date);
      if (idx != null) map.set(idx, row);
    }
    return map;
  };
  const gMaps = growth.map(index);
  const iMaps = inflation.map(index);
  const months = new Set<number>();
  for (const map of [...gMaps, ...iMaps]) for (const idx of map.keys()) months.add(idx);
  const path: { date: string; quad: Quad }[] = [];
  let last: { date: string; quad: Quad; growth: Basket; inflation: Basket } | null = null;
  for (const idx of [...months].sort((a, b) => a - b)) {
    const gDeltas = gMaps.map((map) => map.get(idx)?.delta).filter((n): n is number => n != null);
    const iDeltas = iMaps.map((map) => map.get(idx)?.delta).filter((n): n is number => n != null);
    if (gDeltas.length < 3 || iDeltas.length < 3) continue;
    const g = basketOf(gDeltas);
    const inf = basketOf(iDeltas);
    if (!g || !inf) continue;
    const date = dateFromIndex(idx);
    const quad = quadOf(signOf(g), signOf(inf));
    path.push({ date, quad });
    last = { date, quad, growth: g, inflation: inf };
  }
  if (!last) return null;
  return { ...last, path };
}

export type LegVote = {
  id: string;
  label: string;
  side: "growth" | "inflation";
  delta: number;
};

export type RegimeFlip = {
  side: "growth" | "inflation";
  to: Quad;
  legs: { id: string; label: string; distance: number }[];
};

function quadFromVotes(legs: LegVote[]): Quad | null {
  const sign = (side: LegVote["side"]) => {
    const basket = basketOf(legs.filter((leg) => leg.side === side).map((leg) => leg.delta));
    if (!basket) return null;
    return basket.direction === "slowing" ? -1 : 1;
  };
  const growth = sign("growth");
  const inflation = sign("inflation");
  if (growth == null || inflation == null) return null;
  return quadOf(growth, inflation);
}

/** Cheapest set of legs on each side whose zero-cross changes the quad.
 * Distance is how far that leg's three-month change has to travel, in points. */
export function regimeFlips(legs: LegVote[]): RegimeFlip[] {
  const now = quadFromVotes(legs);
  if (now == null) return [];
  const flips: RegimeFlip[] = [];
  for (const side of ["growth", "inflation"] as const) {
    const mine = legs.filter((leg) => leg.side === side);
    let best: RegimeFlip | null = null;
    const n = mine.length;
    for (let mask = 1; mask < 2 ** n; mask += 1) {
      const chosen: LegVote[] = [];
      for (let i = 0; i < n; i += 1) if (mask & (2 ** i)) chosen.push(mine[i]!);
      const flipped = new Set(chosen.map((leg) => leg.id));
      const next = legs.map((leg) =>
        flipped.has(leg.id) ? { ...leg, delta: leg.delta > 0 ? -1e-9 : 1e-9 } : leg,
      );
      const to = quadFromVotes(next);
      if (to == null || to === now) continue;
      const row: RegimeFlip = {
        side,
        to,
        legs: chosen
          .map((leg) => ({ id: leg.id, label: leg.label, distance: Math.abs(leg.delta) }))
          .sort((a, b) => a.distance - b.distance),
      };
      const distance = row.legs.reduce((sum, leg) => sum + leg.distance, 0);
      const bestDistance = best ? best.legs.reduce((sum, leg) => sum + leg.distance, 0) : Infinity;
      if (!best || row.legs.length < best.legs.length || (row.legs.length === best.legs.length && distance < bestDistance)) {
        best = row;
      }
    }
    if (best) flips.push(best);
  }
  return flips.sort((a, b) => a.legs.length - b.legs.length || a.legs[0]!.distance - b.legs[0]!.distance);
}

