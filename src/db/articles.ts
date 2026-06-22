import type Database from 'better-sqlite3';

// Репозиторий кандидатов (таблица articles): вставка с дедупом по canonical_url (T5).
// Дедуп — глобальный (UNIQUE на все прогоны) и «первый победил»: повторно увиденная
// статья не вставляется и не обогащается заново (экономия на Claude в T7). На конфликте —
// ON CONFLICT DO NOTHING.
//
// На будущее (НЕ T5): articles копит строки на все прогоны → понадобится ретенция
// (чистка старше окна кластеризации). Ре-обработка in-place апдейта по тому же URL
// (детект change + ре-нотификация) — post-MVP, упирается в дедуп отправки по cluster_id.

/** Поля кандидата для вставки в articles (то, что известно до обогащения). */
export interface ArticleInsert {
  canonicalUrl: string;
  source: string;
  feedSourceId: number | null;
  lang: string | null;
  title: string;
  publishedAt: number | null;
  fetchedAt: number; // epoch ms
}

const INSERT_ARTICLE = `
  INSERT INTO articles (canonical_url, source, feed_source_id, lang, title, published_at, fetched_at)
  VALUES (@canonicalUrl, @source, @feedSourceId, @lang, @title, @publishedAt, @fetchedAt)
  ON CONFLICT (canonical_url) DO NOTHING`;

/**
 * Вставляет кандидатов, отбрасывая дубли по canonical_url (включая дубли внутри батча).
 * Возвращает число реально вставленных (новых) строк. Вся пачка — в одной транзакции.
 */
export function insertArticles(db: Database.Database, rows: ArticleInsert[]): { inserted: number } {
  const stmt = db.prepare(INSERT_ARTICLE);
  const run = db.transaction((batch: ArticleInsert[]): number => {
    let inserted = 0;
    for (const r of batch) {
      inserted += stmt.run(r).changes; // changes=1 при вставке, 0 при ON CONFLICT DO NOTHING
    }
    return inserted;
  });
  return { inserted: run(rows) };
}
