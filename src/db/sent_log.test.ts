import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { insertSent, countSentCards } from './sent_log.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedUserAndCluster(db: Database.Database): { chatId: number; clusterId: number } {
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at)
     VALUES (1, 'en', 'UTC', 5, 0, 0)`,
  ).run();
  const info = db
    .prepare(
      `INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 0, 0)`,
    )
    .run();
  return { chatId: 1, clusterId: Number(info.lastInsertRowid) };
}

test('insertSent: пишет строку (chat_id, cluster_id, kind, sent_at)', () => {
  const db = memDb();
  const { chatId, clusterId } = seedUserAndCluster(db);

  insertSent(db, chatId, clusterId, 'digest', 12345);

  const row = db
    .prepare(`SELECT chat_id AS c, cluster_id AS cl, kind AS k, sent_at AS s FROM sent_log`)
    .get() as { c: number; cl: number; k: string; s: number };
  assert.deepEqual(row, { c: chatId, cl: clusterId, k: 'digest', s: 12345 });
});

test('insertSent: повтор того же (chat_id, cluster_id) — идемпотентно (одна строка)', () => {
  const db = memDb();
  const { chatId, clusterId } = seedUserAndCluster(db);

  insertSent(db, chatId, clusterId, 'digest', 100);
  insertSent(db, chatId, clusterId, 'digest', 200); // не должно бросить и не перезаписать

  const rows = db.prepare(`SELECT sent_at AS s FROM sent_log`).all() as { s: number }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].s, 100); // ON CONFLICT DO NOTHING — первая запись сохраняется
});

test('countSentCards: считает кластеры юзера, изолированно по chat_id', () => {
  const db = memDb();
  const { chatId, clusterId } = seedUserAndCluster(db);
  // второй кластер и второй юзер
  const c2 = Number(
    db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k2', 0, 0)`).run()
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at)
     VALUES (2, 'en', 'UTC', 5, 0, 0)`,
  ).run();

  assert.equal(countSentCards(db, chatId), 0);
  insertSent(db, chatId, clusterId, 'digest', 100);
  insertSent(db, chatId, c2, 'digest', 100);
  insertSent(db, 2, clusterId, 'digest', 100); // другой юзер
  insertSent(db, chatId, clusterId, 'digest', 200); // повтор — не увеличивает

  assert.equal(countSentCards(db, chatId), 2);
  assert.equal(countSentCards(db, 2), 1);
  assert.equal(countSentCards(db, 999), 0);
});
