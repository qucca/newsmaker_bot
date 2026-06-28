import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  findCandidateClusters,
  createCluster,
  selectClusterMembers,
  updateClusterAggregate,
  getClusterRepSource,
} from './clusters.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let seq = 0;
// Вставляет обогащённую статью, привязанную к кластеру clusterId; возвращает её id.
function seedMember(
  db: Database.Database,
  clusterId: number,
  over: Record<string, unknown> = {},
): number {
  const v = {
    source: 'e.com',
    quality: 50,
    publishedAt: 1000,
    fetchedAt: 2000,
    isUrgent: 0,
    isMajor: 0,
    tags: '["world"]',
    entities: '["NATO"]',
    neutralFacts: '["A.","B."]',
    ...over,
  };
  const info = db
    .prepare(
      `INSERT INTO articles (canonical_url, source, title, fetched_at, published_at, cluster_id,
         enriched_at, cluster_key, entities, tags, quality, is_urgent, is_major, neutral_facts)
       VALUES (@url, @source, 'T', @fetchedAt, @publishedAt, @clusterId,
         5000, 'k', @entities, @tags, @quality, @isUrgent, @isMajor, @neutralFacts)`,
    )
    .run({ url: `https://e.com/${seq++}`, clusterId, ...v });
  return Number(info.lastInsertRowid);
}

test('findCandidateClusters: фильтрует по ключу и first_seen >= minFirstSeen', () => {
  const db = memDb();
  db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('a', 100, 100)`).run();
  db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('a', 50, 50)`).run();
  db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('b', 100, 100)`).run();
  const got = findCandidateClusters(db, 'a', 60);
  assert.equal(got.length, 1);
  assert.equal(got[0].firstSeen, 100);
  db.close();
});

test('createCluster: создаёт минимальный кластер и возвращает id', () => {
  const db = memDb();
  const id = createCluster(db, 'k', 1234);
  const r = db
    .prepare(`SELECT cluster_key, first_seen, updated_at FROM clusters WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  assert.equal(r.cluster_key, 'k');
  assert.equal(r.first_seen, 1234);
  assert.equal(r.updated_at, 1234);
  db.close();
});

test('selectClusterMembers: возвращает статьи кластера с нужными полями', () => {
  const db = memDb();
  const cid = createCluster(db, 'k', 1000);
  seedMember(db, cid, { quality: 70, publishedAt: 1000 });
  seedMember(db, cid, { quality: 40, publishedAt: 2000 });
  const members = selectClusterMembers(db, cid);
  assert.equal(members.length, 2);
  assert.equal(typeof members[0].quality, 'number');
  assert.equal(typeof members[0].neutralFacts, 'string');
  db.close();
});

test('updateClusterAggregate: перезаписывает агрегатные поля кластера', () => {
  const db = memDb();
  const cid = createCluster(db, 'k', 1000);
  const aid = seedMember(db, cid);
  updateClusterAggregate(db, cid, {
    tags: '["tech"]',
    entities: '["Apple"]',
    neutralFacts: '["X."]',
    quality: 90,
    isUrgent: 1,
    isMajor: 0,
    repId: aid,
    firstSeen: 500,
    updatedAt: 1500,
    contentHash: 'deadbeef',
  });
  const r = db
    .prepare(
      `SELECT tags, quality, is_urgent, is_major, rep_article_id, first_seen, updated_at, content_hash
       FROM clusters WHERE id = ?`,
    )
    .get(cid) as Record<string, unknown>;
  assert.equal(r.quality, 90);
  assert.equal(r.is_urgent, 1);
  assert.equal(r.is_major, 0);
  assert.equal(r.rep_article_id, aid);
  assert.equal(r.first_seen, 500);
  assert.equal(r.content_hash, 'deadbeef');
  db.close();
});

test('getClusterRepSource: источник представителя кластера', () => {
  const db = memDb();
  const cid = createCluster(db, 'k', 1000);
  const aid = seedMember(db, cid, { source: 'reuters.com' });
  db.prepare(`UPDATE clusters SET rep_article_id = ? WHERE id = ?`).run(aid, cid);
  assert.equal(getClusterRepSource(db, cid), 'reuters.com');
  db.close();
});

test('getClusterRepSource: нет представителя → undefined', () => {
  const db = memDb();
  const cid = createCluster(db, 'k', 1000);
  assert.equal(getClusterRepSource(db, cid), undefined);
  db.close();
});
