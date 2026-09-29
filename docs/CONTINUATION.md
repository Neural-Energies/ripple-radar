# Continuation checklist

Where the "one trustworthy, integrated trader workflow" brief stands, and exactly
what is left. Newest state first. Every item names the file or command to start from.

## Done on `main` (2026-09-29)

| Brief item | Commit | Where |
|---|---|---|
| A01–A15 audit fixes | several (see PR #5 replies) | `ace/`, `src/lib/ace/`, `src/lib/live/forecast-ledger.server.ts` |
| B01 `/macro` bound to producers | 69234e9 | `scripts/generate-macro-state.mjs`, `src/lib/ace/macro-state*.ts`, `src/components/macro/mirror.tsx` |
| B03 per-account desk, versioned saves | 9b73570 | `src/lib/desk-*.ts`, `migrations/0007_desk_version.sql` |
| Connected research loop (thesis → monitor → review) | 34d6f04 | `src/lib/thesis.ts`, `src/components/thesis.tsx`, `src/routes/theses.tsx` |
| Daily brief | f4e216b | `src/lib/brief.ts`, `src/routes/brief.tsx`, Live Desk strip |
| B02 structured alerts, durable delivery | 8ebc5bc | `src/lib/live/alerts*.ts`, `migrations/0008_alerts.sql`, `/api/alerts/run` |
| B04 WP3 protocol + promotion evidence | f43c9c1 | `ace/regime/level_regime_validation.py`, `ace/regime/climatology.py`, `ace/registry/registry.py` |
| B05 paid-compute access, quotas, cache identity | 82191c2 | `src/lib/engine/compute-access.server.ts`, `analyze.server.ts`, `rescore.server.ts`, `migrations/0009_compute_access.sql` |

Checks at the last commit:
- `npx tsc --noEmit`: clean
- `npm run test:engine`: 332/332
- `npm run test:app`: 75/75
- `python3 -m pytest ace/tests`: 470 passed
- `npm run build`: ok

## Left to do, in order

1. **WP3 live evidence.** Run `python -m ace.regime.level_regime_validation` with `.env` loaded (it takes about 1–2 h, mostly DFM refits). Commit `artifacts/reports/macro_level_regime_validation.json` with `git add -f`. Update `ace/MODEL-SCORECARD.md` §WP3 with the confirmation verdicts and the manifest hash, then reply on PR #5 under B04.
2. **Deploy settings** (none are exercised yet against a deployed database):
   - `CRON_SECRET` in Vercel. The 5-minute cron in `vite.config.ts` needs a plan that allows it.
   - `OPERATOR_USER_IDS`.
   - Entitlement rows for design partners; the SQL is in `.env.example`.
   - Run `npm run db:migrate` against Neon for `0008_alerts.sql` and `0009_compute_access.sql`.
3. **Billing.** No payment provider exists. Add the checkout → webhook → `entitlements` upsert path (status, `current_period_end`), plus cancel, expiry and refund handling and webhook replay tests. `paidAccess()` already reads the table.
4. **Webhook SSRF hardening.** `checkWebhookUrl` refuses IP literals and internal names, but it does not resolve DNS. Resolve the host at send time and refuse private ranges.
5. **ES/NQ instruments (B06 P1).** `symbols.ts` and `DESK_TICKERS` omit ES and NQ, and `toYahoo('ES')` returns `'ES'`. Map ES=F/NQ=F, and label them as futures proxies with delay and roll conventions, in the quote, watchlist and alert paths.
6. **Thesis outcomes → ledger.** Reviewed theses (`Thesis.review`) are kept per account but are not yet summarised on `/learning` next to the model ledger.
7. **Phase 10 / task 29.** Whether broader factors improve the regime and quad models. The WP3 run above answers the DFM-vs-PCA half.
8. **Light mode** (B01 recommendation). Not started.

## Known properties, not defects

- `inflation.PC1` swings from −11.65 in June 2026 to +4.35 in July. It is a genuine broad June print across all 33 inflation series: PPI final demand z −4.8, intermediate PPI −3.9, CPI energy −3.3, headline CPI −3.2. The second-difference transform then makes the following month swing back. One-month factor momentum on price domains is therefore noisy by construction.
- NFCI cannot be a real-time WP3 target before 2011 (first publication), so the financial-conditions target is VIX (never revised).
