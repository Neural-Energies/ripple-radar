/**
 * FRED + ALFRED delayed-macro client (live path, stamps only — no obs store).
 *
 * Vintage approach: for each series, GET `series/vintagedates` (`sort_order=desc`,
 * `limit=1`) for the latest ALFRED vintage, then GET `series/observations` with
 * `realtime_start` = `realtime_end` = that vintage (`sort_order=desc`, `limit=24`).
 * Observation `date` → eventTimeMs (period). Observation `realtime_start` →
 * availableTimeMs (when the print entered the info set). If vintagedates fail or
 * realtime_start is missing, fall back to current observations and stamp
 * availableTimeMs with the ingest watermark — never invent a historical
 * availableTime without an ALFRED vintage. `delayed` is always true (free/delayed
 * FRED policy). Missing key or fetch errors return an empty/degraded bundle;
 * callers must not throw the desk.
 */
import type { EvidenceItem } from "../../data/types.ts";
import { env } from "../env.server.ts";

export const FRED_SERIES_V0 = [
  "CPIAUCSL",
  "UNRATE",
  "VIXCLS",
  "DCOILWTICO",
  "T10Y2Y",
  "DGS10",
] as const;

export type FredSeriesId = (typeof FRED_SERIES_V0)[number];

export const FRED_API_BASE = "https://api.stlouisfed.org/fred/";
export const FRED_USER_AGENT =
  "Neural-Energies AlphaRecon (https://github.com/Neural-Energies/ripple-radar)";
export const FRED_CACHE_TTL_MS = 30 * 60 * 1000;
const FRED_MIN_GAP_MS = 500;
const OBS_LIMIT = 24;

export type FredObservation = {
  obsId: string;
  seriesId: string;
  value: number;
  eventTimeMs: number;
  availableTimeMs: number;
  delayed: true;
  vintageRealtimeStart?: string;
  source: "FRED";
};

export type FredBundleStatus = "ok" | "empty" | "degraded";

export type FredSeriesBundle = {
  observations: FredObservation[];
  seriesIds: readonly string[];
  fetchedAtMs: number;
  status: FredBundleStatus;
  statusDetail: string;
};

export type FredClientOpts = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  seriesIds?: readonly string[];
  cacheTtlMs?: number;
  minGapMs?: number;
};

type FredObsRaw = {
  date?: string;
  value?: string;
  realtime_start?: string;
  realtime_end?: string;
};

type CacheEntry = { at: number; bundle: FredSeriesBundle };

let bundleCache: CacheEntry | null = null;
let lastRequestAt = 0;

export function resetFredClientForTests() {
  bundleCache = null;
  lastRequestAt = 0;
}

export function emptyFredBundle(
  nowMs = Date.now(),
  detail = "FRED_API_KEY missing — macro series skipped.",
  seriesIds: readonly string[] = FRED_SERIES_V0,
): FredSeriesBundle {
  return {
    observations: [],
    seriesIds,
    fetchedAtMs: nowMs,
    status: "empty",
    statusDetail: detail,
  };
}

function resolveFredKey(explicit?: string): string | undefined {
  if (explicit !== undefined) {
    const trimmed = explicit.trim();
    return trimmed || undefined;
  }
  return env("FRED_API_KEY");
}

function utcDateMs(isoDate: string | undefined): number | undefined {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined;
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

function parseValue(raw: string | undefined): number | undefined {
  if (!raw || raw === ".") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function pacedFetch(
  url: string,
  opts: { fetchImpl: typeof fetch; nowMs: number; minGapMs: number },
): Promise<Response> {
  if (opts.minGapMs > 0) {
    const wait = lastRequestAt + opts.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt = Date.now();
  return opts.fetchImpl(url, {
    headers: {
      "User-Agent": FRED_USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
}

async function fredGetJson<T>(
  path: string,
  params: URLSearchParams,
  opts: { fetchImpl: typeof fetch; nowMs: number; minGapMs: number },
): Promise<T> {
  const url = `${FRED_API_BASE}${path}?${params.toString()}`;
  const res = await pacedFetch(url, opts);
  if (!res.ok) throw new Error(`FRED ${res.status} ${path}`);
  return (await res.json()) as T;
}

function stampObservation(
  seriesId: string,
  raw: FredObsRaw,
  ingestMs: number,
): FredObservation | null {
  const value = parseValue(raw.value);
  if (value === undefined) return null;
  const vintage = raw.realtime_start?.trim() || undefined;
  const vintageMs = utcDateMs(vintage);
  const availableTimeMs = vintageMs ?? ingestMs;
  const eventTimeMs = utcDateMs(raw.date) ?? availableTimeMs;
  const available = Math.max(availableTimeMs, eventTimeMs);
  return {
    obsId: `fred:${seriesId}:${raw.date ?? "inferred"}:${vintage ?? "ingest"}`,
    seriesId,
    value,
    eventTimeMs,
    availableTimeMs: available,
    delayed: true,
    vintageRealtimeStart: vintage,
    source: "FRED",
  };
}

async function latestVintageDate(
  seriesId: string,
  apiKey: string,
  opts: { fetchImpl: typeof fetch; nowMs: number; minGapMs: number },
): Promise<string | undefined> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "1",
  });
  try {
    const json = await fredGetJson<{ vintage_dates?: string[] }>("series/vintagedates", params, opts);
    const date = json.vintage_dates?.[0];
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  } catch {
    return undefined;
  }
}

async function fetchObservations(
  seriesId: string,
  apiKey: string,
  vintageDate: string | undefined,
  opts: { fetchImpl: typeof fetch; nowMs: number; minGapMs: number },
): Promise<FredObsRaw[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: String(OBS_LIMIT),
  });
  if (vintageDate) {
    params.set("realtime_start", vintageDate);
    params.set("realtime_end", vintageDate);
  }
  const json = await fredGetJson<{ observations?: FredObsRaw[] }>("series/observations", params, opts);
  return Array.isArray(json.observations) ? json.observations : [];
}

async function loadSeries(
  seriesId: string,
  apiKey: string,
  ingestMs: number,
  opts: { fetchImpl: typeof fetch; nowMs: number; minGapMs: number },
): Promise<FredObservation[]> {
  const vintage = await latestVintageDate(seriesId, apiKey, opts);
  let raw = await fetchObservations(seriesId, apiKey, vintage, opts);
  if (!raw.length && vintage) {
    raw = await fetchObservations(seriesId, apiKey, undefined, opts);
  }
  const rows: FredObservation[] = [];
  for (const obs of raw) {
    const stamped = stampObservation(seriesId, obs, ingestMs);
    if (stamped) rows.push(stamped);
  }
  return rows;
}

/**
 * Fetch the v0 desk macro bundle. Missing key → empty, no throw.
 * Optional in-memory cache (default 30m, allowed 15–60m).
 */
export async function fetchFredSeriesBundle(opts: FredClientOpts = {}): Promise<FredSeriesBundle> {
  const nowMs = opts.nowMs ?? Date.now();
  const seriesIds = opts.seriesIds ?? FRED_SERIES_V0;
  const apiKey = resolveFredKey(opts.apiKey);
  if (!apiKey) return emptyFredBundle(nowMs, undefined, seriesIds);

  const ttl = opts.cacheTtlMs ?? FRED_CACHE_TTL_MS;
  if (bundleCache && nowMs - bundleCache.at < ttl) return bundleCache.bundle;

  const fetchImpl = opts.fetchImpl ?? fetch;
  const minGapMs = opts.minGapMs ?? FRED_MIN_GAP_MS;
  const pace = { fetchImpl, nowMs, minGapMs };

  const observations: FredObservation[] = [];
  let loaded = 0;
  let failed = 0;
  for (const seriesId of seriesIds) {
    try {
      const rows = await loadSeries(seriesId, apiKey, nowMs, pace);
      if (rows.length) loaded += 1;
      else failed += 1;
      observations.push(...rows);
    } catch {
      failed += 1;
    }
  }

  let status: FredBundleStatus = "ok";
  let statusDetail = `FRED delayed macro · ${loaded}/${seriesIds.length} series.`;
  if (!observations.length) {
    status = "degraded";
    statusDetail = "FRED request failed — macro series skipped.";
  } else if (failed > 0) {
    status = "degraded";
    statusDetail = `FRED delayed macro · ${loaded}/${seriesIds.length} series (${failed} missing).`;
  }

  const bundle: FredSeriesBundle = {
    observations,
    seriesIds,
    fetchedAtMs: nowMs,
    status,
    statusDetail,
  };
  if (observations.length && ttl > 0) bundleCache = { at: nowMs, bundle };
  return bundle;
}

/** Observations-only helper used by the live desk wiring. */
export async function loadFredMacro(opts: FredClientOpts = {}): Promise<FredObservation[]> {
  const bundle = await fetchFredSeriesBundle(opts);
  return bundle.observations;
}

export function mapFredObservationToEvidence(
  obs: FredObservation,
  clock: (ms: number) => string,
): EvidenceItem {
  return {
    id: obs.obsId,
    time: clock(obs.availableTimeMs),
    source: "FRED",
    evidenceClass: "fundamental",
    kind: "data",
    headline: `${obs.seriesId}: ${obs.value}`,
    delayed: true,
    url: `https://fred.stlouisfed.org/series/${obs.seriesId}`,
    reliability: "A",
    strength: 3,
    eventTimeMs: obs.eventTimeMs,
    availableTimeMs: obs.availableTimeMs,
  };
}

/** Latest print per series — live trail, not the 24-row history. */
export function latestFredEvidence(
  bundle: FredSeriesBundle,
  clock: (ms: number) => string,
): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const obs of bundle.observations) {
    if (seen.has(obs.seriesId)) continue;
    seen.add(obs.seriesId);
    out.push(mapFredObservationToEvidence(obs, clock));
  }
  return out;
}

/** Prepend delayed FRED prints onto a book/event trail. No-op when FRED is empty. */
export function attachFredEvidence(base: EvidenceItem[], fred: EvidenceItem[]): EvidenceItem[] {
  if (!fred.length) return base;
  const seen = new Set(fred.map((item) => item.id));
  return [...fred, ...base.filter((item) => !seen.has(item.id))].slice(0, 18);
}
