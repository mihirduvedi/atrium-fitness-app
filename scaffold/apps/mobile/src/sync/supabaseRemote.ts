import type { SupabaseClient } from '@supabase/supabase-js';
import { SYNCED_TABLES, type SyncedTable } from '../db/schema';
import type { PulledRow, QueuedMutation, RemoteApi } from './types';

/**
 * RemoteApi over Supabase. Upserts are keyed on client UUIDs, so re-pushing
 * a batch after a half-failed attempt is harmless (idempotent). Deletes are
 * soft — they're just upserts that carry deleted_at.
 *
 * SQLite stores booleans as 0/1 and json as text; Postgres wants real types.
 * The payload conversion below is the single place that mapping lives.
 */

const JSON_COLUMNS: Partial<Record<SyncedTable, string[]>> = {
  profiles: ['equipment'],
  program_slots: ['scheme', 'state'],
  body_metrics: ['measurements'],
  health_samples: ['value'],
};

const BOOL_COLUMNS: Partial<Record<SyncedTable, string[]>> = {
  sets: ['is_warmup'],
};

const PULL_PAGE_SIZE = 500;
const PULL_OVERLAP_MS = 5 * 60 * 1_000;

type RpcError = { message: string } | null;

interface PullPageEnvelope {
  row_data: unknown;
}

function errorMessage(error: RpcError): string {
  return error?.message ?? 'invalid response';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseServerTime(value: unknown): { queryValue: string; cursor: string; epochMs: number } {
  if (typeof value !== 'string') throw new Error('sync barrier: invalid server time');
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) throw new Error('sync barrier: invalid server time');
  // Preserve PostgreSQL's full fractional precision for the upper-bound query,
  // while returning a consistently comparable UTC cursor to SQLite.
  return { queryValue: value, cursor: new Date(epochMs).toISOString(), epochMs };
}

function parseSince(value: string): number {
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) throw new Error('pull cursor: invalid timestamp');
  return epochMs;
}

function unwrapPullRow(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('invalid row');
  const candidate = 'row_data' in value ? (value as unknown as PullPageEnvelope).row_data : value;
  if (!isRecord(candidate)) throw new Error('invalid row');
  return candidate;
}

function isCoachDeloadPair(
  workout: QueuedMutation | undefined,
  intent: QueuedMutation | undefined,
): boolean {
  if (!workout || !intent) return false;
  return workout.entity === 'workouts'
    && intent.entity === 'workout_training_intents'
    && workout.entity_id === intent.entity_id;
}

function toServer(entity: SyncedTable, payload: Record<string, unknown>): Record<string, unknown> {
  const row = { ...payload };
  for (const col of JSON_COLUMNS[entity] ?? []) {
    if (typeof row[col] === 'string') row[col] = JSON.parse(row[col] as string);
  }
  for (const col of BOOL_COLUMNS[entity] ?? []) {
    if (row[col] !== undefined && row[col] !== null) row[col] = !!row[col];
  }
  return row;
}

function toLocal(entity: SyncedTable, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const col of JSON_COLUMNS[entity] ?? []) {
    if (out[col] !== null && typeof out[col] === 'object') out[col] = JSON.stringify(out[col]);
  }
  for (const col of BOOL_COLUMNS[entity] ?? []) {
    if (typeof out[col] === 'boolean') out[col] = out[col] ? 1 : 0;
  }
  return out;
}

export function createSupabaseRemote(client: SupabaseClient): RemoteApi {
  return {
    async pushBatch(mutations: QueuedMutation[]): Promise<void> {
      for (let index = 0; index < mutations.length;) {
        const m = mutations[index]!;
        const next = mutations[index + 1];

        // Starting a Coach deload creates a parent workout and its exact-resume
        // intent in consecutive queue positions. One RPC makes that causal
        // pair visible atomically; retries remain idempotent on the shared id.
        if (isCoachDeloadPair(m, next)) {
          const { error } = await client.rpc('sync_upsert_coach_deload_workout', {
            workout_row: toServer(m.entity, m.payload),
            intent_row: toServer(next!.entity, next!.payload),
          });
          if (error) {
            throw new Error(`push workouts+workout_training_intents/${m.entity_id}: ${errorMessage(error)}`);
          }
          index += 2;
          continue;
        }

        const { error } = await client
          .from(m.entity)
          .upsert(toServer(m.entity, m.payload), { onConflict: m.entity === 'profiles' ? 'user_id' : 'id' });
        if (error) throw new Error(`push ${m.entity}/${m.entity_id}: ${error.message}`);
        index += 1;
      }
    },

    async pull(since: string): Promise<{ rows: PulledRow[]; serverTime: string }> {
      const sinceMs = parseSince(since);
      const barrierResult = await client.rpc('sync_server_time');
      if (barrierResult.error) {
        throw new Error(`sync barrier: ${errorMessage(barrierResult.error)}`);
      }
      const barrier = parseServerTime(barrierResult.data);
      // A device clock can put its persisted cursor in the future. Never query
      // beyond the database barrier, and always replay a bounded overlap so
      // server-stamped writes around the previous boundary cannot be skipped.
      // A cursor ahead of PostgreSQL may already have skipped arbitrarily old
      // rows, so recover it with one complete backfill rather than assuming
      // the damage is limited to the normal overlap window. SyncEngine then
      // persists this database barrier and later pulls return to five-minute
      // overlap reads.
      const lowerBoundMs = sinceMs > barrier.epochMs
        ? 0
        : Math.max(0, sinceMs - PULL_OVERLAP_MS);
      const lowerBound = new Date(lowerBoundMs).toISOString();
      const rows: PulledRow[] = [];

      for (const table of SYNCED_TABLES) {
        const pk = table === 'profiles' ? 'user_id' : 'id';
        let afterUpdatedAt: string | null = null;
        let afterPk: string | null = null;

        for (;;) {
          const { data, error } = await client.rpc('sync_pull_page', {
            table_name: table,
            since_time: lowerBound,
            barrier_time: barrier.queryValue,
            after_updated_at: afterUpdatedAt,
            after_pk: afterPk,
            page_size: PULL_PAGE_SIZE,
          });
          if (error) throw new Error(`pull ${table}: ${errorMessage(error)}`);
          if (!Array.isArray(data) || data.length > PULL_PAGE_SIZE) {
            throw new Error(`pull ${table}: invalid page`);
          }
          if (data.length === 0) break;

          for (const value of data) {
            let row: Record<string, unknown>;
            try {
              row = unwrapPullRow(value);
            } catch {
              throw new Error(`pull ${table}: invalid row`);
            }
            const updatedAt = row.updated_at;
            const rowPk = row[pk];
            if (typeof updatedAt !== 'string' || rowPk === null || rowPk === undefined) {
              throw new Error(`pull ${table}: invalid row cursor`);
            }
            const updatedAtMs = Date.parse(updatedAt);
            const pkText = String(rowPk);
            const previousUpdatedAtMs = afterUpdatedAt === null ? null : Date.parse(afterUpdatedAt);
            const followsCursor = afterUpdatedAt === null
              || updatedAtMs > (previousUpdatedAtMs ?? Number.NEGATIVE_INFINITY)
              // JavaScript dates lose PostgreSQL's sub-millisecond precision.
              // When the raw timestamps differ but parse to the same ms, trust
              // the ordered database page; for an exact timestamp tie, the PK
              // must still advance.
              || (
                updatedAtMs === previousUpdatedAtMs
                && (updatedAt !== afterUpdatedAt || pkText > (afterPk ?? ''))
              );
            if (
              !Number.isFinite(updatedAtMs)
              || updatedAtMs < lowerBoundMs
              || updatedAtMs > barrier.epochMs
              || !followsCursor
            ) {
              throw new Error(`pull ${table}: invalid row order`);
            }
            rows.push({ table, row: toLocal(table, row) as PulledRow['row'] });
            afterUpdatedAt = updatedAt;
            afterPk = pkText;
          }

          if (data.length < PULL_PAGE_SIZE) break;
        }
      }
      return { rows, serverTime: barrier.cursor };
    },
  };
}
