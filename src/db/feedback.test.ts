import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { recordFeedback, getFeedbackVote } from './feedback.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seed(db: Database.Database): { chatId: number; clusterId: number } {
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at)
     VALUES (1, 'en', 'UTC', 5, 0, 0)`,
  ).run();
  const clusterId = Number(
    db
      .prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 0, 0)`)
      .run().lastInsertRowid,
  );
  return { chatId: 1, clusterId };
}

test('recordFeedback: вставляет голос (chat_id, cluster_id, vote, source, created_at)', () => {
  const db = memDb();
  const { chatId, clusterId } = seed(db);

  recordFeedback(db, { chatId, clusterId, vote: 1, source: 'bbc.com', now: 100 });

  const row = db
    .prepare(
      `SELECT chat_id AS c, cluster_id AS cl, vote AS v, source AS s, created_at AS t FROM feedback`,
    )
    .get() as { c: number; cl: number; v: number; s: string; t: number };
  assert.deepEqual(row, { c: chatId, cl: clusterId, v: 1, s: 'bbc.com', t: 100 });
});

test('recordFeedback: переголос перезаписывает vote+created_at, одна строка', () => {
  const db = memDb();
  const { chatId, clusterId } = seed(db);

  recordFeedback(db, { chatId, clusterId, vote: 1, source: 'bbc.com', now: 100 });
  recordFeedback(db, { chatId, clusterId, vote: -1, source: 'bbc.com', now: 200 });

  const rows = db.prepare(`SELECT vote AS v, created_at AS t FROM feedback`).all() as {
    v: number;
    t: number;
  }[];
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { v: -1, t: 200 });
});

test('getFeedbackVote: текущий голос или undefined', () => {
  const db = memDb();
  const { chatId, clusterId } = seed(db);

  assert.equal(getFeedbackVote(db, chatId, clusterId), undefined);
  recordFeedback(db, { chatId, clusterId, vote: -1, source: 'x', now: 1 });
  assert.equal(getFeedbackVote(db, chatId, clusterId), -1);
});
