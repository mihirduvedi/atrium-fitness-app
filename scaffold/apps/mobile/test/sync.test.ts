import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { upsertWithMutation, softDeleteWithMutation } from '../src/db/dao';
import { migrate } from '../src/db/schema';
import { SyncEngine } from '../src/sync/engine';
import { FakeClock, MockRemote, testId } from './helpers/mockRemote';
import { openNodeDb } from './helpers/nodeDb';

const USER = 'user-1';
const DEVICE = 'device-1';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atrium-sync-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const workoutRow = (id: string, at: string) => ({
  id,
  user_id: USER,
  program_day_id: null,
  started_at: at,
  ended_at: null,
  notes: null,
  readiness_at_start: 82,
  updated_at: at,
  deleted_at: null,
});

const setRow = (id: string, workoutId: string, idx: number, at: string) => ({
  id,
  workout_id: workoutId,
  exercise_id: 'bb_bench',
  set_index: idx,
  weight: 135,
  reps: 8,
  is_warmup: 0,
  completed_at: at,
  updated_at: at,
  deleted_at: null,
});

describe('offline-first sync (brief Part E acceptance)', () => {
  it('a workout written with the network DEAD survives a process restart and reaches the server when the network returns', async () => {
    const path = join(dir, 'atrium.db');
    const remote = new MockRemote();
    const clock = new FakeClock();
    remote.online = false; // (1) network mocked dead

    // --- process 1: log a workout offline
    {
      const db = openNodeDb(path);
      await migrate(db);
      await upsertWithMutation(db, 'workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'), testId);
      await upsertWithMutation(db, 'sets', setRow('s1', 'w1', 0, '2026-06-11T10:05:00.000Z'), testId);
      await upsertWithMutation(db, 'sets', setRow('s2', 'w1', 1, '2026-06-11T10:08:00.000Z'), testId);

      const engine = new SyncEngine(db, remote, USER, DEVICE, clock);
      const r = await engine.push(3); // fails, with backoff, queue intact
      expect(r.error).toMatch(/unreachable/);
      expect(await engine.unpushedCount()).toBe(3);
      db.close(); // (2) process killed
    }

    // --- process 2: app restarts, network restored
    {
      const db = openNodeDb(path);
      await migrate(db); // idempotent
      const engine = new SyncEngine(db, remote, USER, DEVICE, clock);
      expect(await engine.unpushedCount()).toBe(3); // queue survived the kill

      remote.online = true; // (3) network restored
      const result = await engine.sync();

      // (4) server rows exist and the queue is drained
      expect(result.pushed).toBe(3);
      expect(remote.get('workouts', 'w1')).toMatchObject({ id: 'w1', user_id: USER });
      expect(remote.get('sets', 's1')).toMatchObject({ workout_id: 'w1', weight: 135 });
      expect(remote.get('sets', 's2')).toMatchObject({ set_index: 1 });
      expect(await engine.unpushedCount()).toBe(0);
      db.close();
    }
  });

  it('UI reads come from SQLite even while offline (source of truth on device)', async () => {
    const db = openNodeDb(join(dir, 'a.db'));
    await migrate(db);
    const remote = new MockRemote();
    remote.online = false;
    await upsertWithMutation(db, 'workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'), testId);
    const row = await db.getFirstAsync<{ id: string }>('select id from workouts where id = ?', 'w1');
    expect(row).toMatchObject({ id: 'w1' });
    db.close();
  });

  it('push drains in seq order and batches up to 50', async () => {
    const db = openNodeDb(join(dir, 'b.db'));
    await migrate(db);
    const remote = new MockRemote();
    for (let i = 0; i < 120; i++) {
      await upsertWithMutation(db, 'workouts', workoutRow(`w${i}`, `2026-06-11T10:00:${String(i % 60).padStart(2, '0')}.000Z`), testId);
    }
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());
    const r = await engine.push();
    expect(r.pushed).toBe(120);
    expect(remote.pushCalls).toBe(3); // 50 + 50 + 20
    expect(await engine.unpushedCount()).toBe(0);
    db.close();
  });

  it('retries with exponential backoff, 1s doubling to a 60s cap', async () => {
    const db = openNodeDb(join(dir, 'c.db'));
    await migrate(db);
    await upsertWithMutation(db, 'workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'), testId);
    const remote = new MockRemote();
    remote.online = false;
    const clock = new FakeClock();
    const engine = new SyncEngine(db, remote, USER, DEVICE, clock);
    await engine.push(9);
    expect(clock.sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    db.close();
  });

  it('push is idempotent: a retry after a half-acknowledged batch cannot duplicate rows', async () => {
    const db = openNodeDb(join(dir, 'd.db'));
    await migrate(db);
    const remote = new MockRemote();
    await upsertWithMutation(db, 'workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'), testId);
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());
    await engine.push();
    // simulate "server got it but the ack was lost": un-mark and re-push
    await db.runAsync('update mutation_queue set pushed_at = null');
    await engine.push();
    expect(remote.tables.get('workouts')!.size).toBe(1);
    db.close();
  });
});

describe('pull: last-write-wins per row', () => {
  it('newer server rows replace local; older ones are ignored', async () => {
    const db = openNodeDb(join(dir, 'e.db'));
    await migrate(db);
    const remote = new MockRemote();
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());

    await upsertWithMutation(db, 'workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'), testId);
    await engine.push();

    // another device edited w1 later, and pushed an old edit of w2
    remote.seed('workouts', { ...workoutRow('w1', '2026-06-11T12:00:00.000Z'), notes: 'edited elsewhere' });
    await upsertWithMutation(db, 'workouts', { ...workoutRow('w2', '2026-06-11T13:00:00.000Z'), notes: 'local newer' }, testId);
    await engine.push();
    remote.seed('workouts', { ...workoutRow('w2', '2026-06-11T11:00:00.000Z'), notes: 'stale remote' });

    await engine.pull();
    const w1 = await db.getFirstAsync<{ notes: string }>('select notes from workouts where id = ?', 'w1');
    const w2 = await db.getFirstAsync<{ notes: string }>('select notes from workouts where id = ?', 'w2');
    expect(w1!.notes).toBe('edited elsewhere'); // newer remote won
    expect(w2!.notes).toBe('local newer'); // stale remote lost
    db.close();
  });

  it('local unpushed mutations always win over pulled rows for the same entity', async () => {
    const db = openNodeDb(join(dir, 'f.db'));
    await migrate(db);
    const remote = new MockRemote();
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());

    await upsertWithMutation(db, 'workouts', { ...workoutRow('w1', '2026-06-11T10:00:00.000Z'), notes: 'local unpushed' }, testId);
    // server has a LATER edit, but our local change hasn't pushed yet
    remote.seed('workouts', { ...workoutRow('w1', '2026-06-11T12:00:00.000Z'), notes: 'remote' });

    await engine.pull();
    const w1 = await db.getFirstAsync<{ notes: string }>('select notes from workouts where id = ?', 'w1');
    expect(w1!.notes).toBe('local unpushed');
    db.close();
  });

  it('soft-deleted rows tombstone locally', async () => {
    const db = openNodeDb(join(dir, 'g.db'));
    await migrate(db);
    const remote = new MockRemote();
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());

    await upsertWithMutation(db, 'workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'), testId);
    await engine.push();
    remote.seed('workouts', { ...workoutRow('w1', '2026-06-11T12:00:00.000Z'), deleted_at: '2026-06-11T12:00:00.000Z' });

    await engine.pull();
    const w1 = await db.getFirstAsync<{ deleted_at: string | null }>('select deleted_at from workouts where id = ?', 'w1');
    expect(w1!.deleted_at).toBe('2026-06-11T12:00:00.000Z');
    db.close();
  });

  it('the cursor advances: a second pull with no remote changes applies nothing', async () => {
    const db = openNodeDb(join(dir, 'h.db'));
    await migrate(db);
    const remote = new MockRemote();
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());
    remote.seed('workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'));

    expect((await engine.pull()).pulled).toBe(1);
    expect((await engine.pull()).pulled).toBe(0);
    db.close();
  });

  it('local soft delete queues a tombstone mutation that reaches the server', async () => {
    const db = openNodeDb(join(dir, 'i.db'));
    await migrate(db);
    const remote = new MockRemote();
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());

    await upsertWithMutation(db, 'workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'), testId);
    await softDeleteWithMutation(db, 'workouts', 'w1', testId);
    await engine.push();
    expect(remote.get('workouts', 'w1')!.deleted_at).toBeTruthy();
    db.close();
  });
});
