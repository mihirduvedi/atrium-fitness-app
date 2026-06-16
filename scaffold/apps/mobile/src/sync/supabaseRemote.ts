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
      // group consecutive mutations per table, preserving seq order across groups
      for (const m of mutations) {
        const { error } = await client
          .from(m.entity)
          .upsert(toServer(m.entity, m.payload), { onConflict: m.entity === 'profiles' ? 'user_id' : 'id' });
        if (error) throw new Error(`push ${m.entity}/${m.entity_id}: ${error.message}`);
      }
    },

    async pull(since: string): Promise<{ rows: PulledRow[]; serverTime: string }> {
      const rows: PulledRow[] = [];
      const serverTime = new Date().toISOString();
      for (const table of SYNCED_TABLES) {
        const { data, error } = await client.from(table).select('*').gt('updated_at', since);
        if (error) throw new Error(`pull ${table}: ${error.message}`);
        for (const row of data ?? []) {
          rows.push({ table, row: toLocal(table, row) as PulledRow['row'] });
        }
      }
      return { rows, serverTime };
    },
  };
}
