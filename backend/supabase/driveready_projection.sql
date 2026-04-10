create table if not exists public.driveready_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  address_line text not null default '',
  notification_preferences jsonb not null default '{}'::jsonb,
  permission_states jsonb not null default '{}'::jsonb,
  selected_vehicle_id text,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.driveready_vehicle (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  registration_plate text not null,
  nickname text not null,
  make_model text not null,
  fuel_type text not null,
  mileage integer not null,
  mot_due_at date not null,
  tax_due_at date not null,
  insurance_due_at date not null,
  notes text not null default '',
  image_url text not null,
  dvla_ves jsonb,
  dvsa_mot jsonb
);

create table if not exists public.driveready_service_history (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  event_date date not null,
  title text not null,
  note text not null
);

create table if not exists public.driveready_document (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  title text not null,
  document_type text not null,
  uploaded_at timestamptz not null,
  expires_at date not null,
  source_type text not null,
  file_name text not null,
  file_key text,
  mime_type text
);

create table if not exists public.driveready_alert (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text,
  document_id text,
  zone_id text,
  alert_type text not null,
  title text not null,
  subtitle text not null,
  detail text not null,
  due_at date not null,
  lead_days integer not null,
  muted boolean not null default false,
  handled boolean not null default false
);

create table if not exists public.driveready_zone (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  route_label text not null,
  charge_amount_label text not null,
  compliance_status text not null,
  monitored boolean not null default true,
  source_name text not null,
  freshness_at timestamptz not null
);

create table if not exists public.driveready_trip_check (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  input_type text not null,
  destination_query text,
  saved_zone_id text,
  compliance_status text not null,
  charge_amount_label text not null,
  confidence_label text not null,
  freshness_at timestamptz not null,
  source_name text not null,
  parking_suggestions jsonb not null default '[]'::jsonb
);

create table if not exists public.driveready_scheduled_reminder (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  alert_id text not null,
  alert_title text not null,
  scheduled_for timestamptz not null,
  delivery_channel text not null,
  status text not null,
  reason text,
  freshness_at timestamptz not null,
  source_name text not null
);

create table if not exists public.driveready_push_device (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text not null,
  label text,
  created_at timestamptz not null,
  last_seen_at timestamptz not null
);

create table if not exists public.driveready_data_export (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  file_key text not null,
  file_name text not null,
  mime_type text not null,
  download_url text not null,
  source_name text not null
);

create table if not exists public.driveready_reminder_dispatch (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  reminder_id text not null,
  scheduled_for timestamptz not null,
  provider text not null,
  status text not null,
  delivered_at timestamptz,
  error text,
  provider_message_id text
);

alter table public.driveready_profile enable row level security;
alter table public.driveready_vehicle enable row level security;
alter table public.driveready_service_history enable row level security;
alter table public.driveready_document enable row level security;
alter table public.driveready_alert enable row level security;
alter table public.driveready_zone enable row level security;
alter table public.driveready_trip_check enable row level security;
alter table public.driveready_scheduled_reminder enable row level security;
alter table public.driveready_push_device enable row level security;
alter table public.driveready_data_export enable row level security;
alter table public.driveready_reminder_dispatch enable row level security;
