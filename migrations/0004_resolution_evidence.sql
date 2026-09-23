-- Resolution needs evidence ABOUT THE BOOK BEING GRADED.
--
-- The archive stored only (id, title, source, published), so the resolution
-- pass had nothing to filter on and handed the judge the earliest 15 headlines
-- published globally after the freeze -- typically about unrelated events. The
-- judge is instructed to answer inconclusive rather than guess, so it did,
-- every time, and calibration could never fill.
--
-- `event_ids` is the desk's own cluster match for the headline, as a JSON
-- array of text. It is nullable because rows archived before this migration
-- have no linkage to recover.
alter table headline_archive add column if not exists event_ids text;

create index if not exists headline_archive_event_idx
  on headline_archive (published desc);
