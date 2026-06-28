import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedGnSources } from './seed.js';
import type { GnFeedSeedInput } from './feeds.gn.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

interface SourceRowSlice {
  kind: string;
  name: string;
  url: string;
  lang: string;
  categories: string;
}

test('seedGnSources: вставляет GN-фид с kind=gnews_topic, url и имя деривируются', () => {
  const db = memDb();
  const feed: GnFeedSeedInput = {
    lang: 'en',
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
    topic: 'WORLD',
    categories: ['world'],
  };
  const res = seedGnSources(db, [feed]);
  assert.equal(res.inserted, 1);
  const row = db.prepare('SELECT kind, name, url, lang, categories FROM sources').get() as SourceRowSlice;
  assert.equal(row.kind, 'gnews_topic');
  assert.equal(
    row.url,
    'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
  );
  assert.equal(row.name, 'Google News: World (en-US)');
  assert.equal(row.lang, 'en');
  assert.deepEqual(JSON.parse(row.categories), ['world']);
  db.close();
});

test('seedGnSources: идемпотентно по url', () => {
  const db = memDb();
  const feed: GnFeedSeedInput = { lang: 'en', hl: 'en-US', gl: 'US', ceid: 'US:en', topic: 'TOP' };
  seedGnSources(db, [feed]);
  const res = seedGnSources(db, [feed]);
  assert.equal(res.inserted, 0);
  assert.equal(res.updated, 1);
  db.close();
});

test('seedGnSources: невалидный topic бросает', () => {
  const db = memDb();
  const bad = { lang: 'en', hl: 'en-US', gl: 'US', ceid: 'US:en', topic: 'BOGUS' } as unknown as GnFeedSeedInput;
  assert.throws(() => seedGnSources(db, [bad]));
  db.close();
});
