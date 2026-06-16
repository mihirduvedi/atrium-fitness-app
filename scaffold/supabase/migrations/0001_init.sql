-- Atrium schema, v1 (brief Part C).
-- Every user-scoped table: RLS from the first migration, client-generatable
-- UUID PKs, updated_at + deleted_at (soft deletes — sync needs tombstones).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  goal text not null check (goal in ('strength', 'muscle', 'fat_loss', 'general')),
  experience text not null check (experience in ('new', 'returning', 'intermediate', 'advanced')),
  equipment text[] not null default '{}',
  days_per_week int not null check (days_per_week between 1 and 7),
  units text not null default 'lb' check (units in ('lb', 'kg')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.profiles enable row level security;

create policy "own profile" on public.profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- exercises: text PK — catalog rows seeded from archetypes.json use their
-- catalog slug as id; user customs use a client-generated uuid string and set
-- owner_user_id. Catalog rows (owner_user_id null) are readable by everyone
-- and writable by no one.
-- ---------------------------------------------------------------------------

create table public.exercises (
  id text primary key,
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  pattern text not null,
  equipment text not null,
  level int not null default 1 check (level between 1 and 3),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.exercises enable row level security;

create policy "catalog readable, own customs full access" on public.exercises
  for select using (owner_user_id is null or owner_user_id = auth.uid());

create policy "insert own customs" on public.exercises
  for insert with check (owner_user_id = auth.uid());

create policy "update own customs" on public.exercises
  for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy "delete own customs" on public.exercises
  for delete using (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- programs / program_days / program_slots
-- ---------------------------------------------------------------------------

create table public.programs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  archetype_id text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  current_week int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.programs enable row level security;

create policy "own programs" on public.programs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.program_days (
  id uuid primary key,
  program_id uuid not null references public.programs (id) on delete cascade,
  day_index int not null,
  name text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.program_days enable row level security;

-- program_days/_slots carry no user_id; scope through the owning program.
create policy "own program days" on public.program_days
  for all using (
    exists (
      select 1 from public.programs p
      where p.id = program_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_id and p.user_id = auth.uid()
    )
  );

create table public.program_slots (
  id uuid primary key,
  program_day_id uuid not null references public.program_days (id) on delete cascade,
  slot_index int not null,
  pattern text not null,
  exercise_id text not null references public.exercises (id),
  scheme jsonb not null default '{}',
  rule text not null,
  rest_s int not null default 90,
  -- Per-slot progression state lives HERE (engine SlotState).
  state jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.program_slots enable row level security;

create policy "own program slots" on public.program_slots
  for all using (
    exists (
      select 1
      from public.program_days d
      join public.programs p on p.id = d.program_id
      where d.id = program_day_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.program_days d
      join public.programs p on p.id = d.program_id
      where d.id = program_day_id and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- workouts / sets
-- ---------------------------------------------------------------------------

create table public.workouts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  program_day_id uuid references public.program_days (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  readiness_at_start int check (readiness_at_start between 0 and 100),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.workouts enable row level security;

create policy "own workouts" on public.workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.sets (
  id uuid primary key,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id text not null references public.exercises (id),
  set_index int not null,
  weight numeric,
  reps int,
  is_warmup boolean not null default false,
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.sets enable row level security;

create policy "own sets" on public.sets
  for all using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- personal_records / subjective_tags / body_metrics
-- ---------------------------------------------------------------------------

create table public.personal_records (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id text not null references public.exercises (id),
  type text not null check (type in ('weight', 'reps_at_weight', 'e1rm', 'session_volume')),
  value numeric not null,
  workout_id uuid references public.workouts (id) on delete set null,
  achieved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.personal_records enable row level security;

create policy "own prs" on public.personal_records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.subjective_tags (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id uuid references public.workouts (id) on delete set null,
  date date not null,
  energy int check (energy between 1 and 5),
  mood int check (mood between 1 and 5),
  sleep_quality int check (sleep_quality between 1 and 5),
  soreness int check (soreness between 1 and 5),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.subjective_tags enable row level security;

create policy "own subjective tags" on public.subjective_tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.body_metrics (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  weight numeric,
  measurements jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.body_metrics enable row level security;

create policy "own body metrics" on public.body_metrics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- sync_cursors
-- ---------------------------------------------------------------------------

create table public.sync_cursors (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  last_pulled_at timestamptz not null default 'epoch',
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.sync_cursors enable row level security;

create policy "own cursors" on public.sync_cursors
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- updated_at triggers (server-side writes; client writes set updated_at
-- explicitly so LWW compares client timestamps)
-- ---------------------------------------------------------------------------

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger exercises_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();
create trigger programs_updated_at before update on public.programs
  for each row execute function public.set_updated_at();
create trigger program_days_updated_at before update on public.program_days
  for each row execute function public.set_updated_at();
create trigger program_slots_updated_at before update on public.program_slots
  for each row execute function public.set_updated_at();
create trigger workouts_updated_at before update on public.workouts
  for each row execute function public.set_updated_at();
create trigger sets_updated_at before update on public.sets
  for each row execute function public.set_updated_at();
create trigger personal_records_updated_at before update on public.personal_records
  for each row execute function public.set_updated_at();
create trigger subjective_tags_updated_at before update on public.subjective_tags
  for each row execute function public.set_updated_at();
create trigger body_metrics_updated_at before update on public.body_metrics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- grants: RLS does the row filtering; these are the table-level privileges
-- the API roles need at all. anon gets nothing — even anonymous sign-ins
-- carry the `authenticated` role.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Pull-query indexes: sync reads "rows for this user changed since cursor".
create index workouts_user_updated_idx on public.workouts (user_id, updated_at);
create index sets_workout_idx on public.sets (workout_id);
create index sets_updated_idx on public.sets (updated_at);
create index programs_user_idx on public.programs (user_id, updated_at);
create index program_days_program_idx on public.program_days (program_id);
create index program_slots_day_idx on public.program_slots (program_day_id);
create index prs_user_exercise_idx on public.personal_records (user_id, exercise_id);
create index subjective_tags_user_date_idx on public.subjective_tags (user_id, date);
create index body_metrics_user_date_idx on public.body_metrics (user_id, date);
