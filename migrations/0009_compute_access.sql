-- Paid compute: who may use it, and how much (PR #5 B05).
--
-- Analyze and rescore call a paid model. They used to be reachable without
-- sign-in, rate-limited by one process-global timestamp (so one account's
-- request downgraded everyone's, and a second server instance had its own
-- clock), and nothing checked a subscription.
--
-- entitlements   one row per account with paid access. Written by whatever
--                grants a plan (an operator today; a billing webhook when one
--                exists). Access requires status active/trialing and an
--                unexpired period.
-- compute_quota  one row per (account, capability): the day's count and the
--                last call. A call is claimed by a single conditional upsert,
--                so the cooldown and the daily cap hold across instances.

create table if not exists entitlements (
  user_id            text primary key,
  plan               text not null,
  status             text not null,
  current_period_end timestamptz,
  source             text not null default 'manual',
  updated_at         timestamptz not null default now()
);

create table if not exists compute_quota (
  user_id    text not null,
  capability text not null,
  day        text not null,
  count      integer not null,
  last_at_ms bigint not null,
  primary key (user_id, capability)
);
