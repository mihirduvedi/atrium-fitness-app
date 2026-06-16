import type { Row } from '../db/dao';
import type { SyncedTable } from '../db/schema';

export interface QueuedMutation {
  id: string;
  seq: number;
  entity: SyncedTable;
  entity_id: string;
  op: 'upsert' | 'delete';
  payload: Row;
  created_at: string;
}

export interface PulledRow {
  table: SyncedTable;
  row: Row;
}

/**
 * The network seam. The real implementation talks to Supabase (upserts keyed
 * on client UUIDs — idempotent, so retries are always safe); tests swap in a
 * mock whose network can be killed.
 */
export interface RemoteApi {
  /** Apply a batch of mutations. Must be idempotent. Throws on network failure. */
  pushBatch(mutations: QueuedMutation[]): Promise<void>;
  /** All rows for this user with updated_at > since, every synced table. */
  pull(since: string): Promise<{ rows: PulledRow[]; serverTime: string }>;
}

export interface SyncClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: SyncClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
