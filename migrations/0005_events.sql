-- Canonical event registry.
--
-- Before this, events existed only for the lifetime of one request: they were
-- rebuilt from the rolling RSS window each poll and their ids were hashes of
-- their newest headline, so a developing story changed identity every time a
-- wire item landed. `buildDesk` looks up the prior forecast by event id and
-- skips the Bayesian update when it misses -- which, for any story that was
-- actually developing, was always. The forecast ledger, the posterior update
-- and calibration were all written and all unreachable.
--
-- An event's id is assigned once here and never recomputed from content.

create table if not exists events (
  id              text primary key,
  -- Structural signature of entities + most-specific tokens. Indexed for the
  -- exact-match path; drift is handled by similarity, not by this column.
  fingerprint     text not null,
  title           text not null,
  entities        text not null default '[]',   -- JSON array
  tokens          text not null default '[]',   -- JSON array
  tags            text not null default '[]',   -- JSON array
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  -- Counters, so "3 new items since your last look" is a fact and not a guess.
  headline_count  integer not null default 0,
  observation_count integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists events_fingerprint_idx on events (fingerprint);
create index if not exists events_last_seen_idx on events (last_seen desc);

-- One row per (event, headline). This is the provenance trail: which evidence
-- attached to which event, when it entered the info-set, and HOW it was
-- attached -- an exact structural match, a similarity match with its score, or
-- the item that opened a brand-new event. A relationship asserted by the
-- matcher is recorded as such and never presented as an observed fact.
create table if not exists event_evidence (
  event_id        text not null references events(id) on delete cascade,
  headline_id     text not null,
  title           text not null,
  source          text not null,
  url             text not null default '',
  published       timestamptz not null,
  available_at    timestamptz not null,
  attach_method   text not null,                -- 'fingerprint' | 'similarity' | 'new'
  attach_score    double precision not null default 0,
  matched_on      text not null default '[]',   -- JSON array of the entities that drove it
  attached_at     timestamptz not null default now(),
  primary key (event_id, headline_id)
);
create index if not exists event_evidence_event_idx on event_evidence (event_id, published desc);

-- Every poll in which an event was seen. Distinct from event_evidence: an
-- event can be re-observed with no new headline, and the difference between
-- "still running, nothing new" and "three new items" is exactly what a
-- probability-change alert has to be built on.
create table if not exists event_observations (
  id              text primary key,
  event_id        text not null references events(id) on delete cascade,
  observed_at     timestamptz not null default now(),
  method          text not null,
  score           double precision not null default 0,
  new_headlines   integer not null default 0,
  title           text not null
);
create index if not exists event_observations_event_idx
  on event_observations (event_id, observed_at desc);
