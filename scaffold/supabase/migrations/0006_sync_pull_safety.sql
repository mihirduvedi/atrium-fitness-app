-- Make incremental sync use database time, a stable upper barrier, complete
-- keyset pages, and an atomic parent+intent write for Coach deload starts.

-- The client must not advance its cursor using device time. A failed or
-- unavailable call is treated as a failed pull rather than falling back.
create or replace function public.sync_server_time()
returns timestamptz
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select statement_timestamp();
$$;

-- RLS is intentionally evaluated as the caller. The table name is accepted
-- only from the sync allowlist, and identifiers are quoted before execution.
-- Returning each row as jsonb keeps the generic mobile decoder table-agnostic.
create or replace function public.sync_pull_page(
  table_name text,
  since_time timestamptz,
  barrier_time timestamptz,
  after_updated_at timestamptz default null,
  after_pk text default null,
  page_size integer default 500
)
returns setof jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  pk_name text;
begin
  if table_name not in (
    'profiles',
    'exercises',
    'programs',
    'program_days',
    'program_slots',
    'workouts',
    'workout_training_intents',
    'sets',
    'personal_records',
    'subjective_tags',
    'body_metrics',
    'health_samples'
  ) then
    raise exception 'table is not sync-enabled' using errcode = '22023';
  end if;
  if since_time is null or barrier_time is null or since_time > barrier_time then
    raise exception 'invalid sync time range' using errcode = '22023';
  end if;
  if (after_updated_at is null) <> (after_pk is null) then
    raise exception 'incomplete keyset cursor' using errcode = '22023';
  end if;
  if page_size is null or page_size < 1 or page_size > 500 then
    raise exception 'page size must be between 1 and 500' using errcode = '22023';
  end if;

  pk_name := case when table_name = 'profiles' then 'user_id' else 'id' end;
  return query execute format(
    'select to_jsonb(t) as row_data
       from public.%I as t
      where t.updated_at > $1
        and t.updated_at <= $2
        and ($3 is null or (t.updated_at, t.%I::text) > ($3, $4))
      order by t.updated_at asc, t.%I::text asc
      limit $5',
    table_name,
    pk_name,
    pk_name
  ) using since_time, barrier_time, after_updated_at, after_pk, page_size;
end;
$$;

-- A deload workout and its exact-resume intent are one causal unit. PostgreSQL
-- executes the function call in one transaction, so an RLS/FK/check failure on
-- either upsert leaves neither half newly visible. Security invoker preserves
-- the existing table grants and RLS ownership policies.
create or replace function public.sync_upsert_coach_deload_workout(
  workout_row jsonb,
  intent_row jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  workout_id uuid;
begin
  if jsonb_typeof(workout_row) <> 'object' or jsonb_typeof(intent_row) <> 'object' then
    raise exception 'sync rows must be json objects' using errcode = '22023';
  end if;
  if workout_row->>'id' is null
     or workout_row->>'user_id' is null
     or workout_row->>'started_at' is null
     or intent_row->>'id' is null
     or intent_row->>'intent' is distinct from 'coach_deload'
     or workout_row->>'id' is distinct from intent_row->>'id' then
    raise exception 'invalid Coach deload pair' using errcode = '22023';
  end if;
  workout_id := (workout_row->>'id')::uuid;

  insert into public.workouts as target (
    id,
    user_id,
    program_day_id,
    started_at,
    ended_at,
    notes,
    readiness_at_start,
    updated_at,
    deleted_at
  ) values (
    workout_id,
    (workout_row->>'user_id')::uuid,
    nullif(workout_row->>'program_day_id', '')::uuid,
    (workout_row->>'started_at')::timestamptz,
    nullif(workout_row->>'ended_at', '')::timestamptz,
    workout_row->>'notes',
    nullif(workout_row->>'readiness_at_start', '')::integer,
    coalesce(nullif(workout_row->>'updated_at', '')::timestamptz, statement_timestamp()),
    nullif(workout_row->>'deleted_at', '')::timestamptz
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    program_day_id = excluded.program_day_id,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    notes = excluded.notes,
    readiness_at_start = excluded.readiness_at_start,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at;

  insert into public.workout_training_intents as target (
    id,
    intent,
    plan_json,
    updated_at,
    deleted_at
  ) values (
    workout_id,
    'coach_deload',
    intent_row->>'plan_json',
    coalesce(nullif(intent_row->>'updated_at', '')::timestamptz, statement_timestamp()),
    nullif(intent_row->>'deleted_at', '')::timestamptz
  )
  on conflict (id) do update set
    intent = excluded.intent,
    plan_json = excluded.plan_json,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at;
end;
$$;

revoke all on function public.sync_server_time() from public, anon;
revoke all on function public.sync_pull_page(text, timestamptz, timestamptz, timestamptz, text, integer)
  from public, anon;
revoke all on function public.sync_upsert_coach_deload_workout(jsonb, jsonb)
  from public, anon;

grant execute on function public.sync_server_time() to authenticated, service_role;
grant execute on function public.sync_pull_page(text, timestamptz, timestamptz, timestamptz, text, integer)
  to authenticated, service_role;
grant execute on function public.sync_upsert_coach_deload_workout(jsonb, jsonb)
  to authenticated, service_role;

-- Every sync-visible insert and update receives a database transaction timestamp.
-- This makes a prior pull barrier meaningful even when a queued offline row
-- carries a client timestamp far in the past or future.
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before insert or update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists exercises_updated_at on public.exercises;
create trigger exercises_updated_at before insert or update on public.exercises
  for each row execute function public.set_updated_at();

drop trigger if exists programs_updated_at on public.programs;
create trigger programs_updated_at before insert or update on public.programs
  for each row execute function public.set_updated_at();

drop trigger if exists program_days_updated_at on public.program_days;
create trigger program_days_updated_at before insert or update on public.program_days
  for each row execute function public.set_updated_at();

drop trigger if exists program_slots_updated_at on public.program_slots;
create trigger program_slots_updated_at before insert or update on public.program_slots
  for each row execute function public.set_updated_at();

drop trigger if exists workouts_updated_at on public.workouts;
create trigger workouts_updated_at before insert or update on public.workouts
  for each row execute function public.set_updated_at();

drop trigger if exists workout_training_intents_updated_at on public.workout_training_intents;
create trigger workout_training_intents_updated_at before insert or update on public.workout_training_intents
  for each row execute function public.set_updated_at();

drop trigger if exists sets_updated_at on public.sets;
create trigger sets_updated_at before insert or update on public.sets
  for each row execute function public.set_updated_at();

drop trigger if exists personal_records_updated_at on public.personal_records;
create trigger personal_records_updated_at before insert or update on public.personal_records
  for each row execute function public.set_updated_at();

drop trigger if exists subjective_tags_updated_at on public.subjective_tags;
create trigger subjective_tags_updated_at before insert or update on public.subjective_tags
  for each row execute function public.set_updated_at();

drop trigger if exists body_metrics_updated_at on public.body_metrics;
create trigger body_metrics_updated_at before insert or update on public.body_metrics
  for each row execute function public.set_updated_at();

drop trigger if exists health_samples_updated_at on public.health_samples;
create trigger health_samples_updated_at before insert or update on public.health_samples
  for each row execute function public.set_updated_at();

-- Match the generic keyset order, including large batches whose rows receive
-- an identical transaction timestamp.
create index if not exists profiles_sync_keyset_idx
  on public.profiles (updated_at, (user_id::text));
create index if not exists exercises_sync_keyset_idx
  on public.exercises (updated_at, (id::text));
create index if not exists programs_sync_keyset_idx
  on public.programs (updated_at, (id::text));
create index if not exists program_days_sync_keyset_idx
  on public.program_days (updated_at, (id::text));
create index if not exists program_slots_sync_keyset_idx
  on public.program_slots (updated_at, (id::text));
create index if not exists workouts_sync_keyset_idx
  on public.workouts (updated_at, (id::text));
create index if not exists workout_training_intents_sync_keyset_idx
  on public.workout_training_intents (updated_at, (id::text));
create index if not exists sets_sync_keyset_idx
  on public.sets (updated_at, (id::text));
create index if not exists personal_records_sync_keyset_idx
  on public.personal_records (updated_at, (id::text));
create index if not exists subjective_tags_sync_keyset_idx
  on public.subjective_tags (updated_at, (id::text));
create index if not exists body_metrics_sync_keyset_idx
  on public.body_metrics (updated_at, (id::text));
create index if not exists health_samples_sync_keyset_idx
  on public.health_samples (updated_at, (id::text));
