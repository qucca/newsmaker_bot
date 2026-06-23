import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

function clusterIndexNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'clusters'`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

test('migrations: 0003 заменяет индекс матчинга на (cluster_key, first_seen)', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const names = clusterIndexNames(db);
  assert.ok(names.has('idx_clusters_key_firstseen'), 'новый индекс существует');
  assert.ok(!names.has('idx_clusters_key_window'), 'старый индекс удалён');
  db.close();
});
