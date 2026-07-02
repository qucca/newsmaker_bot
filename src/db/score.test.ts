import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  selectCandidateClusters,
  selectBlockedSources,
  selectReasonPenalties,
} from './score.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedUser(db: Database.Database, chatId: number): void {
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at)
     VALUES (?, 'en', 'UTC', 5, 0, 0)`,
  ).run(chatId);
}

function seedCluster(db: Database.Database, over: Record<string, unknown> = {}): number {
  const v = {
    clusterKey: 'k', tags: '["ai"]', quality: 50, isMajor: 0, isUrgent: 0,
    repId: null, firstSeen: 1000, updatedAt: 1000, ...over,
  };
  const info = db
    .prepare(
      `INSERT INTO clusters (cluster_key, tags, quality, is_major, is_urgent,
         rep_article_id, first_seen, updated_at)
       VALUES (@clusterKey, @tags, @quality, @isMajor, @isUrgent, @repId, @firstSeen, @updatedAt)`,
    )
    .run(v);
  return Number(info.lastInsertRowid);
}

let seq = 0;
function seedArticle(db: Database.Database, clusterId: number, source: string): number {
  const info = db
    .prepare(
      `INSERT INTO articles (canonical_url, source, title, fetched_at, cluster_id)
       VALUES (?, ?, 'T', 0, ?)`,
    )
    .run(`https://x/${seq++}`, source, clusterId);
  return Number(info.lastInsertRowid);
}

test('selectCandidateClusters: фильтрует по окну updated_at >= minUpdated', () => {
  const db = memDb();
  seedUser(db, 1);
  seedCluster(db, { updatedAt: 100 });
  const fresh = seedCluster(db, { updatedAt: 500 });
  const got = selectCandidateClusters(db, 1, 200);
  assert.deepEqual(got.map((c) => c.id), [fresh]);
  db.close();
});

test('selectCandidateClusters: исключает отправленные этому юзеру, но не другому', () => {
  const db = memDb();
  seedUser(db, 1);
  seedUser(db, 2);
  const c1 = seedCluster(db, { updatedAt: 500 });
  const c2 = seedCluster(db, { updatedAt: 500 });
  db.prepare(`INSERT INTO sent_log (chat_id, cluster_id, sent_at) VALUES (1, ?, 0)`).run(c1);
  const got1 = selectCandidateClusters(db, 1, 0)
    .map((c) => c.id)
    .sort((a, b) => a - b);
  assert.deepEqual(got1, [c2]);
  const got2 = selectCandidateClusters(db, 2, 0)
    .map((c) => c.id)
    .sort((a, b) => a - b);
  assert.deepEqual(got2, [c1, c2]);
  db.close();
});

test('selectCandidateClusters: repSource из rep-статьи, sourceCount = DISTINCT источников', () => {
  const db = memDb();
  seedUser(db, 1);
  const cid = seedCluster(db, { updatedAt: 500 });
  const repId = seedArticle(db, cid, 'reuters.com');
  seedArticle(db, cid, 'reuters.com'); // дубликат источника
  seedArticle(db, cid, 'bbc.com');
  db.prepare(`UPDATE clusters SET rep_article_id = ? WHERE id = ?`).run(repId, cid);
  const got = selectCandidateClusters(db, 1, 0);
  assert.equal(got.length, 1);
  assert.equal(got[0].repSource, 'reuters.com');
  assert.equal(got[0].sourceCount, 2); // reuters + bbc
  db.close();
});

test('selectCandidateClusters: срочные кластеры тоже попадают в кандидаты', () => {
  const db = memDb();
  seedUser(db, 1);
  const cid = seedCluster(db, { updatedAt: 500, isUrgent: 1 });
  const got = selectCandidateClusters(db, 1, 0);
  assert.deepEqual(got.map((c) => c.id), [cid]);
  db.close();
});

test('selectBlockedSources: возвращает множество источников юзера', () => {
  const db = memDb();
  seedUser(db, 1);
  db.prepare(`INSERT INTO blocked_sources (chat_id, source, created_at) VALUES (1, 'tass.ru', 0)`).run();
  const got = selectBlockedSources(db, 1);
  assert.ok(got.has('tass.ru'));
  assert.equal(got.size, 1);
  db.close();
});

test('selectReasonPenalties: net по (reason_type, reason_key), лайки без причины не в счёт', () => {
  const db = memDb();
  db.prepare(`INSERT INTO users (chat_id, lang, tz, max_items_per_send, created_at, updated_at) VALUES (1,'ru','UTC',5,0,0)`).run();
  const mk = (cid: number, vote: number, rt: string | null, rk: string | null) => {
    db.prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k',1,1)`).run();
    db.prepare(`INSERT INTO feedback (chat_id, cluster_id, vote, source, reason_type, reason_key, created_at)
                VALUES (1, ?, ?, 'e.com', ?, ?, 0)`).run(cid, vote, rt, rk);
  };
  mk(1, -1, 'pair', 'football|RU');
  mk(2, -1, 'pair', 'football|RU'); // две разные истории → net -2
  mk(3, -1, 'tag', 'football');
  mk(4, 1, null, null); // лайк без причины — игнор
  const p = selectReasonPenalties(db, 1);
  assert.equal(p.pair.get('football|RU'), -2);
  assert.equal(p.tag.get('football'), -1);
  assert.equal(p.source.size, 0);
});
