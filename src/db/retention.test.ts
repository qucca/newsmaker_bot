import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { deleteOldClusters, deleteOldArticles, runRetention } from './retention.js';

// Ретенция БД: чистим articles (по fetched_at) и clusters (по updated_at) старше горизонта.
// summaries/sent_log уезжают каскадом за clusters; articles.cluster_id/feedback.cluster_id → NULL.
// feedback и blocked_sources по возрасту НЕ чистим (сигналы обучения).

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); // каскады/SET NULL работают только при FK ON
  runMigrations(db);
  return db;
}

function seedUser(db: Database.Database, chatId: number): void {
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at)
     VALUES (?, 'en', 'UTC', 5, 0, 0)`,
  ).run(chatId);
}

function seedCluster(db: Database.Database, updatedAt: number): number {
  return Number(
    db
      .prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 0, ?)`)
      .run(updatedAt).lastInsertRowid,
  );
}

function seedArticle(db: Database.Database, url: string, fetchedAt: number, clusterId?: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO articles (canonical_url, source, title, fetched_at, cluster_id)
         VALUES (?, 's', 't', ?, ?)`,
      )
      .run(url, fetchedAt, clusterId ?? null).lastInsertRowid,
  );
}

function seedSummary(db: Database.Database, clusterId: number): void {
  db.prepare(
    `INSERT INTO summaries (cluster_id, lang, title, summary, content_hash, created_at)
     VALUES (?, 'en', 't', 's', 'h', 0)`,
  ).run(clusterId);
}

function seedSent(db: Database.Database, chatId: number, clusterId: number): void {
  db.prepare(
    `INSERT INTO sent_log (chat_id, cluster_id, kind, sent_at) VALUES (?, ?, 'digest', 0)`,
  ).run(chatId, clusterId);
}

function seedFeedback(db: Database.Database, chatId: number, clusterId: number): void {
  db.prepare(
    `INSERT INTO feedback (chat_id, cluster_id, vote, source, created_at) VALUES (?, ?, 1, 'src', 0)`,
  ).run(chatId, clusterId);
}

const count = (db: Database.Database, sql: string, ...p: unknown[]): number =>
  (db.prepare(sql).get(...p) as { n: number }).n;

test('deleteOldClusters: удаляет updated_at < cutoff, свежие оставляет, возвращает число', () => {
  const db = memDb();
  seedCluster(db, 100); // старый
  seedCluster(db, 100);
  seedCluster(db, 900); // свежий

  assert.equal(deleteOldClusters(db, 500), 2);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM clusters`), 1);
});

test('deleteOldClusters: каскад summaries/sent_log; feedback/articles.cluster_id → NULL', () => {
  const db = memDb();
  seedUser(db, 1);
  const oldC = seedCluster(db, 100);
  const freshC = seedCluster(db, 900);
  seedSummary(db, oldC);
  seedSummary(db, freshC);
  seedSent(db, 1, oldC);
  seedSent(db, 1, freshC);
  seedFeedback(db, 1, oldC);
  const art = seedArticle(db, 'https://a/1', 100, oldC);

  deleteOldClusters(db, 500);

  // каскад: summaries и sent_log старого кластера ушли, свежего — остались
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM summaries WHERE cluster_id = ?`, oldC), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM summaries WHERE cluster_id = ?`, freshC), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_log WHERE cluster_id = ?`, oldC), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_log WHERE cluster_id = ?`, freshC), 1);
  // SET NULL: фидбэк сохранён (голос/издание), ссылка на кластер обнулена
  const fb = db.prepare(`SELECT cluster_id AS c, vote AS v FROM feedback`).get() as {
    c: number | null;
    v: number;
  };
  assert.deepEqual(fb, { c: null, v: 1 });
  // SET NULL: статья сохранена, cluster_id обнулён
  const a = db.prepare(`SELECT cluster_id AS c FROM articles WHERE id = ?`).get(art) as {
    c: number | null;
  };
  assert.equal(a.c, null);
});

test('deleteOldArticles: удаляет fetched_at < cutoff, свежие оставляет, возвращает число', () => {
  const db = memDb();
  seedArticle(db, 'https://a/old', 100);
  seedArticle(db, 'https://a/old2', 100);
  seedArticle(db, 'https://a/fresh', 900);

  assert.equal(deleteOldArticles(db, 500), 2);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM articles`), 1);
});

test('runRetention: cutoff = now − horizon; чистит старое, свежее оставляет, считает', () => {
  const db = memDb();
  seedCluster(db, 4000); // < cutoff(5000) → удалить
  seedCluster(db, 6000); // свежий
  seedArticle(db, 'https://a/old', 4000);
  seedArticle(db, 'https://a/fresh', 6000);

  const res = runRetention(db, 10000, 5000); // cutoff = 5000

  assert.deepEqual(res, { clusters: 1, articles: 1 });
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM clusters`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM articles`), 1);
});
