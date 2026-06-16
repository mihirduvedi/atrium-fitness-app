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
    expect(await cols('health_samples')).toEqual([
      'id', 'user_id', 'source', 'type', 'date', 'value', 'external_id',
      'updated_at', 'deleted_at',
    ]);
    // every synced table carries updated_at + deleted_at (tombstones for sync)
    for (const t of SYNCED_TABLES) {
      const c = await cols(t);
      expect(c, t).toContain('updated_at');
      expect(c, t).toContain('deleted_at');
    }
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
