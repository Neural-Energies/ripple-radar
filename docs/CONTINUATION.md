# Continuation checklist

Where the "one trustworthy, integrated trader workflow" brief stands, and exactly
what is left. Newest state first. Every item names the file or command to start from.
The audit trail for each finding is `docs/AUDIT-LOG.md` (cycle 5) and the replies on PR #5/#6.

## Done on `main` (2026-09-30)

| Brief item | Commit | Where |
|---|---|---|
| A01–A15 audit fixes | see AUDIT-LOG cycle 5 | `ace/`, `src/lib/ace/`, `src/lib/live/forecast-ledger.server.ts` |
| A11 evidence: converged regime DFM, PCA drivers in real units | 4f3e968 | `ace/regime/mean_vs_variance.py`, `ace/factors/pca.py`, `artifacts/reports/` |
| B01 `/macro` bound to producers | 69234e9 | `scripts/generate-macro-state.mjs`, `src/components/macro/mirror.tsx` |
| B02 structured alerts, durable delivery | 8ebc5bc, fbf34a8 | `src/lib/live/alerts*.ts`, `webhook-send.server.ts`, `/api/alerts/run` |
| B03 per-account desk, versioned saves | 9b73570 | `src/lib/desk-*.ts` |
| B04 WP3 protocol, evidence run, fail-closed promotion | f43c9c1, 4f3e968 | `ace/regime/level_regime_validation.py`, `ace/MODEL-SCORECARD.md` §WP3 |
| B05 paid compute: access, quotas, cache identity | 82191c2 | `src/lib/engine/compute-access.server.ts` |
| Thesis → monitor → review, outcomes on /learning | 34d6f04, a0a40c9 | `src/lib/thesis.ts`, `src/routes/theses.tsx`, `src/routes/learning.tsx` |
| Daily brief, coming up (FRED release calendar) | f4e216b, 51c380f | `src/lib/brief.ts`, `src/lib/live/release-calendar*.ts` |
| Scenario confirmation / invalidation | 3faad0c | `src/routes/scenarios.tsx`, `src/components/engine-panels.tsx` |
| Futures and held-name quotes | 9ca5bb4 | `src/lib/live/symbols.ts`, `build.server.ts` `quotesFor` |
| Why this exposure | 43925b7 | `src/lib/live/discover.ts`, `src/routes/assets.$ticker.tsx` |
| Light mode | ecf86f7 | `src/lib/theme.ts`, `src/styles.css` |
| CI + pinned Python | d749fef | `.github/workflows/ci.yml`, `ace/constraints.txt` |
| Scheduled resolution, `/api/health` | c201f4e | `src/lib/live/jobs.server.ts` |
| Billing: Stripe checkout, portal, webhook → entitlements | 5095697 | `src/lib/billing/`, `migrations/0010_billing.sql` |

Checks at `5095697`: tsc clean; test:engine 362/362; test:app 75/75; pytest 471
(clean checkout + pinned venv: 467 passed, 4 skipped for the local GDELT cache);
build ok; 26/26 page routes 200.

## Left to do, in order

1. **Deploy settings.** None of this has been exercised against the deployed database yet:
   - `CRON_SECRET` in Vercel. The build registers two crons: `/api/alerts/run` every 5 minutes, which needs a plan that allows it, and `/api/ledger/resolve` hourly.
   - `OPERATOR_USER_IDS` and `XAI_API_KEY`, for the resolution judge.
   - `npm run db:migrate` against Neon, for 0008_alerts, 0009_compute_access and 0010_billing.
   - Point an uptime monitor at `/api/health`. It answers 503 when a job is stale or has never run.
2. **Stripe.** Create one recurring price and set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET`. Add a webhook endpoint at `https://<host>/api/billing/webhook` for these events: checkout.session.completed, customer.subscription.created/updated/deleted and charge.refunded. Enable the Customer Portal with cancellation and payment-method updates. Then run one live test-mode purchase, a cancel and a refund. With `stripe listen --forward-to`, the webhook can be replayed locally.
3. **FOMC dates** are not in FRED's release calendar. Add them from a source that publishes the schedule if the brief should show them.
4. **`test:scripts`**: 17 of 201 fail on main. They predate this work. Fix them, then add `npm run test:scripts` to CI.
5. **Phase 10, quad half.** Whether broader factors improve the quad classification is still untested. The WP3 run answered the regime half: no skill over climatology.

## Known properties, not defects

- `inflation.PC1` swings from −11.65 in June 2026 to +4.35 in July. It is a genuine broad June print across all 33 inflation series. The second-difference transform then makes the following month swing back, so one-month factor momentum on price domains is noisy by construction.
- NFCI cannot be a real-time WP3 target before 2011, when it was first published. The financial-conditions target is therefore VIX, which is never revised.
- In this sandbox, Node's `fetch` reaches FRED only with `NODE_USE_ENV_PROXY=1` (the agent proxy). Without it, `/macro` and the release calendar read "unavailable". This is not a code defect.
