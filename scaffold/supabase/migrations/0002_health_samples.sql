-- HealthKit / wearable import samples. Text id allows deterministic,
-- idempotent client keys from source + external_id.

create table if not exists public.health_samples (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  type text not null check (type in ('sleep', 'rhr', 'hrv', 'steps', 'workout')),
  date date not null,
  value jsonb not null default '{}',
  external_id text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, source, external_id)
);

alter table public.health_samples enable row level security;

create policy "own health samples" on public.health_samples
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists health_samples_updated_at on public.health_samples;
create trigger health_samples_updated_at before update on public.health_samples
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.health_samples to authenticated;
grant all on public.health_samples to service_role;

create index if not exists health_samples_user_type_date_idx
  on public.health_samples (user_id, type, date);
