/**
 * On-device SQLite schema — mirrors supabase/migrations/0001_init.sql
 * (minus RLS, which has no meaning locally) plus the local-only
 * mutation_queue. SQLite is the source of truth on device; the server is a
 * replica (brief Part E).
 *
 * Representation choices:
 * - uuids and timestamps are TEXT (ISO-8601, UTC) — lexicographic order ==
 *   chronological order, which the sync cursor relies on.
 * - booleans are INTEGER 0/1.
 * - jsonb columns are TEXT holding JSON.
 *
 * This module is pure SQL + types so vitest can apply it to node:sqlite.
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
create table if not exists profiles (
  user_id text primary key,
  goal text not null,
  experience text not null,
  equipment text not null default '[]',          -- json array
  days_per_week integer not null,
  units text not null default 'lb',
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

create table if not exists exercises (
  id text primary key,
  owner_user_id text,
  name text not null,
  pattern text not null,
  equipment text not null,
  level integer not null default 1,
  updated_at text not null,
  deleted_at text
);

create table if not exists programs (
  id text primary key,
  user_id text not null,
  archetype_id text not null,
  status text not null default 'active',
  started_at text not null,
  current_week integer not null default 1,
  updated_at text not null,
  deleted_at text
);

create table if not exists program_days (
  id text primary key,
  program_id text not null references programs (id),
  day_index integer not null,
  name text not null,
  updated_at text not null,
  deleted_at text
);

create table if not exists program_slots (
  id text primary key,
  program_day_id text not null references program_days (id),
  slot_index integer not null,
  pattern text not null,
  exercise_id text not null,
  scheme text not null default '{}',             -- json
  rule text not null,
  rest_s integer not null default 90,
  state text not null default '{}',              -- json: engine SlotState
  updated_at text not null,
  deleted_at text
);

create table if not exists workouts (
  id text primary key,
  user_id text not null,
  program_day_id text,
  started_at text not null,
  ended_at text,
  notes text,
  readiness_at_start integer,
  updated_at text not null,
  deleted_at text
);

create table if not exists sets (
  id text primary key,
  workout_id text not null references workouts (id),
  exercise_id text not null,
  set_index integer not null,
  weight real,
  reps integer,
  is_warmup integer not null default 0,
  completed_at text not null,
  updated_at text not null,
  deleted_at text
);

create table if not exists personal_records (
  id text primary key,
  user_id text not null,
  exercise_id text not null,
  type text not null,
  value real not null,
  workout_id text,
  achieved_at text not null,
  updated_at text not null,
  deleted_at text
);

create table if not exists subjective_tags (
  id text primary key,
  user_id text not null,
  workout_id text,
  date text not null,
  energy integer,
  mood integer,
  sleep_quality integer,
  soreness integer,
  updated_at text not null,
  deleted_at text
);

create table if not exists body_metrics (
  id text primary key,
  user_id text not null,
  date text not null,
  weight real,
  measurements text not null default '{}',       -- json
  updated_at text not null,
  deleted_at text
);

create table if not exists health_samples (
  id text primary key,
  user_id text not null,
  source text not null,
  type text not null,
  date text not null,
  value text not null default '{}',              -- json: { minutes | bpm | ms | count }
  external_id text not null,
  updated_at text not null,
  deleted_at text,
  unique (user_id, source, external_id)
);

create table if not exists sync_cursors (
  user_id text not null,
  device_id text not null,
  last_pulled_at text not null default '1970-01-01T00:00:00.000Z',
  updated_at text not null,
  primary key (user_id, device_id)
);

-- Local-only. Every local write appends here in the same transaction as the
-- entity upsert; the push task drains it in seq order (brief Part E).
create table if not exists mutation_queue (
  id text not null unique,
  seq integer primary key autoincrement,
  entity text not null,
  entity_id text not null,
  op text not null check (op in ('upsert', 'delete')),
  payload text not null,                         -- json: full row snapshot
  created_at text not null,
  pushed_at text
);

-- Local-only key/value (device_id, demo flags). Never synced.
create table if not exists device_meta (
  key text primary key,
  value text not null
);

create index if not exists sets_workout_idx on sets (workout_id);
create index if not exists sets_exercise_idx on sets (exercise_id, completed_at);
create index if not exists workouts_user_idx on workouts (user_id, started_at);
create index if not exists program_days_program_idx on program_days (program_id);
create index if not exists program_slots_day_idx on program_slots (program_day_id);
create index if not exists health_samples_user_type_date_idx on health_samples (user_id, type, date);
create index if not exists mutation_queue_unpushed_idx on mutation_queue (seq) where pushed_at is null;
`;

/** Tables that sync to Supabase, in dependency order (parents before children). */
export const SYNCED_TABLES = [
  'profiles',
  'exercises',
  'programs',
  'program_days',
  'program_slots',
  'workouts',
  'sets',
  'personal_records',
  'subjective_tags',
  'body_metrics',
  'health_samples',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * Minimal async database surface shared by expo-sqlite's SQLiteDatabase and
 * the node:sqlite adapter used in tests — keeps the DAO and sync layers
 * runtime-agnostic.
 */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlParam[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
}

export type SqlParam = string | number | null;

/** Apply the schema (idempotent) and stamp user_version. */
export async function migrate(db: SqlDb): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;
  await db.execAsync(SCHEMA_SQL);
  await db.execAsync(`pragma user_version = ${SCHEMA_VERSION}`);
}
