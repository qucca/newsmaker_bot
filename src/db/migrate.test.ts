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

test('0005: articles.regions + clusters.regions существуют', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const artCols = (db.prepare(`PRAGMA table_info(articles)`).all() as { name: string }[]).map((c) => c.name);
  const clsCols = (db.prepare(`PRAGMA table_info(clusters)`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(artCols.includes('regions'));
  assert.ok(clsCols.includes('regions'));
  const cid = db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 1, 1)`).run().lastInsertRowid;
  const row = db.prepare(`SELECT regions FROM clusters WHERE id = ?`).get(cid) as { regions: string };
  assert.equal(row.regions, '["GLOBAL"]'); // дефолт
  db.close();
});

test('0006: feedback.reason_type + reason_key существуют', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const cols = (db.prepare(`PRAGMA table_info(feedback)`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('reason_type'));
  assert.ok(cols.includes('reason_key'));
  db.close();
});

test('0006: CHECK на reason_type enforced + индекс существует', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  // вставляем тестового юзера
  db.prepare(`INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at) VALUES (1, 'en', 'UTC', 5, 0, 0)`).run();
  // валидный reason_type принимается
  db.prepare(
    `INSERT INTO feedback (chat_id, cluster_id, vote, source, created_at, reason_type)
     VALUES (1, NULL, 1, 'x', 0, 'pair')`,
  ).run();
  // невалидный reason_type отвергается CHECK
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO feedback (chat_id, cluster_id, vote, source, created_at, reason_type)
         VALUES (1, NULL, 1, 'x', 0, 'bad')`,
      )
      .run(),
  );
  // индекс создан
  const idx = (db.prepare(`PRAGMA index_list(feedback)`).all() as { name: string }[]).map((i) => i.name);
  assert.ok(idx.includes('idx_feedback_reason'));
  db.close();
});
