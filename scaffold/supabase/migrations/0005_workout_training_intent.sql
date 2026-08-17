-- Durable one-session AI Coach deload marker. This is intentionally separate
-- from public.workouts so older clients keep receiving the exact v11 workout
-- row shape and ignore this table until they upgrade their sync allowlist.

create table if not exists public.workout_training_intents (
  id uuid primary key references public.workouts (id) on delete cascade,
  intent text not null check (intent = 'coach_deload'),
  plan_json text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Early local/staging runs of this unreleased migration created the intent
-- table before exact cross-device resume snapshots were added.
alter table public.workout_training_intents
  add column if not exists plan_json text;

alter table public.workout_training_intents enable row level security;

create policy "own workout training intents" on public.workout_training_intents
  for all using (
    exists (
      select 1 from public.workouts w
       where w.id = workout_training_intents.id and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workouts w
       where w.id = workout_training_intents.id and w.user_id = auth.uid()
    )
  );

-- A deload workout, its intent snapshot, and its sets are one causal sync
-- chain. Offline clients may push rows whose client updated_at predates a
-- peer's cursor, so every INSERT in that chain must become visible at the
-- server commit time (updates were already server-stamped).
drop trigger if exists workouts_updated_at on public.workouts;
create trigger workouts_updated_at
  before insert or update on public.workouts
  for each row execute function public.set_updated_at();

drop trigger if exists sets_updated_at on public.sets;
create trigger sets_updated_at
  before insert or update on public.sets
  for each row execute function public.set_updated_at();

drop trigger if exists workout_training_intents_updated_at on public.workout_training_intents;
create trigger workout_training_intents_updated_at
  before insert or update on public.workout_training_intents
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.workout_training_intents to authenticated;
grant all on public.workout_training_intents to service_role;

create index if not exists workout_training_intents_updated_idx
  on public.workout_training_intents (updated_at);
