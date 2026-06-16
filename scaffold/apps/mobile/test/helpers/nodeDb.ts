import { DatabaseSync } from 'node:sqlite';
import type { SqlDb, SqlParam } from '../../src/db/schema';

/**
 * node:sqlite-backed implementation of the SqlDb surface, so db + sync tests
 * exercise real SQLite semantics (transactions, autoincrement, partial
 * indexes) without a device. Pass a file path to simulate process restarts
 * against the same database file.
 */
export function openNodeDb(path = ':memory:'): SqlDb & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal');
  db.exec('pragma foreign_keys = on');
  let inTransaction = false;

  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, ...params: SqlParam[]) {
      return db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, ...params: SqlParam[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: SqlParam[]) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(fn) {
      if (inTransaction) throw new Error('nested transaction');
      inTransaction = true;
      db.exec('begin');
      try {
        await fn();
        db.exec('commit');
      } catch (e) {
        db.exec('rollback');
        throw e;
      } finally {
        inTransaction = false;
      }
    },
    close() {
      db.close();
    },
  };
}
