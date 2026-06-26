import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  insertArticles,
  selectUnenriched,
  writeEnrichment,
  selectUnclustered,
  assignCluster,
  selectRepresentative,
  type ArticleInsert,
  type EnrichmentWrite,
} from './articles.js';

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
    description: null,
    ...over,
  };
}

function enrichRow(over: Partial<EnrichmentWrite> = {}): EnrichmentWrite {
  return {
    id: 0,
    clusterKey: 'nato|ukraine',
    entities: ['NATO', 'Ukraine'],
    tags: ['world'],
    quality: 75,
    isUrgent: false,
    isMajor: true,
    neutralFacts: ['Fact one.', 'Fact two.'],
    enrichedAt: 5000,
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

test('insertArticles: сохраняет description', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/a', description: 'snippet' })]);
  const r = db
    .prepare(`SELECT description FROM articles WHERE canonical_url = 'https://e.com/a'`)
    .get() as Record<string, unknown>;
  assert.equal(r.description, 'snippet');
  db.close();
});

test('insertArticles: description=null сохраняется как NULL', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/b', description: null })]);
  const r = db
    .prepare(`SELECT description FROM articles WHERE canonical_url = 'https://e.com/b'`)
    .get() as Record<string, unknown>;
  assert.equal(r.description, null);
  db.close();
});

test('selectUnenriched: возвращает только необогащённых, по id, с лимитом', () => {
  const db = memDb();
  insertArticles(db, [
    row({ canonicalUrl: 'https://e.com/a', title: 'A' }),
    row({ canonicalUrl: 'https://e.com/b', title: 'B' }),
    row({ canonicalUrl: 'https://e.com/c', title: 'C' }),
  ]);
  const all = selectUnenriched(db, 10);
  assert.equal(all.length, 3);
  assert.equal(all[0].title, 'A');
  const limited = selectUnenriched(db, 2);
  assert.equal(limited.length, 2);
  db.close();
});

test('writeEnrichment: пишет поля, ставит enriched_at и убирает из необогащённых', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/a', description: 'd' })]);
  const id = selectUnenriched(db, 10)[0].id;
  const res = writeEnrichment(db, [enrichRow({ id })]);
  assert.equal(res.updated, 1);
  const r = db
    .prepare(
      `SELECT enriched_at, cluster_key, entities, tags, quality, is_urgent, is_major, neutral_facts FROM articles WHERE id = ?`,
    )
    .get(id) as Record<string, unknown>;
  assert.equal(r.enriched_at, 5000);
  assert.equal(r.cluster_key, 'nato|ukraine');
  assert.deepEqual(JSON.parse(r.entities as string), ['NATO', 'Ukraine']);
  assert.deepEqual(JSON.parse(r.tags as string), ['world']);
  assert.equal(r.quality, 75);
  assert.equal(r.is_urgent, 0);
  assert.equal(r.is_major, 1);
  assert.deepEqual(JSON.parse(r.neutral_facts as string), ['Fact one.', 'Fact two.']);
  assert.equal(selectUnenriched(db, 10).length, 0); // больше не необогащён
  db.close();
});

test('selectUnclustered: только обогащённые без кластера', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/a' }), row({ canonicalUrl: 'https://e.com/b' })]);
  assert.equal(selectUnclustered(db, 10).length, 0); // ни одна не обогащена
  const id = selectUnenriched(db, 10)[0].id;
  writeEnrichment(db, [enrichRow({ id })]);
  const got = selectUnclustered(db, 10);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, id);
  assert.equal(got[0].clusterKey, 'nato|ukraine');
  db.close();
});

test('assignCluster: проставляет cluster_id и убирает из некластеризованных', () => {
  const db = memDb();
  insertArticles(db, [row({ canonicalUrl: 'https://e.com/a' })]);
  const id = selectUnenriched(db, 10)[0].id;
  writeEnrichment(db, [enrichRow({ id })]);
  const cid = Number(
    db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 1, 1)`).run()
      .lastInsertRowid,
  );
  assignCluster(db, id, cid);
  assert.equal(selectUnclustered(db, 10).length, 0);
  const r = db.prepare(`SELECT cluster_id FROM articles WHERE id = ?`).get(id) as Record<string, unknown>;
  assert.equal(r.cluster_id, cid);
  db.close();
});

test('selectRepresentative: маппит canonical_url→url и source', () => {
  const db = memDb();
  insertArticles(db, [
    row({ canonicalUrl: 'https://techcrunch.com/x', source: 'techcrunch.com' }),
  ]);
  const r = db
    .prepare(`SELECT id FROM articles WHERE canonical_url = ?`)
    .get('https://techcrunch.com/x') as { id: number };
  assert.deepEqual(selectRepresentative(db, r.id), {
    url: 'https://techcrunch.com/x',
    source: 'techcrunch.com',
  });
  db.close();
});

test('selectRepresentative: undefined когда строки нет', () => {
  const db = memDb();
  assert.equal(selectRepresentative(db, 999), undefined);
  db.close();
});
