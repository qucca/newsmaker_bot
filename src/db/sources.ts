import type Database from 'better-sqlite3';
import type { SourceRow } from '../sources/types.js';

// Репозиторий реестра фидов (таблица sources): чтение активных L1 и запись
// conditional-GET состояния после фетча (T4).

const SELECT_ENABLED_COLUMNS = `
  SELECT id, kind, name, url, lang, categories, enabled,
         etag,
         last_modified   AS lastModified,
         last_fetched_at AS lastFetchedAt
  FROM sources
  WHERE enabled = 1 AND kind IN`;

// gnews_search (точечный keyword под юзера) — за пределами MVP, в прогон не берётся даже при GN.
const KINDS_L1 = ['l1_rss'];
const KINDS_WITH_GN = ['l1_rss', 'gnews_topic'];

/**
 * Активные фиды (enabled=1), поля в camelCase. По умолчанию только L1; includeGn добавляет
 * Google News (kind='gnews_topic'). Kill-switch GOOGLE_NEWS_ENABLED прокидывается сюда из collect.
 */
export function readEnabledFeedSources(
  db: Database.Database,
  opts: { includeGn?: boolean } = {},
): SourceRow[] {
  const kinds = opts.includeGn ? KINDS_WITH_GN : KINDS_L1;
  const placeholders = kinds.map(() => '?').join(', ');
  const sql = `${SELECT_ENABLED_COLUMNS} (${placeholders}) ORDER BY id`;
  // .all() возвращает unknown[]; форма строк гарантирована SELECT-алиасами выше.
  return db.prepare(sql).all(...kinds) as SourceRow[];
}

/** Активные L1-фиды (enabled=1, kind='l1_rss'). Тонкая обёртка над readEnabledFeedSources. */
export function readEnabledL1Sources(db: Database.Database): SourceRow[] {
  return readEnabledFeedSources(db, { includeGn: false });
}

export interface ConditionalGetUpdate {
  etag: string | null;
  lastModified: string | null;
  fetchedAt: number; // epoch ms
}

/** Сохраняет валидаторы и время последнего фетча фида. */
export function updateConditionalGet(
  db: Database.Database,
  id: number,
  update: ConditionalGetUpdate,
): void {
  db.prepare(
    `UPDATE sources SET etag = ?, last_modified = ?, last_fetched_at = ? WHERE id = ?`,
  ).run(update.etag, update.lastModified, update.fetchedAt, id);
}
