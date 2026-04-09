create table if not exists public.driveready_user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.driveready_user_state enable row level security;
