import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedSources } from './seed.js';
import type { FeedSeedInput } from './feeds.l1.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function feed(over: Partial<FeedSeedInput> = {}): FeedSeedInput {
  return { name: 'A', url: 'https://a.com/feed', lang: 'en', categories: [], ...over };
}

function count(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM sources').get() as { c: number }).c;
}

test('seedSources: вставляет новые фиды', () => {
  const db = memDb();
  const res = seedSources(db, [feed(), feed({ name: 'B', url: 'https://b.com/feed' })]);
  assert.equal(res.inserted, 2);
  assert.equal(res.updated, 0);
  assert.equal(count(db), 2);
  db.close();
});

test('seedSources: идемпотентно — повтор не плодит дубли', () => {
  const db = memDb();
  seedSources(db, [feed()]);
  const res = seedSources(db, [feed()]);
  assert.equal(res.inserted, 0);
  assert.equal(res.updated, 1);
  assert.equal(count(db), 1);
  db.close();
});

test('seedSources: обновляет name/categories по url', () => {
  const db = memDb();
  seedSources(db, [feed()]);
  seedSources(db, [feed({ name: 'Renamed', categories: ['world'] })]);
  const row = db
    .prepare('SELECT name, categories FROM sources WHERE url = ?')
    .get('https://a.com/feed') as { name: string; categories: string };
  assert.equal(row.name, 'Renamed');
  assert.deepEqual(JSON.parse(row.categories), ['world']);
  db.close();
});

test('seedSources: categories по умолчанию []', () => {
  const db = memDb();
  seedSources(db, [{ name: 'A', url: 'https://a.com/feed', lang: 'en' }]);
  const row = db
    .prepare('SELECT categories FROM sources WHERE url = ?')
    .get('https://a.com/feed') as { categories: string };
  assert.deepEqual(JSON.parse(row.categories), []);
  db.close();
});

test('seedSources: валидирует — кривой url бросает', () => {
  const db = memDb();
  assert.throws(() => seedSources(db, [feed({ url: 'not-a-url' })]));
  db.close();
});
