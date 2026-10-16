-- Durable tape for the morning briefing.
--
-- RSS is a rolling window. Sentiment over today / 3 day / 5 day needs the
-- headlines that were actually ingested, kept here with the score that was
-- assigned at the time. Rows older than 90 days are deleted by the recorder.

create table if not exists tape_headlines (
  id          text primary key,
  title       text not null,
  source      text not null,
  url         text not null default '',
  published   timestamptz not null,
  stored_at   timestamptz not null default now()
);

create index if not exists tape_headlines_published_idx
  on tape_headlines (published desc);

create table if not exists tape_scores (
  headline_id text not null references tape_headlines(id) on delete cascade,
  method      text not null,
  sentiment   double precision,
  bots        text not null,
  scored_at   timestamptz not null default now(),
  primary key (headline_id, method)
);

-- Point-in-time bot scores, written at most every 15 minutes while the tape
-- is being recorded. The live windows are recomputed from tape_scores; this
-- table is the record of what the bots said.
create table if not exists bot_snapshots (
  id        bigserial primary key,
  taken_at  timestamptz not null default now(),
  payload   text not null
);

create index if not exists bot_snapshots_taken_idx
  on bot_snapshots (taken_at desc);
