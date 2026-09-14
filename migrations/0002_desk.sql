-- Per-user Ripple Radar desk (watchlists, alerts, selected book, custom scenarios).
create table if not exists desk_state (
  user_id    text primary key,
  payload    text not null,
  updated_at timestamptz not null default now()
);
