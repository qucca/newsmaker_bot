import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { readEnabledL1Sources, readEnabledFeedSources, updateConditionalGet } from './sources.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function insert(
  db: Database.Database,
  f: { name: string; url: string; kind?: string; enabled?: number; lang?: string },
): number {
  const info = db
    .prepare(`INSERT INTO sources (kind, name, url, lang, enabled) VALUES (?, ?, ?, ?, ?)`)
    .run(f.kind ?? 'l1_rss', f.name, f.url, f.lang ?? 'en', f.enabled ?? 1);
  return Number(info.lastInsertRowid);
}

test('readEnabledL1Sources: только enabled и kind=l1_rss, camelCase', () => {
  const db = memDb();
  const keep = insert(db, { name: 'Keep', url: 'https://a.com/feed' });
  insert(db, { name: 'Disabled', url: 'https://b.com/feed', enabled: 0 });
  insert(db, { name: 'GNews', url: 'https://c.com/feed', kind: 'gnews_topic' });

  const rows = readEnabledL1Sources(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, keep);
  assert.equal(rows[0]?.name, 'Keep');
  assert.equal(rows[0]?.lastModified, null);
  assert.equal(rows[0]?.lastFetchedAt, null);
  db.close();
});

test('updateConditionalGet: пишет etag/last_modified/last_fetched_at', () => {
  const db = memDb();
  const id = insert(db, { name: 'A', url: 'https://a.com/feed' });

  updateConditionalGet(db, id, { etag: 'W/"v9"', lastModified: 'lm9', fetchedAt: 123 });

  const row = readEnabledL1Sources(db)[0];
  assert.equal(row?.etag, 'W/"v9"');
  assert.equal(row?.lastModified, 'lm9');
  assert.equal(row?.lastFetchedAt, 123);
  db.close();
});

test('updateConditionalGet: умеет писать null-валидаторы', () => {
  const db = memDb();
  const id = insert(db, { name: 'A', url: 'https://a.com/feed' });

  updateConditionalGet(db, id, { etag: null, lastModified: null, fetchedAt: 456 });

  const row = readEnabledL1Sources(db)[0];
  assert.equal(row?.etag, null);
  assert.equal(row?.lastModified, null);
  assert.equal(row?.lastFetchedAt, 456);
  db.close();
});

test('readEnabledFeedSources: includeGn=false → только l1_rss', () => {
  const db = memDb();
  const l1 = insert(db, { name: 'L1', url: 'https://a.com/feed' });
  insert(db, { name: 'GN', url: 'https://news.google.com/rss', kind: 'gnews_topic' });

  const rows = readEnabledFeedSources(db, { includeGn: false });
  assert.deepEqual(
    rows.map((r) => r.id),
    [l1],
  );
  db.close();
});

test('readEnabledFeedSources: includeGn=true → l1_rss + gnews_topic, но не gnews_search', () => {
  const db = memDb();
  const l1 = insert(db, { name: 'L1', url: 'https://a.com/feed' });
  const gn = insert(db, { name: 'GN', url: 'https://news.google.com/rss', kind: 'gnews_topic' });
  insert(db, { name: 'Search', url: 'https://news.google.com/rss/search?q=x', kind: 'gnews_search' });

  const rows = readEnabledFeedSources(db, { includeGn: true });
  assert.deepEqual(
    rows.map((r) => r.id).sort((a, b) => a - b),
    [l1, gn].sort((a, b) => a - b),
  );
  db.close();
});
