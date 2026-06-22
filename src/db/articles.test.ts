import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { insertArticles, type ArticleInsert } from './articles.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function row(over: Partial<ArticleInsert> = {}): ArticleInsert {
  return {
    canonicalUrl: 'https://e.com/a',
    source: 'e.com',
    feedSourceId: null,
    lang: 'en',
    title: 'Title',
    publishedAt: 1000,
    fetchedAt: 2000,
    ...over,
  };
}

function readArticles(db: Database.Database): Record<string, unknown>[] {
  return db
    .prepare(`SELECT canonical_url, source, lang, title, published_at, fetched_at FROM articles`)
    .all() as Record<string, unknown>[];
}

test('insertArticles: вставляет новые строки и возвращает их число', () => {
  const db = memDb();
  const res = insertArticles(db, [
    row({ canonicalUrl: 'https://e.com/a' }),
    row({ canonicalUrl: 'https://e.com/b' }),
  ]);
  assert.equal(res.inserted, 2);
  assert.equal(readArticles(db).length, 2);
  db.close();
});

test('insertArticles: конфликт по canonical_url игнорируется, первый побеждает', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/a', title: 'First', source: 'a.com' })]);
  const res = insertArticles(db, [
    row({ canonicalUrl: 'https://e.com/a', title: 'Second', source: 'b.com' }),
  ]);
  assert.equal(res.inserted, 0);
  const rows = readArticles(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, 'First');
  assert.equal(rows[0]?.source, 'a.com');
  db.close();
});

test('insertArticles: дубликат внутри одного батча вставляется один раз', () => {
  const db = memDb();
  const res = insertArticles(db, [
    row({ canonicalUrl: 'https://e.com/a', title: 'First' }),
    row({ canonicalUrl: 'https://e.com/a', title: 'Dup' }),
  ]);
  assert.equal(res.inserted, 1);
  const rows = readArticles(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, 'First');
  db.close();
});

test('insertArticles: пустой вход — no-op', () => {
  const db = memDb();
  const res = insertArticles(db, []);
  assert.equal(res.inserted, 0);
  assert.equal(readArticles(db).length, 0);
  db.close();
});

test('insertArticles: nullable поля сохраняются как NULL, cluster/enriched пусты', () => {
  const db = memDb();
  insertArticles(db, [
    row({ canonicalUrl: 'https://e.com/a', lang: null, publishedAt: null, feedSourceId: null }),
  ]);
  const r = db
    .prepare(
      `SELECT lang, published_at, feed_source_id, cluster_id, enriched_at FROM articles WHERE canonical_url = 'https://e.com/a'`,
    )
    .get() as Record<string, unknown>;
  assert.equal(r.lang, null);
  assert.equal(r.published_at, null);
  assert.equal(r.feed_source_id, null);
  assert.equal(r.cluster_id, null);
  assert.equal(r.enriched_at, null);
  db.close();
});

test('insertArticles: feed_source_id ссылается на реальный sources.id (FK)', () => {
  const db = memDb();
  const info = db
    .prepare(
      `INSERT INTO sources (kind, name, url, lang) VALUES ('l1_rss', 'A', 'https://a/feed', 'en')`,
    )
    .run();
  const sid = Number(info.lastInsertRowid);
  const res = insertArticles(db, [row({ canonicalUrl: 'https://e.com/a', feedSourceId: sid })]);
  assert.equal(res.inserted, 1);
  const r = db
    .prepare(`SELECT feed_source_id FROM articles WHERE canonical_url = 'https://e.com/a'`)
    .get() as Record<string, unknown>;
  assert.equal(r.feed_source_id, sid);
  db.close();
});
