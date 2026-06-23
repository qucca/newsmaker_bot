import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { clusterPending } from './index.js';

const H = 3_600_000;
const DEPS = { windowMs: 72 * H, runCap: 1000 };

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let seq = 0;
// Вставляет обогащённую, ещё НЕ кластеризованную статью; возвращает её id.
function addArticle(db: Database.Database, over: Record<string, unknown> = {}): number {
  const v = {
    source: 'e.com',
    clusterKey: 'k',
    publishedAt: 1000,
    fetchedAt: 1000,
    quality: 50,
    isUrgent: 0,
    isMajor: 0,
    tags: '["world"]',
    entities: '["NATO"]',
    neutralFacts: '["A.","B."]',
    ...over,
  };
  const info = db
    .prepare(
      `INSERT INTO articles (canonical_url, source, title, fetched_at, published_at, enriched_at,
         cluster_key, entities, tags, quality, is_urgent, is_major, neutral_facts)
       VALUES (@url, @source, 'T', @fetchedAt, @publishedAt, 5000,
         @clusterKey, @entities, @tags, @quality, @isUrgent, @isMajor, @neutralFacts)`,
    )
    .run({ url: `https://e.com/${seq++}`, ...v });
  return Number(info.lastInsertRowid);
}

function clusterCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM clusters`).get() as { c: number }).c;
}

test('clusterPending: одинаковый ключ в окне → один кластер', async () => {
  const db = memDb();
  addArticle(db, { clusterKey: 'k', publishedAt: 1000, source: 'a.com' });
  addArticle(db, { clusterKey: 'k', publishedAt: 1000 + 10 * H, source: 'b.com' });
  const res = await clusterPending(db, DEPS);
  assert.equal(res.created, 1);
  assert.equal(res.joined, 1);
  assert.equal(clusterCount(db), 1);
  db.close();
});

test('clusterPending: одинаковый ключ за окном → два кластера', async () => {
  const db = memDb();
  addArticle(db, { clusterKey: 'k', publishedAt: 0 });
  addArticle(db, { clusterKey: 'k', publishedAt: 73 * H }); // > 72ч от first_seen
  const res = await clusterPending(db, DEPS);
  assert.equal(res.created, 2);
  assert.equal(res.joined, 0);
  assert.equal(clusterCount(db), 2);
  db.close();
});

test('clusterPending: пустой ключ → отдельные синглтоны (не склеиваются)', async () => {
  const db = memDb();
  addArticle(db, { clusterKey: '', publishedAt: 1000 });
  addArticle(db, { clusterKey: '', publishedAt: 1000 });
  const res = await clusterPending(db, DEPS);
  assert.equal(res.created, 2);
  assert.equal(clusterCount(db), 2);
  db.close();
});

test('clusterPending: лучшая статья промотируется; content_hash отражает её факты', async () => {
  const db = memDb();
  const a1 = addArticle(db, {
    clusterKey: 'k', publishedAt: 1000, quality: 40, neutralFacts: '["low."]', source: 'a.com',
  });
  await clusterPending(db, DEPS);
  const c1 = db
    .prepare(`SELECT rep_article_id, quality, content_hash FROM clusters`)
    .get() as Record<string, unknown>;
  assert.equal(c1.rep_article_id, a1);
  assert.equal(c1.quality, 40);
  const hashBefore = c1.content_hash;

  const a2 = addArticle(db, {
    clusterKey: 'k', publishedAt: 1000 + 5 * H, quality: 90, neutralFacts: '["high."]', source: 'b.com',
  });
  await clusterPending(db, DEPS);
  const c2 = db
    .prepare(`SELECT rep_article_id, quality, neutral_facts, content_hash FROM clusters`)
    .get() as Record<string, unknown>;
  assert.equal(c2.rep_article_id, a2);
  assert.equal(c2.quality, 90);
  assert.deepEqual(JSON.parse(c2.neutral_facts as string), ['high.']);
  assert.notEqual(c2.content_hash, hashBefore);
  db.close();
});

test('clusterPending: is_urgent/is_major = OR по членам', async () => {
  const db = memDb();
  addArticle(db, { clusterKey: 'k', publishedAt: 1000, isUrgent: 0, isMajor: 1, quality: 80 });
  addArticle(db, { clusterKey: 'k', publishedAt: 1000, isUrgent: 1, isMajor: 0, quality: 40 });
  await clusterPending(db, DEPS);
  const c = db.prepare(`SELECT is_urgent, is_major FROM clusters`).get() as Record<string, unknown>;
  assert.equal(c.is_urgent, 1);
  assert.equal(c.is_major, 1);
  db.close();
});

test('clusterPending: source_count не хранится, считается COUNT(DISTINCT source)', async () => {
  const db = memDb();
  addArticle(db, { clusterKey: 'k', publishedAt: 1000, source: 'a.com' });
  addArticle(db, { clusterKey: 'k', publishedAt: 1000, source: 'b.com' });
  addArticle(db, { clusterKey: 'k', publishedAt: 1000, source: 'a.com' }); // дубль источника
  await clusterPending(db, DEPS);
  const cid = (db.prepare(`SELECT id FROM clusters`).get() as { id: number }).id;
  const r = db
    .prepare(`SELECT COUNT(DISTINCT source) AS sc FROM articles WHERE cluster_id = ?`)
    .get(cid) as { sc: number };
  assert.equal(r.sc, 2);
  db.close();
});

test('clusterPending: повторный прогон без новых статей — no-op', async () => {
  const db = memDb();
  addArticle(db, { clusterKey: 'k', publishedAt: 1000 });
  await clusterPending(db, DEPS);
  const res2 = await clusterPending(db, DEPS);
  assert.equal(res2.selected, 0);
  assert.equal(res2.created, 0);
  assert.equal(res2.joined, 0);
  db.close();
});
