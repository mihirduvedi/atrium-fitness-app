import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySessionDeload } from '@atrium/engine';
import { upsertWithMutation, softDeleteWithMutation } from '../src/db/dao';
import {
  getActiveProgram,
  getNextProgramDay,
  getWorkoutDraft,
  planSession,
  seedDemoProgram,
  seedExerciseCatalog,
  startWorkout,
} from '../src/db/queries';
import { migrate, type SqlDb } from '../src/db/schema';
import { SyncEngine } from '../src/sync/engine';
import type { QueuedMutation } from '../src/sync/types';
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

const deloadIntentRow = (workoutId: string, at: string) => ({
  id: workoutId,
  intent: 'coach_deload',
  plan_json: JSON.stringify({
    version: 1,
    basePlan: { name: 'Synced deload' },
    resumePlan: { name: 'Synced deload' },
  }),
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

  it('syncs the deload intent between new clients without widening workout rows', async () => {
    const remote = new MockRemote();
    const timestamp = '2026-08-05T10:00:00.000Z';
    const first = openNodeDb(join(dir, 'intent-a.db'));
    await migrate(first);
    await upsertWithMutation(first, 'workouts', {
      ...workoutRow('deload-w1', timestamp),
      ended_at: '2026-08-05T11:00:00.000Z',
    }, testId);
    await upsertWithMutation(first, 'workout_training_intents', deloadIntentRow('deload-w1', timestamp), testId);
    await upsertWithMutation(first, 'sets', setRow('deload-s1', 'deload-w1', 0, timestamp), testId);
    expect((await first.getAllAsync<{ entity: string }>(
      'select entity from mutation_queue order by seq',
    )).map((row) => row.entity)).toEqual([
      'workouts',
      'workout_training_intents',
      'sets',
    ]);
    await new SyncEngine(first, remote, USER, 'intent-device-a', new FakeClock()).sync();
    expect(remote.get('workouts', 'deload-w1')).not.toHaveProperty('training_intent');
    expect(remote.get('workout_training_intents', 'deload-w1')).toMatchObject({
      intent: 'coach_deload',
      plan_json: expect.stringContaining('Synced deload'),
    });
    first.close();

    const second = openNodeDb(join(dir, 'intent-b.db'));
    await migrate(second);
    await new SyncEngine(second, remote, USER, 'intent-device-b', new FakeClock()).pull();
    expect(await second.getFirstAsync<{ intent: string; plan_json: string }>(
      'select intent, plan_json from workout_training_intents where id = ?',
      'deload-w1',
    )).toEqual({
      intent: 'coach_deload',
      plan_json: expect.stringContaining('Synced deload'),
    });
    expect(await second.getFirstAsync<{ n: number }>(
      `select count(*) as n
         from sets s
         join workouts w on w.id = s.workout_id
        where w.user_id = ?
          and not exists (
            select 1 from workout_training_intents intent
             where intent.id = w.id and intent.deleted_at is null
          )`,
      USER,
    )).toEqual({ n: 0 });
    second.close();
  });

  it('resumes the exact validated deload plan after a two-device sync without a local draft', async () => {
    const remote = new MockRemote();
    const first = openNodeDb(join(dir, 'active-deload-a.db'));
    await migrate(first);
    await seedExerciseCatalog(first);
    await seedDemoProgram(first, USER, testId);
    const firstProgram = (await getActiveProgram(first, USER))!;
    const firstDay = (await getNextProgramDay(first, firstProgram.id))!;
    const basePlan = await planSession(first, USER, firstDay, testId, 'green');
    const transformed = applySessionDeload(basePlan);
    const resumePlan = {
      ...transformed,
      notes: [
        ...(transformed.notes ?? []),
        'atrium:coach-proposal-kind:deload_session',
      ],
    };
    const workoutId = await startWorkout(first, USER, firstDay.dayId, testId, 82);
    await upsertWithMutation(first, 'workout_training_intents', {
      id: workoutId,
      intent: 'coach_deload',
      plan_json: JSON.stringify({ version: 1, basePlan, resumePlan }),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    }, testId);
    await new SyncEngine(first, remote, USER, 'active-device-a', new FakeClock()).sync();
    first.close();

    const second = openNodeDb(join(dir, 'active-deload-b.db'));
    await migrate(second);
    await new SyncEngine(second, remote, USER, 'active-device-b', new FakeClock()).pull();
    expect(await getWorkoutDraft(second, workoutId)).toBeNull();
    const secondProgram = (await getActiveProgram(second, USER))!;
    const secondDay = (await getNextProgramDay(second, secondProgram.id))!;
    const resumed = await planSession(second, USER, secondDay, testId, 'green');
    expect(resumed).toEqual(JSON.parse(JSON.stringify(resumePlan)));
    expect(resumed.prescriptions.every((prescription) => (
      prescription.sets.some((set) => !set.isWarmup)
      && !prescription.sets.some((set) => !set.isWarmup && set.kind === 'top')
    ))).toBe(true);
    second.close();
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

  it('keeps a boundary deload pair atomic across a lost acknowledgement and idempotent retry', async () => {
    class LostAckRemote extends MockRemote {
      batches: QueuedMutation[][] = [];
      private lostAck = false;

      override async pushBatch(mutations: QueuedMutation[]): Promise<void> {
        this.batches.push(mutations.map((mutation) => ({
          ...mutation,
          payload: { ...mutation.payload },
        })));
        await super.pushBatch(mutations);
        if (!this.lostAck && this.batches.length === 2) {
          this.lostAck = true;
          throw new Error('acknowledgement lost after atomic commit');
        }
      }
    }

    const source = openNodeDb(join(dir, 'boundary-source.db'));
    await migrate(source);
    const remote = new LostAckRemote();
    for (let i = 0; i < 49; i++) {
      await upsertWithMutation(
        source,
        'workouts',
        workoutRow(`filler-${i}`, `2026-06-11T10:00:${String(i).padStart(2, '0')}.000Z`),
        testId,
      );
    }
    await upsertWithMutation(
      source,
      'workouts',
      workoutRow('boundary-deload', '2026-06-11T11:00:00.000Z'),
      testId,
    );
    await upsertWithMutation(
      source,
      'workout_training_intents',
      deloadIntentRow('boundary-deload', '2026-06-11T11:00:00.000Z'),
      testId,
    );

    const sourceEngine = new SyncEngine(source, remote, USER, 'boundary-source', new FakeClock());
    const interrupted = await sourceEngine.push(1);
    expect(interrupted).toMatchObject({
      pushed: 49,
      error: 'acknowledgement lost after atomic commit',
    });
    expect(remote.batches.map((batch) => batch.length)).toEqual([49, 2]);
    expect(remote.batches[1].map((mutation) => [mutation.entity, mutation.entity_id])).toEqual([
      ['workouts', 'boundary-deload'],
      ['workout_training_intents', 'boundary-deload'],
    ]);
    expect(Boolean(remote.get('workouts', 'boundary-deload'))).toBe(
      Boolean(remote.get('workout_training_intents', 'boundary-deload')),
    );
    expect(await sourceEngine.unpushedCount()).toBe(2);

    const peer = openNodeDb(join(dir, 'boundary-peer.db'));
    await migrate(peer);
    const peerEngine = new SyncEngine(peer, remote, USER, 'boundary-peer', new FakeClock());
    await peerEngine.pull();
    expect(await peer.getFirstAsync<{ orphaned: number }>(
      `select count(*) as orphaned
         from workouts w
        where w.id = ?
          and not exists (
            select 1 from workout_training_intents intent where intent.id = w.id
          )`,
      'boundary-deload',
    )).toEqual({ orphaned: 0 });
    expect(await peer.getFirstAsync<{ intent: string }>(
      'select intent from workout_training_intents where id = ?',
      'boundary-deload',
    )).toEqual({ intent: 'coach_deload' });

    expect(await sourceEngine.push()).toEqual({ pushed: 2 });
    expect(await sourceEngine.unpushedCount()).toBe(0);
    await peerEngine.pull();
    expect(await peer.getFirstAsync<{ orphaned: number }>(
      `select count(*) as orphaned
         from workouts w
        where w.id = ?
          and not exists (
            select 1 from workout_training_intents intent where intent.id = w.id
          )`,
      'boundary-deload',
    )).toEqual({ orphaned: 0 });
    expect(remote.tables.get('workouts')!.size).toBe(50);
    expect(remote.tables.get('workout_training_intents')!.size).toBe(1);
    source.close();
    peer.close();
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

describe('pull: server-authoritative clean rows with dirty-local protection', () => {
  it('accepts a 2026 server tombstone after a clean local row was pushed with a year-2030 device timestamp', async () => {
    const db = openNodeDb(join(dir, 'e.db'));
    await migrate(db);
    const remote = new MockRemote();
    remote.setServerTime('2026-06-11T10:00:00.000Z');
    const engine = new SyncEngine(db, remote, USER, DEVICE, new FakeClock());

    await upsertWithMutation(db, 'workouts', {
      ...workoutRow('w1', '2030-01-01T00:00:00.000Z'),
      notes: 'future device clock',
    }, testId);
    await engine.push();
    expect(await engine.unpushedCount()).toBe(0);
    remote.seed('workouts', {
      ...workoutRow('w1', '2026-06-11T12:00:00.000Z'),
      notes: 'deleted on another device',
      deleted_at: '2026-06-11T12:00:00.000Z',
    });

    await engine.pull();
    expect(await db.getFirstAsync<{ notes: string; updated_at: string; deleted_at: string }>(
      'select notes, updated_at, deleted_at from workouts where id = ?',
      'w1',
    )).toEqual({
      notes: 'deleted on another device',
      updated_at: '2026-06-11T12:00:00.000Z',
      deleted_at: '2026-06-11T12:00:00.000Z',
    });
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

  it('rechecks dirty state inside the exclusive apply transaction', async () => {
    const db = openNodeDb(join(dir, 'dirty-race.db'));
    await migrate(db);
    await db.runAsync(
      `insert into workouts (
        id, user_id, program_day_id, started_at, ended_at, notes,
        readiness_at_start, updated_at, deleted_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'w1',
      USER,
      null,
      '2026-06-11T10:00:00.000Z',
      null,
      'clean before pull',
      82,
      '2026-06-11T10:00:00.000Z',
      null,
    );
    const remote = new MockRemote();
    remote.seed('workouts', {
      ...workoutRow('w1', '2026-06-11T12:00:00.000Z'),
      notes: 'remote response',
    });
    let injected = false;
    const racingDb: SqlDb = {
      ...db,
      async withExclusiveTransactionAsync(fn) {
        if (!injected) {
          injected = true;
          await upsertWithMutation(db, 'workouts', {
            ...workoutRow('w1', '2026-06-11T11:00:00.000Z'),
            notes: 'queued before apply',
          }, testId);
        }
        await db.withExclusiveTransactionAsync!(fn);
      },
    };

    await new SyncEngine(racingDb, remote, USER, 'dirty-race', new FakeClock()).pull();
    expect(await db.getFirstAsync<{ notes: string }>(
      'select notes from workouts where id = ?',
      'w1',
    )).toEqual({ notes: 'queued before apply' });
    expect(await db.getFirstAsync<{ n: number }>(
      `select count(*) as n
         from mutation_queue
        where entity = 'workouts' and entity_id = 'w1' and pushed_at is null`,
    )).toEqual({ n: 1 });
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

  it('serializes overlapping pulls and continues the chain after completion', async () => {
    class DelayedRemote extends MockRemote {
      pullCalls = 0;
      activePulls = 0;
      maxActivePulls = 0;
      firstStarted: Promise<void>;
      releaseFirst: () => void = () => undefined;
      private markFirstStarted: () => void = () => undefined;
      private firstGate: Promise<void>;

      constructor() {
        super();
        this.firstStarted = new Promise((resolve) => {
          this.markFirstStarted = resolve;
        });
        this.firstGate = new Promise((resolve) => {
          this.releaseFirst = resolve;
        });
      }

      override async pull(since: string) {
        this.pullCalls += 1;
        this.activePulls += 1;
        this.maxActivePulls = Math.max(this.maxActivePulls, this.activePulls);
        try {
          if (this.pullCalls === 1) {
            this.markFirstStarted();
            await this.firstGate;
          }
          return await super.pull(since);
        } finally {
          this.activePulls -= 1;
        }
      }
    }

    const db = openNodeDb(join(dir, 'serialized.db'));
    await migrate(db);
    const remote = new DelayedRemote();
    remote.seed('workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'));
    const engine = new SyncEngine(db, remote, USER, 'serialized-device', new FakeClock());
    const first = engine.pull();
    const second = engine.pull();
    await remote.firstStarted;
    expect(remote.pullCalls).toBe(1);
    expect(remote.maxActivePulls).toBe(1);
    remote.releaseFirst();
    const results = await Promise.all([first, second]);
    expect(results).toEqual([{ pulled: 1 }, { pulled: 0 }]);
    expect(remote.pullCalls).toBe(2);
    expect(remote.maxActivePulls).toBe(1);
    db.close();
  });

  it('does not advance the cursor when the remote pull fails', async () => {
    const db = openNodeDb(join(dir, 'failed-pull.db'));
    await migrate(db);
    const remote = new MockRemote();
    remote.seed('workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'));
    const engine = new SyncEngine(db, remote, USER, 'failed-pull-device', new FakeClock());
    await engine.pull();
    const before = await db.getFirstAsync<{ last_pulled_at: string }>(
      'select last_pulled_at from sync_cursors where user_id = ? and device_id = ?',
      USER,
      'failed-pull-device',
    );

    remote.online = false;
    await expect(engine.pull()).rejects.toThrow('network unreachable');
    expect(await db.getFirstAsync<{ last_pulled_at: string }>(
      'select last_pulled_at from sync_cursors where user_id = ? and device_id = ?',
      USER,
      'failed-pull-device',
    )).toEqual(before);
    remote.online = true;
    await expect(engine.pull()).resolves.toEqual({ pulled: 0 });
    db.close();
  });

  it('uses only remote server time and rewinds a cursor ahead of the database barrier', async () => {
    const db = openNodeDb(join(dir, 'server-cursor.db'));
    await migrate(db);
    const remote = new MockRemote();
    remote.setServerTime('2026-06-11T10:00:00.000Z');
    remote.seed('workouts', workoutRow('w1', '2026-06-11T10:30:00.000Z'));
    const firstServerCursor = remote.currentServerTime();
    const futureDeviceClock = new FakeClock();
    futureDeviceClock.t = Date.parse('2040-01-01T00:00:00.000Z');
    const engine = new SyncEngine(db, remote, USER, 'server-cursor-device', futureDeviceClock);

    await engine.pull();
    expect(await db.getFirstAsync<{ last_pulled_at: string; updated_at: string }>(
      'select last_pulled_at, updated_at from sync_cursors where user_id = ? and device_id = ?',
      USER,
      'server-cursor-device',
    )).toEqual({
      last_pulled_at: firstServerCursor,
      updated_at: firstServerCursor,
    });

    remote.setServerTime('2025-01-01T00:00:00.000Z');
    await engine.pull();
    expect(await db.getFirstAsync<{ last_pulled_at: string; updated_at: string }>(
      'select last_pulled_at, updated_at from sync_cursors where user_id = ? and device_id = ?',
      USER,
      'server-cursor-device',
    )).toEqual({
      last_pulled_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
    });
    db.close();
  });

  it('falls back to the regular transaction only for Expo web exclusive-transaction support', async () => {
    const db = openNodeDb(join(dir, 'web-fallback.db'));
    await migrate(db);
    const remote = new MockRemote();
    remote.seed('workouts', workoutRow('w1', '2026-06-11T10:00:00.000Z'));
    let fallbackTransactions = 0;
    const webDb: SqlDb = {
      ...db,
      async withExclusiveTransactionAsync() {
        throw new Error('withExclusiveTransactionAsync is not supported on web');
      },
      async withTransactionAsync(fn) {
        fallbackTransactions += 1;
        await db.withTransactionAsync(fn);
      },
    };

    await new SyncEngine(webDb, remote, USER, 'web-device', new FakeClock()).pull();
    expect(fallbackTransactions).toBe(1);
    expect(await db.getFirstAsync<{ id: string }>(
      'select id from workouts where id = ?',
      'w1',
    )).toEqual({ id: 'w1' });
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
