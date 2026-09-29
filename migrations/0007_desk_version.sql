-- Versioned desk snapshots (PR #5 B03).
--
-- A save replaced the whole JSON blob unconditionally, so two devices that
-- started from the same snapshot erased each other's additions. Every save now
-- names the version it was based on and succeeds only if that is still the
-- stored version; a stale save is rejected with the current copy so the
-- client can merge. Existing rows start at 0, which is what a client that has
-- never seen a version sends.
alter table desk_state add column if not exists version integer not null default 0;
