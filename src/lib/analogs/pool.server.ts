/**
 * Server-side historical analog lookup.
 *
 * The pool is ~4,000 daily states and stays on the server: the client receives
 * the twenty retrieved analogs and their outcome distribution, never the
 * history used to find them.
 *
 * The pool is a generated artifact with a stamped `generatedAt`. That staleness
 * is real and is reported rather than hidden — a 20-day momentum/volatility
 * state does not change intraday, but a reader deserves to know which day's
 * state they are being shown analogs for.
 */
import pool from "./pool.json";
import { retrieveAnalogs, type AnalogResult, type PoolRow } from "./retrieval";

interface PoolArtifact {
  generated_at: string;
  target_channel: string;
  channels: string[];
  features: string[];
  window_days: number;
  forward_days: number;
  k: number;
  method: string;
  rows: PoolRow[];
}

const artifact = pool as unknown as PoolArtifact;

export interface AnalogLookup extends AnalogResult {
  /** What the analogs describe — the forward return of this channel. */
  targetChannel: string;
  /** Channels whose momentum and volatility define the state. */
  channels: string[];
  windowDays: number;
  forwardDays: number;
  method: string;
  /** When the pool was built. Analogs are as fresh as this, and no fresher. */
  poolGeneratedAt: string;
  poolRows: number;
  poolEnd: string;
}

/**
 * Analogs for a given date, defaulting to the most recent state in the pool.
 *
 * Never throws: a missing or malformed pool returns `available: false` with a
 * reason, because "we cannot answer this" is a result the product is built to
 * display.
 */
export function analogsFor(asOf?: string): AnalogLookup {
  const rows = artifact.rows ?? [];
  const last = rows[rows.length - 1];
  const base = {
    targetChannel: artifact.target_channel,
    channels: artifact.channels ?? [],
    windowDays: artifact.window_days,
    forwardDays: artifact.forward_days,
    method: artifact.method,
    poolGeneratedAt: artifact.generated_at,
    poolRows: rows.length,
    poolEnd: last?.d ?? "",
  };
  if (!last) {
    return { ...base, available: false, reason: "analog pool is empty", analogs: [] };
  }
  try {
    const result = retrieveAnalogs(rows, asOf ?? last.d, {
      features: artifact.features,
      forwardDays: artifact.forward_days,
      k: artifact.k ?? 20,
    });
    return { ...base, ...result };
  } catch (err) {
    console.error("[analogs] retrieval failed:", err);
    return { ...base, available: false, reason: "retrieval failed", analogs: [] };
  }
}

/**
 * The features separating an analog from the query, in words.
 *
 * "Why is it similar" is the small share of the distance; "why is it different"
 * is the large share. Naming the feature and both values lets a reader check
 * the claim instead of taking the distance on faith.
 */
export function describeDrivers(hit: AnalogResult["analogs"][number]): string[] {
  return hit.drivers.map((d) => {
    const dir = d.analogValue > d.queryValue ? "higher" : "lower";
    return `${d.feature} ${dir} then (${d.analogValue.toFixed(4)} vs ${d.queryValue.toFixed(4)}) — ${Math.round(d.share * 100)}% of the gap`;
  });
}
