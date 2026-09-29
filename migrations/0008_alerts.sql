-- Durable alert evaluation and delivery (PR #5 B02).
--
-- Alerts used to be evaluated only inside an open browser tab and delivered as
-- a toast, so closing the tab stopped monitoring. Rules still live in each
-- account's desk (desk_state); a server pass now evaluates them against the
-- tape on a schedule and records every firing here.
--
-- alert_state      one row per (account, rule): whether its condition held at
--                  the last pass and since when. A firing is the transition
--                  into "satisfied", claimed with a conditional update so two
--                  overlapping passes cannot both fire it.
-- alert_deliveries one row per firing per channel. Unique on the episode, so a
--                  retried or duplicated pass cannot deliver twice.
-- alert_channels   optional off-app channel per account (an HTTPS webhook).
-- job_runs         when each background job last ran, for status display.

create table if not exists alert_state (
  user_id      text not null,
  rule_id      text not null,
  satisfied    boolean not null default false,
  since_ms     bigint,
  status       text not null,
  reason       text not null,
  value        double precision,
  evaluated_at timestamptz not null default now(),
  primary key (user_id, rule_id)
);

create table if not exists alert_deliveries (
  id              bigserial primary key,
  user_id         text not null,
  rule_id         text not null,
  episode         text not null,
  channel         text not null,
  title           text not null,
  reason          text not null,
  value           double precision,
  fired_at        timestamptz not null default now(),
  status          text not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  delivered_at    timestamptz,
  unique (user_id, rule_id, episode, channel)
);

create index if not exists alert_deliveries_user on alert_deliveries (user_id, fired_at desc);
create index if not exists alert_deliveries_due on alert_deliveries (channel, status, next_attempt_at);

create table if not exists alert_channels (
  user_id     text primary key,
  webhook_url text,
  updated_at  timestamptz not null default now()
);

create table if not exists job_runs (
  name        text primary key,
  last_run_at timestamptz not null,
  summary     text not null
);
