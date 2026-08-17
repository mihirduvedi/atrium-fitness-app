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
  /**
   * Apply a batch idempotently. Consecutive workout + Coach-intent mutations
   * for one id are kept in the same batch so the remote can publish that pair
   * atomically. Throws when the batch was not acknowledged; callers may retry
   * the entire batch even when the acknowledgement was lost after commit.
   */
  pushBatch(mutations: QueuedMutation[]): Promise<void>;
  /**
   * Return a complete remote snapshot newer than `since`. `serverTime` is an
   * authoritative normalized UTC server cursor at or after every returned
   * revision; it must never come from the device clock.
   */
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
