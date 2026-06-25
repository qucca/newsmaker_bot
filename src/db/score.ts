import type Database from 'better-sqlite3';

// Репозиторий ранжирования (T10): «глупый» SQL без доменной логики. Доменные правила
// (скор, тай-брейки) — в src/score. source_count считаем на лету COUNT(DISTINCT source).

/** Кандидат-кластер для ранжирования. tags — JSON-строка (парсит ядро ранжирования). */
export interface CandidateRow {
  id: number;
  tags: string;
  quality: number | null;
  isMajor: number;
  updatedAt: number;
  repArticleId: number | null;
  repSource: string | null;
  sourceCount: number;
}

const SELECT_CANDIDATES = `
  SELECT c.id, c.tags, c.quality, c.is_major AS isMajor,
         c.updated_at AS updatedAt, c.rep_article_id AS repArticleId,
         r.source AS repSource,
         (SELECT COUNT(DISTINCT a.source) FROM articles a WHERE a.cluster_id = c.id) AS sourceCount
  FROM clusters c
  LEFT JOIN articles r ON r.id = c.rep_article_id
  WHERE c.updated_at >= @minUpdated
    AND c.id NOT IN (SELECT cluster_id FROM sent_log WHERE chat_id = @chatId)`;

/** Кластеры в окне свежести (updated_at >= minUpdated), НЕ отправленные юзеру. */
export function selectCandidateClusters(
  db: Database.Database,
  chatId: number,
  minUpdated: number,
): CandidateRow[] {
  return db.prepare(SELECT_CANDIDATES).all({ chatId, minUpdated }) as CandidateRow[];
}

/** Множество заблокированных юзером источников. */
export function selectBlockedSources(db: Database.Database, chatId: number): Set<string> {
  const rows = db
    .prepare(`SELECT source FROM blocked_sources WHERE chat_id = ?`)
    .all(chatId) as { source: string }[];
  return new Set(rows.map((r) => r.source));
}

/** Свёртка фидбэка: источник → нетто SUM(vote) (отрицательное = больше дизлайков). */
export function selectSourcePenalties(db: Database.Database, chatId: number): Map<string, number> {
  const rows = db
    .prepare(`SELECT source, SUM(vote) AS net FROM feedback WHERE chat_id = ? GROUP BY source`)
    .all(chatId) as { source: string; net: number }[];
  return new Map(rows.map((r) => [r.source, r.net]));
}
