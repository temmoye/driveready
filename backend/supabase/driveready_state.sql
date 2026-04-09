create table if not exists public.driveready_state (
  state_key text primary key,
  state jsonb not null,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.driveready_state enable row level security;
