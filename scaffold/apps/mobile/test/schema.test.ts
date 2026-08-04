import { describe, expect, it } from 'vitest';
import { migrate, SYNCED_TABLES } from '../src/db/schema';
import { openNodeDb } from './helpers/nodeDb';

describe('on-device SQLite schema', () => {
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
