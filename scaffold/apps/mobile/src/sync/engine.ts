import type { Row } from '../db/dao';
import { SYNCED_TABLES, type SqlDb, type SyncedTable } from '../db/schema';
import { realClock, type QueuedMutation, type RemoteApi, type SyncClock } from './types';

/**
 * Offline-first sync (brief Part E). SQLite is the source of truth on
 * device; the server is a replica that other devices (and the future coach)
 * read.
 *
 * CONFLICT STANCE: an unpushed local mutation always wins for its entity.
 * Otherwise the server row is authoritative. In particular, a device clock
 * that is ahead of server time must not make a clean local row immortal.
 * Matching updated_at revisions may be skipped because they already identify
 * the same committed server revision.
 */

export const PUSH_BATCH_SIZE = 50;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60_000;

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Set when push gave up after maxAttempts (the queue stays durable). */
  pushError?: string;
}

export class SyncEngine {
  /** Pulls share one ordered chain so cursor reads, remote snapshots, and applies cannot race. */
  private pullTail: Promise<void> = Promise.resolve();

  /** Exposed for tests: backoff delay before retry n (0-based). */
  static backoffMs(attempt: number): number {
    return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  }

  constructor(
    private db: SqlDb,
    private remote: RemoteApi,
    private userId: string,
    private deviceId: string,
    private clock: SyncClock = realClock,
  ) {}

  async unpushedCount(): Promise<number> {
    const r = await this.db.getFirstAsync<{ n: number }>(
      'select count(*) as n from mutation_queue where pushed_at is null',
    );
    return r?.n ?? 0;
  }

  /**
   * Drain the queue in seq order, batches of up to 50. Exponential backoff
   * 1s → 60s cap on failure; gives up after maxAttempts leaving the queue
   * intact (it lives in SQLite, so it survives app kill by construction).
   */
  async push(maxAttempts = 5): Promise<{ pushed: number; error?: string }> {
    let pushed = 0;
    let attempt = 0;
    for (;;) {
      const candidates = await this.db.getAllAsync<{
        id: string;
        seq: number;
        entity: SyncedTable;
        entity_id: string;
        op: 'upsert' | 'delete';
        payload: string;
        created_at: string;
      }>(
        `select id, seq, entity, entity_id, op, payload, created_at
         from mutation_queue where pushed_at is null order by seq limit ?`,
        PUSH_BATCH_SIZE + 1,
      );
      let batch = candidates.slice(0, PUSH_BATCH_SIZE);

      // A Coach deload workout and its side-table marker are queued
      // consecutively. Keep that pair in one remote batch so the remote can
      // publish them atomically; if the pair straddles the 50-row boundary,
      // leave the workout for the next batch with its marker.
      const boundary = batch[batch.length - 1];
      const lookahead = candidates[PUSH_BATCH_SIZE];
      if (
        boundary?.entity === 'workouts'
        && lookahead?.entity === 'workout_training_intents'
        && boundary.entity_id === lookahead.entity_id
      ) {
        batch = batch.slice(0, -1);
      }
      if (batch.length === 0) return { pushed };

      const mutations: QueuedMutation[] = batch.map((m) => ({ ...m, payload: JSON.parse(m.payload) as Row }));
      try {
        await this.remote.pushBatch(mutations);
      } catch (e) {
        attempt += 1;
        if (attempt >= maxAttempts) {
          return { pushed, error: e instanceof Error ? e.message : String(e) };
        }
        await this.clock.sleep(SyncEngine.backoffMs(attempt - 1));
        continue;
      }
      attempt = 0; // a successful batch resets the backoff
      const ts = new Date(this.clock.now()).toISOString();
      await this.db.withTransactionAsync(async () => {
        for (const m of batch) {
          await this.db.runAsync('update mutation_queue set pushed_at = ? where seq = ?', ts, m.seq);
        }
      });
      pushed += batch.length;
    }
  }

  /** Serialize pulls for this engine even when foreground/background callers overlap. */
  pull(): Promise<{ pulled: number }> {
    const pending = this.pullTail.then(() => this.pullOnce());
    this.pullTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  /**
   * Pull rows after the server cursor. Dirty local entities win; every clean
   * row accepts the server revision, including tombstones older than a
   * device-generated local timestamp. Apply and cursor movement are one
   * isolated transaction, so consumers never observe a partial pull.
   */
  private async pullOnce(): Promise<{ pulled: number }> {
    const cursor = await this.db.getFirstAsync<{ last_pulled_at: string }>(
      'select last_pulled_at from sync_cursors where user_id = ? and device_id = ?',
      this.userId,
      this.deviceId,
    );
    const since = cursor?.last_pulled_at ?? '1970-01-01T00:00:00.000Z';
    const { rows, serverTime } = await this.remote.pull(since);

    let applied = 0;
    await this.withPullTransaction(async (transaction) => {
      for (const { table, row } of rows) {
        if (!(SYNCED_TABLES as readonly string[]).includes(table)) continue;
        const pk = table === 'profiles' ? 'user_id' : 'id';
        const id = String(row[pk]);

        // This check deliberately happens inside the same exclusive
        // transaction as the upsert. A local edit queued after the network
        // response but before apply must still win.
        const dirty = await transaction.getFirstAsync<{ dirty: number }>(
          `select 1 as dirty
             from mutation_queue
            where entity = ? and entity_id = ? and pushed_at is null
            limit 1`,
          table,
          id,
        );
        if (dirty) continue;

        const local = await transaction.getFirstAsync<{ updated_at: string }>(
          `select updated_at from ${table} where ${pk} = ?`,
          id,
        );
        if (local && String(local.updated_at) === String(row.updated_at)) continue;

        const cols = Object.keys(row);
        const assignments = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`).join(', ');
        await transaction.runAsync(
          `insert into ${table} (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})
           on conflict (${pk}) do update set ${assignments}`,
          ...cols.map((c) => row[c] ?? null),
        );
        applied += 1;
      }
      await transaction.runAsync(
        `insert into sync_cursors (user_id, device_id, last_pulled_at, updated_at)
         values (?, ?, ?, ?)
         on conflict (user_id, device_id) do update
           set last_pulled_at = excluded.last_pulled_at,
               updated_at = excluded.updated_at`,
        this.userId,
        this.deviceId,
        serverTime,
        serverTime,
      );
    });
    return { pulled: applied };
  }

  /** Native/node isolation, with Expo SQLite's exact unsupported-web fallback. */
  private async withPullTransaction(fn: (transaction: SqlDb) => Promise<void>): Promise<void> {
    if (this.db.withExclusiveTransactionAsync) {
      try {
        await this.db.withExclusiveTransactionAsync(fn);
        return;
      } catch (error) {
        const unsupportedOnWeb = error instanceof Error
          && error.message === 'withExclusiveTransactionAsync is not supported on web';
        if (!unsupportedOnWeb) throw error;
      }
    }
    await this.db.withTransactionAsync(() => fn(this.db));
  }

  /** Push, then pull (the Part E loop: pull after each successful push). */
  async sync(): Promise<SyncResult> {
    const { pushed, error } = await this.push();
    if (error) return { pushed, pulled: 0, pushError: error };
    const { pulled } = await this.pull();
    return { pushed, pulled };
  }

  /** Housekeeping: drop mutation rows pushed more than `days` ago. */
  async pruneQueue(days = 7): Promise<void> {
    const cutoff = new Date(this.clock.now() - days * 86_400_000).toISOString();
    await this.db.runAsync('delete from mutation_queue where pushed_at is not null and pushed_at < ?', cutoff);
  }
}
