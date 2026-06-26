import type Database from 'better-sqlite3';

// Репозиторий кеша саммари (T11): «глупый» SQL без доменной логики. Кеш-правила
// (сверка content_hash, выбор пар) — в src/render. JSON-поля отдаём строками как в БД.

/** Срез кластера для рендера: факты/сущности (JSON-строки) + хеш-инвалидатор кеша. */
export interface ClusterRenderRow {
  neutralFacts: string | null;
  entities: string;
  contentHash: string | null;
}

const SELECT_CLUSTER = `
  SELECT neutral_facts AS neutralFacts, entities, content_hash AS contentHash
  FROM clusters WHERE id = ?`;

/** Факты/сущности/хеш кластера для рендера; undefined если кластера нет. */
export function selectClusterForRender(
  db: Database.Database,
  clusterId: number,
): ClusterRenderRow | undefined {
  return db.prepare(SELECT_CLUSTER).get(clusterId) as ClusterRenderRow | undefined;
}

/** Строка кеша для сверки и переиспользования. */
export interface SummaryCacheRow {
  title: string;
  summary: string;
  contentHash: string;
}

const SELECT_SUMMARY = `
  SELECT title, summary, content_hash AS contentHash
  FROM summaries WHERE cluster_id = ? AND lang = ?`;

/** Закешированное саммари пары (cluster, lang); undefined если не отрендерено. */
export function getSummary(
  db: Database.Database,
  clusterId: number,
  lang: string,
): SummaryCacheRow | undefined {
  return db.prepare(SELECT_SUMMARY).get(clusterId, lang) as SummaryCacheRow | undefined;
}

/** Полный набор полей для записи строки кеша. */
export interface SummaryWrite {
  clusterId: number;
  lang: string;
  title: string;
  summary: string;
  contentHash: string;
  model: string;
  createdAt: number;
}

const UPSERT_SUMMARY = `
  INSERT INTO summaries (cluster_id, lang, title, summary, content_hash, model, created_at)
  VALUES (@clusterId, @lang, @title, @summary, @contentHash, @model, @createdAt)
  ON CONFLICT (cluster_id, lang) DO UPDATE SET
    title        = excluded.title,
    summary      = excluded.summary,
    content_hash = excluded.content_hash,
    model        = excluded.model,
    created_at   = excluded.created_at`;

/** Вставляет или перезаписывает строку кеша по PK (cluster_id, lang). */
export function upsertSummary(db: Database.Database, row: SummaryWrite): void {
  db.prepare(UPSERT_SUMMARY).run(row);
}
