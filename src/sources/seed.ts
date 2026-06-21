import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { getDatabasePath } from '../config/index.js';
import { openDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { FEEDS_L1, FeedSeedSchema, type FeedSeedInput } from './feeds.l1.js';

// Идемпотентный сидинг реестра L1-фидов из feeds.l1.ts в таблицу sources.
// Upsert по url (UNIQUE): новые — вставляем, существующие — обновляем (name/lang/categories).
// enabled НЕ трогаем при апдейте, чтобы ручное отключение фида переживало повторный сидинг.

export interface SeedResult {
  inserted: number;
  updated: number;
}

/** Валидирует записи и применяет к sources в одной транзакции. */
export function seedSources(db: Database.Database, feeds: FeedSeedInput[]): SeedResult {
  const validated = z.array(FeedSeedSchema).parse(feeds);

  const exists = db.prepare('SELECT 1 FROM sources WHERE url = ?');
  const insert = db.prepare(
    `INSERT INTO sources (kind, name, url, lang, categories, enabled)
     VALUES ('l1_rss', ?, ?, ?, ?, 1)`,
  );
  const update = db.prepare(`UPDATE sources SET name = ?, lang = ?, categories = ? WHERE url = ?`);

  const result: SeedResult = { inserted: 0, updated: 0 };
  const apply = db.transaction((items: FeedSeed[]) => {
    for (const feed of items) {
      const categories = JSON.stringify(feed.categories);
      if (exists.get(feed.url)) {
        update.run(feed.name, feed.lang, categories, feed.url);
        result.updated++;
      } else {
        insert.run(feed.name, feed.url, feed.lang, categories);
        result.inserted++;
      }
    }
  });
  apply(validated);
  return result;
}

type FeedSeed = z.infer<typeof FeedSeedSchema>;

// CLI: `npm run seed:sources`. Применяет миграции (на свежем чекауте) и сидит FEEDS_L1.
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  const db = openDb(getDatabasePath());
  runMigrations(db);
  const result = seedSources(db, FEEDS_L1);
  console.log(`seed:sources — добавлено ${result.inserted}, обновлено ${result.updated}`);
  db.close();
}
