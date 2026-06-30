import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { insertArticles } from '../db/articles.js';
import { upsertSummary } from '../db/summaries.js';
import { buildUserCards } from './index.js';
import type { UserRow } from '../db/users.js';
import type { ScoredCluster } from '../score/rank.js';

const silent = { info() {}, warn() {}, error() {} };

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedCluster(db: Database.Database): number {
  const info = db
    .prepare(`INSERT INTO clusters (cluster_key, first_seen, updated_at) VALUES ('k', 1, 1)`)
    .run();
  return Number(info.lastInsertRowid);
}

function seedArticle(db: Database.Database, url: string, source: string): number {
  insertArticles(db, [
    {
      canonicalUrl: url,
      source,
      feedSourceId: null,
      lang: 'en',
      title: 'T',
      publishedAt: null,
      fetchedAt: 1,
      description: null,
    },
  ]);
  const r = db.prepare(`SELECT id FROM articles WHERE canonical_url = ?`).get(url) as { id: number };
  return r.id;
}

function seedSummary(db: Database.Database, clusterId: number, title: string): void {
  upsertSummary(db, {
    clusterId,
    lang: 'ru',
    title,
    summary: 'S',
    contentHash: 'h',
    model: 'm',
    createdAt: 1,
  });
}

function user(over: Partial<UserRow> = {}): UserRow {
  return {
    chatId: 1,
    lang: 'ru',
    tz: 'UTC',
    interestTags: [],
    profileText: '',
    readingWindows: [],
    maxItemsPerSend: 5,
    active: 1,
    lastSentAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function scored(over: Partial<ScoredCluster> = {}): ScoredCluster {
  return {
    clusterId: 1,
    repArticleId: 1,
    repSource: 'e.com',
    score: 1,
    matchedTags: ['ai'],
    ...over,
  };
}

test('buildUserCards: happy path — карточка с clusterId', () => {
  const db = memDb();
  const cid = seedCluster(db);
  const aid = seedArticle(db, 'https://techcrunch.com/x', 'techcrunch.com');
  seedSummary(db, cid, 'Заголовок');
  const cards = buildUserCards(
    db,
    user({ lang: 'ru' }),
    [scored({ clusterId: cid, repArticleId: aid, matchedTags: ['ai'] })],
    { logger: silent },
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].clusterId, cid);
  assert.match(cards[0].message.text, /<b>Заголовок<\/b>/);
  assert.match(cards[0].message.text, /Читать в techcrunch\.com/);
  db.close();
});

test('buildUserCards: skip когда нет саммари в кеше', () => {
  const db = memDb();
  const cid = seedCluster(db);
  const aid = seedArticle(db, 'https://e.com/a', 'e.com');
  const cards = buildUserCards(db, user(), [scored({ clusterId: cid, repArticleId: aid })], {
    logger: silent,
  });
  assert.equal(cards.length, 0);
  db.close();
});

test('buildUserCards: skip когда repArticleId null', () => {
  const db = memDb();
  const cid = seedCluster(db);
  seedSummary(db, cid, 'T');
  const cards = buildUserCards(db, user(), [scored({ clusterId: cid, repArticleId: null })], {
    logger: silent,
  });
  assert.equal(cards.length, 0);
  db.close();
});

test('buildUserCards: skip когда представитель не найден', () => {
  const db = memDb();
  const cid = seedCluster(db);
  seedSummary(db, cid, 'T');
  const cards = buildUserCards(db, user(), [scored({ clusterId: cid, repArticleId: 999 })], {
    logger: silent,
  });
  assert.equal(cards.length, 0);
  db.close();
});

test('buildUserCards: в окне калибровки (count < лимит) — кнопки фидбэка есть', () => {
  const db = memDb();
  const cid = seedCluster(db);
  const aid = seedArticle(db, 'https://a.com/x', 'a.com');
  seedSummary(db, cid, 'T');
  const cards = buildUserCards(db, user(), [scored({ clusterId: cid, repArticleId: aid })], {
    logger: silent,
  });
  assert.ok(cards[0].message.replyMarkup !== undefined);
  db.close();
});

test('buildUserCards: после калибровки (count >= лимит) — кнопок нет', () => {
  const db = memDb();
  const cid = seedCluster(db);
  const aid = seedArticle(db, 'https://a.com/x', 'a.com');
  seedSummary(db, cid, 'T');
  db.prepare(
    `INSERT INTO users (chat_id, lang, tz, max_items_per_send, cards_sent_total, created_at, updated_at)
     VALUES (1, 'ru', 'UTC', 5, 1, 0, 0)`,
  ).run(); // lifetime-счётчик = 1
  const cards = buildUserCards(db, user({ chatId: 1 }), [scored({ clusterId: cid, repArticleId: aid })], {
    logger: silent,
    calibrationCards: 1, // cards_sent_total(1) >= лимит(1) → калибровка пройдена
  });
  assert.equal(cards[0].message.replyMarkup, undefined);
  db.close();
});

test('buildUserCards: пропуск одного кластера не валит остальные, порядок сохранён', () => {
  const db = memDb();
  const c1 = seedCluster(db);
  const cBad = seedCluster(db);
  const c3 = seedCluster(db);
  const a1 = seedArticle(db, 'https://a.com/1', 'a.com');
  const a3 = seedArticle(db, 'https://c.com/3', 'c.com');
  seedSummary(db, c1, 'One');
  seedSummary(db, c3, 'Three');
  const cards = buildUserCards(
    db,
    user(),
    [
      scored({ clusterId: c1, repArticleId: a1 }),
      scored({ clusterId: cBad, repArticleId: null }), // skip: нет представителя
      scored({ clusterId: c3, repArticleId: a3 }),
    ],
    { logger: silent },
  );
  assert.deepEqual(
    cards.map((c) => c.clusterId),
    [c1, c3],
  );
  db.close();
});
