import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { EvidenceItem } from "../../data/types.ts";
import {
  FRED_SERIES_V0,
  FRED_USER_AGENT,
  attachFredEvidence,
  fetchFredSeriesBundle,
  latestFredEvidence,
  loadFredMacro,
  mapFredObservationToEvidence,
  resetFredClientForTests,
  type FredObservation,
} from "./fred.server.ts";

const NOW = Date.parse("2024-09-21T12:00:00.000Z");
const CPI_EVENT = Date.parse("2024-08-01T00:00:00.000Z");
const CPI_VINTAGE = Date.parse("2024-09-11T00:00:00.000Z");

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFredFetch(opts?: {
  vintages?: Record<string, string[] | null>;
  obs?: Record<string, Array<Json> | null>;
  failSeries?: Set<string>;
  capture?: { urls: string[]; uas: string[] };
}) {
  const capture = opts?.capture ?? { urls: [], uas: [] };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    capture.urls.push(url);
    capture.uas.push(String((init?.headers as Record<string, string>)?.["User-Agent"] ?? ""));
    const parsed = new URL(url);
    const seriesId = parsed.searchParams.get("series_id") ?? "";
    if (opts?.failSeries?.has(seriesId)) {
      return jsonResponse({ error_code: 500 }, 500);
    }
    if (parsed.pathname.endsWith("/series/vintagedates")) {
      const dates = opts?.vintages?.[seriesId];
      if (dates === null) return jsonResponse({ error_message: "missing" }, 404);
      return jsonResponse({ vintage_dates: dates ?? ["2024-09-11"] });
    }
    if (parsed.pathname.endsWith("/series/observations")) {
      const rows = opts?.obs?.[seriesId];
      if (rows === null) return jsonResponse({ error_message: "missing" }, 404);
      return jsonResponse({
        observations: rows ?? [
          {
            date: "2024-08-01",
            value: "2.5",
            realtime_start: "2024-09-11",
            realtime_end: "9999-12-31",
          },
        ],
      });
    }
    return jsonResponse({ error: "unknown" }, 404);
  };
  return { fetchImpl, capture };
}

const defaultOpts = {
  apiKey: "test-key",
  nowMs: NOW,
  cacheTtlMs: 0,
  minGapMs: 0,
  seriesIds: ["CPIAUCSL"] as const,
};

beforeEach(() => {
  resetFredClientForTests();
});

afterEach(() => {
  resetFredClientForTests();
});

describe("fetchFredSeriesBundle", () => {
  it("returns empty and does not fetch when the key is missing", async () => {
    const { fetchImpl, capture } = mockFredFetch();
    const bundle = await fetchFredSeriesBundle({
      apiKey: "",
      fetchImpl,
      nowMs: NOW,
      cacheTtlMs: 0,
      minGapMs: 0,
    });
    assert.equal(bundle.status, "empty");
    assert.match(bundle.statusDetail, /FRED_API_KEY missing/);
    assert.equal(bundle.observations.length, 0);
    assert.deepEqual([...bundle.seriesIds], [...FRED_SERIES_V0]);
    assert.equal(capture.urls.length, 0);
  });

  it("reads FRED_API_KEY from env and still returns empty when unset", async () => {
    const prev = process.env.FRED_API_KEY;
    delete process.env.FRED_API_KEY;
    const { fetchImpl, capture } = mockFredFetch();
    try {
      const bundle = await fetchFredSeriesBundle({
        fetchImpl,
        nowMs: NOW,
        cacheTtlMs: 0,
        minGapMs: 0,
        seriesIds: ["UNRATE"],
      });
      assert.equal(bundle.status, "empty");
      assert.equal(bundle.observations.length, 0);
      assert.equal(capture.urls.length, 0);
    } finally {
      if (prev === undefined) delete process.env.FRED_API_KEY;
      else process.env.FRED_API_KEY = prev;
    }
  });

  it("stamps dual clocks from ALFRED realtime_start and always sets delayed", async () => {
    const { fetchImpl, capture } = mockFredFetch();
    const bundle = await fetchFredSeriesBundle({ ...defaultOpts, fetchImpl });
    assert.equal(bundle.status, "ok");
    assert.equal(bundle.observations.length, 1);
    const obs = bundle.observations[0]!;
    assert.equal(obs.seriesId, "CPIAUCSL");
    assert.equal(obs.value, 2.5);
    assert.equal(obs.eventTimeMs, CPI_EVENT);
    assert.equal(obs.availableTimeMs, CPI_VINTAGE);
    assert.equal(obs.delayed, true);
    assert.equal(obs.source, "FRED");
    assert.equal(obs.vintageRealtimeStart, "2024-09-11");
    assert.ok(obs.availableTimeMs >= obs.eventTimeMs);
    assert.ok(capture.urls.some((u) => u.includes("/fred/series/vintagedates")));
    assert.ok(capture.urls.some((u) => u.includes("/fred/series/observations")));
    assert.ok(capture.urls.every((u) => u.includes("file_type=json")));
    assert.ok(capture.urls.every((u) => u.includes("api_key=test-key")));
    assert.ok(capture.uas.every((ua) => ua === FRED_USER_AGENT));
    assert.ok(capture.uas.every((ua) => !/Chrome/i.test(ua)));
    assert.ok(capture.urls.some((u) => u.includes("realtime_start=2024-09-11")));
    assert.ok(capture.urls.some((u) => /sort_order=desc/.test(u) && /limit=24/.test(u)));
  });

  it("uses ingest watermark when vintage is missing and infers eventTime from availableTime", async () => {
    const { fetchImpl } = mockFredFetch({
      vintages: { CPIAUCSL: [] },
      obs: { CPIAUCSL: [{ date: "", value: "3.1", realtime_start: "" }] },
    });
    const bundle = await fetchFredSeriesBundle({ ...defaultOpts, fetchImpl });
    const obs = bundle.observations[0]!;
    assert.equal(obs.eventTimeMs, NOW);
    assert.equal(obs.availableTimeMs, NOW);
    assert.equal(obs.delayed, true);
    assert.equal(obs.vintageRealtimeStart, undefined);
  });

  it("skips missing '.' values and does not throw when a series 404s", async () => {
    const { fetchImpl } = mockFredFetch({
      vintages: { CPIAUCSL: ["2024-09-11"], UNRATE: null },
      obs: {
        CPIAUCSL: [
          { date: "2024-08-01", value: ".", realtime_start: "2024-09-11" },
          { date: "2024-07-01", value: "2.4", realtime_start: "2024-08-14" },
        ],
        UNRATE: null,
      },
    });
    const bundle = await fetchFredSeriesBundle({
      ...defaultOpts,
      seriesIds: ["CPIAUCSL", "UNRATE"],
      fetchImpl,
    });
    assert.equal(bundle.status, "degraded");
    assert.equal(bundle.observations.length, 1);
    assert.equal(bundle.observations[0]!.value, 2.4);
    assert.equal(bundle.observations[0]!.delayed, true);
  });

  it("loadFredMacro returns the same observations as the bundle", async () => {
    const { fetchImpl } = mockFredFetch();
    const rows = await loadFredMacro({ ...defaultOpts, fetchImpl });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.seriesId, "CPIAUCSL");
  });
});

describe("live-path EvidenceItem mapper", () => {
  const obs: FredObservation = {
    obsId: "fred:CPIAUCSL:2024-08-01:2024-09-11",
    seriesId: "CPIAUCSL",
    value: 2.5,
    eventTimeMs: CPI_EVENT,
    availableTimeMs: CPI_VINTAGE,
    delayed: true,
    vintageRealtimeStart: "2024-09-11",
    source: "FRED",
  };

  it("maps FRED rows to EvidenceItem with dual clocks, kind data, reliability A", () => {
    const item = mapFredObservationToEvidence(obs, (ms) => `t-${ms}`);
    assert.equal(item.source, "FRED");
    assert.equal(item.kind, "data");
    assert.equal(item.evidenceClass, "fundamental");
    assert.equal(item.reliability, "A");
    assert.equal(item.delayed, true);
    assert.equal(item.eventTimeMs, CPI_EVENT);
    assert.equal(item.availableTimeMs, CPI_VINTAGE);
    assert.ok((item.availableTimeMs ?? 0) >= (item.eventTimeMs ?? 0));
    assert.equal(item.headline, "CPIAUCSL: 2.5");
    assert.equal(item.time, `t-${CPI_VINTAGE}`);
  });

  it("latestFredEvidence keeps one print per series", () => {
    const later: FredObservation = {
      ...obs,
      obsId: "fred:CPIAUCSL:2024-07-01:2024-08-14",
      eventTimeMs: Date.parse("2024-07-01T00:00:00.000Z"),
    };
    const items = latestFredEvidence(
      {
        observations: [obs, later],
        seriesIds: ["CPIAUCSL"],
        fetchedAtMs: NOW,
        status: "ok",
        statusDetail: "ok",
      },
      () => "clock",
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]!.id, obs.obsId);
  });

  it("attachFredEvidence prepends FRED onto existing evidence and is a no-op when empty", () => {
    const news: EvidenceItem = {
      id: "h1",
      time: "09:00:00",
      source: "Reuters",
      evidenceClass: "narrative",
      kind: "news",
      headline: "Some tape item",
      delayed: false,
    };
    const fred = [mapFredObservationToEvidence(obs, () => "clock")];
    const merged = attachFredEvidence([news], fred);
    assert.equal(merged[0]!.source, "FRED");
    assert.equal(merged[1]!.id, "h1");
    assert.equal(merged[0]!.delayed, true);
    assert.deepEqual(attachFredEvidence([news], []), [news]);
  });
});
