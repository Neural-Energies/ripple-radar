-- Billing (PR #5 B06 "buy, use and cancel the service").
--
-- A Stripe webhook writes `entitlements` (0009), which paidAccess already
-- reads. Checkout carries the account id, so the subscription and customer
-- map back to it.
--
-- billing_customers  account <-> Stripe customer, written at checkout.
-- billing_events     every webhook event id processed, so a replayed or
--                    retried delivery is applied once.
-- entitlements.source_event_at
--                    the Stripe `created` time of the event that last wrote
--                    the row; an older event arriving late does not
--                    overwrite a newer state.

create table if not exists billing_customers (
  user_id     text primary key,
  customer_id text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists billing_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now(),
  outcome     text not null
);

alter table entitlements add column if not exists source_event_at timestamptz;
