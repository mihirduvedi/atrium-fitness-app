import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Row } from '../src/db/dao';
import { SYNCED_TABLES, type SyncedTable } from '../src/db/schema';
import { createSupabaseRemote } from '../src/sync/supabaseRemote';
import type { QueuedMutation } from '../src/sync/types';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

class FakeSupabaseClient {
  serverTime = '2026-08-17T17:00:00.000Z';
  barrierError: string | null = null;
  pairError: string | null = null;
  failPage: { table: SyncedTable; call: number } | null = null;
  readonly rpcCalls: RpcCall[] = [];
  readonly fromCalls: Array<{ table: SyncedTable; payload: Record<string, unknown> }> = [];
  readonly rows = new Map<SyncedTable, Map<string, Record<string, unknown>>>();
  private readonly pageCalls = new Map<SyncedTable, number>();

  private table(name: SyncedTable): Map<string, Record<string, unknown>> {
    let table = this.rows.get(name);
    if (!table) {
      table = new Map();
      this.rows.set(name, table);
    }
    return table;
  }

  seed(table: SyncedTable, row: Record<string, unknown>): void {
    const pk = table === 'profiles' ? 'user_id' : 'id';
    this.table(table).set(String(row[pk]), { ...row });
  }

  pageCallCount(table: SyncedTable): number {
    return this.pageCalls.get(table) ?? 0;
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<{
    data: unknown;
    error: { message: string } | null;
  }> {
    this.rpcCalls.push({ name, args });
    if (name === 'sync_server_time') {
      return this.barrierError
        ? { data: null, error: { message: this.barrierError } }
        : { data: this.serverTime, error: null };
    }

    if (name === 'sync_pull_page') {
      const table = String(args.table_name) as SyncedTable;
      const call = (this.pageCalls.get(table) ?? 0) + 1;
      this.pageCalls.set(table, call);
      if (this.failPage?.table === table && this.failPage.call === call) {
        return { data: null, error: { message: 'later page failed' } };
      }

      const pk = table === 'profiles' ? 'user_id' : 'id';
      const since = Date.parse(String(args.since_time));
      const barrier = Date.parse(String(args.barrier_time));
      const afterUpdatedAt = args.after_updated_at === null
        ? null
        : Date.parse(String(args.after_updated_at));
      const afterPk = args.after_pk === null ? null : String(args.after_pk);
      const limit = Number(args.page_size);
      const page = [...this.table(table).values()]
        .filter((row) => {
          const updatedAt = Date.parse(String(row.updated_at));
          const rowPk = String(row[pk]);
          return updatedAt > since
            && updatedAt <= barrier
            && (
              afterUpdatedAt === null
              || updatedAt > afterUpdatedAt
              || (updatedAt === afterUpdatedAt && rowPk > (afterPk ?? ''))
            );
        })
        .sort((left, right) => {
          const timestampOrder = Date.parse(String(left.updated_at)) - Date.parse(String(right.updated_at));
          if (timestampOrder !== 0) return timestampOrder;
          const leftPk = String(left[pk]);
          const rightPk = String(right[pk]);
          return leftPk < rightPk ? -1 : leftPk > rightPk ? 1 : 0;
        })
        .slice(0, limit)
        .map((row) => ({ ...row }));
      return { data: page, error: null };
    }

    if (name === 'sync_upsert_coach_deload_workout') {
      if (this.pairError) return { data: null, error: { message: this.pairError } };
      const workout = args.workout_row;
      const intent = args.intent_row;
      if (
        typeof workout !== 'object'
        || workout === null
        || typeof intent !== 'object'
        || intent === null
      ) {
        return { data: null, error: { message: 'invalid pair' } };
      }
      const workoutRow = workout as Record<string, unknown>;
      const intentRow = intent as Record<string, unknown>;
      if (
        workoutRow.id !== intentRow.id
        || intentRow.intent !== 'coach_deload'
      ) {
        return { data: null, error: { message: 'invalid pair' } };
      }

      // Validate both first, then publish both: this mirrors one PostgreSQL
      // function transaction and lets the failure test prove no partial state.
      this.seed('workouts', workoutRow);
      this.seed('workout_training_intents', intentRow);
      return { data: null, error: null };
    }

    return { data: null, error: { message: `unknown RPC ${name}` } };
  }

  from(table: SyncedTable): {
    upsert: (
      payload: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<{ error: null }>;
  } {
    return {
      upsert: async (payload) => {
        this.fromCalls.push({ table, payload });
        this.seed(table, payload);
        return { error: null };
      },
    };
  }
}

function remoteFor(fake: FakeSupabaseClient) {
  return createSupabaseRemote(fake as unknown as SupabaseClient);
}

function mutation(
  seq: number,
  entity: SyncedTable,
  entityId: string,
  payload: Row,
): QueuedMutation {
  return {
    id: `mutation-${seq}`,
    seq,
    entity,
    entity_id: entityId,
    op: payload.deleted_at ? 'delete' : 'upsert',
    payload,
    created_at: '2026-08-17T16:00:00.000Z',
  };
}

const workoutRow = (id: string): Row => ({
  id,
  user_id: '00000000-0000-4000-8000-000000000001',
  program_day_id: null,
  started_at: '2026-08-17T16:00:00.000Z',
  ended_at: null,
  notes: null,
  readiness_at_start: 70,
  updated_at: '2026-08-17T16:00:00.000Z',
  deleted_at: null,
});

const intentRow = (id: string): Row => ({
  id,
  intent: 'coach_deload',
  plan_json: '{"version":1,"basePlan":{},"resumePlan":{}}',
  updated_at: '2026-08-17T16:00:00.000Z',
  deleted_at: null,
});

describe('Supabase remote pull safety', () => {
  it('uses a database barrier and fully backfills a cursor ahead of PostgreSQL', async () => {
    const fake = new FakeSupabaseClient();
    fake.seed('workouts', {
      id: 'inside-overlap',
      updated_at: '2026-08-17T16:56:00.000Z',
    });
    fake.seed('workouts', {
      id: 'before-overlap',
      updated_at: '2026-08-17T16:54:59.999Z',
    });

    const result = await remoteFor(fake).pull('2026-08-17T17:30:00.000Z');

    expect(result.serverTime).toBe('2026-08-17T17:00:00.000Z');
    expect(result.rows.map(({ row }) => row.id)).toEqual(['before-overlap', 'inside-overlap']);
    const workoutPage = fake.rpcCalls.find(
      ({ name, args }) => name === 'sync_pull_page' && args.table_name === 'workouts',
    );
    expect(workoutPage?.args).toMatchObject({
      since_time: '1970-01-01T00:00:00.000Z',
      barrier_time: '2026-08-17T17:00:00.000Z',
      page_size: 500,
    });
  });

  it('replays five minutes for an ordinary server-relative cursor', async () => {
    const fake = new FakeSupabaseClient();
    fake.seed('workouts', {
      id: 'inside-overlap',
      updated_at: '2026-08-17T16:56:00.000Z',
    });
    fake.seed('workouts', {
      id: 'before-overlap',
      updated_at: '2026-08-17T16:54:59.999Z',
    });

    const result = await remoteFor(fake).pull('2026-08-17T17:00:00.000Z');

    expect(result.rows.map(({ row }) => row.id)).toEqual(['inside-overlap']);
    const workoutPage = fake.rpcCalls.find(
      ({ name, args }) => name === 'sync_pull_page' && args.table_name === 'workouts',
    );
    expect(workoutPage?.args.since_time).toBe('2026-08-17T16:55:00.000Z');
  });

  it('fails closed before reading tables when the database barrier is unavailable', async () => {
    const fake = new FakeSupabaseClient();
    fake.barrierError = 'RPC unavailable';

    await expect(remoteFor(fake).pull('2026-08-17T16:00:00.000Z'))
      .rejects.toThrow('sync barrier: RPC unavailable');
    expect(fake.rpcCalls.map(({ name }) => name)).toEqual(['sync_server_time']);
  });

  it('pulls more than 1,000 rows sharing one timestamp with complete composite keyset pages', async () => {
    const fake = new FakeSupabaseClient();
    for (let index = 0; index < 1_205; index++) {
      fake.seed('workouts', {
        id: `workout-${String(index).padStart(4, '0')}`,
        updated_at: '2026-08-17T16:30:00.000Z',
      });
    }

    const result = await remoteFor(fake).pull('2026-08-17T16:00:00.000Z');
    const workouts = result.rows.filter(({ table }) => table === 'workouts');

    expect(workouts).toHaveLength(1_205);
    expect(new Set(workouts.map(({ row }) => row.id))).toHaveLength(1_205);
    expect(workouts[0]?.row.id).toBe('workout-0000');
    expect(workouts.at(-1)?.row.id).toBe('workout-1204');
    expect(fake.pageCallCount('workouts')).toBe(3);
    const workoutCalls = fake.rpcCalls.filter(
      ({ name, args }) => name === 'sync_pull_page' && args.table_name === 'workouts',
    );
    expect(workoutCalls.every(({ args }) => Number(args.page_size) <= 500)).toBe(true);
    expect(workoutCalls[1]?.args).toMatchObject({
      after_updated_at: '2026-08-17T16:30:00.000Z',
      after_pk: 'workout-0499',
    });
  });

  it('rejects the whole pull when a later page fails', async () => {
    const fake = new FakeSupabaseClient();
    for (let index = 0; index < 600; index++) {
      fake.seed('workouts', {
        id: `workout-${String(index).padStart(4, '0')}`,
        updated_at: '2026-08-17T16:30:00.000Z',
      });
    }
    fake.failPage = { table: 'workouts', call: 2 };

    await expect(remoteFor(fake).pull('2026-08-17T16:00:00.000Z'))
      .rejects.toThrow('pull workouts: later page failed');
    expect(fake.pageCallCount('workouts')).toBe(2);
  });

  it('requests every synced table before returning a successful pull', async () => {
    const fake = new FakeSupabaseClient();
    await remoteFor(fake).pull('2026-08-17T16:00:00.000Z');
    expect(SYNCED_TABLES.every((table) => fake.pageCallCount(table) === 1)).toBe(true);
  });
});

describe('Supabase remote atomic Coach deload push', () => {
  it('uses one idempotent RPC for an adjacent workout+intent pair and keeps ordinary mutations on upsert', async () => {
    const fake = new FakeSupabaseClient();
    const workoutId = '00000000-0000-4000-8000-000000000010';
    const mutations = [
      mutation(1, 'workouts', workoutId, workoutRow(workoutId)),
      mutation(2, 'workout_training_intents', workoutId, intentRow(workoutId)),
      mutation(3, 'sets', 'set-1', {
        id: 'set-1',
        workout_id: workoutId,
        exercise_id: 'bench',
        set_index: 0,
        weight: 100,
        reps: 5,
        is_warmup: 0,
        completed_at: '2026-08-17T16:05:00.000Z',
        updated_at: '2026-08-17T16:05:00.000Z',
        deleted_at: null,
      }),
    ];

    await remoteFor(fake).pushBatch(mutations);
    await remoteFor(fake).pushBatch(mutations);

    expect(fake.rpcCalls.filter(({ name }) => name === 'sync_upsert_coach_deload_workout')).toHaveLength(2);
    expect(fake.rows.get('workouts')?.size).toBe(1);
    expect(fake.rows.get('workout_training_intents')?.size).toBe(1);
    expect(fake.rows.get('sets')?.get('set-1')?.is_warmup).toBe(false);
    expect(fake.fromCalls.map(({ table }) => table)).toEqual(['sets', 'sets']);
  });

  it('publishes neither half and does not continue the batch when the pair RPC fails', async () => {
    const fake = new FakeSupabaseClient();
    fake.pairError = 'intent rejected';
    const workoutId = '00000000-0000-4000-8000-000000000011';
    const mutations = [
      mutation(1, 'workouts', workoutId, workoutRow(workoutId)),
      mutation(2, 'workout_training_intents', workoutId, intentRow(workoutId)),
      mutation(3, 'sets', 'set-after-failure', {
        id: 'set-after-failure',
        workout_id: workoutId,
        updated_at: '2026-08-17T16:05:00.000Z',
        deleted_at: null,
      }),
    ];

    await expect(remoteFor(fake).pushBatch(mutations))
      .rejects.toThrow(`push workouts+workout_training_intents/${workoutId}: intent rejected`);
    expect(fake.rows.get('workouts')).toBeUndefined();
    expect(fake.rows.get('workout_training_intents')).toBeUndefined();
    expect(fake.fromCalls).toHaveLength(0);
  });

  it('atomically preserves a legacy marker without a resume snapshot so recovery can fail closed', async () => {
    const fake = new FakeSupabaseClient();
    const workoutId = '00000000-0000-4000-8000-000000000012';
    await remoteFor(fake).pushBatch([
      mutation(1, 'workouts', workoutId, workoutRow(workoutId)),
      mutation(2, 'workout_training_intents', workoutId, {
        ...intentRow(workoutId),
        plan_json: null,
      }),
    ]);

    expect(fake.rows.get('workouts')?.has(workoutId)).toBe(true);
    expect(fake.rows.get('workout_training_intents')?.get(workoutId)).toMatchObject({
      intent: 'coach_deload',
      plan_json: null,
    });
  });
});
