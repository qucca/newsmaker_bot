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
  description: string | null; // RSS-сниппет, вход обогащения T7
}

const INSERT_ARTICLE = `
  INSERT INTO articles (canonical_url, source, feed_source_id, lang, title, published_at, fetched_at, description)
  VALUES (@canonicalUrl, @source, @feedSourceId, @lang, @title, @publishedAt, @fetchedAt, @description)
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

/** Кандидат, ещё не прошедший обогащение (вход T7). */
export interface UnenrichedArticle {
  id: number;
  source: string;
  lang: string | null;
  title: string;
  description: string | null;
}

const SELECT_UNENRICHED = `
  SELECT id, source, lang, title, description
  FROM articles
  WHERE enriched_at IS NULL
  ORDER BY id
  LIMIT @limit`;

/** Необогащённые кандидаты (partial-индекс idx_articles_unenriched), по id, с капом. */
export function selectUnenriched(db: Database.Database, limit: number): UnenrichedArticle[] {
  return db.prepare(SELECT_UNENRICHED).all({ limit }) as UnenrichedArticle[];
}

/** Результат обогащения одной статьи (для записи в articles). */
export interface EnrichmentWrite {
  id: number;
  clusterKey: string;
  entities: string[];
  tags: string[];
  quality: number;
  isUrgent: boolean;
  isMajor: boolean;
  neutralFacts: string[];
  regions: string[];
  enrichedAt: number; // epoch ms
}

const UPDATE_ENRICHMENT = `
  UPDATE articles SET
    enriched_at   = @enrichedAt,
    cluster_key   = @clusterKey,
    entities      = @entities,
    tags          = @tags,
    quality       = @quality,
    is_urgent     = @isUrgent,
    is_major      = @isMajor,
    neutral_facts = @neutralFacts,
    regions       = @regions
  WHERE id = @id`;

/**
 * Пишет результаты обогащения пачкой в одной транзакции. JSON-поля сериализуются,
 * boolean → 0/1 (под CHECK-констрейнты). Возвращает число обновлённых строк.
 */
export function writeEnrichment(
  db: Database.Database,
  rows: EnrichmentWrite[],
): { updated: number } {
  const stmt = db.prepare(UPDATE_ENRICHMENT);
  const run = db.transaction((batch: EnrichmentWrite[]): number => {
    let updated = 0;
    for (const r of batch) {
      updated += stmt.run({
        id: r.id,
        enrichedAt: r.enrichedAt,
        clusterKey: r.clusterKey,
        entities: JSON.stringify(r.entities),
        tags: JSON.stringify(r.tags),
        quality: r.quality,
        isUrgent: r.isUrgent ? 1 : 0,
        isMajor: r.isMajor ? 1 : 0,
        neutralFacts: JSON.stringify(r.neutralFacts),
        regions: JSON.stringify(r.regions),
      }).changes;
    }
    return updated;
  });
  return { updated: run(rows) };
}

/** Кандидат, обогащённый, но ещё не кластеризованный (вход T8). */
export interface UnclusteredArticle {
  id: number;
  clusterKey: string | null;
  publishedAt: number | null;
  fetchedAt: number;
}

const SELECT_UNCLUSTERED = `
  SELECT id, cluster_key AS clusterKey, published_at AS publishedAt, fetched_at AS fetchedAt
  FROM articles
  WHERE enriched_at IS NOT NULL AND cluster_id IS NULL
  ORDER BY id
  LIMIT @limit`;

/** Обогащённые статьи без кластера (partial-индекс idx_articles_unclustered), с капом. */
export function selectUnclustered(db: Database.Database, limit: number): UnclusteredArticle[] {
  return db.prepare(SELECT_UNCLUSTERED).all({ limit }) as UnclusteredArticle[];
}

const ASSIGN_CLUSTER = `UPDATE articles SET cluster_id = @clusterId WHERE id = @id`;

/** Привязывает статью к кластеру (cluster_id ссылается на существующий clusters.id). */
export function assignCluster(db: Database.Database, id: number, clusterId: number): void {
  db.prepare(ASSIGN_CLUSTER).run({ id, clusterId });
}

/** Представитель кластера для ссылки в карточке (T12). */
export interface RepresentativeRow {
  url: string; // canonical_url
  source: string; // хост издания (без www), напр. "techcrunch.com"
}

const SELECT_REPRESENTATIVE = `
  SELECT canonical_url AS url, source
  FROM articles
  WHERE id = ?`;

/** URL и источник статьи-представителя по её id; undefined если строки нет. */
export function selectRepresentative(
  db: Database.Database,
  articleId: number,
): RepresentativeRow | undefined {
  return db.prepare(SELECT_REPRESENTATIVE).get(articleId) as RepresentativeRow | undefined;
}
