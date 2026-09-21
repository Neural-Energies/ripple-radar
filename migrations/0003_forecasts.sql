-- Freeze-at-T forecast ledger. Append-only: a rescore or resolution writes a
-- NEW row, never mutates a prior one -- past forecasts are never rewritten
-- after the fact, even when the book itself later changes.
create table if not exists forecast_snapshots (
  id              text primary key,
  event_id        text not null,
  event_title     text not null,
  as_of           timestamptz not null default now(),
  scenarios       text not null,   -- JSON: [{id, name, probability}], sums to ~100
  provenance      text not null,   -- 'heuristic' | 'llm_proposal' | 'unchanged'
  horizon_hours   integer not null default 72,
  created_at      timestamptz not null default now()
);
create index if not exists forecast_snapshots_event_idx
  on forecast_snapshots (event_id, as_of desc);

-- Resolutions point at a frozen snapshot; the snapshot row itself is never
-- edited. `resolved_scenario` is null when the judge found no scenario
-- conclusively occurred (a real, expected outcome -- not every forecast
-- resolves cleanly).
create table if not exists forecast_resolutions (
  id                text primary key,
  snapshot_id       text not null references forecast_snapshots(id),
  resolved_scenario text,
  method            text not null,   -- 'llm_judge' -- model-graded, not verified ground truth
  confidence        text,            -- ordinal judge confidence, never a probability
  rationale         text not null,
  resolved_at       timestamptz not null default now()
);
create unique index if not exists forecast_resolutions_snapshot_uidx
  on forecast_resolutions (snapshot_id);

-- Minimal durable headline archive so resolution (days later) has real text
-- to judge against -- the live RSS tape itself is a rolling window and does
-- not retain history. Only market-relevant headlines the desk already
-- surfaced are archived; this is not a general news store.
create table if not exists headline_archive (
  id         text primary key,
  title      text not null,
  source     text not null,
  published  timestamptz not null,
  archived_at timestamptz not null default now()
);
create index if not exists headline_archive_published_idx
  on headline_archive (published);

