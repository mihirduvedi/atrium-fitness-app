/**
 * On-device SQLite schema — mirrors supabase/migrations/0001_init.sql
 * (minus RLS, which has no meaning locally) plus the local-only
 * mutation_queue. SQLite is the source of truth on device; the server is a
 * replica (brief Part E). Progress photos stay local-only until private media
 * storage/backups are designed separately.
 *
 * Representation choices:
 * - uuids and timestamps are TEXT (ISO-8601, UTC) — lexicographic order ==
 *   chronological order, which the sync cursor relies on.
 * - booleans are INTEGER 0/1.
 * - jsonb columns are TEXT holding JSON.
 *
 * This module is pure SQL + types so vitest can apply it to node:sqlite.
 */

export const SCHEMA_VERSION = 12;

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
  description text,
  default_sets integer,
  default_reps integer,
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

-- Presence marks a workout as an AI Coach one-session deload. Keeping this
-- in a separate synced table preserves the schema-v11 workouts wire shape;
-- older clients ignore tables outside their hard-coded sync allowlist.
create table if not exists workout_training_intents (
  id text primary key references workouts (id),
  intent text not null check (intent = 'coach_deload'),
  plan_json text,
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

-- Local-only private media records. Image files live in the app document
-- directory and are intentionally not part of the generic sync table list.
create table if not exists progress_photos (
  id text primary key,
  user_id text not null,
  taken_at text not null,
  image_uri text not null,
  pose text not null default 'front',
  body_weight real,
  note text,
  tags text not null default '[]',
  created_at text not null,
  updated_at text not null,
  deleted_at text
);

-- Local-only in-progress workout UI state. Completed sets still live in the
-- synced sets table; this preserves draft inputs, queue order, active cursor,
-- and rest timer state across app restarts.
create table if not exists workout_drafts (
  workout_id text primary key references workouts (id),
  user_id text not null,
  program_day_id text,
  day_json text not null,
  plan_json text not null,
  set_ui_json text not null default '{}',
  active_index integer not null default 0,
  rest_remaining_s integer,
  rest_saved_at text,
  updated_at text not null,
  deleted_at text
);

-- Local-only template metadata for the program library. The synced
-- program_days row remains the source for name and active/inactive state.
create table if not exists program_day_settings (
  program_day_id text primary key references program_days (id),
  user_id text not null,
  active integer not null default 1,
  category text not null default 'other',
  notes text,
  repeat_every integer not null default 1,
  repeat_unit text not null default 'week',
  weekdays text not null default '[]',
  set_rest_s integer,
  exercise_rest_s integer,
  updated_at text not null,
  deleted_at text
);

-- Local-only metadata for the workout plan library. The synced programs row
-- remains the source for plan identity and active/inactive status.
create table if not exists workout_plan_settings (
  program_id text primary key references programs (id),
  user_id text not null,
  name text,
  goal text not null default 'general',
  notes text,
  updated_at text not null,
  deleted_at text
);

-- Local-only Coach conversations. These can contain sensitive training and
-- recovery discussion, so they do not enter the generic sync queue. The user
-- can permanently delete a thread and its messages from the Coach screen.
create table if not exists coach_threads (
  id text primary key,
  user_id text not null,
  title text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists coach_messages (
  id text primary key,
  thread_id text not null references coach_threads (id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  history_content text not null,
  reply_json text,
  evidence_json text not null default '[]',
  created_at text not null
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
create index if not exists workout_training_intents_updated_idx on workout_training_intents (updated_at);
create index if not exists program_days_program_idx on program_days (program_id);
create index if not exists program_slots_day_idx on program_slots (program_day_id);
create index if not exists health_samples_user_type_date_idx on health_samples (user_id, type, date);
create index if not exists progress_photos_user_taken_idx on progress_photos (user_id, taken_at);
create index if not exists workout_drafts_user_idx on workout_drafts (user_id, updated_at);
create index if not exists program_day_settings_user_idx on program_day_settings (user_id, category);
create index if not exists workout_plan_settings_user_idx on workout_plan_settings (user_id, goal);
create index if not exists coach_threads_user_updated_idx on coach_threads (user_id, updated_at desc);
create index if not exists coach_messages_thread_created_idx on coach_messages (thread_id, created_at);
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
  'workout_training_intents',
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
  /** Native Expo SQLite supplies an isolated connection for this callback. */
  withExclusiveTransactionAsync?(fn: (transaction: SqlDb) => Promise<void>): Promise<void>;
}

export type SqlParam = string | number | null;

const SYNC_CURSOR_EPOCH = '1970-01-01T00:00:00.000Z';
const WORKOUT_TRAINING_INTENTS_CURSOR_BACKFILL_KEY =
  'schema-v12-workout-training-intents-cursor-backfill';
const SERVER_PULL_CURSOR_BACKFILL_KEY =
  'server-authoritative-paginated-pull-cursor-v1';

async function ensureColumn(db: SqlDb, table: string, column: string, ddl: string): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`pragma table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`alter table ${table} add column ${ddl}`);
  }
}

/**
 * Early schema-v12 development builds stored this marker directly on
 * workouts. Convert those local rows and queued payloads before removing the
 * column so the public workout wire shape remains compatible with v11.
 */
async function migrateLegacyWorkoutTrainingIntent(db: SqlDb): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('pragma table_info(workouts)');
  if (!columns.some((column) => column.name === 'training_intent')) return;

  await db.withTransactionAsync(async () => {
    const deloads = await db.getAllAsync<{
      id: string;
      deleted_at: string | null;
    }>(
      `select id, deleted_at
         from workouts
        where training_intent = 'coach_deload'`,
    );
    for (const row of deloads) {
      const pendingSetMutations = await db.getAllAsync<{
        seq: number;
        id: string;
        entity_id: string;
        op: string;
        payload: string;
        created_at: string;
      }>(
        `select mq.seq, mq.id, mq.entity_id, mq.op, mq.payload, mq.created_at
           from mutation_queue mq
           join sets s on s.id = mq.entity_id
          where mq.entity = 'sets'
            and s.workout_id = ?
            and mq.pushed_at is null
          order by mq.seq`,
        row.id,
      );
      const migratedAt = new Date().toISOString();
      const payload = {
        id: row.id,
        intent: 'coach_deload',
        updated_at: migratedAt,
        deleted_at: row.deleted_at,
      };
      await db.runAsync(
        `insert into workout_training_intents (id, intent, updated_at, deleted_at)
         values (?, 'coach_deload', ?, ?)
         on conflict (id) do update set
           intent = excluded.intent,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`,
        row.id,
        migratedAt,
        row.deleted_at,
      );
      await db.runAsync(
        `update mutation_queue
            set op = ?, payload = ?, created_at = ?
          where entity = 'workout_training_intents'
            and entity_id = ?
            and pushed_at is null`,
        row.deleted_at ? 'delete' : 'upsert',
        JSON.stringify(payload),
        migratedAt,
        row.id,
      );
      const pendingIntentMutation = await db.getFirstAsync<{ seq: number }>(
        `select seq from mutation_queue
          where entity = 'workout_training_intents'
            and entity_id = ?
            and pushed_at is null
          order by seq desc
          limit 1`,
        row.id,
      );
      if (!pendingIntentMutation) {
        await db.runAsync(
          `insert or ignore into mutation_queue (
             id, entity, entity_id, op, payload, created_at
           ) values (?, 'workout_training_intents', ?, ?, ?, ?)`,
          `schema12-workout-intent-${row.id}`,
          row.id,
          row.deleted_at ? 'delete' : 'upsert',
          JSON.stringify(payload),
          migratedAt,
        );
      }

      // Preserve every pending set mutation byte-for-byte, but give it a new
      // sequence after the intent marker so sync cannot publish child sets
      // before peers can identify the workout as a Coach deload.
      for (const mutation of pendingSetMutations) {
        await db.runAsync(
          'delete from mutation_queue where seq = ? and pushed_at is null',
          mutation.seq,
        );
        await db.runAsync(
          `insert into mutation_queue (
             id, entity, entity_id, op, payload, created_at, pushed_at
           ) values (?, 'sets', ?, ?, ?, ?, null)`,
          mutation.id,
          mutation.entity_id,
          mutation.op,
          mutation.payload,
          mutation.created_at,
        );
      }
    }

    const queuedWorkouts = await db.getAllAsync<{ seq: number; payload: string }>(
      `select seq, payload from mutation_queue where entity = 'workouts'`,
    );
    for (const queued of queuedWorkouts) {
      try {
        const payload = JSON.parse(queued.payload) as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(payload, 'training_intent')) continue;
        delete payload.training_intent;
        await db.runAsync(
          'update mutation_queue set payload = ? where seq = ?',
          JSON.stringify(payload),
          queued.seq,
        );
      } catch {
        // A malformed queue payload will be surfaced by the normal sync path;
        // migration must not silently replace unrelated data.
      }
    }

    await db.execAsync('alter table workouts drop column training_intent');
  });
}

/**
 * Sync uses one cursor for every table. A v11 device can therefore have a
 * cursor newer than intent rows created before it learned about the v12 side
 * table. Rewind once so the next pull backfills those historical markers;
 * the local marker protects all later sync progress from another rewind.
 */
async function resetCursorForWorkoutTrainingIntentBackfill(db: SqlDb): Promise<void> {
  await db.withTransactionAsync(async () => {
    const marker = await db.getFirstAsync<{ value: string }>(
      'select value from device_meta where key = ?',
      WORKOUT_TRAINING_INTENTS_CURSOR_BACKFILL_KEY,
    );
    if (marker) return;

    const migratedAt = new Date().toISOString();
    await db.runAsync(
      'update sync_cursors set last_pulled_at = ?, updated_at = ?',
      SYNC_CURSOR_EPOCH,
      migratedAt,
    );
    await db.runAsync(
      'insert into device_meta (key, value) values (?, ?)',
      WORKOUT_TRAINING_INTENTS_CURSOR_BACKFILL_KEY,
      '1',
    );
  });
}

/**
 * Earlier clients could persist a device-clock cursor ahead of PostgreSQL and
 * used an unpaginated table read. Rewind once when the server-authoritative,
 * paginated pull contract lands so any rows skipped by either behavior are
 * deterministically backfilled.
 */
async function resetCursorForServerPullBackfill(db: SqlDb): Promise<void> {
  await db.withTransactionAsync(async () => {
    const marker = await db.getFirstAsync<{ value: string }>(
      'select value from device_meta where key = ?',
      SERVER_PULL_CURSOR_BACKFILL_KEY,
    );
    if (marker) return;

    const migratedAt = new Date().toISOString();
    await db.runAsync(
      'update sync_cursors set last_pulled_at = ?, updated_at = ?',
      SYNC_CURSOR_EPOCH,
      migratedAt,
    );
    await db.runAsync(
      'insert into device_meta (key, value) values (?, ?)',
      SERVER_PULL_CURSOR_BACKFILL_KEY,
      '1',
    );
  });
}

/** Apply the schema (idempotent) and stamp user_version. */
export async function migrate(db: SqlDb): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  await db.execAsync(SCHEMA_SQL);
  await ensureColumn(db, 'workout_training_intents', 'plan_json', 'plan_json text');
  await migrateLegacyWorkoutTrainingIntent(db);
  await resetCursorForWorkoutTrainingIntentBackfill(db);
  await resetCursorForServerPullBackfill(db);
  await ensureColumn(db, 'progress_photos', 'tags', "tags text not null default '[]'");
  await ensureColumn(db, 'exercises', 'description', 'description text');
  await ensureColumn(db, 'exercises', 'default_sets', 'default_sets integer');
  await ensureColumn(db, 'exercises', 'default_reps', 'default_reps integer');
  await ensureColumn(db, 'program_day_settings', 'active', 'active integer not null default 1');
  await ensureColumn(db, 'program_day_settings', 'set_rest_s', 'set_rest_s integer');
  await ensureColumn(db, 'program_day_settings', 'exercise_rest_s', 'exercise_rest_s integer');
  await ensureColumn(db, 'coach_messages', 'history_content', "history_content text not null default ''");
  if (current < 9) {
    await db.execAsync(`
      update program_day_settings
         set category = (
           select case
             when instr(lower(d.name), 'arm') > 0 or instr(lower(d.name), 'bicep') > 0 or instr(lower(d.name), 'tricep') > 0 then 'arms'
             when instr(lower(d.name), 'chest') > 0 or instr(lower(d.name), 'push') > 0 then 'chest'
             when instr(lower(d.name), 'back') > 0 or instr(lower(d.name), 'pull') > 0 then 'back'
             when instr(lower(d.name), 'upper') > 0 then 'upper'
             when instr(lower(d.name), 'lower') > 0 or instr(lower(d.name), 'leg') > 0 then 'lower'
             when instr(lower(d.name), 'free') > 0 then 'free'
             else 'other'
           end
             from program_days d
            where d.id = program_day_settings.program_day_id
         )
       where category = 'other'
         and deleted_at is null
         and exists (
           select 1
             from program_days d
            where d.id = program_day_settings.program_day_id
              and (
                instr(lower(d.name), 'arm') > 0 or instr(lower(d.name), 'bicep') > 0 or instr(lower(d.name), 'tricep') > 0 or
                instr(lower(d.name), 'chest') > 0 or instr(lower(d.name), 'push') > 0 or
                instr(lower(d.name), 'back') > 0 or instr(lower(d.name), 'pull') > 0 or
                instr(lower(d.name), 'upper') > 0 or instr(lower(d.name), 'lower') > 0 or
                instr(lower(d.name), 'leg') > 0 or instr(lower(d.name), 'free') > 0
              )
         );
    `);
  }
  if (current < SCHEMA_VERSION) {
    await db.execAsync(`pragma user_version = ${SCHEMA_VERSION}`);
  }
}
