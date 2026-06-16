import type { SqlDb, SqlParam, SyncedTable } from './schema';

/**
 * Write path (brief Part E): every local write is ONE transaction that
 * (a) upserts the entity row and (b) appends to mutation_queue. The UI reads
 * only from SQLite — never from network responses. The push task drains the
 * queue later; if the process dies first, the queue row is already durable.
 */

export type Row = Record<string, SqlParam>;

const nowIso = () => new Date().toISOString();

/** Simple v4-ish UUID from Math.random is NOT acceptable for sync keys; the
 * app passes expo-crypto's randomUUID. Tests pass a counter. */
export type IdFn = () => string;

export async function upsertWithMutation(
  db: SqlDb,
  table: SyncedTable,
  row: Row,
  idFn: IdFn,
): Promise<void> {
  const updated: Row = { ...row, updated_at: (row.updated_at as string) ?? nowIso() };
  const cols = Object.keys(updated);
  const placeholders = cols.map(() => '?').join(', ');
  const assignments = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `insert into ${table} (${cols.join(', ')}) values (${placeholders})
       on conflict (${table === 'profiles' ? 'user_id' : 'id'}) do update set ${assignments}`,
      ...cols.map((c) => updated[c] ?? null),
    );
    await db.runAsync(
      `insert into mutation_queue (id, entity, entity_id, op, payload, created_at)
       values (?, ?, ?, 'upsert', ?, ?)`,
      idFn(),
      table,
      String(updated.id ?? updated.user_id),
      JSON.stringify(updated),
      nowIso(),
    );
  });
}

/** Soft delete: tombstone the row and queue the mutation (sync needs tombstones). */
export async function softDeleteWithMutation(
  db: SqlDb,
  table: SyncedTable,
  id: string,
  idFn: IdFn,
): Promise<void> {
  const ts = nowIso();
  const pk = table === 'profiles' ? 'user_id' : 'id';
  await db.withTransactionAsync(async () => {
    await db.runAsync(`update ${table} set deleted_at = ?, updated_at = ? where ${pk} = ?`, ts, ts, id);
    const row = await db.getFirstAsync<Row>(`select * from ${table} where ${pk} = ?`, id);
    await db.runAsync(
      `insert into mutation_queue (id, entity, entity_id, op, payload, created_at)
       values (?, ?, ?, 'delete', ?, ?)`,
      idFn(),
      table,
      id,
      JSON.stringify(row ?? { [pk]: id, deleted_at: ts, updated_at: ts }),
      ts,
    );
  });
}
