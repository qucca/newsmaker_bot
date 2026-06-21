import type Database from 'better-sqlite3';
import type { SourceRow } from '../sources/types.js';

// Репозиторий реестра фидов (таблица sources): чтение активных L1 и запись
// conditional-GET состояния после фетча (T4).

const SELECT_ENABLED_L1 = `
  SELECT id, kind, name, url, lang, categories, enabled,
         etag,
         last_modified   AS lastModified,
         last_fetched_at AS lastFetchedAt
  FROM sources
  WHERE enabled = 1 AND kind = 'l1_rss'
  ORDER BY id`;

/** Активные L1-фиды (enabled=1, kind='l1_rss'), поля в camelCase. */
export function readEnabledL1Sources(db: Database.Database): SourceRow[] {
  // .all() возвращает unknown[]; форма строк гарантирована SELECT-алиасами выше.
  return db.prepare(SELECT_ENABLED_L1).all() as SourceRow[];
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
