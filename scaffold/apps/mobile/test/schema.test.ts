import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate, SYNCED_TABLES } from '../src/db/schema';
import { openNodeDb } from './helpers/nodeDb';

describe('on-device SQLite schema', () => {
  it('server-stamps every insert in the deload workout sync chain', () => {
    const sql = readFileSync(
      resolve(process.cwd(), '../../supabase/migrations/0005_workout_training_intent.sql'),
      'utf8',
    );
    for (const trigger of ['workouts_updated_at', 'sets_updated_at', 'workout_training_intents_updated_at']) {
      expect(sql).toMatch(new RegExp(`create trigger ${trigger}\\s+before insert or update`, 'i'));
    }
  });

  it('defines the server-authoritative paginated sync contract for every synced table', () => {
    const sql = readFileSync(
      resolve(process.cwd(), '../../supabase/migrations/0006_sync_pull_safety.sql'),
      'utf8',
    );
    for (const rpc of [
      'sync_server_time',
      'sync_pull_page',
      'sync_upsert_coach_deload_workout',
    ]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${rpc}\\(`, 'i'));
    }
    for (const table of SYNCED_TABLES) {
      expect(sql).toMatch(new RegExp(
        `create trigger ${table}_updated_at\\s+before insert or update on public\\.${table}`,
        'i',
      ));
    }
    expect(sql).toMatch(/security invoker/gi);
    expect(sql).toMatch(/page size must be between 1 and 500/i);
  });

  it('applies cleanly and is idempotent', async () => {
    const db = openNodeDb();
    await migrate(db);
    await migrate(db); // second run is a no-op

    const tables = await db.getAllAsync<{ name: string }>(
      "select name from sqlite_master where type = 'table' order by name",
    );
    const names = tables.map((t) => t.name);
    for (const t of SYNCED_TABLES) expect(names).toContain(t);
    expect(names).toContain('progress_photos');
    expect(names).toContain('workout_drafts');
    expect(names).toContain('program_day_settings');
    expect(names).toContain('workout_plan_settings');
    expect(names).toContain('coach_threads');
    expect(names).toContain('coach_messages');
    expect(names).toContain('mutation_queue');
    expect(names).toContain('sync_cursors');
    db.close();
  });

  it('mirrors every synced Supabase table column-for-column (Part C)', async () => {
    const db = openNodeDb();
    await migrate(db);
    const cols = async (table: string) =>
      (await db.getAllAsync<{ name: string }>(`pragma table_info(${table})`)).map((c) => c.name);

    expect(await cols('workouts')).toEqual([
      'id', 'user_id', 'program_day_id', 'started_at', 'ended_at', 'notes',
      'readiness_at_start', 'updated_at', 'deleted_at',
    ]);
    expect(await cols('workout_training_intents')).toEqual([
      'id', 'intent', 'plan_json', 'updated_at', 'deleted_at',
    ]);
    expect(await cols('sets')).toEqual([
      'id', 'workout_id', 'exercise_id', 'set_index', 'weight', 'reps',
      'is_warmup', 'completed_at', 'updated_at', 'deleted_at',
    ]);
    expect(await cols('program_slots')).toEqual([
      'id', 'program_day_id', 'slot_index', 'pattern', 'exercise_id',
      'scheme', 'rule', 'rest_s', 'state', 'updated_at', 'deleted_at',
    ]);
    expect(await cols('exercises')).toEqual([
      'id', 'owner_user_id', 'name', 'pattern', 'equipment', 'level',
      'description', 'default_sets', 'default_reps', 'updated_at', 'deleted_at',
    ]);
    expect(await cols('health_samples')).toEqual([
      'id', 'user_id', 'source', 'type', 'date', 'value', 'external_id',
      'updated_at', 'deleted_at',
    ]);
    expect(await cols('progress_photos')).toEqual([
      'id', 'user_id', 'taken_at', 'image_uri', 'pose', 'body_weight',
      'note', 'tags', 'created_at', 'updated_at', 'deleted_at',
    ]);
    expect(await cols('program_day_settings')).toEqual([
      'program_day_id', 'user_id', 'active', 'category', 'notes',
      'repeat_every', 'repeat_unit', 'weekdays', 'set_rest_s',
      'exercise_rest_s', 'updated_at', 'deleted_at',
    ]);
    expect(await cols('workout_plan_settings')).toEqual([
      'program_id', 'user_id', 'name', 'goal', 'notes', 'updated_at', 'deleted_at',
    ]);
    expect(SYNCED_TABLES).not.toContain('progress_photos' as never);
    expect(SYNCED_TABLES).not.toContain('program_day_settings' as never);
    expect(SYNCED_TABLES).not.toContain('workout_plan_settings' as never);
    expect(SYNCED_TABLES).not.toContain('coach_threads' as never);
    expect(SYNCED_TABLES).not.toContain('coach_messages' as never);
    expect(SYNCED_TABLES.indexOf('workouts')).toBeLessThan(SYNCED_TABLES.indexOf('workout_training_intents'));
    expect(SYNCED_TABLES.indexOf('workout_training_intents')).toBeLessThan(SYNCED_TABLES.indexOf('sets'));
    // every synced table carries updated_at + deleted_at (tombstones for sync)
    for (const t of SYNCED_TABLES) {
      const c = await cols(t);
      expect(c, t).toContain('updated_at');
      expect(c, t).toContain('deleted_at');
    }
    db.close();
  });

  it('migrates v3 progress photo rows to include tags', async () => {
    const db = openNodeDb();
    await db.execAsync(`
      create table progress_photos (
        id text primary key,
        user_id text not null,
        taken_at text not null,
        image_uri text not null,
        pose text not null default 'front',
        body_weight real,
        note text,
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
      insert into progress_photos (
        id, user_id, taken_at, image_uri, pose, body_weight, note, created_at, updated_at, deleted_at
      ) values (
        'p1', 'u1', '2026-06-01T12:00:00.000Z', 'file:///p1.jpg', 'front', 180, 'old',
        '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z', null
      );
      pragma user_version = 3;
    `);

    await migrate(db);
    const cols = (await db.getAllAsync<{ name: string }>('pragma table_info(progress_photos)')).map((c) => c.name);
    const row = await db.getFirstAsync<{ tags: string }>('select tags from progress_photos where id = ?', 'p1');
    expect(cols).toContain('tags');
    expect(row?.tags).toBe('[]');
    db.close();
  });

  it('migrates older exercise rows to include custom movement metadata', async () => {
    const db = openNodeDb();
    await db.execAsync(`
      create table exercises (
        id text primary key,
        owner_user_id text,
        name text not null,
        pattern text not null,
        equipment text not null,
        level integer not null default 1,
        updated_at text not null,
        deleted_at text
      );
      insert into exercises (id, owner_user_id, name, pattern, equipment, level, updated_at, deleted_at)
      values ('x1', 'u1', 'Custom Press', 'hpress', 'dumbbell', 1, '2026-06-01T12:00:00.000Z', null);
      pragma user_version = 4;
    `);

    await migrate(db);
    const cols = (await db.getAllAsync<{ name: string }>('pragma table_info(exercises)')).map((c) => c.name);
    const row = await db.getFirstAsync<{ default_sets: number | null; default_reps: number | null }>(
      'select default_sets, default_reps from exercises where id = ?',
      'x1',
    );
    expect(cols).toContain('description');
    expect(cols).toContain('default_sets');
    expect(cols).toContain('default_reps');
    expect(row).toMatchObject({ default_sets: null, default_reps: null });
    db.close();
  });

  it('migrates older databases to include program day settings', async () => {
    const db = openNodeDb();
    await db.execAsync('pragma user_version = 6');

    await migrate(db);
    const cols = (await db.getAllAsync<{ name: string }>('pragma table_info(program_day_settings)')).map((c) => c.name);
    expect(cols).toContain('active');
    expect(cols).toContain('set_rest_s');
    expect(cols).toContain('exercise_rest_s');
    expect(cols).toContain('weekdays');
    db.close();
  });

  it('repairs current-version databases that are missing newer local columns', async () => {
    const db = openNodeDb();
    await db.execAsync(`
      create table program_day_settings (
        program_day_id text primary key,
        user_id text not null,
        category text not null default 'other',
        notes text,
        repeat_every integer not null default 1,
        repeat_unit text not null default 'week',
        weekdays text not null default '[]',
        updated_at text not null,
        deleted_at text
      );
      pragma user_version = 8;
    `);

    await migrate(db);
    const cols = (await db.getAllAsync<{ name: string }>('pragma table_info(program_day_settings)')).map((c) => c.name);
    expect(cols).toContain('active');
    expect(cols).toContain('set_rest_s');
    expect(cols).toContain('exercise_rest_s');
    const tables = (await db.getAllAsync<{ name: string }>("select name from sqlite_master where type = 'table'")).map((t) => t.name);
    expect(tables).toContain('workout_plan_settings');
    db.close();
  });

  it('repairs an interrupted Coach history upgrade without exposing old messages to model history', async () => {
    const db = openNodeDb();
    await db.execAsync(`
      create table coach_threads (
        id text primary key,
        user_id text not null,
        title text not null,
        created_at text not null,
        updated_at text not null
      );
      create table coach_messages (
        id text primary key,
        thread_id text not null references coach_threads (id) on delete cascade,
        user_id text not null,
        role text not null check (role in ('user', 'assistant')),
        content text not null,
        reply_json text,
        evidence_json text not null default '[]',
        created_at text not null
      );
      insert into coach_threads (id, user_id, title, created_at, updated_at)
      values ('thread-1', 'user-1', 'Older conversation', '2026-08-04T10:00:00.000Z', '2026-08-04T10:00:00.000Z');
      insert into coach_messages (id, thread_id, user_id, role, content, created_at)
      values ('message-1', 'thread-1', 'user-1', 'user', 'Older prompt', '2026-08-04T10:00:00.000Z');
      pragma user_version = 11;
    `);

    await migrate(db);
    const cols = (await db.getAllAsync<{ name: string }>('pragma table_info(coach_messages)')).map((c) => c.name);
    const row = await db.getFirstAsync<{ history_content: string }>(
      'select history_content from coach_messages where id = ?',
      'message-1',
    );
    expect(cols).toContain('history_content');
    expect(row?.history_content).toBe('');
    db.close();
  });

  it('adds the intent side table without changing a schema-v11 workout row', async () => {
    const db = openNodeDb();
    await db.execAsync(`
      create table workouts (
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
      insert into workouts (
        id, user_id, program_day_id, started_at, ended_at, notes,
        readiness_at_start, updated_at, deleted_at
      ) values (
        'workout-1', 'user-1', null, '2026-08-01T10:00:00.000Z',
        '2026-08-01T11:00:00.000Z', null, 74,
        '2026-08-01T11:00:00.000Z', null
      );
      pragma user_version = 11;
    `);

    await migrate(db);
    const workoutColumns = (await db.getAllAsync<{ name: string }>(
      'pragma table_info(workouts)',
    )).map((column) => column.name);
    expect(workoutColumns).toEqual([
      'id', 'user_id', 'program_day_id', 'started_at', 'ended_at', 'notes',
      'readiness_at_start', 'updated_at', 'deleted_at',
    ]);
    await db.runAsync(
      `insert into workout_training_intents (id, intent, updated_at, deleted_at)
       values (?, 'coach_deload', ?, null)`,
      'workout-1',
      '2026-08-01T11:00:00.000Z',
    );
    expect(await db.getFirstAsync<{ intent: string }>(
      'select intent from workout_training_intents where id = ?',
      'workout-1',
    )).toEqual({ intent: 'coach_deload' });
    db.close();
  });

  it('converts the early v12 workout column and sanitizes queued wire payloads', async () => {
    const db = openNodeDb();
    const timestamp = '2026-08-01T11:00:00.000Z';
    await db.execAsync(`
      create table workouts (
        id text primary key,
        user_id text not null,
        program_day_id text,
        started_at text not null,
        ended_at text,
        notes text,
        readiness_at_start integer,
        updated_at text not null,
        deleted_at text,
        training_intent text not null default 'normal'
          check (training_intent in ('normal', 'coach_deload'))
      );
      create table mutation_queue (
        id text not null unique,
        seq integer primary key autoincrement,
        entity text not null,
        entity_id text not null,
        op text not null,
        payload text not null,
        created_at text not null,
        pushed_at text
      );
      create table sets (
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
      insert into workouts (
        id, user_id, program_day_id, started_at, ended_at, notes,
        readiness_at_start, updated_at, deleted_at, training_intent
      ) values (
        'legacy-deload', 'user-1', null, '2026-08-01T10:00:00.000Z',
        '${timestamp}', null, 74, '${timestamp}', null, 'coach_deload'
      );
      insert into sets (
        id, workout_id, exercise_id, set_index, weight, reps, is_warmup,
        completed_at, updated_at, deleted_at
      ) values (
        'legacy-set', 'legacy-deload', 'squat', 0, 185, 5, 0,
        '${timestamp}', '${timestamp}', null
      );
      insert into mutation_queue (
        id, entity, entity_id, op, payload, created_at, pushed_at
      ) values (
        'legacy-workout-mutation', 'workouts', 'legacy-deload', 'upsert',
        '{"id":"legacy-deload","training_intent":"coach_deload","updated_at":"${timestamp}"}',
        '${timestamp}', null
      ), (
        'legacy-set-mutation', 'sets', 'legacy-set', 'upsert',
        '{"id":"legacy-set","workout_id":"legacy-deload","weight":185}',
        '${timestamp}', null
      );
      pragma user_version = 12;
    `);

    await migrate(db);
    expect((await db.getAllAsync<{ name: string }>('pragma table_info(workouts)'))
      .map((column) => column.name)).not.toContain('training_intent');
    expect(await db.getFirstAsync<{ intent: string }>(
      'select intent from workout_training_intents where id = ?',
      'legacy-deload',
    )).toEqual({ intent: 'coach_deload' });
    const intent = await db.getFirstAsync<{ updated_at: string }>(
      'select updated_at from workout_training_intents where id = ?',
      'legacy-deload',
    );
    const workoutMutation = await db.getFirstAsync<{ payload: string }>(
      'select payload from mutation_queue where id = ?',
      'legacy-workout-mutation',
    );
    expect(JSON.parse(workoutMutation!.payload)).toEqual({
      id: 'legacy-deload',
      updated_at: timestamp,
    });
    const intentMutation = await db.getFirstAsync<{ payload: string; created_at: string }>(
      `select payload, created_at from mutation_queue
        where entity = 'workout_training_intents' and entity_id = ?`,
      'legacy-deload',
    );
    expect(intent?.updated_at).not.toBe(timestamp);
    expect(intentMutation?.created_at).toBe(intent?.updated_at);
    expect(JSON.parse(intentMutation!.payload)).toMatchObject({
      id: 'legacy-deload',
      intent: 'coach_deload',
      updated_at: intent?.updated_at,
      deleted_at: null,
    });
    expect((await db.getAllAsync<{ entity: string; entity_id: string }>(
      `select entity, entity_id
         from mutation_queue
        where pushed_at is null
        order by seq`,
    )).map((mutation) => `${mutation.entity}:${mutation.entity_id}`)).toEqual([
      'workouts:legacy-deload',
      'workout_training_intents:legacy-deload',
      'sets:legacy-set',
    ]);
    expect(await db.getFirstAsync<{
      id: string;
      op: string;
      payload: string;
      created_at: string;
    }>(
      `select id, op, payload, created_at
         from mutation_queue
        where entity = 'sets' and entity_id = ?`,
      'legacy-set',
    )).toEqual({
      id: 'legacy-set-mutation',
      op: 'upsert',
      payload: '{"id":"legacy-set","workout_id":"legacy-deload","weight":185}',
      created_at: timestamp,
    });
    expect((await db.getFirstAsync<{ total: number }>(
      `select count(*) as total from mutation_queue
        where entity = 'workout_training_intents'
          and entity_id = 'legacy-deload'
          and pushed_at is null`,
    ))?.total).toBe(1);
    await migrate(db);
    expect((await db.getFirstAsync<{ total: number }>(
      `select count(*) as total from mutation_queue
        where entity = 'workout_training_intents'
          and entity_id = 'legacy-deload'
          and pushed_at is null`,
    ))?.total).toBe(1);
    db.close();
  });

  it('rewinds the shared sync cursor once so v12 can backfill historical intents', async () => {
    const db = openNodeDb();
    const previousCursor = '2026-08-15T12:00:00.000Z';
    const laterCursor = '2026-08-17T12:00:00.000Z';
    await db.execAsync(`
      create table sync_cursors (
        user_id text not null,
        device_id text not null,
        last_pulled_at text not null default '1970-01-01T00:00:00.000Z',
        updated_at text not null,
        primary key (user_id, device_id)
      );
      create table device_meta (
        key text primary key,
        value text not null
      );
      insert into sync_cursors (user_id, device_id, last_pulled_at, updated_at)
      values ('user-1', 'device-1', '${previousCursor}', '${previousCursor}');
      pragma user_version = 11;
    `);

    await migrate(db);
    expect(await db.getFirstAsync<{ last_pulled_at: string }>(
      'select last_pulled_at from sync_cursors where user_id = ? and device_id = ?',
      'user-1',
      'device-1',
    )).toEqual({ last_pulled_at: '1970-01-01T00:00:00.000Z' });
    expect(await db.getFirstAsync<{ value: string }>(
      'select value from device_meta where key = ?',
      'schema-v12-workout-training-intents-cursor-backfill',
    )).toEqual({ value: '1' });
    expect(await db.getFirstAsync<{ value: string }>(
      'select value from device_meta where key = ?',
      'server-authoritative-paginated-pull-cursor-v1',
    )).toEqual({ value: '1' });

    await db.runAsync(
      `update sync_cursors
          set last_pulled_at = ?, updated_at = ?
        where user_id = ? and device_id = ?`,
      laterCursor,
      laterCursor,
      'user-1',
      'device-1',
    );
    await migrate(db);
    expect(await db.getFirstAsync<{ last_pulled_at: string }>(
      'select last_pulled_at from sync_cursors where user_id = ? and device_id = ?',
      'user-1',
      'device-1',
    )).toEqual({ last_pulled_at: laterCursor });
    db.close();
  });

  it('rewinds an existing v12 cursor once for the server-authoritative paginated pull contract', async () => {
    const db = openNodeDb();
    await migrate(db);
    const futureCursor = '2030-08-17T12:00:00.000Z';
    const laterCursor = '2031-08-17T12:00:00.000Z';
    await db.runAsync(
      `insert into sync_cursors (user_id, device_id, last_pulled_at, updated_at)
       values (?, ?, ?, ?)`,
      'user-1',
      'device-1',
      futureCursor,
      futureCursor,
    );
    await db.runAsync(
      'delete from device_meta where key = ?',
      'server-authoritative-paginated-pull-cursor-v1',
    );

    await migrate(db);
    expect(await db.getFirstAsync<{ last_pulled_at: string }>(
      'select last_pulled_at from sync_cursors where user_id = ? and device_id = ?',
      'user-1',
      'device-1',
    )).toEqual({ last_pulled_at: '1970-01-01T00:00:00.000Z' });

    await db.runAsync(
      `update sync_cursors
          set last_pulled_at = ?, updated_at = ?
        where user_id = ? and device_id = ?`,
      laterCursor,
      laterCursor,
      'user-1',
      'device-1',
    );
    await migrate(db);
    expect(await db.getFirstAsync<{ last_pulled_at: string }>(
      'select last_pulled_at from sync_cursors where user_id = ? and device_id = ?',
      'user-1',
      'device-1',
    )).toEqual({ last_pulled_at: laterCursor });
    db.close();
  });

  it('repairs categories overwritten by the old active toggle migration', async () => {
    const db = openNodeDb();
    await migrate(db);
    await db.execAsync(`
      insert into programs (id, user_id, archetype_id, status, started_at, current_week, updated_at, deleted_at)
      values ('plan', 'u1', 'demo', 'active', '2026-08-01T00:00:00.000Z', 1, '2026-08-01T00:00:00.000Z', null);
      insert into program_days (id, program_id, day_index, name, updated_at, deleted_at) values
        ('upper', 'plan', 0, 'Upper — Strength', '2026-08-01T00:00:00.000Z', null),
        ('lower', 'plan', 1, 'Lower Body — Volume', '2026-08-01T00:00:00.000Z', null),
        ('chest', 'plan', 2, 'Chest Focus', '2026-08-01T00:00:00.000Z', null),
        ('back', 'plan', 3, 'Back and Pull', '2026-08-01T00:00:00.000Z', null),
        ('arms', 'plan', 4, 'Arms', '2026-08-01T00:00:00.000Z', null),
        ('other', 'plan', 5, 'Conditioning', '2026-08-01T00:00:00.000Z', null);
      insert into program_day_settings (
        program_day_id, user_id, active, category, notes, repeat_every, repeat_unit, weekdays, updated_at, deleted_at
      ) values
        ('upper', 'u1', 1, 'other', null, 1, 'week', '[]', '2026-08-01T00:00:00.000Z', null),
        ('lower', 'u1', 1, 'other', null, 1, 'week', '[]', '2026-08-01T00:00:00.000Z', null),
        ('chest', 'u1', 1, 'other', null, 1, 'week', '[]', '2026-08-01T00:00:00.000Z', null),
        ('back', 'u1', 1, 'other', null, 1, 'week', '[]', '2026-08-01T00:00:00.000Z', null),
        ('arms', 'u1', 1, 'other', null, 1, 'week', '[]', '2026-08-01T00:00:00.000Z', null),
        ('other', 'u1', 1, 'other', null, 1, 'week', '[]', '2026-08-01T00:00:00.000Z', null);
      pragma user_version = 8;
    `);

    await migrate(db);
    const rows = await db.getAllAsync<{ program_day_id: string; category: string }>(
      'select program_day_id, category from program_day_settings order by program_day_id',
    );
    expect(Object.fromEntries(rows.map((row) => [row.program_day_id, row.category]))).toEqual({
      arms: 'arms',
      back: 'back',
      chest: 'chest',
      lower: 'lower',
      other: 'other',
      upper: 'upper',
    });
    db.close();
  });

  it('mutation_queue assigns monotonically increasing seq', async () => {
    const db = openNodeDb();
    await migrate(db);
    for (let i = 0; i < 3; i++) {
      await db.runAsync(
        `insert into mutation_queue (id, entity, entity_id, op, payload, created_at)
         values (?, 'workouts', ?, 'upsert', '{}', ?)`,
        `m${i}`, `w${i}`, new Date().toISOString(),
      );
    }
    const rows = await db.getAllAsync<{ seq: number; entity_id: string }>(
      'select seq, entity_id from mutation_queue order by seq',
    );
    expect(rows.map((r) => r.entity_id)).toEqual(['w0', 'w1', 'w2']);
    expect(rows[1]!.seq).toBeGreaterThan(rows[0]!.seq);
    db.close();
  });
});
