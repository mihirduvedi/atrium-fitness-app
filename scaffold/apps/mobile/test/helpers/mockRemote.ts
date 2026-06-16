import type { Row } from '../../src/db/dao';
import type { SyncedTable } from '../../src/db/schema';
import type { PulledRow, QueuedMutation, RemoteApi } from '../../src/sync/types';

/**
 * In-memory "server": tables of rows keyed by client UUID, with a network
 * switch. Mirrors the two server behaviors the engine depends on —
 * idempotent upserts and updated_at-filtered pulls.
 */
export class MockRemote implements RemoteApi {
  online = true;
  pushCalls = 0;
  tables = new Map<SyncedTable, Map<string, Row>>();

  private table(t: SyncedTable): Map<string, Row> {
    let m = this.tables.get(t);
    if (!m) {
      m = new Map();
      this.tables.set(t, m);
    }
    return m;
  }

  /** Seed a server-side row (e.g. an edit from another device). */
  seed(t: SyncedTable, row: Row): void {
    const pk = t === 'profiles' ? 'user_id' : 'id';
    this.table(t).set(String(row[pk]), row);
  }

  get(t: SyncedTable, id: string): Row | undefined {
    return this.table(t).get(id);
  }

  async pushBatch(mutations: QueuedMutation[]): Promise<void> {
    this.pushCalls += 1;
    if (!this.online) throw new Error('network unreachable');
    for (const m of mutations) {
      const pk = m.entity === 'profiles' ? 'user_id' : 'id';
      const id = String(m.payload[pk]);
      const existing = this.table(m.entity).get(id);
      // idempotent upsert keyed on client UUID
      this.table(m.entity).set(id, { ...existing, ...m.payload });
    }
  }

  async pull(since: string): Promise<{ rows: PulledRow[]; serverTime: string }> {
    if (!this.online) throw new Error('network unreachable');
    const rows: PulledRow[] = [];
    for (const [table, byId] of this.tables) {
      for (const row of byId.values()) {
        if (String(row.updated_at) > since) rows.push({ table, row });
      }
    }
    return { rows, serverTime: new Date().toISOString() };
  }
}

/** Deterministic clock: sleeps record their duration and return instantly. */
export class FakeClock {
  t = 0;
  sleeps: number[] = [];
  now = () => this.t;
  sleep = async (ms: number) => {
    this.sleeps.push(ms);
    this.t += ms;
  };
}

let n = 0;
export const testId = () => `id-${++n}`;
