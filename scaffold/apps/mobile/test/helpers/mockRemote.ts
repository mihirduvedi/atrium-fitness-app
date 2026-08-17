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
  private serverMs = Date.parse('2026-01-01T00:00:00.000Z');

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
    this.table(t).set(String(row[pk]), { ...row });
    const revisionMs = Date.parse(String(row.updated_at));
    if (Number.isFinite(revisionMs)) this.serverMs = Math.max(this.serverMs, revisionMs + 1);
  }

  get(t: SyncedTable, id: string): Row | undefined {
    return this.table(t).get(id);
  }

  /** Set the remote clock independently from any device FakeClock. */
  setServerTime(at: string): void {
    const parsed = Date.parse(at);
    if (!Number.isFinite(parsed)) throw new Error(`invalid mock server time: ${at}`);
    this.serverMs = parsed;
  }

  currentServerTime(): string {
    return new Date(this.serverMs).toISOString();
  }

  advanceServerTime(ms = 1): string {
    this.serverMs += ms;
    return this.currentServerTime();
  }

  async pushBatch(mutations: QueuedMutation[]): Promise<void> {
    this.pushCalls += 1;
    if (!this.online) throw new Error('network unreachable');

    // Model one atomic server commit: no pull can observe a prefix of this
    // batch, and a lost acknowledgement can safely retry the whole batch.
    const commitTime = this.advanceServerTime();
    const staged = new Map<SyncedTable, Map<string, Row>>(
      [...this.tables].map(([table, rows]) => [table, new Map(rows)]),
    );
    const stagedTable = (table: SyncedTable) => {
      let rows = staged.get(table);
      if (!rows) {
        rows = new Map();
        staged.set(table, rows);
      }
      return rows;
    };
    for (const m of mutations) {
      const pk = m.entity === 'profiles' ? 'user_id' : 'id';
      const id = String(m.payload[pk]);
      const rows = stagedTable(m.entity);
      const existing = rows.get(id);
      // idempotent upsert keyed on client UUID
      rows.set(id, { ...existing, ...m.payload, updated_at: commitTime });
    }
    this.tables = staged;
  }

  async pull(since: string): Promise<{ rows: PulledRow[]; serverTime: string }> {
    if (!this.online) throw new Error('network unreachable');
    const rows: PulledRow[] = [];
    for (const [table, byId] of this.tables) {
      for (const row of byId.values()) {
        if (String(row.updated_at) > since) rows.push({ table, row: { ...row } });
      }
    }
    return { rows, serverTime: this.currentServerTime() };
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
