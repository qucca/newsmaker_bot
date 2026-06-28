import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { getDatabasePath } from '../config/index.js';
import { openDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { FEEDS_L1, FeedSeedSchema, type FeedSeedInput } from './feeds.l1.js';
import { FEEDS_GN, GnFeedSeedSchema, type GnFeedSeedInput } from './feeds.gn.js';
import { buildGnewsFeedUrl, gnewsFeedName } from './gnews-url.js';

// Идемпотентный сидинг реестра фидов в таблицу sources.
// Upsert по url (UNIQUE): новые — вставляем, существующие — обновляем (name/lang/categories).
// enabled НЕ трогаем при апдейте, чтобы ручное отключение фида переживало повторный сидинг.
// L1 (kind='l1_rss') и GN (kind='gnews_topic') сидятся через общий upsertFeeds.

export interface SeedResult {
  inserted: number;
  updated: number;
}

/** Нормализованная строка фида для upsert (url — ключ). */
interface FeedRow {
  name: string;
  url: string;
  lang: string;
  categories: string[];
}

/** Общий идемпотентный upsert фидов с заданным kind, в одной транзакции. */
function upsertFeeds(db: Database.Database, rows: FeedRow[], kind: string): SeedResult {
  const exists = db.prepare('SELECT 1 FROM sources WHERE url = ?');
  const insert = db.prepare(
    `INSERT INTO sources (kind, name, url, lang, categories, enabled)
     VALUES (?, ?, ?, ?, ?, 1)`,
  );
  const update = db.prepare(`UPDATE sources SET name = ?, lang = ?, categories = ? WHERE url = ?`);

  const result: SeedResult = { inserted: 0, updated: 0 };
  const apply = db.transaction((items: FeedRow[]) => {
    for (const feed of items) {
      const categories = JSON.stringify(feed.categories);
      if (exists.get(feed.url)) {
        update.run(feed.name, feed.lang, categories, feed.url);
        result.updated++;
      } else {
        insert.run(kind, feed.name, feed.url, feed.lang, categories);
        result.inserted++;
      }
    }
  });
  apply(rows);
  return result;
}

/** Валидирует L1-записи и применяет к sources (kind='l1_rss'). */
export function seedSources(db: Database.Database, feeds: FeedSeedInput[]): SeedResult {
  const validated = z.array(FeedSeedSchema).parse(feeds);
  return upsertFeeds(db, validated, 'l1_rss');
}

/**
 * Валидирует GN-записи и применяет к sources (kind='gnews_topic'). URL и имя деривируются из
 * hl/gl/ceid/topic — пользователь даёт только маппинг, не собирает ссылку руками.
 */
export function seedGnSources(db: Database.Database, feeds: GnFeedSeedInput[]): SeedResult {
  const validated = z.array(GnFeedSeedSchema).parse(feeds);
  const rows: FeedRow[] = validated.map((f) => ({
    name: gnewsFeedName({ topic: f.topic, hl: f.hl }),
    url: buildGnewsFeedUrl({ hl: f.hl, gl: f.gl, ceid: f.ceid, topic: f.topic }),
    lang: f.lang,
    categories: f.categories,
  }));
  return upsertFeeds(db, rows, 'gnews_topic');
}

// CLI: `npm run seed:sources`. Применяет миграции (на свежем чекауте) и сидит L1 + GN.
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  const db = openDb(getDatabasePath());
  runMigrations(db);
  const l1 = seedSources(db, FEEDS_L1);
  const gn = seedGnSources(db, FEEDS_GN);
  console.log(
    `seed:sources — L1: +${l1.inserted}/~${l1.updated}, GN: +${gn.inserted}/~${gn.updated}`,
  );
  db.close();
}
