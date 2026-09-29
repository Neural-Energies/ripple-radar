-- Grade a forecast at its own horizon, and keep what it was graded on.
--
-- The resolution pass used `horizon_hours` only to decide when grading could
-- START; the evidence was every matched headline after the freeze, with no
-- upper bound, so a 24h book graded on day 10 was scored against day-9 news
-- (PR #5 A02). The pass now bounds evidence to (as_of, as_of + horizon] and
-- records that cutoff and the headline ids it used.
--
-- Rows written before this migration have `deadline` null. They were graded
-- without a cutoff, and calibration no longer counts them; they stay in the
-- table because the ledger is append-only.
alter table forecast_resolutions add column if not exists deadline timestamptz;
alter table forecast_resolutions add column if not exists evidence text;  -- JSON: [{id, publishedMs}]
