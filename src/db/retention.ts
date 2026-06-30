import type Database from 'better-sqlite3';

// Ретенция БД (пост-MVP тех.долг, PLAN.md). articles копит строки на все прогоны, clusters —
// на все окна; без чистки БД растёт неограниченно. Один прогон удаляет всё старше горизонта.
//
// Порядок и каскады (схема 0001):
//   * clusters по updated_at: кластер старше окна ранжирования (SCORE_WINDOW) уже не отправляется,
//     удалять безопасно. summaries и sent_log уезжают каскадом (ON DELETE CASCADE);
//     feedback.cluster_id и articles.cluster_id → NULL (ON DELETE SET NULL — голос/статья сохранены).
//   * articles по fetched_at (когда попали в систему).
//   * feedback / blocked_sources по возрасту НЕ чистим — агрегируемые сигналы обучения.
// Горизонт ОБЯЗАН быть ≥ окон кластеризации/ранжирования (72ч), иначе всплывёт переотправка —
// это гарантирует config (RETENTION_DAYS, дефолт 14д ≫ 72ч).

/**
 * Удаляет кластеры, не обновлявшиеся дольше горизонта (updated_at < cutoff). Каскадом уезжают
 * summaries и sent_log; feedback.cluster_id и articles.cluster_id обнуляются. Возвращает число.
 */
export function deleteOldClusters(db: Database.Database, cutoffMs: number): number {
  return db.prepare(`DELETE FROM clusters WHERE updated_at < ?`).run(cutoffMs).changes;
}

/** Удаляет статьи старше горизонта по fetched_at (когда попали в систему). Возвращает число. */
export function deleteOldArticles(db: Database.Database, cutoffMs: number): number {
  return db.prepare(`DELETE FROM articles WHERE fetched_at < ?`).run(cutoffMs).changes;
}

export interface RetentionResult {
  clusters: number;
  articles: number;
}

/**
 * Один прогон ретенции: всё старше horizonMs относительно now. Кластеры первыми (каскад
 * чистит summaries/sent_log), затем статьи. Возвращает счётчики удалённого.
 */
export function runRetention(
  db: Database.Database,
  now: number,
  horizonMs: number,
): RetentionResult {
  const cutoff = now - horizonMs;
  const clusters = deleteOldClusters(db, cutoff);
  const articles = deleteOldArticles(db, cutoff);
  return { clusters, articles };
}
