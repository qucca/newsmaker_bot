import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { readEnabledL1Sources } from '../db/sources.js';
import { collectCandidates } from './collect.js';
import type { FeedFetchResult } from './feed.js';
import type { Logger } from '../log/index.js';
import type { RawCandidate, SourceRow } from './types.js';

const silent: Logger = { info() {}, warn() {}, error() {} };
const FIXED_NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function insert(
  db: Database.Database,
  f: { name: string; url: string; kind?: string; enabled?: number },
): number {
  const info = db
    .prepare(`INSERT INTO sources (kind, name, url, lang, enabled) VALUES (?, ?, ?, 'en', ?)`)
    .run(f.kind ?? 'l1_rss', f.name, f.url, f.enabled ?? 1);
  return Number(info.lastInsertRowid);
}

function candidate(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    feedSourceId: 0,
    source: 'example.com',
    lang: 'en',
    title: 'H',
    link: 'https://example.com/x',
    publishedAt: FIXED_NOW - HOUR,
    ...over,
  };
}

function ok(candidates: RawCandidate[], etag: string | null = null): FeedFetchResult {
  return { status: 'ok', candidates, etag, lastModified: null };
}

test('collectCandidates: фетчит только активные L1 и возвращает кандидатов', async () => {
  const db = memDb();
  const keep = insert(db, { name: 'Keep', url: 'https://a.com/feed' });
  insert(db, { name: 'Disabled', url: 'https://b.com/feed', enabled: 0 });
  insert(db, { name: 'GNews', url: 'https://c.com/feed', kind: 'gnews_topic' });

  const fetched: number[] = [];
  const result = await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    fetchFeed: (s: SourceRow) => {
      fetched.push(s.id);
      return Promise.resolve(ok([candidate({ feedSourceId: s.id })]));
    },
  });

  assert.deepEqual(fetched, [keep]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.feedSourceId, keep);
  db.close();
});

test('collectCandidates: изоляция — упавший фид не валит прогон', async () => {
  const db = memDb();
  const bad = insert(db, { name: 'Bad', url: 'https://bad.com/feed' });
  const good = insert(db, { name: 'Good', url: 'https://good.com/feed' });

  const result = await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    fetchFeed: (s: SourceRow) =>
      s.id === bad
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(ok([candidate({ feedSourceId: s.id })])),
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.feedSourceId, good);
  db.close();
});

test('collectCandidates: сохраняет conditional-GET после успешного фетча', async () => {
  const db = memDb();
  insert(db, { name: 'A', url: 'https://a.com/feed' });

  await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    fetchFeed: () => Promise.resolve(ok([candidate()], 'W/"new"')),
  });

  const row = readEnabledL1Sources(db)[0];
  assert.equal(row?.etag, 'W/"new"');
  assert.equal(row?.lastFetchedAt, FIXED_NOW);
  db.close();
});

test('collectCandidates: 304 — без кандидатов, но last_fetched_at обновлён', async () => {
  const db = memDb();
  insert(db, { name: 'A', url: 'https://a.com/feed' });

  const result = await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    fetchFeed: () =>
      Promise.resolve({
        status: 'not-modified',
        candidates: [],
        etag: 'W/"v1"',
        lastModified: 'lm1',
      }),
  });

  assert.equal(result.length, 0);
  const row = readEnabledL1Sources(db)[0];
  assert.equal(row?.lastFetchedAt, FIXED_NOW);
  assert.equal(row?.etag, 'W/"v1"');
  db.close();
});

test('collectCandidates: режет старше окна свежести', async () => {
  const db = memDb();
  insert(db, { name: 'A', url: 'https://a.com/feed' });

  const result = await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    maxAgeMs: 72 * HOUR,
    fetchFeed: () =>
      Promise.resolve(
        ok([
          candidate({ title: 'fresh', publishedAt: FIXED_NOW - 10 * HOUR }),
          candidate({ title: 'stale', publishedAt: FIXED_NOW - 100 * HOUR }),
          candidate({ title: 'undated', publishedAt: null }),
        ]),
      ),
  });

  const titles = result.map((c) => c.title).sort();
  assert.deepEqual(titles, ['fresh', 'undated']);
  db.close();
});

test('collectCandidates: применяет пер-фид кап', async () => {
  const db = memDb();
  insert(db, { name: 'A', url: 'https://a.com/feed' });

  const many = Array.from({ length: 5 }, (_, i) =>
    candidate({ title: `t${i}`, publishedAt: FIXED_NOW - i * HOUR }),
  );
  const result = await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    perFeedCap: 2,
    fetchFeed: () => Promise.resolve(ok(many)),
  });

  assert.equal(result.length, 2);
  db.close();
});

test('collectCandidates: применяет общий кап поверх пер-фид', async () => {
  const db = memDb();
  insert(db, { name: 'A', url: 'https://a.com/feed' });
  insert(db, { name: 'B', url: 'https://b.com/feed' });

  const result = await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    perFeedCap: 10,
    globalCap: 3,
    fetchFeed: () =>
      Promise.resolve(
        ok(Array.from({ length: 5 }, (_, i) => candidate({ publishedAt: FIXED_NOW - i * HOUR }))),
      ),
  });

  assert.equal(result.length, 3);
  db.close();
});

test('collectCandidates: includeGn=true фетчит и gnews_topic', async () => {
  const db = memDb();
  const l1 = insert(db, { name: 'L1', url: 'https://a.com/feed' });
  const gn = insert(db, { name: 'GN', url: 'https://news.google.com/rss', kind: 'gnews_topic' });

  const fetched: number[] = [];
  await collectCandidates(db, {
    now: () => FIXED_NOW,
    logger: silent,
    includeGn: true,
    fetchFeed: (s: SourceRow) => {
      fetched.push(s.id);
      return Promise.resolve(ok([candidate({ feedSourceId: s.id })]));
    },
  });

  assert.deepEqual(
    fetched.sort((a, b) => a - b),
    [l1, gn].sort((a, b) => a - b),
  );
  db.close();
});
