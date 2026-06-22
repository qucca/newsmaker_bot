import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import type { Logger } from '../log/index.js';
import { persistCandidates } from './persist.js';
import type { RawCandidate } from './types.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  // Источник-провенанс (articles.feed_source_id REFERENCES sources.id).
  db.prepare(
    `INSERT INTO sources (id, kind, name, url, lang) VALUES (1, 'l1_rss', 'A', 'https://a/feed', 'en')`,
  ).run();
  return db;
}

const silent: Logger = { info() {}, warn() {}, error() {} };

function cand(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    feedSourceId: 1,
    source: 'e.com',
    lang: 'en',
    title: 'Title',
    link: 'https://e.com/a',
    publishedAt: 1000,
    ...over,
  };
}

function readUrls(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT canonical_url FROM articles ORDER BY id`).all() as {
      canonical_url: string;
    }[]
  ).map((r) => r.canonical_url);
}

test('persistCandidates: канонизирует и пишет кандидатов в articles', () => {
  const db = memDb();
  const res = persistCandidates(
    db,
    [cand({ link: 'http://www.e.com/a/' }), cand({ link: 'https://e.com/b?utm_source=x' })],
    { logger: silent, now: () => 42 },
  );
  assert.equal(res.collected, 2);
  assert.equal(res.dropped, 0);
  assert.equal(res.inserted, 2);
  assert.deepEqual(readUrls(db), ['https://e.com/a', 'https://e.com/b']);
  db.close();
});

test('persistCandidates: непарсимый URL отбрасывается, прогон не падает', () => {
  const db = memDb();
  const res = persistCandidates(
    db,
    [cand({ link: 'not a url' }), cand({ link: 'https://e.com/ok' })],
    {
      logger: silent,
      now: () => 42,
    },
  );
  assert.equal(res.collected, 2);
  assert.equal(res.dropped, 1);
  assert.equal(res.inserted, 1);
  assert.deepEqual(readUrls(db), ['https://e.com/ok']);
  db.close();
});

test('persistCandidates: кандидаты, схлопывающиеся в один canonical_url, дедупятся', () => {
  const db = memDb();
  const res = persistCandidates(
    db,
    [cand({ link: 'http://www.x.com/a?utm_source=y' }), cand({ link: 'https://x.com/a#top' })],
    { logger: silent, now: () => 42 },
  );
  assert.equal(res.inserted, 1);
  assert.deepEqual(readUrls(db), ['https://x.com/a']);
  db.close();
});

test('persistCandidates: fetched_at берётся из инъекции now()', () => {
  const db = memDb();
  persistCandidates(db, [cand({ link: 'https://e.com/a' })], { logger: silent, now: () => 777 });
  const r = db
    .prepare(`SELECT fetched_at FROM articles WHERE canonical_url = 'https://e.com/a'`)
    .get() as {
    fetched_at: number;
  };
  assert.equal(r.fetched_at, 777);
  db.close();
});

test('persistCandidates: отброшенный кандидат логируется как warn', () => {
  const db = memDb();
  let warnings = 0;
  const logger: Logger = {
    info() {},
    warn() {
      warnings++;
    },
    error() {},
  };
  persistCandidates(db, [cand({ link: 'not a url' })], { logger, now: () => 1 });
  assert.equal(warnings, 1);
  db.close();
});
