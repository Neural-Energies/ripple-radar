# Feed inventory

Live desk sources. Ingest stamps only — **no observation append store** and no `buildDeskAsOf` product path.

| Source | Module | Gate | Dual clocks | Notes |
|---|---|---|---|---|
| RSS world tape | `src/lib/live/build.server.ts` | none | publish time on headlines | Existing |
| Yahoo spark quotes | `src/lib/live/build.server.ts` | none | quote `asOf` | Existing |
| FRED + ALFRED | `src/lib/live/fred.server.ts` | `FRED_API_KEY` | `eventTimeMs` = observation date; `availableTimeMs` = ALFRED `realtime_start` (else ingest watermark); `delayed: true` always | Adapter landed. Soft-fail when key absent. v0 series: CPIAUCSL, UNRATE, VIXCLS, DCOILWTICO, T10Y2Y, DGS10. No Treasury / EIA / EDGAR / BLS. |

Missing `FRED_API_KEY` returns an empty bundle; `buildDesk()` still completes on RSS + Yahoo.
