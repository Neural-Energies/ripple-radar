import type { FredPoint, Quad } from "./macro-regime.ts";

/** Claudia Sahm's published line: 0.50 on the real-time rule. */
export const SAHM_LINE = 0.5;

/** Chicago Fed: a three-month CFNAI average at or below this is a contraction signal. */
export const CFNAI_LINE = -0.7;

export type Trip = { start: string; end: string; peak: number };

/** Last run through the line. If one is still open, that run is the result. */
export function lastTrip(points: FredPoint[], line: number, above: boolean): Trip | null {
  let open: Trip | null = null;
  let closed: Trip | null = null;
  for (const point of points) {
    const hit = above ? point.value >= line : point.value <= line;
    if (!hit) {
      if (open) closed = open;
      open = null;
      continue;
    }
    if (!open) {
      open = { start: point.date, end: point.date, peak: point.value };
      continue;
    }
    open = {
      start: open.start,
      end: point.date,
      peak: above ? Math.max(open.peak, point.value) : Math.min(open.peak, point.value),
    };
  }
  return open ?? closed;
}

export function sahmStatus(points: FredPoint[]) {
  const last = points.at(-1);
  if (!last) return null;
  return {
    value: last.value,
    date: last.date,
    tripped: last.value >= SAHM_LINE,
    gap: SAHM_LINE - last.value,
    lastTrip: lastTrip(points, SAHM_LINE, true),
  };
}

export function cfnaiStatus(points: FredPoint[]) {
  const last = points.at(-1);
  if (!last) return null;
  return {
    value: last.value,
    date: last.date,
    tripped: last.value <= CFNAI_LINE,
    gap: last.value - CFNAI_LINE,
  };
}

/** St. Louis Fed: zero is average financial stress. */
export function stressStatus(points: FredPoint[]) {
  const last = points.at(-1);
  if (!last) return null;
  return { value: last.value, date: last.date, aboveAverage: last.value > 0 };
}

export function curveStatus(points: FredPoint[]) {
  const last = points.at(-1);
  if (!last) return null;
  let lastNegative: string | undefined;
  for (const point of points) if (point.value < 0) lastNegative = point.date;
  return {
    value: last.value,
    date: last.date,
    inverted: last.value < 0,
    ...(lastNegative ? { lastNegative } : {}),
  };
}

export function nberDuring(points: FredPoint[], start: string, end: string): boolean {
  return points.some((point) => point.date >= start && point.date <= end && point.value === 1);
}

export function quadTrack(path: { date: string; quad: Quad }[]) {
  const last = path.at(-1);
  if (!last) return null;
  let since = last.date;
  let months = 0;
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const row = path[i];
    if (!row || row.quad !== last.quad) break;
    since = row.date;
    months += 1;
  }
  const changes: { date: string; from: Quad; to: Quad }[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const row = path[i];
    if (!prev || !row || prev.quad === row.quad) continue;
    changes.push({ date: row.date, from: prev.quad, to: row.quad });
  }
  return { since, months, quad: last.quad, changes };
}
